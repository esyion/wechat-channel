#!/usr/bin/env node
/**
 * QR code login helper.
 *
 * Run this once to obtain a bot_token:
 *   tsx src/login.ts
 *
 * On success, writes token + accountId to:
 *   $ACCOUNT_STATE_DIR/credentials.json  (chmod 600)
 *   $ACCOUNT_STATE_DIR/state.json       (accountId, baseUrl, userId)
 *
 * Then set in .env:
 *   WECHAT_BOT_TOKEN=<token>
 *   WECHAT_ACCOUNT_ID=<accountId>
 */

import { createInterface } from "node:readline/promises";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import qrcodeTerminal from "qrcode-terminal";

import { WechatApiClient } from "./wechat/api.js";
import { runLoginFlow } from "./wechat/login.js";
import { config } from "./config.js";
import { loginLog } from "./log.js";

interface Credentials {
  token: string;
  savedAt: string;
  baseUrl: string;
  accountId: string;
  userId?: string;
}

async function promptVerifyCode(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("");
    return answer.trim();
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  await mkdir(config.bot.accountStateDir, { recursive: true });

  const api = new WechatApiClient({
    baseUrl: config.wechat.baseUrl,
    cdnBaseUrl: config.wechat.cdnBaseUrl,
    botToken: "", // not yet
    channelVersion: config.wechat.channelVersion,
    botAgent: config.wechat.botAgent,
  });

  loginLog.info({ baseUrl: api.baseUrl }, "starting QR login flow");

  const result = await runLoginFlow({
    api,
    botType: "3",
    timeoutMs: 480_000,
    onQrCode: (qrImg) => {
      // QR rendering is UI output, not structured log: write directly to stdout
      // so the user sees the QR code intact (ANSI escapes, ASCII art).
      process.stdout.write("\n[login] Scan this QR code with WeChat:\n\n");
      try {
        qrcodeTerminal.generate(qrImg, { small: true });
      } catch {
        process.stdout.write(`${qrImg}\n`);
      }
      process.stdout.write(`\n[login] (or open this URL: ${qrImg})\n\n`);
    },
    onQrRefresh: (qrImg) => {
      process.stdout.write("\n[login] QR refreshed — scan again:\n\n");
      try {
        qrcodeTerminal.generate(qrImg, { small: true });
      } catch {
        process.stdout.write(`${qrImg}\n`);
      }
    },
    onVerifyCode: promptVerifyCode,
    onStatus: (status, info) => {
      if (status === "scaned") loginLog.info("QR scanned — waiting for confirmation");
      if (status === "confirmed") loginLog.info({ info }, "login confirmed");
    },
  });

  if (!result.connected) {
    if (result.alreadyConnected) {
      loginLog.info({ message: result.message }, "existing token in credentials.json is still valid");
      process.exit(0);
    }
    loginLog.error({ message: result.message }, "login failed");
    process.exit(1);
  }

  loginLog.info(
    { accountId: result.accountId, userId: result.userId, baseUrl: result.baseUrl },
    "✅ login successful",
  );

  // Persist credentials (chmod 600)
  const creds: Credentials = {
    token: result.botToken ?? "",
    savedAt: new Date().toISOString(),
    baseUrl: result.baseUrl ?? config.wechat.baseUrl,
    accountId: result.accountId ?? "",
    ...(result.userId ? { userId: result.userId } : {}),
  };

  const credPath = join(config.bot.accountStateDir, "credentials.json");
  await writeFile(credPath, JSON.stringify(creds, null, 2), "utf-8");
  try {
    await chmod(credPath, 0o600);
  } catch {
    // best-effort
  }

  // "Next steps" is a user-facing instruction block — keep aligned stdout output.
  loginLog.info({ credPath }, "saved credentials");
  process.stdout.write(
    [
      "",
      "[login] Next steps — add to your .env:",
      `        WECHAT_BOT_TOKEN=${creds.token}`,
      `        WECHAT_ACCOUNT_ID=${creds.accountId}`,
      "",
      "[login] Then run:  npm start",
      "",
    ].join("\n"),
  );
}

main().catch((err) => {
  loginLog.fatal({ err: String(err) }, "login fatal");
  process.exit(1);
});
