/**
 * ChannelManager — single source of truth for the @esyion/wechat-channel lifecycle.
 *
 * Phase machine:
 *
 *   idle ──startLogin──▶ login_pending ──scanConfirmed──▶ logged_in ──start──▶ channel_running
 *     ▲                      │                                │                     │
 *     │                      └─cancel / error                 │                     │
 *     └──────────────────────────────────────────────────── stop ┘
 *
 * Reply routing: the @esyion/wechat-channel public API only exposes `reply` inside
 * the onMessage callback. We capture every inbound reply handle in a Map keyed
 * by `msgId`, so the React UI can call `POST /api/reply { messageId, text }`
 * after the message has been delivered to the browser. Entries expire after a
 * TTL to avoid unbounded growth if a user never replies.
 */

import {
  createChannel,
  loginQR,
  type ChannelHandle,
  type ChannelMsg,
  type Reply,
  type QRLoginHandle,
} from "@esyion/wechat-channel";
import { randomUUID } from "node:crypto";

import type {
  AppPhase,
  AppStatus,
  PublicCredentials,
  PublicMessage,
  QrPayload,
} from "../src/shared/types.js";
import type { SseHub } from "./sse.js";

const MAX_BUFFER = 100;
/** Pending reply handles expire after 10 minutes — long enough for human reply, short enough to avoid leaks. */
const REPLY_TTL_MS = 10 * 60 * 1000;

interface PendingReply {
  reply: Reply;
  fromUserId: string;
  contextToken: string;
  expiresAt: number;
}

/** Plain Error subclass for app-level errors that aren't part of @esyion/wechat-channel's enum. */
class AppError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

export class ChannelManager {
  private phase: AppPhase = "idle";
  private qr: QrPayload | null = null;
  private waitAbort: AbortController | null = null;
  private credentials: PublicCredentials | null = null;
  private channel: ChannelHandle | null = null;
  private channelAbort: AbortController | null = null;
  private messages: PublicMessage[] = [];
  private pendingReplies = new Map<string, PendingReply>();
  private errorMsg: { message: string; phase?: string } | null = null;
  private readonly sse: SseHub;

  constructor(sse: SseHub) {
    this.sse = sse;
    // Sweep expired reply handles every minute; unref so it doesn't keep the process alive
    const timer = setInterval(() => this.sweepExpiredReplies(), 60_000);
    timer.unref();
  }

  // ─── status ──────────────────────────────────────────────────────────────

  getStatus(): AppStatus {
    return {
      phase: this.phase,
      qr: this.qr,
      credentials: this.credentials,
      channelRunning: this.channel !== null,
      messageCount: this.messages.length,
      error: this.errorMsg,
    };
  }

  getRecentMessages(limit = 50): PublicMessage[] {
    return this.messages.slice(-limit);
  }

  // ─── login flow ──────────────────────────────────────────────────────────

  async startLogin(): Promise<QrPayload> {
    if (this.phase === "login_pending") {
      throw new AppError("ALREADY_LOGGING_IN", "login already in progress");
    }
    if (this.phase === "channel_running") {
      throw new AppError("ALREADY_LOGGED_IN", "channel already running; stop first");
    }

    this.errorMsg = null;
    this.qr = null;

    try {
      const handle = await loginQR();

      const [dataURL, svg, terminal] = await Promise.all([
        handle.toDataURL({ size: 360 }),
        Promise.resolve(handle.toSvg({ margin: 2 })),
        Promise.resolve(handle.toTerminal()),
      ]);

      const payload: QrPayload = { dataURL, svg, terminal, matrix: handle.matrix };
      this.qr = payload;
      this.phase = "login_pending";
      this.broadcastState();

      // Background: poll for QR scan confirmation
      this.waitAbort = new AbortController();
      void this.awaitLogin(handle, this.waitAbort.signal);

      return payload;
    } catch (err) {
      this.failWith("login_start", err);
      throw err;
    }
  }

  cancelLogin(): void {
    if (this.phase !== "login_pending") return;
    this.waitAbort?.abort();
    this.waitAbort = null;
    this.qr = null;
    this.phase = "idle";
    this.broadcastState();
  }

  private async awaitLogin(handle: QRLoginHandle, signal: AbortSignal): Promise<void> {
    try {
      // NOTE: `handle.waitForLogin()` resolves to { botToken, accountId, baseUrl }.
      // On login failure it throws ChannelError("AUTH_REQUIRED") — see
      // src/channel/login-flow.ts. The full internal LoginResult is not exposed.
      const result = await handle.waitForLogin({ signal });
      if (!result.botToken || !result.accountId) {
        const keys = Object.keys(result).join(",");
        throw new Error(
          `login result missing botToken/accountId (keys=[${keys}])`,
        );
      }
      this.credentials = { botToken: result.botToken, accountId: result.accountId };
      this.phase = "logged_in";
      this.qr = null;
      this.broadcastState();
      this.sse.broadcast({ type: "log", level: "info", message: "登录已确认,自动启动通道" });

      await this.startChannel();
    } catch (err) {
      if (signal.aborted) return;
      this.failWith("login_wait", err);
    }
  }

  // ─── channel lifecycle ───────────────────────────────────────────────────

  async startChannel(): Promise<void> {
    if (!this.credentials) {
      throw new AppError("AUTH_REQUIRED", "no credentials; login first");
    }
    if (this.channel) return;

    try {
      this.channelAbort = new AbortController();
      const handle = await createChannel({
        botToken: this.credentials.botToken,
        accountId: this.credentials.accountId,
        onError: (err, ctx) => {
          const phase = ctx?.phase;
          this.sse.broadcast({ type: "error", message: String((err as Error).message ?? err), phase });
        },
        onMessage: (msg, reply) => this.handleInbound(msg, reply),
      });

      this.channel = handle;
      this.phase = "channel_running";
      this.errorMsg = null;
      this.broadcastState();
      this.sse.broadcast({ type: "log", level: "info", message: "通道已启动,等待长轮询..." });

      void handle.start({ signal: this.channelAbort.signal }).catch((err) => {
        if (this.channelAbort?.signal.aborted) return;
        this.failWith("channel_run", err);
      });
    } catch (err) {
      this.failWith("channel_start", err);
      throw err;
    }
  }

  async stopChannel(): Promise<void> {
    if (!this.channel) return;
    this.channelAbort?.abort();
    try {
      await this.channel.stop();
    } catch {
      // best-effort shutdown
    }
    this.channel = null;
    this.channelAbort = null;
    this.pendingReplies.clear();
    this.phase = this.credentials ? "logged_in" : "idle";
    this.broadcastState();
    this.sse.broadcast({ type: "log", level: "info", message: "通道已停止" });
  }

  // ─── reply / typing helpers (called by HTTP routes) ──────────────────────

  async replyText(messageId: string, text: string): Promise<void> {
    const entry = this.takePending(messageId);
    if (!entry) throw new AppError("NO_MSG", "no pending reply for this message");
    await entry.reply.text(text);
  }

  async replyMedia(messageId: string, mediaPath: string, caption?: string): Promise<void> {
    const entry = this.takePending(messageId);
    if (!entry) throw new AppError("NO_MSG", "no pending reply for this message");
    await entry.reply.media(mediaPath, caption);
  }

  async setTyping(messageId: string, on: boolean): Promise<void> {
    const entry = this.pendingReplies.get(messageId);
    if (!entry) throw new AppError("NO_MSG", "no pending reply for this message");
    await entry.reply.typing(on);
  }

  private takePending(messageId: string): PendingReply | undefined {
    const entry = this.pendingReplies.get(messageId);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.pendingReplies.delete(messageId);
      return undefined;
    }
    // Keep the entry around so user can chain typing → reply on the same msg
    return entry;
  }

  private sweepExpiredReplies(): void {
    const now = Date.now();
    for (const [id, entry] of this.pendingReplies) {
      if (entry.expiresAt < now) this.pendingReplies.delete(id);
    }
  }

  // ─── internal ────────────────────────────────────────────────────────────

  private handleInbound(msg: ChannelMsg, reply: Reply): Promise<void> {
    const publicMsg: PublicMessage = {
      id: randomUUID(),
      fromUserId: msg.fromUserId,
      contextToken: msg.contextToken,
      text: msg.text,
      media: msg.media.map((m) => ({ path: m.path, mime: m.mime })),
      receivedAt: Date.now(),
    };
    this.messages.push(publicMsg);
    if (this.messages.length > MAX_BUFFER) this.messages.shift();

    this.pendingReplies.set(publicMsg.id, {
      reply,
      fromUserId: msg.fromUserId,
      contextToken: msg.contextToken,
      expiresAt: Date.now() + REPLY_TTL_MS,
    });

    this.sse.broadcast({ type: "message", message: publicMsg });
    return Promise.resolve();
  }

  private failWith(phase: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.errorMsg = { message, phase };
    this.phase = "error";
    this.qr = null;
    this.waitAbort?.abort();
    this.waitAbort = null;
    this.broadcastState();
    this.sse.broadcast({ type: "error", message, phase });
  }

  private broadcastState(): void {
    this.sse.broadcast({ type: "state", status: this.getStatus() });
  }
}
