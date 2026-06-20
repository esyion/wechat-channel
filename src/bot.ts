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
import { botLog } from "./log.js";
import { ContextTokenStore } from "./state/context-tokens.js";
import { SessionStore } from "./state/sessions.js";
import { SyncBufStore } from "./state/sync-buf.js";
import { WechatApiClient } from "./wechat/api.js";
import type { WeixinMessage } from "./wechat/types.js";

import { buildInboundPayload } from "./bot/inbound.js";
import { parseMediaDirectives, sendReplyMedia, sendReplyText } from "./bot/send.js";

const SESSION_EXPIRED_ERRCODE = -14;
const SESSION_PAUSE_MS = 60 * 60 * 1000;
const CONSECUTIVE_FAILURE_LIMIT = 3;
const BACKOFF_MS = 30_000;
const RETRY_DELAY_MS = 2_000;

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

  // Send typing indicator (best-effort)
  if (ctxToken) {
    void sendTypingFor(api, userId, ctxToken).catch((err) => {
      botLog.warn({ userId, err: String(err) }, "typing indicator failed");
    });
  }

  // Call Claude
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
        // Could pipe to typing indicator here for "still working"
        if (delta.length > 0) process.stdout.write(`.`);
      },
      onToolUse: (name, input) => {
        botLog.debug({ userId, name, inputPreview: JSON.stringify(input).slice(0, 200) }, "tool use");
      },
    },
    { cfg: config },
  );

  process.stdout.write(`\n`);

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

  botLog.info(
    {
      userId,
      textLen: turn.finalText.length,
      costUsd: turn.totalCostUsd?.toFixed(4) ?? "?",
      sessionId: turn.sessionId,
    },
    "reply sent",
  );

  if (turn.sessionId && turn.sessionId !== existingSession) {
    await sessions.set(userId, turn.sessionId);
  }

  if (!ctxToken) return;

  // Parse MEDIA: directives
  const parsed = parseMediaDirectives(turn.finalText);
  if (parsed.text) {
    await sendReplyText({ api, toUserId: userId, contextToken: ctxToken }, parsed.text);
  }
  for (const filePath of parsed.mediaFiles) {
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

async function sendTypingFor(api: WechatApiClient, userId: string, contextToken: string): Promise<void> {
  // getConfig to fetch typing_ticket (cache could be added but kept simple)
  const cfg = await api.getConfig({ ilinkUserId: userId, contextToken });
  const ticket = cfg.typing_ticket;
  if (!ticket) return;
  await api.sendTyping({ ilink_user_id: userId, typing_ticket: ticket, status: 1 });
  // Cancel after a short interval
  setTimeout(() => {
    api.sendTyping({ ilink_user_id: userId, typing_ticket: ticket, status: 2 }).catch(() => {});
  }, 3000).unref?.();
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
