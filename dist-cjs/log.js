"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.stateLog = exports.agentLog = exports.outboundLog = exports.inboundLog = exports.botLog = exports.wechatCryptoLog = exports.wechatMediaLog = exports.wechatApiLog = exports.wechatLoginLog = exports.loginLog = exports.mainLog = exports.log = exports.isDev = void 0;
const pino_1 = require("pino");
const level = process.env.LOG_LEVEL ?? "info";
/** True when running outside production. Drives dev-only HTTP body dumps. */
exports.isDev = process.env.NODE_ENV !== "production";
const wantPretty = process.env.LOG_PRETTY === "1" ||
    (process.env.LOG_PRETTY !== "0" && exports.isDev);
exports.log = (0, pino_1.pino)({
    level,
    base: { app: "wechat-agent-channel" },
    timestamp: pino_1.pino.stdTimeFunctions.isoTime,
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
exports.mainLog = exports.log.child({ mod: "main" });
exports.loginLog = exports.log.child({ mod: "login" });
exports.wechatLoginLog = exports.log.child({ mod: "wechat.login" });
exports.wechatApiLog = exports.log.child({ mod: "wechat.api" });
exports.wechatMediaLog = exports.log.child({ mod: "wechat.media" });
exports.wechatCryptoLog = exports.log.child({ mod: "wechat.crypto" });
exports.botLog = exports.log.child({ mod: "bot" });
exports.inboundLog = exports.log.child({ mod: "bot.inbound" });
exports.outboundLog = exports.log.child({ mod: "bot.outbound" });
exports.agentLog = exports.log.child({ mod: "claude.agent" });
exports.stateLog = exports.log.child({ mod: "state" });
//# sourceMappingURL=log.js.map