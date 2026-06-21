/**
 * StreamingSender — manages a single WeChat logical message's streaming lifecycle.
 *
 * Modeled after openclaw-weixin's createReplyDispatcherWithTyping but implemented
 * directly against WechatApiClient (this project doesn't use the openclaw plugin SDK).
 *
 * Protocol assumption (Strategy A):
 *   The WeChat server replaces a logical message's content whenever a new
 *   `sendmessage` packet arrives with the same `client_id`. The `message_state`
 *   field tells the client UI whether to show a "generating…" indicator
 *   (1=GENERATING) or to mark the message complete (2=FINISH).
 *
 *   Therefore each packet carries the FULL accumulated text so far (not a delta)
 *   and all packets for a logical message share one `client_id`.
 *
 * Lifecycle:
 *   1. Constructor issues a fresh `client_id` (one per logical message).
 *   2. Each `feed(delta)` from the LLM token stream is filtered through
 *      StreamingMarkdownFilter, accumulated, and asynchronously flushed when:
 *        - `pendingSafeText.length >= minChars` → immediate GENERATING flush
 *        - `idleMs` passes since last flush → timer-triggered GENERATING flush
 *   3. `finalize()` flushes remaining text with state=FINISH and resolves.
 *   4. `cancel()` flushes remaining text with state=FINISH, marks cancelled,
 *      and rejects nothing (graceful degradation — caller may inspect hasErrors()).
 *
 * MEDIA: directive handling:
 *   Lines matching `^[ \t]*MEDIA:\/abs\/path[ \t]*$` are stripped from the
 *   streamed text (so users don't see raw MEDIA: lines), and the collected
 *   paths are returned from `finalize()` for the caller to upload + send.
 *
 * Failure mode:
 *   Each packet send is wrapped in try/catch. Failures are logged and recorded
 *   via `hasErrors()` but do NOT throw, so a single bad packet doesn't abort
 *   the whole streaming session. The caller can inspect `hasErrors()` after
 *   finalize and decide whether to fall back to a plain sendReplyText.
 */

import type pino from "pino";

import { StreamingMarkdownFilter } from "./markdown-filter.js";
import type { WechatApiClient } from "../wechat/api.js";
import { MessageItemType, MessageState, MessageType } from "../wechat/types.js";

const MEDIA_LINE_REGEX = /^[ \t]*MEDIA:(\/[^ \t\r\n]+)[ \t]*$/;

/**
 * True if `partial` is a prefix that could grow into a complete MEDIA: directive.
 * MEDIA: lines start with optional whitespace then "MEDIA:" then a path. We hold
 * back any partial line whose current form could still resolve to that pattern,
 * so we never emit a half-baked `MEDIA:/partial/p` and then watch it become
 * `MEDIA:/partial/photo.png` on the next chunk.
 */
function couldBeMediaLine(partial: string): boolean {
  return /^[ \t]*M(E(D(I(A(:(\/)?)?)?)?)?)?$/.test(partial);
}

export interface StreamingSenderOptions {
  api: WechatApiClient;
  toUserId: string;
  contextToken: string;
  /** Pino logger — typically `outboundLog.child({ userId })`. */
  log: pino.Logger;
  /** Flush immediately when pending safe text reaches this size. Default 200. */
  minChars?: number;
  /** Force-flush after this many ms of inactivity. Default 3000. */
  idleMs?: number;
  /**
   * Hard cap per packet. If accumulated text exceeds this, each flush sends
   * at most this many chars. Should match WeChat's max text length (default 4000).
   */
  maxChars?: number;
}

interface SentPacket {
  state: number;
  text: string;
}

export class StreamingSender {
  private readonly clientId: string;
  private readonly api: WechatApiClient;
  private readonly toUserId: string;
  private readonly contextToken: string;
  private readonly log: pino.Logger;
  private readonly minChars: number;
  private readonly idleMs: number;
  private readonly maxChars: number;
  private readonly filter = new StreamingMarkdownFilter();

  /** New safe text accumulated since last flush (filtered, but not yet sent). */
  private pendingSafeText = "";
  /** Trailing partial line from previous flush — held until line completes. */
  private lineCarry = "";
  /** Total filtered text successfully sent across all packets. */
  private sentSoFar = "";
  /** Number of packets sent (GENERATING + FINISH combined). */
  private packetCount = 0;
  /** True if at least one sendMessage call failed. */
  private hasFailed = false;
  /** Collected MEDIA: paths from stripped lines. */
  private readonly collectedMedia: string[] = [];

  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;
  private state: "idle" | "streaming" | "finalizing" | "cancelled" = "idle";
  /** True after a successful finalize(); subsequent calls are no-ops. */
  private finalized = false;
  /** History of sent packets (for tests / debugging). */
  readonly packets: SentPacket[] = [];

  constructor(opts: StreamingSenderOptions) {
    this.api = opts.api;
    this.toUserId = opts.toUserId;
    this.contextToken = opts.contextToken;
    this.log = opts.log;
    this.minChars = opts.minChars ?? 200;
    this.idleMs = opts.idleMs ?? 3000;
    this.maxChars = opts.maxChars ?? 4000;
    this.clientId = `wac-stream:${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
  }

  get client_id(): string {
    return this.clientId;
  }

  /** True if at least one packet was sent. */
  hasStarted(): boolean {
    return this.packetCount > 0;
  }

  /** True if any sendMessage failed during this session. */
  hasErrors(): boolean {
    return this.hasFailed;
  }

  /** True if `cancel()` was called. */
  isCancelled(): boolean {
    return this.state === "cancelled";
  }

  /** Number of characters sent in total (across all packets). */
  get sentCharCount(): number {
    return this.sentSoFar.length;
  }

  /**
   * Push a text delta from the model. Returns immediately; the flush happens
   * asynchronously based on `minChars` / `idleMs` thresholds.
   *
   * Safe to call after `finalize()` or `cancel()` — those states are no-ops.
   */
  feed(delta: string): void {
    if (this.state === "finalizing" || this.state === "cancelled") return;
    if (delta.length === 0) return;
    if (this.state === "idle") this.state = "streaming";

    const safeNow = this.filter.feed(delta);
    if (safeNow.length > 0) {
      this.pendingSafeText += safeNow;
    }
    this.scheduleFlush();
  }

  /**
   * Send all remaining buffered text with FINISH state. Returns once the final
   * packet is sent (or has failed). After this call, `feed()` is a no-op.
   * Calling `finalize()` more than once is a no-op (idempotent).
   */
  async finalize(): Promise<void> {
    if (this.state === "cancelled") return;
    if (this.finalized) return;
    this.finalized = true;
    this.state = "finalizing";
    this.clearIdleTimer();
    // Drain any characters still held back by the filter (e.g. trailing `*`).
    this.pendingSafeText += this.filter.flush();
    await this.flushNow(MessageState.FINISH);
  }

  /**
   * Best-effort flush of remaining text with FINISH state, then mark cancelled.
   * Use this when the upstream (Claude turn) errors out — we still want the
   * partial text to reach the user.
   */
  async cancel(): Promise<void> {
    if (this.state === "cancelled") return;
    this.state = "cancelled";
    this.clearIdleTimer();
    this.pendingSafeText += this.filter.flush();
    try {
      await this.flushNow(MessageState.FINISH);
    } catch (err) {
      // flushNow never throws, but be defensive in case of unhandled rejections
      this.log.warn({ err: String(err) }, "streaming cancel: flush failed");
    }
  }

  /** MEDIA: paths collected during streaming (one entry per stripped line). */
  getMediaFiles(): string[] {
    return [...this.collectedMedia];
  }

  // -----------------------------------------------------------------------
  // Internal flush machinery
  // -----------------------------------------------------------------------

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private scheduleFlush(): void {
    // Threshold reached → flush right away (no need for idle timer).
    if (this.pendingSafeText.length >= this.minChars) {
      this.clearIdleTimer();
      void this.flushNow(MessageState.GENERATING);
      return;
    }
    // Otherwise arm / reset the idle timer.
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      void this.flushNow(MessageState.GENERATING);
    }, this.idleMs);
  }

  /**
   * Flush whatever is in `pendingSafeText` (+ lineCarry) as a single packet.
   *
   * Lines are split out: complete MEDIA: lines are dropped (path collected).
   * The trailing partial line is held in `lineCarry` ONLY IF it could still
   * grow into a MEDIA: directive — otherwise it's emitted with the packet so
   * the user sees the text immediately rather than waiting for a newline that
   * may never arrive (typical LLM streams rarely produce \n in mid-thought).
   *
   * Returns immediately if there's nothing to send AND we're not finalizing.
   */
  private async flushNow(state: number): Promise<void> {
    // If a previous flush is still in flight, queue behind it so packets
    // arrive at the server in the order they were scheduled.
    if (this.inflight) {
      try {
        await this.inflight;
      } catch {
        // already recorded by previous attempt
      }
    }
    if (this.state === "cancelled" && state !== MessageState.FINISH) return;

    const raw = this.lineCarry + this.pendingSafeText;
    this.pendingSafeText = "";
    this.lineCarry = "";

    let toSend: string;
    if (state === MessageState.FINISH) {
      // Final flush: emit everything, including any trailing partial line.
      toSend = raw;
    } else if (raw.length === 0) {
      return;
    } else {
      // Intermediate flush: emit complete lines, plus any trailing partial
      // line that is *not* a possible MEDIA: prefix.
      const lastNl = raw.lastIndexOf("\n");
      if (lastNl === -1) {
        // No complete line at all.
        if (couldBeMediaLine(raw)) {
          // Could still become MEDIA: — hold it back.
          this.lineCarry = raw;
          return;
        }
        toSend = raw;
      } else {
        const completePart = raw.slice(0, lastNl + 1);
        const partial = raw.slice(lastNl + 1);
        if (partial.length === 0 || !couldBeMediaLine(partial)) {
          // No partial line, or it can't become MEDIA: — emit everything.
          toSend = completePart + partial;
        } else {
          // Partial line could become MEDIA: — hold just it back.
          toSend = completePart;
          this.lineCarry = partial;
        }
      }
    }

    // Strip MEDIA: lines and collect their paths.
    toSend = this.stripMediaLines(toSend);

    // Skip empty packets (e.g. the only content was MEDIA: lines, or only
    // whitespace after stripping). Always allow the FINISH packet through
    // (even empty) so the client UI gets the completion marker.
    if (toSend.length === 0 && state !== MessageState.FINISH) {
      // If we still have pending lineCarry, schedule another flush soon.
      if (this.lineCarry.length > 0) {
        this.clearIdleTimer();
        this.idleTimer = setTimeout(() => {
          this.idleTimer = null;
          void this.flushNow(MessageState.GENERATING);
        }, this.idleMs);
      }
      return;
    }

    // Enforce maxChars: cap packet size, leave remainder for next flush.
    // (Shouldn't normally happen because finalize() passes full buffer, but
    // guards against runaway packets in long-running streams.)
    let packetText = toSend;
    if (packetText.length > this.maxChars) {
      packetText = packetText.slice(0, this.maxChars);
      // Try to break on a newline boundary near the cap.
      const lastNl = packetText.lastIndexOf("\n");
      if (lastNl > this.maxChars * 0.6) {
        packetText = packetText.slice(0, lastNl + 1);
      }
      this.lineCarry = toSend.slice(packetText.length) + this.lineCarry;
    }

    const fullText = this.sentSoFar + packetText;

    const send = async (): Promise<void> => {
      try {
        await this.api.sendMessage({
          msg: {
            from_user_id: "",
            to_user_id: this.toUserId,
            client_id: this.clientId,
            message_type: MessageType.BOT,
            message_state: state,
            item_list: packetText
              ? [{ type: MessageItemType.TEXT, text_item: { text: fullText } }]
              : [],
            context_token: this.contextToken,
          },
        });
        this.sentSoFar = fullText;
        this.packetCount += 1;
        this.packets.push({ state, text: fullText });
        this.log.debug(
          { state, packetLen: packetText.length, totalLen: fullText.length, packet: this.packetCount },
          "streaming packet sent",
        );
      } catch (err) {
        this.hasFailed = true;
        this.log.warn(
          { err: String(err), state, packet: this.packetCount + 1 },
          "streaming packet send failed",
        );
        // Don't rethrow — let caller inspect hasErrors() and decide.
      }
    };

    this.inflight = send().finally(() => {
      this.inflight = null;
    });
    await this.inflight;

    // After a successful flush, if more pending remains, schedule another.
    if (state === MessageState.GENERATING && this.state === "streaming") {
      if (this.pendingSafeText.length >= this.minChars) {
        void this.flushNow(MessageState.GENERATING);
      } else if (this.idleTimer === null && this.lineCarry.length > 0) {
        // Have a partial line buffered; arm idle timer for it.
        this.idleTimer = setTimeout(() => {
          this.idleTimer = null;
          void this.flushNow(MessageState.GENERATING);
        }, this.idleMs);
      }
    }
  }

  private stripMediaLines(text: string): string {
    if (!text.includes("MEDIA:")) return text;
    const lines = text.split("\n");
    const kept: string[] = [];
    for (const line of lines) {
      const m = line.match(MEDIA_LINE_REGEX);
      if (m) {
        this.collectedMedia.push(m[1]);
      } else {
        kept.push(line);
      }
    }
    return kept.join("\n");
  }
}
