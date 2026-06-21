import type { WeixinMessage } from "../wechat/types.js";

export interface MediaRef {
  /** Absolute path to a local file the handler can read. */
  path: string;
  /** MIME type — image/* are vision-eligible, others are file references. */
  mime: string;
}

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

export interface QRLoginHandle {
  matrix: boolean[][];
  toTerminal(opts?: QrTerminalOpts): string;
  toPng(opts?: QrPngOpts): Promise<Buffer>;
  toSvg(opts?: QrSvgOpts): string;
  toDataURL(opts?: QrPngOpts): Promise<string>;
  waitForLogin(opts?: WaitForLoginOpts): Promise<LoginResult>;
}