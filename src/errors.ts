export type ChannelErrorCode = "AUTH_REQUIRED" | "INVALID_TOKEN" | "ABORTED" | "INVALID_BOT_ID";

/**
 * Lifecycle / configuration error from the channel layer itself (not from
 * the WeChat server). Thrown synchronously by `createChannel()` for bad
 * inputs, and by `start()` if called twice without an intervening `stop()`.
 */
export class ChannelError extends Error {
  readonly code: ChannelErrorCode;
  constructor(code: ChannelErrorCode, message: string) {
    super(message);
    this.name = "ChannelError";
    this.code = code;
  }
}

export interface WechatApiErrorPayload {
  ret?: number;
  errcode?: number;
  errmsg?: string;
}

/**
 * Error returned by the WeChat ilink server or the HTTP transport layer.
 *
 * `errcode === -14` ("session expired") triggers the long-poll loop's 1-hour
 * pause; all other non-zero ret/errcode values are surfaced via `onError`
 * with `phase: "getUpdates"` or `phase: "sessionExpired"`.
 */
export class WechatApiError extends Error {
  readonly ret?: number;
  readonly errcode?: number;
  readonly errmsg?: string;
  constructor(payload: WechatApiErrorPayload, message?: string) {
    super(message ?? payload.errmsg ?? `wechat api error ${payload.errcode ?? payload.ret ?? "unknown"}`);
    this.name = "WechatApiError";
    this.ret = payload.ret;
    this.errcode = payload.errcode;
    this.errmsg = payload.errmsg;
  }
}

export type MediaPhase = "download" | "decrypt" | "upload" | "encrypt";

/**
 * Media I/O failure (download / decrypt / upload / encrypt). Always wraps
 * a `cause: unknown` from the underlying fs / crypto / network call.
 *
 * Inbound (`"download"`, `"decrypt"`) failures are reported via
 * `onError({ phase: "inbound" })` and the message is dropped; outbound
 * (`"upload"`, `"encrypt"`) failures throw synchronously from `reply.media()`.
 */
export class MediaError extends Error {
  readonly phase: MediaPhase;
  override readonly cause: unknown;
  constructor(phase: MediaPhase, cause: unknown, message?: string) {
    super(message ?? `media ${phase} failed: ${String(cause)}`);
    this.name = "MediaError";
    this.phase = phase;
    this.cause = cause;
  }
}
