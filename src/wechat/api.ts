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

import { randomBytes } from "node:crypto";

import type {
  BaseInfo,
  GetConfigResp,
  GetUpdatesReq,
  GetUpdatesResp,
  GetUploadUrlReq,
  GetUploadUrlResp,
  NotifyResp,
  SendMessageReq,
  SendTypingReq,
} from "./types.js";

const ILINK_APP_ID = "bot"; // package.json#ilink_appid

interface CommonOpts {
  baseUrl: string;
  channelVersion: string;
  botAgent: string;
}

export interface ApiClientOptions extends CommonOpts {
  botToken?: string;
  /** Default per-request timeout for non-long-poll calls. */
  defaultTimeoutMs?: number;
  /** Default timeout for long-poll (getUpdates). */
  longPollTimeoutMs?: number;
}

export class WechatApiClient {
  readonly baseUrl: string;
  readonly cdnBaseUrl: string;
  private readonly botToken?: string;
  private readonly channelVersion: string;
  private readonly botAgent: string;
  private readonly defaultTimeoutMs: number;
  private readonly longPollTimeoutMs: number;

  constructor(opts: ApiClientOptions & { cdnBaseUrl: string }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.cdnBaseUrl = opts.cdnBaseUrl.replace(/\/+$/, "");
    this.botToken = opts.botToken;
    this.channelVersion = opts.channelVersion;
    this.botAgent = opts.botAgent;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 15_000;
    this.longPollTimeoutMs = opts.longPollTimeoutMs ?? 35_000;
  }

  setBotToken(token: string): void {
    (this as unknown as { botToken: string }).botToken = token;
  }

  // -----------------------------------------------------------------------
  // Header / payload helpers
  // -----------------------------------------------------------------------

  private buildBaseInfo(): BaseInfo {
    return { channel_version: this.channelVersion, bot_agent: this.botAgent };
  }

  private commonHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      "X-WECHAT-UIN": this.randomWechatUin(),
      "iLink-App-Id": ILINK_APP_ID,
      "iLink-App-ClientVersion": "0",
    };
  }

  private authHeaders(): Record<string, string> {
    const h = this.commonHeaders();
    if (this.botToken) {
      h.Authorization = `Bearer ${this.botToken}`;
    }
    return h;
  }

  private randomWechatUin(): string {
    const u32 = randomBytes(4).readUInt32BE(0);
    return Buffer.from(String(u32), "utf-8").toString("base64");
  }

  // -----------------------------------------------------------------------
  // Low-level HTTP
  // -----------------------------------------------------------------------

  private async postJson<TReq, TRes>(
    endpoint: string,
    body: TReq,
    useAuth: boolean,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<TRes> {
    const url = `${this.baseUrl}/${endpoint.replace(/^\/+/, "")}`;
    const controller = new AbortController();
    const timeout = timeoutMs ?? this.defaultTimeoutMs;
    const timer = setTimeout(() => controller.abort(), timeout);
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: useAuth ? this.authHeaders() : this.commonHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`POST ${endpoint} ${res.status}: ${text}`);
      }
      return JSON.parse(text) as TRes;
    } finally {
      clearTimeout(timer);
    }
  }

  private async getJson<TRes>(endpoint: string, timeoutMs?: number): Promise<TRes> {
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
      return JSON.parse(text) as TRes;
    } finally {
      clearTimeout(timer);
    }
  }

  // -----------------------------------------------------------------------
  // Login
  // -----------------------------------------------------------------------

  async getBotQrcode(opts: {
    botType?: string;
    localTokenList?: string[];
  }): Promise<{ qrcode: string; qrcode_img_content: string }> {
    const botType = opts.botType ?? "3";
    const endpoint = `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`;
    return this.postJson(
      endpoint,
      { local_token_list: opts.localTokenList ?? [] },
      false,
    );
  }

  async getQrcodeStatus(opts: {
    qrcode: string;
    verifyCode?: string;
    timeoutMs?: number;
  }): Promise<{
    status: string;
    bot_token?: string;
    ilink_bot_id?: string;
    baseurl?: string;
    ilink_user_id?: string;
    redirect_host?: string;
  }> {
    let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(opts.qrcode)}`;
    if (opts.verifyCode) {
      endpoint += `&verify_code=${encodeURIComponent(opts.verifyCode)}`;
    }
    return this.getJson(endpoint, opts.timeoutMs);
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async notifyStart(): Promise<NotifyResp> {
    return this.postJson("ilink/bot/msg/notifystart", { base_info: this.buildBaseInfo() }, true, 10_000);
  }

  async notifyStop(): Promise<NotifyResp> {
    return this.postJson("ilink/bot/msg/notifystop", { base_info: this.buildBaseInfo() }, true, 10_000);
  }

  // -----------------------------------------------------------------------
  // Main loop
  // -----------------------------------------------------------------------

  async getUpdates(
    req: GetUpdatesReq,
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<GetUpdatesResp> {
    return this.postJson(
      "ilink/bot/getupdates",
      {
        get_updates_buf: req.get_updates_buf ?? "",
        base_info: this.buildBaseInfo(),
      },
      true,
      opts?.timeoutMs ?? this.longPollTimeoutMs,
      opts?.signal,
    );
  }

  // -----------------------------------------------------------------------
  // Outbound messaging
  // -----------------------------------------------------------------------

  async sendMessage(req: SendMessageReq): Promise<void> {
    await this.postJson(
      "ilink/bot/sendmessage",
      { ...req, base_info: this.buildBaseInfo() },
      true,
    );
  }

  async getUploadUrl(req: GetUploadUrlReq): Promise<GetUploadUrlResp> {
    return this.postJson(
      "ilink/bot/getuploadurl",
      { ...req, base_info: this.buildBaseInfo() },
      true,
    );
  }

  async getConfig(opts: { ilinkUserId: string; contextToken?: string }): Promise<GetConfigResp> {
    return this.postJson(
      "ilink/bot/getconfig",
      {
        ilink_user_id: opts.ilinkUserId,
        context_token: opts.contextToken,
        base_info: this.buildBaseInfo(),
      },
      true,
      10_000,
    );
  }

  async sendTyping(req: SendTypingReq): Promise<void> {
    await this.postJson(
      "ilink/bot/sendtyping",
      { ...req, base_info: this.buildBaseInfo() },
      true,
      10_000,
    );
  }
}
