/**
 * Centralised Pino logger.
 *
 * Usage:
 *   import { log, botLog, wechatApiLog, ... } from "./log.js";
 *   log.info("starting up");
 *   botLog.info({ userId, items }, "inbound message");
 *
 * Conventions:
 *   - Use child loggers (botLog, wechatApiLog, ...) so every line carries
 *     a `mod` field for filtering.
 *   - Pass structured fields as the first arg, free-form text as the second.
 *   - In dev, pretty output via pino-pretty. In prod, raw JSON.
 *
 * Configure via env:
 *   LOG_LEVEL  — "trace" | "debug" | "info" | "warn" | "error" | "fatal" (default: "info")
 *   LOG_PRETTY — "1" to force pretty; "0" to force JSON (default: pretty unless NODE_ENV=production)
 */

import { pino, type Logger } from "pino";

const level = process.env.LOG_LEVEL ?? "info";

const wantPretty =
  process.env.LOG_PRETTY === "1" ||
  (process.env.LOG_PRETTY !== "0" && process.env.NODE_ENV !== "production");

export const log: Logger = pino({
  level,
  base: { app: "wechat-agent-channel" },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(wantPretty
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss.l",
            ignore: "pid,hostname,app",
            singleLine: false,
          },
        },
      }
    : {}),
});

// Pre-built child loggers for hot modules — avoids per-call child() overhead.
export const mainLog = log.child({ mod: "main" });
export const loginLog = log.child({ mod: "login" });
export const wechatLoginLog = log.child({ mod: "wechat.login" });
export const wechatApiLog = log.child({ mod: "wechat.api" });
export const wechatMediaLog = log.child({ mod: "wechat.media" });
export const wechatCryptoLog = log.child({ mod: "wechat.crypto" });
export const botLog = log.child({ mod: "bot" });
export const inboundLog = log.child({ mod: "bot.inbound" });
export const outboundLog = log.child({ mod: "bot.outbound" });
export const agentLog = log.child({ mod: "claude.agent" });
export const stateLog = log.child({ mod: "state" });
