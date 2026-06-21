import { loadEnvOverrides } from "../config.js";
import { ChannelError } from "../errors.js";
import { JsonFileStore } from "../store/file.js";
import { MemoryStore } from "../store/memory.js";
import type { Store } from "../store/types.js";
import { WechatApiClient } from "../wechat/api.js";
import { decodeQrMatrix, pollQrLogin, requestQrCode } from "../wechat/login.js";
import { runLongPoll } from "./long-poll.js";
import { createQRLoginHandle } from "./login.js";
import type { ChannelMsg, QRLoginHandle, Reply } from "./types.js";

export interface CreateChannelOpts {
  botToken: string;
  accountId: string;
  baseUrl?: string;
  cdnBaseUrl?: string;
  channelVersion?: string;
  botAgent?: string;
  botType?: string;
  stateDir?: string;
  store?: Store;
  onMessage?: (msg: ChannelMsg, reply: Reply) => Promise<void> | void;
  onError?: (err: unknown, ctx?: { phase: string }) => void;
  longPollTimeoutMs?: number;
  mediaTmpDir?: string;
  blockedUsers?: ReadonlySet<string>;
}

export interface ChannelHandle {
  api: WechatApiClient;
  start(opts?: { signal?: AbortSignal }): Promise<void>;
  stop(): Promise<void>;
  loginQR(opts?: { botType?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<QRLoginHandle>;
}

export async function createChannel(opts: CreateChannelOpts): Promise<ChannelHandle> {
  if (!opts.botToken) throw new ChannelError("AUTH_REQUIRED", "botToken is required");
  if (!opts.accountId) throw new ChannelError("INVALID_TOKEN", "accountId is required");

  const env = loadEnvOverrides("WECHAT_CHANNEL_");
  const baseUrl = opts.baseUrl ?? env.baseUrl ?? "https://ilinkai.weixin.qq.com";
  const cdnBaseUrl = opts.cdnBaseUrl ?? env.cdnBaseUrl ?? "https://novac2c.cdn.weixin.qq.com/c2c";
  const channelVersion = opts.channelVersion ?? "wechat-channel/0.1.0";
  const botAgent = opts.botAgent ?? channelVersion;
  const longPollTimeoutMs = opts.longPollTimeoutMs ?? env.longPollTimeoutMs ?? 35_000;

  const api = new WechatApiClient({
    baseUrl,
    cdnBaseUrl,
    botToken: opts.botToken,
    channelVersion,
    botAgent,
    longPollTimeoutMs,
  });

  const stateDir = opts.stateDir ?? env.stateDir ?? `${process.env.HOME ?? "."}/.wechat-channel`;
  const store: Store = opts.store ?? new JsonFileStore(`${stateDir}/store.json`);
  const mediaTmpDir = opts.mediaTmpDir ?? `${stateDir}/media`;

  const onError = opts.onError ?? ((err) => console.error("[wechat-channel]", err));

  let abortController: AbortController | null = null;
  let loopPromise: Promise<void> | null = null;

  async function start(startOpts?: { signal?: AbortSignal }): Promise<void> {
    if (loopPromise) throw new ChannelError("ABORTED", "channel already started");
    abortController = new AbortController();
    if (startOpts?.signal) {
      startOpts.signal.addEventListener("abort", () => abortController?.abort(), { once: true });
    }
    if (opts.onMessage) {
      const handler = opts.onMessage;
      loopPromise = runLongPoll({
        api,
        store,
        mediaTmpDir,
        onMessage: (msg, reply) => {
          if (opts.blockedUsers?.has(msg.fromUserId)) return Promise.resolve();
          return handler(msg, reply);
        },
        onError,
        longPollTimeoutMs,
        signal: abortController.signal,
      });
    }
    await loopPromise;
  }

  async function stop(): Promise<void> {
    abortController?.abort();
    try {
      await api.notifyStop();
    } catch (err) {
      onError(err, { phase: "notifyStop" });
    }
    await store.flush();
    loopPromise = null;
  }

  async function loginQR(loginOpts?: { botType?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<QRLoginHandle> {
    const botType = loginOpts?.botType ?? opts.botType ?? "3";
    const { qrcode, qrcodeImgContent } = await requestQrCode(api, { botType });
    const matrix = await decodeQrMatrix(qrcodeImgContent);
    return createQRLoginHandle({
      matrix,
      waitForLogin: async (waitOpts) => {
        const result = await pollQrLogin(api, {
          qrcode,
          timeoutMs: waitOpts?.timeoutMs ?? loginOpts?.timeoutMs ?? 120_000,
          signal: waitOpts?.signal ?? loginOpts?.signal,
        });
        return { botToken: result.botToken!, accountId: result.accountId!, baseUrl: result.baseUrl ?? baseUrl };
      },
    });
  }

  return { api, start, stop, loginQR };
}
