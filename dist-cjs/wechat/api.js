"use strict";
/**
 * WeChat ilink API client.
 *
 * Implements the 11 endpoints from weixin-channel-api.md:
 *   - get_bot_qrcode (login)
 *   - get_qrcode_status (login long-poll)
 *   - getupdates (main loop)
 *   - sendmessage
 *   - getuploadurl
 *   - getconfig
 *   - sendtyping
 *   - notifystart / notifystop
 *
 * Plus raw CDN upload/download (octet-stream).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WechatApiClient = void 0;
const node_crypto_1 = require("node:crypto");
const ILINK_APP_ID = "bot"; // package.json#ilink_appid
class WechatApiClient {
    baseUrl;
    cdnBaseUrl;
    botToken;
    channelVersion;
    botAgent;
    defaultTimeoutMs;
    longPollTimeoutMs;
    logger;
    constructor(opts) {
        this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
        this.cdnBaseUrl = opts.cdnBaseUrl.replace(/\/+$/, "");
        this.botToken = opts.botToken;
        this.channelVersion = opts.channelVersion;
        this.botAgent = opts.botAgent;
        this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 15_000;
        this.longPollTimeoutMs = opts.longPollTimeoutMs ?? 35_000;
        this.logger = opts.logger;
    }
    setBotToken(token) {
        this.botToken = token;
    }
    // -----------------------------------------------------------------------
    // Header / payload helpers
    // -----------------------------------------------------------------------
    buildBaseInfo() {
        return { channel_version: this.channelVersion, bot_agent: this.botAgent };
    }
    commonHeaders() {
        return {
            "Content-Type": "application/json",
            AuthorizationType: "ilink_bot_token",
            "X-WECHAT-UIN": this.randomWechatUin(),
            "iLink-App-Id": ILINK_APP_ID,
            "iLink-App-ClientVersion": "0",
        };
    }
    authHeaders() {
        const h = this.commonHeaders();
        if (this.botToken) {
            h.Authorization = `Bearer ${this.botToken}`;
        }
        return h;
    }
    randomWechatUin() {
        const u32 = (0, node_crypto_1.randomBytes)(4).readUInt32BE(0);
        return Buffer.from(String(u32), "utf-8").toString("base64");
    }
    // -----------------------------------------------------------------------
    // Low-level HTTP
    // -----------------------------------------------------------------------
    async postJson(endpoint, body, useAuth, timeoutMs, signal) {
        const url = `${this.baseUrl}/${endpoint.replace(/^\/+/, "")}`;
        const controller = new AbortController();
        const timeout = timeoutMs ?? this.defaultTimeoutMs;
        const timer = setTimeout(() => controller.abort(), timeout);
        if (signal) {
            if (signal.aborted)
                controller.abort();
            else
                signal.addEventListener("abort", () => controller.abort(), { once: true });
        }
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: useAuth ? this.authHeaders() : this.commonHeaders(),
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            const text = await res.text();
            this.logger?.debug({ url, method: "POST", req: body, resStatus: res.status, resBody: text });
            if (!res.ok) {
                throw new Error(`POST ${endpoint} ${res.status}: ${text}`);
            }
            return JSON.parse(text);
        }
        finally {
            clearTimeout(timer);
        }
    }
    async getJson(endpoint, timeoutMs) {
        const url = `${this.baseUrl}/${endpoint.replace(/^\/+/, "")}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs ?? 10_000);
        try {
            const res = await fetch(url, {
                method: "GET",
                headers: this.commonHeaders(),
                signal: controller.signal,
            });
            const text = await res.text();
            if (!res.ok) {
                throw new Error(`GET ${endpoint} ${res.status}: ${text}`);
            }
            return JSON.parse(text);
        }
        finally {
            clearTimeout(timer);
        }
    }
    // -----------------------------------------------------------------------
    // Login
    // -----------------------------------------------------------------------
    async getBotQrcode(opts) {
        const botType = opts.botType ?? "3";
        const endpoint = `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`;
        return this.postJson(endpoint, { local_token_list: opts.localTokenList ?? [] }, false);
    }
    async getQrcodeStatus(opts) {
        let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(opts.qrcode)}`;
        if (opts.verifyCode) {
            endpoint += `&verify_code=${encodeURIComponent(opts.verifyCode)}`;
        }
        return this.getJson(endpoint, opts.timeoutMs);
    }
    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------
    async notifyStart() {
        return this.postJson("ilink/bot/msg/notifystart", { base_info: this.buildBaseInfo() }, true, 10_000);
    }
    async notifyStop() {
        return this.postJson("ilink/bot/msg/notifystop", { base_info: this.buildBaseInfo() }, true, 10_000);
    }
    // -----------------------------------------------------------------------
    // Main loop
    // -----------------------------------------------------------------------
    async getUpdates(req, opts) {
        return this.postJson("ilink/bot/getupdates", {
            get_updates_buf: req.get_updates_buf ?? "",
            base_info: this.buildBaseInfo(),
        }, true, opts?.timeoutMs ?? this.longPollTimeoutMs, opts?.signal);
    }
    // -----------------------------------------------------------------------
    // Outbound messaging
    // -----------------------------------------------------------------------
    async sendMessage(req) {
        await this.postJson("ilink/bot/sendmessage", { ...req, base_info: this.buildBaseInfo() }, true);
    }
    async getUploadUrl(req) {
        return this.postJson("ilink/bot/getuploadurl", { ...req, base_info: this.buildBaseInfo() }, true);
    }
    async getConfig(opts) {
        return this.postJson("ilink/bot/getconfig", {
            ilink_user_id: opts.ilinkUserId,
            context_token: opts.contextToken,
            base_info: this.buildBaseInfo(),
        }, true, 10_000);
    }
    async sendTyping(req) {
        await this.postJson("ilink/bot/sendtyping", { ...req, base_info: this.buildBaseInfo() }, true, 10_000);
    }
}
exports.WechatApiClient = WechatApiClient;
//# sourceMappingURL=api.js.map