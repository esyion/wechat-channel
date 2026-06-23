"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestQrCode = requestQrCode;
exports.decodeQrMatrix = decodeQrMatrix;
exports.pollQrLogin = pollQrLogin;
exports.runLoginFlow = runLoginFlow;
exports.newSessionKey = newSessionKey;
const node_crypto_1 = require("node:crypto");
const pngjs_1 = require("pngjs");
const node_buffer_1 = require("node:buffer");
const qr_1 = require("qr");
const decode_js_1 = require("qr/decode.js");
// ---------------------------------------------------------------------------
// Low-level primitives
// ---------------------------------------------------------------------------
/** Step 1: get a fresh QR code from ilink. */
async function requestQrCode(api, opts) {
    const botType = opts.botType ?? "3";
    const qr = await api.getBotQrcode({ botType });
    if (!qr.qrcode || !qr.qrcode_img_content) {
        throw new Error("Failed to fetch QR code");
    }
    return { qrcode: qr.qrcode, qrcodeImgContent: qr.qrcode_img_content };
}
/** Step 1b: turn `qrcode_img_content` into a 2D boolean matrix.
 *
 * Three accepted shapes (per the ilink protocol doc):
 *   - `data:image/png;base64,XXX` — embedded PNG; decode → recover text → re-encode matrix
 *   - `https://liteapp.weixin.qq.com/q/...?qrcode=...&bot_type=N` — the QR *encodes* this URL;
 *     scanning opens the URL in WeChat which signals the login. Just encode the URL directly.
 *   - `weixin://...` — WeChat deep link; encode as text. (Rare; documented but rarely seen.)
 *
 * Returns rows × cols, true = dark module.
 */
async function decodeQrMatrix(qrcodeImgContent) {
    const dataMatch = qrcodeImgContent.match(/^data:image\/png;base64,(.+)$/);
    if (dataMatch) {
        const buf = node_buffer_1.Buffer.from(dataMatch[1], "base64");
        const png = pngjs_1.PNG.sync.read(buf);
        if (!png?.height || !png?.width || !png?.data)
            throw new Error("invalid PNG");
        const img = { height: png.height, width: png.width, data: png.data };
        const text = (0, decode_js_1.decodeQR)(img);
        return textToQrMatrix(text);
    }
    // HTTP(S) URL or arbitrary text — encode directly. The WeChat scanner reads
    // the QR and dispatches the URL to the ilink service.
    return textToQrMatrix(qrcodeImgContent);
}
/** Encode `text` as a clean boolean matrix via the `qr` package. */
function textToQrMatrix(text) {
    const bits = (0, qr_1.encodeQR)(text, "raw", { scale: 4 });
    if (!bits[0])
        throw new Error("encodeQR returned empty result");
    const bm = new qr_1.Bitmap({ width: bits[0].length, height: bits.length }, bits);
    const detected = decode_js_1._tests.detect(bm);
    const size = detected.bits.size();
    const matrix = [];
    for (let r = 0; r < size.height; r++) {
        const row = [];
        for (let c = 0; c < size.width; c++)
            row.push(Boolean(detected.bits.get(c, r)));
        matrix.push(row);
    }
    return matrix;
}
// ---------------------------------------------------------------------------
// Polling loop
// ---------------------------------------------------------------------------
/** Step 2: poll get_qrcode_status until terminal state. Caller passes onVerifyCode
 *  to handle verify-code prompts (returns code or throws to abort). */
async function pollQrLogin(api, opts) {
    const timeoutMs = opts.timeoutMs ?? 480_000;
    const deadline = Date.now() + timeoutMs;
    let pendingVerifyCode;
    let refreshCount = 0;
    let currentQrcode = opts.qrcode;
    while (Date.now() < deadline) {
        if (opts.signal?.aborted) {
            return { connected: false, message: "aborted" };
        }
        let status;
        try {
            status = await api.getQrcodeStatus({
                qrcode: currentQrcode,
                ...(pendingVerifyCode ? { verifyCode: pendingVerifyCode } : {}),
                timeoutMs: 35_000,
            });
        }
        catch {
            // Network/gateway error — treat as "wait", keep polling
            await sleep(1000, opts.signal);
            continue;
        }
        const s = status.status;
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
                await opts.onQrRefresh?.(refreshed.qrcode_img_content);
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
/** Wires requestQrCode + pollQrLogin with the existing LoginOpts callbacks.
 *  Preserves the verify-code / refresh / redirect state machine exactly. */
async function runLoginFlow(opts) {
    const botType = opts.botType ?? "3";
    // 1. Acquire QR code
    let qr;
    try {
        qr = await requestQrCode(opts.api, { botType });
    }
    catch {
        return { connected: false, message: "Failed to fetch QR code" };
    }
    await opts.onQrCode?.(qr.qrcodeImgContent);
    // 2. Delegate polling to pollQrLogin
    return await pollQrLogin(opts.api, {
        qrcode: qr.qrcode,
        timeoutMs: opts.timeoutMs,
        signal: opts.signal,
        onVerifyCode: opts.onVerifyCode,
        onStatus: opts.onStatus,
        onQrRefresh: opts.onQrRefresh,
    });
}
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function sleep(ms, signal) {
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
function newSessionKey() {
    return (0, node_crypto_1.randomUUID)();
}
//# sourceMappingURL=login.js.map