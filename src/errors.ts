export type ChannelErrorCode = "AUTH_REQUIRED" | "INVALID_TOKEN" | "ABORTED";

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

export class MediaError extends Error {
  readonly phase: MediaPhase;
  readonly cause: unknown;
  constructor(phase: MediaPhase, cause: unknown, message?: string) {
    super(message ?? `media ${phase} failed: ${String(cause)}`);
    this.name = "MediaError";
    this.phase = phase;
    this.cause = cause;
  }
}
