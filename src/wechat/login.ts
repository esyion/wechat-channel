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
import { PNG } from "pngjs";
import { Buffer } from "node:buffer";

import { Bitmap, encodeQR } from "qr";
import { decodeQR, _tests as decodeTests } from "qr/decode.js";

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

export interface RequestedQr {
  qrcode: string;
  qrcodeImgContent: string; // data: URL or "weixin://..." — see docs
}

// ---------------------------------------------------------------------------
// Low-level primitives
// ---------------------------------------------------------------------------

/** Step 1: get a fresh QR code from ilink. */
export async function requestQrCode(
  api: WechatApiClient,
  opts: { botType?: string },
): Promise<RequestedQr> {
  const botType = opts.botType ?? "3";
  const qr = await api.getBotQrcode({ botType });
  if (!qr.qrcode || !qr.qrcode_img_content) {
    throw new Error("Failed to fetch QR code");
  }
  return { qrcode: qr.qrcode, qrcodeImgContent: qr.qrcode_img_content };
}

/** Step 1b: decode qrcode_img_content into a 2D boolean matrix.
 *  Uses `qr` package (active successor to deprecated @paulmillr/qr).
 *  Parses the data URL → PNG buffer → decodeQR → detect → boolean matrix.
 *  Returns rows × cols, true = dark. */
export async function decodeQrMatrix(qrcodeImgContent: string): Promise<boolean[][]> {
  // qrcodeImgContent is typically "data:image/png;base64,XXXXX"
  const m = qrcodeImgContent.match(/^data:image\/png;base64,(.+)$/);
  if (!m) throw new Error("unexpected qrcode_img_content format");
  const buf = Buffer.from(m[1]!, "base64");
  const png = PNG.sync.read(buf);
  if (!png?.height || !png?.width || !png?.data) throw new Error("invalid PNG");
  // decodeQR expects RGBA image { height, width, data }
  const img = { height: png.height, width: png.width, data: png.data };
  const text = decodeQR(img);
  // Re-encode the decoded text to get a clean bitmap we can sample
  const bits = encodeQR(text, "raw", { scale: 4 });
  if (!bits[0]) throw new Error("encodeQR returned empty result");
  const bm = new Bitmap({ width: bits[0].length, height: bits.length }, bits);
  const detected = decodeTests.detect(bm);
  const size = detected.bits.size();
  const matrix: boolean[][] = [];
  for (let r = 0; r < size.height; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < size.width; c++) row.push(Boolean(detected.bits.get(c, r)));
    matrix.push(row);
  }
  return matrix;
}

// ---------------------------------------------------------------------------
// Polling loop
// ---------------------------------------------------------------------------

/** Step 2: poll get_qrcode_status until terminal state. Caller passes onVerifyCode
 *  to handle verify-code prompts (returns code or throws to abort). */
export async function pollQrLogin(
  api: WechatApiClient,
  opts: {
    qrcode: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    onVerifyCode?: (prompt: string) => Promise<string>;
    onStatus?: (status: QrStatus, info?: Record<string, unknown>) => void | Promise<void>;
  },
): Promise<LoginResult> {
  const timeoutMs = opts.timeoutMs ?? 480_000;
  const deadline = Date.now() + timeoutMs;
  let pendingVerifyCode: string | undefined;
  let refreshCount = 0;
  let currentQrcode = opts.qrcode;

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) {
      return { connected: false, message: "aborted" };
    }

    let status: Awaited<ReturnType<typeof api.getQrcodeStatus>>;
    try {
      status = await api.getQrcodeStatus({
        qrcode: currentQrcode,
        ...(pendingVerifyCode ? { verifyCode: pendingVerifyCode } : {}),
        timeoutMs: 35_000,
      });
    } catch {
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
          ? "You entered the wrong code. Please retry:"
          : "Enter the 6-digit code shown on WeChat:";
        const code = await opts.onVerifyCode(prompt);
        pendingVerifyCode = code.trim();
        // continue immediately, no 1s sleep
        continue;
      }
      case "expired":
      case "verify_code_blocked": {
        refreshCount += 1;
        const MAX_QR_REFRESH = 3;
        if (refreshCount > MAX_QR_REFRESH) {
          return {
            connected: false,
            message: `QR expired ${MAX_QR_REFRESH} times. Please retry later.`,
          };
        }
        const refreshed = await api.getBotQrcode({ botType: "3" });
        currentQrcode = refreshed.qrcode;
        pendingVerifyCode = undefined;
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
          baseUrl: status.baseurl ?? api.baseUrl,
          userId: status.ilink_user_id,
          message: "Login confirmed.",
        };
      }
    }

    await sleep(1000, opts.signal);
  }

  return { connected: false, message: "Login timed out" };
}

// ---------------------------------------------------------------------------
// Thin wrapper (backward compat)
// ---------------------------------------------------------------------------

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

/** Wires requestQrCode + pollQrLogin with the existing LoginOpts callbacks.
 *  Preserves the verify-code / refresh / redirect state machine exactly. */
export async function runLoginFlow(opts: LoginOpts): Promise<LoginResult> {
  const botType = opts.botType ?? "3";

  // 1. Acquire QR code
  let qr: RequestedQr;
  try {
    qr = await requestQrCode(opts.api, { botType });
  } catch {
    return { connected: false, message: "Failed to fetch QR code" };
  }

  await opts.onQrCode?.(qr.qrcodeImgContent);

  // 2. Long-poll status
  const deadline = Date.now() + (opts.timeoutMs ?? 480_000);
  let pendingVerifyCode: string | undefined;
  let refreshCount = 0;
  let currentQrcode = qr.qrcode;

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) {
      return { connected: false, message: "aborted" };
    }

    let status: Awaited<ReturnType<typeof opts.api.getQrcodeStatus>>;
    try {
      status = await opts.api.getQrcodeStatus({
        qrcode: currentQrcode,
        ...(pendingVerifyCode ? { verifyCode: pendingVerifyCode } : {}),
        timeoutMs: 35_000,
      });
    } catch {
      await sleep(1000, opts.signal);
      continue;
    }

    const s = status.status as QrStatus;
    await opts.onStatus?.(s, { botId: status.ilink_bot_id, hasBotToken: Boolean(status.bot_token) });

    switch (s) {
      case "wait":
        break;
      case "scaned":
        if (pendingVerifyCode) pendingVerifyCode = undefined;
        break;
      case "need_verifycode": {
        if (!opts.onVerifyCode) {
          return { connected: false, message: "Server requested verify code but no handler provided" };
        }
        const prompt = pendingVerifyCode
          ? "You entered the wrong code. Please retry:"
          : "Enter the 6-digit code shown on WeChat:";
        const code = await opts.onVerifyCode(prompt);
        pendingVerifyCode = code.trim();
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
        currentQrcode = refreshed.qrcode;
        const newQr = await requestQrCode(opts.api, { botType });
        pendingVerifyCode = undefined;
        await opts.onQrRefresh?.(newQr.qrcodeImgContent);
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
          baseUrl: status.baseurl ?? opts.api.baseUrl,
          userId: status.ilink_user_id,
          message: "Login confirmed.",
        };
      }
    }

    await sleep(1000, opts.signal);
  }

  return { connected: false, message: "Login timed out" };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
