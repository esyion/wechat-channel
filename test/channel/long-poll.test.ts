import { describe, expect, it, vi } from "vitest";
import { runLongPoll } from "../../src/channel/long-poll.js";

describe("runLongPoll", () => {
  it("invokes handler for each message", async () => {
    const api = {
      notifyStart: vi.fn().mockResolvedValue({ ret: 0 }),
      getUpdates: vi
        .fn()
        .mockResolvedValueOnce({
          ret: 0,
          get_updates_buf: "buf-1",
          msgs: [{ from_user_id: "u1", context_token: "ctx", item_list: [{ type: 1, text_item: { text: "hi" } }] }],
        })
        .mockResolvedValueOnce({ ret: 0, get_updates_buf: "buf-2", msgs: [] }),
    } as any;
    const store = {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn(),
      flush: vi.fn(),
    };
    const handler = vi.fn().mockResolvedValue(undefined);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    await runLongPoll({
      api,
      store,
      mediaTmpDir: "/tmp",
      onMessage: handler,
      longPollTimeoutMs: 1000,
      signal: ac.signal,
      onError: vi.fn(),
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].text).toBe("hi");
  });

  it("retries on consecutive network errors with backoff", async () => {
    const api = {
      notifyStart: vi.fn().mockResolvedValue({ ret: 0 }),
      getUpdates: vi.fn().mockRejectedValue(new Error("network")),
    } as any;
    const store = { get: vi.fn(), set: vi.fn(), delete: vi.fn(), flush: vi.fn() };
    const handler = vi.fn();
    const ac = new AbortController();
    const errors: any[] = [];
    const start = Date.now();
    setTimeout(() => ac.abort(), 200);
    await runLongPoll({
      api,
      store,
      mediaTmpDir: "/tmp",
      onMessage: handler,
      longPollTimeoutMs: 100,
      signal: ac.signal,
      onError: (e) => errors.push(e),
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it("pauses 1 hour on errcode=-14", async () => {
    const api = {
      notifyStart: vi.fn().mockResolvedValue({ ret: 0 }),
      getUpdates: vi
        .fn()
        .mockResolvedValueOnce({ ret: -14, errmsg: "session expired", msgs: [] })
        .mockResolvedValueOnce({ ret: 0, msgs: [] }),
    } as any;
    const store = { get: vi.fn(), set: vi.fn(), delete: vi.fn(), flush: vi.fn() };
    const handler = vi.fn();
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    await runLongPoll({
      api,
      store,
      mediaTmpDir: "/tmp",
      onMessage: handler,
      longPollTimeoutMs: 50,
      signal: ac.signal,
      onError: vi.fn(),
    });
    // Should have only called getUpdates once (paused)
    expect(api.getUpdates).toHaveBeenCalledTimes(1);
  });
});