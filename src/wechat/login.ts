/**
 * QR code login flow.
 *
 * Usage:
 *   import { runLoginFlow } from "./wechat/login.js";
 *   const result = await runLoginFlow({ baseUrl, botType: "3", onQrCode });
 *   console.log(result.botToken, result.accountId);
 *
 * The flow:
 *   1. POST get_bot_qrcode → qrcode + qrcode_img_content (data: URL or weixin:// scheme)
 *   2. Caller renders the QR code (terminal / browser)
 *   3. Long-poll get_qrcode_status every 1s (server may hold 35s)
 *   4. Handle status state machine until "confirmed" / "binded_redirect" / error
 */

import { randomUUID } from "node:crypto";

import { WechatApiClient } from "./api.js";

export type QrStatus =
  | "wait"
  | "scaned"
  | "confirmed"
  | "expired"
  | "scaned_but_redirect"
  | "need_verifycode"
  | "verify_code_blocked"
  | "binded_redirect";

export interface LoginResult {
  connected: boolean;
  botToken?: string;
  accountId?: string;
  baseUrl?: string;
  userId?: string;
  alreadyConnected?: boolean;
  message: string;
}

export interface LoginOpts {
  api: WechatApiClient;
  botType?: string;
  timeoutMs?: number;
  /** Called when QR is ready; receives the qrcode_img_content string. */
  onQrCode?: (qrcodeImgContent: string) => void | Promise<void>;
  /** Called when user input is required (need_verifycode); should resolve with the entered code. */
  onVerifyCode?: (prompt: string) => Promise<string>;
  /** Called when QR needs refresh (expired/blocked); receives the new img content. */
  onQrRefresh?: (qrcodeImgContent: string) => void | Promise<void>;
  /** Called on each status update for logging. */
  onStatus?: (status: QrStatus, info?: Record<string, unknown>) => void | Promise<void>;
  /** Aborts the wait loop. */
  signal?: AbortSignal;
}

const MAX_QR_REFRESH = 3;

export async function runLoginFlow(opts: LoginOpts): Promise<LoginResult> {
  const botType = opts.botType ?? "3";
  const timeoutMs = opts.timeoutMs ?? 480_000;

  // 1. Acquire QR code
  const qr = await opts.api.getBotQrcode({ botType });
  if (!qr.qrcode || !qr.qrcode_img_content) {
    return { connected: false, message: "Failed to fetch QR code" };
  }

  await opts.onQrCode?.(qr.qrcode_img_content);

  // 2. Long-poll status
  const deadline = Date.now() + timeoutMs;
  let pendingVerifyCode: string | undefined;
  let refreshCount = 0;
  let currentBaseUrl = opts.api.baseUrl;

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) {
      return { connected: false, message: "aborted" };
    }

    let status: Awaited<ReturnType<typeof opts.api.getQrcodeStatus>>;
    try {
      status = await opts.api.getQrcodeStatus({
        qrcode: qr.qrcode,
        ...(pendingVerifyCode ? { verifyCode: pendingVerifyCode } : {}),
        timeoutMs: 35_000,
      });
    } catch (err) {
      // Network/gateway error — treat as "wait", keep polling
      await sleep(1000, opts.signal);
      continue;
    }

    const s = status.status as QrStatus;
    await opts.onStatus?.(s, { botId: status.ilink_bot_id, hasBotToken: Boolean(status.bot_token) });

    switch (s) {
      case "wait":
        break;
      case "scaned":
        if (pendingVerifyCode) {
          pendingVerifyCode = undefined;
        }
        break;
      case "need_verifycode": {
        if (!opts.onVerifyCode) {
          return { connected: false, message: "Server requested verify code but no handler provided" };
        }
        const prompt = pendingVerifyCode
          ? "❌ You entered the wrong code. Please retry:"
          : "Enter the 6-digit code shown on WeChat:";
        const code = await opts.onVerifyCode(prompt);
        pendingVerifyCode = code.trim();
        // continue immediately, no 1s sleep
        continue;
      }
      case "expired":
      case "verify_code_blocked": {
        refreshCount += 1;
        if (refreshCount > MAX_QR_REFRESH) {
          return {
            connected: false,
            message: `QR expired ${MAX_QR_REFRESH} times. Please retry later.`,
          };
        }
        const refreshed = await opts.api.getBotQrcode({ botType });
        qr.qrcode = refreshed.qrcode;
        qr.qrcode_img_content = refreshed.qrcode_img_content;
        pendingVerifyCode = undefined;
        await opts.onQrRefresh?.(qr.qrcode_img_content);
        break;
      }
      case "binded_redirect":
        return {
          connected: false,
          alreadyConnected: true,
          message: "Already connected to this OpenClaw instance.",
        };
      case "scaned_but_redirect": {
        if (status.redirect_host) {
          currentBaseUrl = `https://${status.redirect_host}`;
          // The API client holds its baseUrl; we'd need to swap it for further polling.
          // For simplicity, treat this as a fatal "retry needed" — caller should re-run.
          return {
            connected: false,
            message: `IDC redirect required to ${status.redirect_host}. Please re-run login.`,
          };
        }
        break;
      }
      case "confirmed": {
        if (!status.ilink_bot_id) {
          return { connected: false, message: "Login confirmed but ilink_bot_id missing" };
        }
        return {
          connected: true,
          botToken: status.bot_token,
          accountId: status.ilink_bot_id,
          baseUrl: status.baseurl ?? currentBaseUrl,
          userId: status.ilink_user_id,
          message: "Login confirmed.",
        };
      }
    }

    await sleep(1000, opts.signal);
  }

  return { connected: false, message: "Login timed out" };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      });
      return;
    }
    void t;
  });
}

/** Generate a sessionKey suitable for the login flow. */
export function newSessionKey(): string {
  return randomUUID();
}
