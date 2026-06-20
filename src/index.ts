#!/usr/bin/env node
/**
 * Entry point for the wechat-agent-channel bot.
 *
 * Usage:
 *   tsx src/index.ts                         # run bot (requires WECHAT_BOT_TOKEN)
 *   tsx src/login.ts                         # QR login flow (separate binary)
 *
 * The bot:
 *   1. Long-polls getUpdates from ilinkai.weixin.qq.com
 *   2. For each user message, calls Claude Agent SDK with per-user session
 *   3. Sends the reply back via sendMessage (text + MEDIA: attachments)
 */

import { mkdir } from "node:fs/promises";

import { buildBotDeps, runBotLoop } from "./bot.js";
import { config } from "./config.js";
import { mainLog } from "./log.js";

async function main(): Promise<void> {
  await mkdir(config.bot.accountStateDir, { recursive: true });
  await mkdir(config.bot.mediaTmpDir, { recursive: true });
  await mkdir(config.claude.workDir, { recursive: true });

  const deps = await buildBotDeps(config.bot.accountStateDir);

  const abortController = new AbortController();

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    mainLog.info({ signal }, "received signal; shutting down");
    abortController.abort();
    try {
      await deps.api.notifyStop();
    } catch (err) {
      mainLog.warn({ err: String(err) }, "notifyStop failed");
    }
    await Promise.allSettled([deps.contextTokens.flush(), deps.sessions.flush(), deps.syncBuf.flush()]);
    mainLog.info("state flushed; exiting");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await runBotLoop(deps, abortController.signal);
  } catch (err) {
    mainLog.error({ err: String(err) }, "bot loop crashed");
    process.exit(1);
  }
}

main().catch((err) => {
  mainLog.fatal({ err: String(err) }, "fatal");
  process.exit(1);
});
