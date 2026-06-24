import type { WeixinMessage } from "../wechat/types.js";

export interface MediaRef {
  /** Absolute path to a local file the handler can read. */
  path: string;
  /** MIME type — image/* are vision-eligible, others are file references. */
  mime: string;
}

/**
 * An inbound message passed to `onMessage` handlers.
 *
 * `media[].path` is a local file path (already decrypted). `raw` is the full
 * protocol-level message for callers that need fields not projected onto
 * `ChannelMsg` (e.g. quoted replies, custom item types).
 */
export interface ChannelMsg {
  fromUserId: string;
  contextToken: string;
  text: string;
  media: ReadonlyArray<MediaRef>;
  raw: WeixinMessage;
}

export interface ReplyTextOpts {
  maxChars?: number;
}

/**
 * Per-message outbound helper passed to `onMessage(msg, reply)` handlers.
 *
 * `text` auto-chunks at `maxChars` (default 4000). `media` dispatches to the
 * correct ilink upload endpoint based on MIME type. `typing(true)` starts a
 * "对方正在输入" heartbeat; `typing(false)` cancels it.
 */
export interface Reply {
  text(content: string, opts?: ReplyTextOpts): Promise<void>;
  media(filePath: string, caption?: string): Promise<void>;
  typing(on?: boolean): Promise<void>;
}

export interface QrTerminalOpts {
  margin?: number;
  invert?: boolean;
}

export interface QrPngOpts {
  size?: number;
  margin?: number;
}

export interface QrSvgOpts {
  margin?: number;
}

export interface WaitForLoginOpts {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface LoginResult {
  botToken: string;
  accountId: string;
  baseUrl: string;
}

/**
 * Login handle returned by the top-level `loginQR()`. Exposes the raw QR matrix plus
 * four render helpers covering terminal (ASCII), PNG buffer, SVG string, and
 * data URL — so the same handle works for CLI bots, web apps, and embedded use.
 *
 * `waitForLogin()` polls until the user scans and confirms on their phone,
 * then resolves with `{ botToken, accountId, baseUrl }`.
 */
export interface QRLoginHandle {
  matrix: boolean[][];
  toTerminal(opts?: QrTerminalOpts): string;
  toPng(opts?: QrPngOpts): Promise<Buffer>;
  toSvg(opts?: QrSvgOpts): string;
  toDataURL(opts?: QrPngOpts): Promise<string>;
  waitForLogin(opts?: WaitForLoginOpts): Promise<LoginResult>;
}