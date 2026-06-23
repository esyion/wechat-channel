"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediaError = exports.WechatApiError = exports.ChannelError = void 0;
/**
 * Lifecycle / configuration error from the channel layer itself (not from
 * the WeChat server). Thrown synchronously by `createChannel()` for bad
 * inputs, and by `start()` if called twice without an intervening `stop()`.
 */
class ChannelError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "ChannelError";
        this.code = code;
    }
}
exports.ChannelError = ChannelError;
/**
 * Error returned by the WeChat ilink server or the HTTP transport layer.
 *
 * `errcode === -14` ("session expired") triggers the long-poll loop's 1-hour
 * pause; all other non-zero ret/errcode values are surfaced via `onError`
 * with `phase: "getUpdates"` or `phase: "sessionExpired"`.
 */
class WechatApiError extends Error {
    ret;
    errcode;
    errmsg;
    constructor(payload, message) {
        super(message ?? payload.errmsg ?? `wechat api error ${payload.errcode ?? payload.ret ?? "unknown"}`);
        this.name = "WechatApiError";
        this.ret = payload.ret;
        this.errcode = payload.errcode;
        this.errmsg = payload.errmsg;
    }
}
exports.WechatApiError = WechatApiError;
/**
 * Media I/O failure (download / decrypt / upload / encrypt). Always wraps
 * a `cause: unknown` from the underlying fs / crypto / network call.
 *
 * Inbound (`"download"`, `"decrypt"`) failures are reported via
 * `onError({ phase: "inbound" })` and the message is dropped; outbound
 * (`"upload"`, `"encrypt"`) failures throw synchronously from `reply.media()`.
 */
class MediaError extends Error {
    phase;
    cause;
    constructor(phase, cause, message) {
        super(message ?? `media ${phase} failed: ${String(cause)}`);
        this.name = "MediaError";
        this.phase = phase;
        this.cause = cause;
    }
}
exports.MediaError = MediaError;
//# sourceMappingURL=errors.js.map