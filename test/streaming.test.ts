/**
 * Unit tests for StreamingSender.
 *
 * Covers:
 *  - Basic flow: feed chunks → flush → finalize
 *  - minChars threshold triggers immediate flush
 *  - idleMs timer triggers flush
 *  - sendMessage failure is recorded but doesn't throw
 *  - cancel() vs finalize(): both emit FINISH, cancel marks cancelled
 *  - MEDIA: directive stripping from streamed text + path collection
 *  - All packets share the same client_id (logical message grouping)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pino from "pino";

import { StreamingSender } from "../src/bot/streaming.js";
import { MessageItemType, MessageState, MessageType } from "../src/wechat/types.js";
import type { SendMessageReq, WechatApiClient } from "../src/wechat/api.js";

/** Minimal interface surface that StreamingSender actually calls. */
interface FakeApi {
  sendMessage: (req: SendMessageReq) => Promise<void>;
}

/** Captured packet in the order sendMessage was called. */
interface CapturedPacket {
  state: MessageState;
  text: string;
  clientId: string;
}

function makeSender(opts: {
  sendImpl?: (req: SendMessageReq) => Promise<void>;
  minChars?: number;
  idleMs?: number;
  maxChars?: number;
} = {}): { sender: StreamingSender; captured: CapturedPacket[]; api: FakeApi & WechatApiClient } {
  const captured: CapturedPacket[] = [];
  const sendImpl =
    opts.sendImpl ??
    (async (req: SendMessageReq) => {
      const item = req.msg?.item_list?.[0];
      const text = item?.type === MessageItemType.TEXT ? (item.text_item?.text ?? "") : "";
      captured.push({
        state: req.msg?.message_state ?? MessageState.FINISH,
        text,
        clientId: req.msg?.client_id ?? "",
      });
    });
  const api = { sendMessage: sendImpl } as unknown as FakeApi & WechatApiClient;
  const log = pino({ level: "silent" });
  const sender = new StreamingSender({
    api,
    toUserId: "user-1",
    contextToken: "ctx-token",
    log,
    minChars: opts.minChars,
    idleMs: opts.idleMs,
    maxChars: opts.maxChars,
  });
  return { sender, captured, api };
}

/** Flush all microtasks (lets inflight promises settle). */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((r) => setImmediate(r));
  await new Promise<void>((r) => setImmediate(r));
}

describe("StreamingSender", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("basic flow", () => {
    it("emits a single FINISH packet on finalize with no intermediate feed", async () => {
      const { sender, captured } = makeSender({ minChars: 100, idleMs: 60_000 });
      sender.feed("hello world");
      expect(captured).toHaveLength(0); // not yet — pending < minChars and no flush
      await sender.finalize();
      await flushMicrotasks();

      expect(captured).toHaveLength(1);
      expect(captured[0].state).toBe(MessageState.FINISH);
      expect(captured[0].text).toBe("hello world");
    });

    it("all packets share the same client_id (logical message grouping)", async () => {
      const { sender, captured } = makeSender({ minChars: 5, idleMs: 60_000 });
      sender.feed("aaaa");
      await flushMicrotasks();
      sender.feed("bbbb");
      await flushMicrotasks();
      sender.feed("cccc");
      await flushMicrotasks();
      await sender.finalize();
      await flushMicrotasks();

      const ids = new Set(captured.map((p) => p.clientId));
      expect(ids.size).toBe(1);
      expect(sender.client_id).toBe(captured[0].clientId);
    });

    it("each packet carries the full accumulated text (Strategy A)", async () => {
      // minChars=4 so each 4-char feed triggers its own threshold flush.
      const { sender, captured } = makeSender({ minChars: 4, idleMs: 60_000 });
      sender.feed("aaaa");
      await flushMicrotasks();
      sender.feed("bbbb");
      await flushMicrotasks();
      sender.feed("cccc");
      await flushMicrotasks();
      await sender.finalize();
      await flushMicrotasks();

      // Filter to GENERATING packets (finalize() may emit an empty FINISH
      // marker packet after the last full one).
      const generating = captured.filter((p) => p.state === MessageState.GENERATING);
      expect(generating.map((p) => p.text)).toEqual(["aaaa", "aaaabbbb", "aaaabbbbcccc"]);
    });

    it("intermediate packets use GENERATING, last packet uses FINISH", async () => {
      const { sender, captured } = makeSender({ minChars: 3, idleMs: 60_000 });
      sender.feed("aaa");
      await flushMicrotasks();
      sender.feed("bbb");
      await flushMicrotasks();
      await sender.finalize();
      await flushMicrotasks();

      expect(captured.map((p) => p.state)).toEqual([
        MessageState.GENERATING,
        MessageState.GENERATING,
        MessageState.FINISH,
      ]);
    });

    it("empty feed is a no-op", async () => {
      const { sender, captured } = makeSender({ minChars: 100, idleMs: 60_000 });
      sender.feed("");
      expect(captured).toHaveLength(0);
      await sender.finalize();
      await flushMicrotasks();
      expect(captured).toHaveLength(1);
    });

    it("feed after finalize is ignored", async () => {
      const { sender, captured } = makeSender({ minChars: 5, idleMs: 60_000 });
      sender.feed("first");
      await sender.finalize();
      await flushMicrotasks();
      const countAfterFinalize = captured.length;
      sender.feed("ignored");
      await flushMicrotasks();
      expect(captured.length).toBe(countAfterFinalize);
    });
  });

  describe("minChars threshold", () => {
    it("flushes immediately when pending crosses minChars", async () => {
      const { sender, captured } = makeSender({ minChars: 10, idleMs: 60_000 });
      sender.feed("a".repeat(5));
      await flushMicrotasks();
      expect(captured).toHaveLength(0);

      sender.feed("b".repeat(5)); // 5+5=10, hits threshold
      await flushMicrotasks();
      expect(captured.length).toBeGreaterThanOrEqual(1);
      expect(captured[0].text).toBe("a".repeat(5) + "b".repeat(5));
    });

    it("does NOT flush when pending stays below minChars and timer hasn't fired", async () => {
      vi.useFakeTimers();
      const { sender, captured } = makeSender({ minChars: 100, idleMs: 10_000 });
      sender.feed("short");
      await vi.advanceTimersByTimeAsync(5_000);
      expect(captured).toHaveLength(0);
      vi.useRealTimers();
    });
  });

  describe("idleMs timer", () => {
    it("flushes after idleMs even when pending stays small", async () => {
      vi.useFakeTimers();
      const { sender, captured } = makeSender({ minChars: 1000, idleMs: 3_000 });
      sender.feed("tiny");
      // Nothing flushed yet
      expect(captured).toHaveLength(0);
      // Advance past idle threshold. advanceTimersByTimeAsync also flushes
      // microtasks queued by the timer callback, so we don't need a separate
      // flushMicrotasks() call (which would hang on the real setImmediate).
      await vi.advanceTimersByTimeAsync(3_500);
      expect(captured.length).toBeGreaterThanOrEqual(1);
      expect(captured[0].text).toBe("tiny");
      vi.useRealTimers();
    });

    it("resets the timer on each new feed", async () => {
      vi.useFakeTimers();
      const { sender, captured } = makeSender({ minChars: 1000, idleMs: 3_000 });
      sender.feed("a");
      await vi.advanceTimersByTimeAsync(2_500);
      sender.feed("b"); // resets timer
      await vi.advanceTimersByTimeAsync(2_500); // total 5s but timer only at 2.5s
      expect(captured).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1_000); // now 3.5s since last feed
      expect(captured.length).toBeGreaterThanOrEqual(1);
      vi.useRealTimers();
    });

    it("timer is cleared on finalize", async () => {
      vi.useFakeTimers();
      const { sender, captured } = makeSender({ minChars: 1000, idleMs: 3_000 });
      sender.feed("partial");
      await sender.finalize();
      expect(captured.length).toBe(1);
      // Advancing time after finalize should NOT trigger any more sends
      await vi.advanceTimersByTimeAsync(10_000);
      expect(captured.length).toBe(1);
      vi.useRealTimers();
    });
  });

  describe("failure handling", () => {
    it("sendMessage failure sets hasErrors() and does NOT throw", async () => {
      const { sender, captured } = makeSender({
        minChars: 5,
        idleMs: 60_000,
        sendImpl: async () => {
          throw new Error("network down");
        },
      });
      sender.feed("aaaaa"); // hits minChars → triggers flush
      await flushMicrotasks();
      expect(sender.hasErrors()).toBe(true);
      // captured stays empty because the impl throws before pushing
      expect(captured).toHaveLength(0);

      // Further feeds should still work (no throw, no abort)
      sender.feed("bbbbb");
      await flushMicrotasks();
      expect(sender.hasErrors()).toBe(true);

      await sender.finalize();
      await flushMicrotasks();
      expect(sender.hasErrors()).toBe(true);
    });

    it("successful sends after a failure still update hasStarted()", async () => {
      let calls = 0;
      const { sender } = makeSender({
        minChars: 5,
        idleMs: 60_000,
        sendImpl: async () => {
          calls += 1;
          if (calls === 1) throw new Error("first call fails");
          // succeed otherwise
        },
      });
      sender.feed("aaaaa");
      await flushMicrotasks();
      expect(sender.hasErrors()).toBe(true);
      expect(sender.hasStarted()).toBe(false);

      sender.feed("bbbbb");
      await flushMicrotasks();
      expect(sender.hasStarted()).toBe(true);
    });

    it("hasStarted() is false when no packet succeeded", async () => {
      const { sender } = makeSender({
        minChars: 5,
        idleMs: 60_000,
        sendImpl: async () => {
          throw new Error("always fails");
        },
      });
      sender.feed("aaaaa");
      await flushMicrotasks();
      await sender.finalize();
      await flushMicrotasks();
      expect(sender.hasStarted()).toBe(false);
      expect(sender.hasErrors()).toBe(true);
    });
  });

  describe("cancel vs finalize", () => {
    it("cancel() emits a FINISH packet and marks cancelled", async () => {
      // minChars above feed length so cancel() is the only flusher.
      const { sender, captured } = makeSender({ minChars: 1000, idleMs: 60_000 });
      sender.feed("partial");
      await sender.cancel();
      await flushMicrotasks();
      expect(sender.isCancelled()).toBe(true);
      expect(captured.length).toBe(1);
      expect(captured[0].state).toBe(MessageState.FINISH);
      expect(captured[0].text).toBe("partial");
    });

    it("feed() after cancel() is ignored", async () => {
      const { sender, captured } = makeSender({ minChars: 1000, idleMs: 60_000 });
      sender.feed("first");
      await sender.cancel();
      await flushMicrotasks();
      const after = captured.length;
      sender.feed("ignored");
      await flushMicrotasks();
      expect(captured.length).toBe(after);
    });

    it("calling cancel() twice does not double-send", async () => {
      const { sender, captured } = makeSender({ minChars: 1000, idleMs: 60_000 });
      sender.feed("once");
      await sender.cancel();
      await flushMicrotasks();
      await sender.cancel();
      await flushMicrotasks();
      expect(captured.length).toBe(1);
    });

    it("calling finalize() twice does not double-send", async () => {
      const { sender, captured } = makeSender({ minChars: 1000, idleMs: 60_000 });
      sender.feed("once");
      await sender.finalize();
      await flushMicrotasks();
      await sender.finalize();
      await flushMicrotasks();
      expect(captured.length).toBe(1);
    });
  });

  describe("MEDIA: directive stripping", () => {
    it("strips MEDIA: lines from streamed text", async () => {
      const { sender, captured } = makeSender({ minChars: 100, idleMs: 60_000 });
      sender.feed("Some text here\nMEDIA:/tmp/photo.png\nMore text\n");
      await sender.finalize();
      await flushMicrotasks();
      expect(captured).toHaveLength(1);
      expect(captured[0].text).toBe("Some text here\nMore text\n");
    });

    it("collects MEDIA: paths for the caller to upload", async () => {
      const { sender } = makeSender({ minChars: 100, idleMs: 60_000 });
      sender.feed("Intro\nMEDIA:/tmp/a.png\nMEDIA:/tmp/b.pdf\nDone\n");
      await sender.finalize();
      await flushMicrotasks();
      expect(sender.getMediaFiles()).toEqual(["/tmp/a.png", "/tmp/b.pdf"]);
    });

    it("handles MEDIA: line with leading whitespace", async () => {
      const { sender } = makeSender({ minChars: 100, idleMs: 60_000 });
      sender.feed("Before\n   MEDIA:/tmp/c.mp4   \nAfter\n");
      await sender.finalize();
      await flushMicrotasks();
      expect(sender.getMediaFiles()).toEqual(["/tmp/c.mp4"]);
    });

    it("does NOT strip a line that contains MEDIA: but is not on its own line", async () => {
      const { sender, captured } = makeSender({ minChars: 100, idleMs: 60_000 });
      sender.feed("Use MEDIA:/path as a tag\nNot real\n");
      await sender.finalize();
      await flushMicrotasks();
      expect(captured[0].text).toContain("MEDIA:/path");
      expect(sender.getMediaFiles()).toEqual([]);
    });

    it("MEDIA-only packet does not send an empty packet", async () => {
      const { sender, captured } = makeSender({ minChars: 5, idleMs: 60_000 });
      // First chunk has only MEDIA: — should not produce a packet
      sender.feed("MEDIA:/tmp/a.png\n");
      await flushMicrotasks();
      expect(captured).toHaveLength(0);
      // Second chunk with text long enough to trigger threshold flush
      sender.feed("hello world\n");
      await flushMicrotasks();
      expect(captured.length).toBeGreaterThanOrEqual(1);
      expect(captured[captured.length - 1].text).not.toContain("MEDIA:");
    });
  });

  describe("line buffering", () => {
    it("holds back partial MEDIA: prefixes (could still grow into a directive)", async () => {
      const { sender, captured } = makeSender({ minChars: 5, idleMs: 60_000 });
      // "MED" could still become "MEDIA:/path" → hold it back, don't flush.
      sender.feed("MED");
      await flushMicrotasks();
      expect(captured).toHaveLength(0);
      // Complete into a MEDIA: line → still held (we'll strip it on flush)
      sender.feed("IA:/tmp/x.png\n");
      await flushMicrotasks();
      // MEDIA: line was stripped, so the packet contains nothing visible.
      // The packet might or might not be sent depending on threshold —
      // what matters is no MEDIA: text leaked to the user.
      for (const p of captured) {
        expect(p.text).not.toContain("MEDIA:");
      }
      // Finalize so the MEDIA: path is collected
      await sender.finalize();
      await flushMicrotasks();
      expect(sender.getMediaFiles()).toContain("/tmp/x.png");
    });

    it("flushes a non-MEDIA partial line immediately (no need to wait for newline)", async () => {
      const { sender, captured } = makeSender({ minChars: 5, idleMs: 60_000 });
      sender.feed("partial without newline");
      await flushMicrotasks();
      // Partial line is not a MEDIA: prefix → should flush immediately.
      expect(captured.length).toBe(1);
      expect(captured[0].text).toBe("partial without newline");
    });

    it("finalize emits the trailing partial line too", async () => {
      const { sender, captured } = makeSender({ minChars: 1000, idleMs: 60_000 });
      sender.feed("line one\nline two without newline");
      await flushMicrotasks();
      // No newline at end → not flushed yet
      expect(captured).toHaveLength(0);
      await sender.finalize();
      await flushMicrotasks();
      expect(captured).toHaveLength(1);
      expect(captured[0].text).toBe("line one\nline two without newline");
    });
  });

  describe("MessageItem structure", () => {
    it("sends correct message_type, item type, and context_token", async () => {
      const requests: SendMessageReq[] = [];
      const { sender } = makeSender({
        minChars: 100,
        idleMs: 60_000,
        sendImpl: async (req) => {
          requests.push(req);
        },
      });
      sender.feed("hello");
      await sender.finalize();
      await flushMicrotasks();
      expect(requests.length).toBe(1);
      const req = requests[0];
      expect(req.msg?.message_type).toBe(MessageType.BOT);
      expect(req.msg?.message_state).toBe(MessageState.FINISH);
      expect(req.msg?.to_user_id).toBe("user-1");
      expect(req.msg?.context_token).toBe("ctx-token");
      expect(req.msg?.item_list?.[0]?.type).toBe(MessageItemType.TEXT);
      expect(req.msg?.item_list?.[0]?.text_item?.text).toBe("hello");
    });
  });
});
