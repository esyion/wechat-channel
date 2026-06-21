/**
 * Main bot loop.
 *
 * Flow:
 *   1. Initialize WeChat API client (with persisted botToken + sync_buf)
 *   2. notifyStart
 *   3. Loop: getUpdates (35s long-poll)
 *      - On errcode=-14 → pause 1 hour, continue
 *      - On msgs → for each msg: parse → build payload → call Claude → reply
 *   4. On SIGINT: notifyStop, flush state, exit
 */

import { join } from "node:path";

import { runClaudeTurn } from "./claude/agent.js";
import { config, requireWechatToken } from "./config.js";
import { botLog, outboundLog } from "./log.js";
import { ContextTokenStore } from "./state/context-tokens.js";
import { SessionStore } from "./state/sessions.js";
import { SyncBufStore } from "./state/sync-buf.js";
import { WechatApiClient } from "./wechat/api.js";
import type { WeixinMessage } from "./wechat/types.js";

import { buildInboundPayload } from "./bot/inbound.js";
import { parseMediaDirectives, sendReplyMedia, sendReplyText } from "./bot/send.js";
import { StreamingSender } from "./bot/streaming.js";

const SESSION_EXPIRED_ERRCODE = -14;
const SESSION_PAUSE_MS = 60 * 60 * 1000;
const CONSECUTIVE_FAILURE_LIMIT = 3;
const BACKOFF_MS = 30_000;
const RETRY_DELAY_MS = 2_000;
const TYPING_KEEPALIVE_MS = 5_000;


export interface BotDeps {
  api: WechatApiClient;
  contextTokens: ContextTokenStore;
  sessions: SessionStore;
  syncBuf: SyncBufStore;
}

export async function runBotLoop(deps: BotDeps, abortSignal: AbortSignal): Promise<void> {
  const { api, contextTokens, sessions, syncBuf } = deps;

  botLog.info({ baseUrl: api.baseUrl }, "bot starting");

  // notifyStart (best-effort)
  try {
    const resp = await api.notifyStart();
    if (resp.ret !== undefined && resp.ret !== 0) {
      botLog.warn({ ret: resp.ret, errmsg: resp.errmsg }, "notifyStart non-zero ret");
    }
  } catch (err) {
    botLog.warn({ err: String(err) }, "notifyStart failed (ignored)");
  }

  let consecutiveFailures = 0;
  let sessionPausedUntil = 0;

  while (!abortSignal.aborted) {
    // Session pause gate (errcode=-14 → 1h cooldown)
    const now = Date.now();
    if (now < sessionPausedUntil) {
      const waitMs = sessionPausedUntil - now;
      botLog.info({ waitMin: Math.ceil(waitMs / 60_000) }, "session paused; sleeping");
      await sleep(waitMs, abortSignal);
      continue;
    }

    let resp;
    try {
      resp = await api.getUpdates(
        { get_updates_buf: syncBuf.get() },
        { timeoutMs: config.bot.longPollTimeoutMs, signal: abortSignal },
      );
    } catch (err) {
      if (abortSignal.aborted) break;
      consecutiveFailures += 1;
      botLog.error(
        { err: String(err), consecutive: consecutiveFailures, limit: CONSECUTIVE_FAILURE_LIMIT },
        "getUpdates error",
      );
      if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
        consecutiveFailures = 0;
        await sleep(BACKOFF_MS, abortSignal);
      } else {
        await sleep(RETRY_DELAY_MS, abortSignal);
      }
      continue;
    }

    // API error?
    const isError =
      (resp.ret !== undefined && resp.ret !== 0) ||
      (resp.errcode !== undefined && resp.errcode !== 0);

    if (isError) {
      if (resp.errcode === SESSION_EXPIRED_ERRCODE || resp.ret === SESSION_EXPIRED_ERRCODE) {
        sessionPausedUntil = Date.now() + SESSION_PAUSE_MS;
        botLog.error({ errcode: resp.errcode }, "session expired; pausing 60 min");
        continue;
      }
      consecutiveFailures += 1;
      botLog.error(
        {
          ret: resp.ret,
          errcode: resp.errcode,
          errmsg: resp.errmsg,
          consecutive: consecutiveFailures,
          limit: CONSECUTIVE_FAILURE_LIMIT,
        },
        "getUpdates error response",
      );
      if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
        consecutiveFailures = 0;
        await sleep(BACKOFF_MS, abortSignal);
      } else {
        await sleep(RETRY_DELAY_MS, abortSignal);
      }
      continue;
    }

    consecutiveFailures = 0;

    // Persist new sync_buf
    if (resp.get_updates_buf != null && resp.get_updates_buf !== "") {
      await syncBuf.set(resp.get_updates_buf);
    }

    // Process messages
    const msgs = resp.msgs ?? [];
    for (const fullMsg of msgs) {
      if (abortSignal.aborted) break;
      await handleInboundMessage(fullMsg, { api, contextTokens, sessions });
    }
  }

  botLog.info({ aborted: abortSignal.aborted }, "bot loop exited");
}

async function handleInboundMessage(
  fullMsg: WeixinMessage,
  deps: { api: WechatApiClient; contextTokens: ContextTokenStore; sessions: SessionStore },
): Promise<void> {
  const { api, contextTokens, sessions } = deps;
  const userId = fullMsg.from_user_id ?? "";
  if (!userId) return;
  if (config.bot.blockedUsers.has(userId)) {
    botLog.info({ userId }, "blocked user; dropping");
    return;
  }

  const contextToken = fullMsg.context_token;
  if (contextToken) {
    await contextTokens.set(userId, contextToken);
  }

  botLog.info({ userId, items: fullMsg.item_list?.length ?? 0 }, "inbound message");

  // Build payload (download + decrypt media)
  let payload;
  try {
    payload = await buildInboundPayload({
      api,
      mediaTmpDir: config.bot.mediaTmpDir,
      msg: fullMsg,
    });
  } catch (err) {
    botLog.error({ userId, err: String(err) }, "buildInboundPayload failed");
    return;
  }

  const ctxToken = contextToken ?? contextTokens.get(userId);
  if (!ctxToken) {
    botLog.warn({ userId }, "no context_token; will skip outbound send");
  }

  // Start typing keepalive (5s heartbeat). Stops when first text packet
  // is sent, or on finalize/error. Best-effort; silently tolerates failures.
  const typing = ctxToken ? new TypingKeepalive(api, userId, ctxToken) : null;
  typing?.start();

  // Set up streaming sender so each token delta flows to WeChat live.
  const streamer = ctxToken
    ? new StreamingSender({
        api,
        toUserId: userId,
        contextToken: ctxToken,
        log: outboundLog.child({ userId }),
        minChars: config.bot.streamMinChars,
        idleMs: config.bot.streamIdleMs,
        maxChars: config.bot.streamMaxChars,
      })
    : null;

  // Call Claude — wire token deltas into StreamingSender.
  const existingSession = sessions.get(userId);
  const turn = await runClaudeTurn(
    {
      userId,
      text: payload.text,
      media: payload.media,
      sessionId: existingSession,
    },
    {
      onTextChunk: (delta) => {
        if (streamer) streamer.feed(delta);
      },
      onToolUse: (name, input) => {
        botLog.debug({ userId, name, inputPreview: JSON.stringify(input).slice(0, 200) }, "tool use");
      },
    },
    { cfg: config },
  );

  // Always finalize streaming (flushes any held-back chars + FINISH packet).
  if (streamer) {
    try {
      await streamer.finalize();
    } catch (err) {
      // finalize() is non-throwing in practice; defensive in case of refactor.
      botLog.warn({ userId, err: String(err) }, "streaming finalize failed");
    }
  }
  // First real text arrived → cancel the typing indicator.
  typing?.stop();

  if (!turn.ok) {
    botLog.error({ userId, err: turn.error }, "Claude turn failed");
    if (ctxToken) {
      await sendReplyText(
        { api, toUserId: userId, contextToken: ctxToken },
        `⚠️ 处理出错: ${turn.error ?? "unknown"}\n\n请稍后重试。`,
      ).catch((err) => botLog.error({ userId, err: String(err) }, "error notice send failed"));
    }
    return;
  }

  if (turn.sessionId && turn.sessionId !== existingSession) {
    await sessions.set(userId, turn.sessionId);
  }

  if (!ctxToken) return;

  // If streaming sent nothing (model returned non-streaming response or
  // streamed only MEDIA: lines), fall back to a one-shot text send so the
  // user still gets the reply.
  if (!streamer?.hasStarted()) {
    const parsed = parseMediaDirectives(turn.finalText);
    if (parsed.text) {
      await sendReplyText({ api, toUserId: userId, contextToken: ctxToken }, parsed.text);
    }
    await sendMediaFiles(api, userId, ctxToken, parsed.mediaFiles);
    return;
  }

  // Streaming already sent the (filtered) text. Log delivery stats.
  botLog.info(
    {
      userId,
      packets: streamer.packets.length,
      streamedChars: streamer.sentCharCount,
      streamingErrors: streamer.hasErrors(),
      textLen: turn.finalText.length,
      costUsd: turn.totalCostUsd?.toFixed(4) ?? "?",
      sessionId: turn.sessionId,
    },
    "reply streamed",
  );

  // Send MEDIA: attachments as separate MessageItems (new client_ids).
  // We parse from the original `turn.finalText` — the streamed text had
  // MEDIA: lines stripped by StreamingSender during streaming.
  const parsed = parseMediaDirectives(turn.finalText);
  await sendMediaFiles(api, userId, ctxToken, parsed.mediaFiles);
}

async function sendMediaFiles(
  api: WechatApiClient,
  userId: string,
  ctxToken: string,
  paths: string[],
): Promise<void> {
  for (const filePath of paths) {
    try {
      await sendReplyMedia({ api, toUserId: userId, contextToken: ctxToken }, "", filePath);
    } catch (err) {
      botLog.error({ userId, filePath, err: String(err) }, "media send failed");
      await sendReplyText(
        { api, toUserId: userId, contextToken: ctxToken },
        `⚠️ 文件发送失败: ${filePath}\n${String(err).slice(0, 200)}`,
      ).catch(() => {});
    }
  }
}

/**
 * Heartbeat-based "typing" indicator.
 *
 * Fires the FIRST status=1 packet immediately so the client UI shows
 * "typing…" right away, then re-arms every `intervalMs` until `stop()`.
 * `stop()` sends status=2 once to cancel and clears the interval.
 *
 * The typing_ticket is fetched lazily (and cached for the lifetime of
 * this instance) — WeChat invalidates tickets on session restart, but for
 * a single message lifecycle that's not a concern.
 */
class TypingKeepalive {
  private ticket: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(
    private readonly api: WechatApiClient,
    private readonly userId: string,
    private readonly contextToken: string,
    private readonly intervalMs: number = TYPING_KEEPALIVE_MS,
  ) {}

  async start(): Promise<void> {
    try {
      const cfg = await this.api.getConfig({ ilinkUserId: this.userId, contextToken: this.contextToken });
      this.ticket = cfg.typing_ticket ?? null;
      if (!this.ticket) return;
      await this.api.sendTyping({
        ilink_user_id: this.userId,
        typing_ticket: this.ticket,
        status: 1,
      });
      this.timer = setInterval(() => {
        void this.tick();
      }, this.intervalMs);
    } catch (err) {
      botLog.warn({ userId: this.userId, err: String(err) }, "typing keepalive start failed");
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ticket) {
      this.api
        .sendTyping({ ilink_user_id: this.userId, typing_ticket: this.ticket, status: 2 })
        .catch(() => {});
    }
  }

  private async tick(): Promise<void> {
    if (!this.ticket) return;
    try {
      await this.api.sendTyping({
        ilink_user_id: this.userId,
        typing_ticket: this.ticket,
        status: 1,
      });
    } catch (err) {
      botLog.warn({ userId: this.userId, err: String(err) }, "typing keepalive tick failed");
      // Stop heartbeat on persistent failure — don't keep retrying.
      this.stop();
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(new Error("aborted"));
        },
        { once: true },
      );
    }
  });
}

export async function buildBotDeps(stateDir: string): Promise<BotDeps> {
  const token = requireWechatToken();
  const api = new WechatApiClient({
    baseUrl: config.wechat.baseUrl,
    cdnBaseUrl: config.wechat.cdnBaseUrl,
    botToken: token,
    channelVersion: config.wechat.channelVersion,
    botAgent: config.wechat.botAgent,
    longPollTimeoutMs: config.bot.longPollTimeoutMs,
  });
  const contextTokens = await ContextTokenStore.load(join(stateDir, "context-tokens.json"));
  const sessions = await SessionStore.load(join(stateDir, "sessions.json"));
  const syncBuf = await SyncBufStore.load(join(stateDir, "sync-buf.json"));
  return { api, contextTokens, sessions, syncBuf };
}
