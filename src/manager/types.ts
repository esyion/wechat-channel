import type { ChannelMsg, Reply } from "../channel/types.js";
import type { ChannelHandle, CreateChannelOpts } from "../channel/create.js";

/** 一个 bot 的登录凭证。loginQR() 的 LoginResult 即此形状。 */
export interface BotCredentials {
  botToken: string;
  accountId: string;
  baseUrl?: string;
}

/**
 * 凭证持久化接口。默认实现 JsonBotCredentialStore（明文 bots.json）。
 * 小王可传自定义实现接管（如 Postgres）。
 */
export interface BotCredentialStore {
  save(botId: string, creds: BotCredentials): Promise<void>;
  load(botId: string): Promise<BotCredentials | undefined>;
  list(): Promise<Array<{ botId: string; creds: BotCredentials }>>;
  delete(botId: string): Promise<void>;
}

export interface BotInfo {
  botId: string;
  status: "running" | "stopped" | "error";
}

/** 创建底层 channel 的工厂。默认 createChannel，测试时注入假实现。 */
export type ChannelFactory = (opts: CreateChannelOpts) => Promise<ChannelHandle>;

export interface CreateBotManagerOpts {
  /** 全局消息回调，botId 标识来源 bot。 */
  onMessage: (botId: string, msg: ChannelMsg, reply: Reply) => Promise<void> | void;
  /** 全局错误回调，带 botId。 */
  onError?: (botId: string, err: unknown, ctx?: { phase: string }) => void;
  /** 状态根目录，每个 bot 在其下分到 bots/<botId>/。默认 ~/.wechat-channel。 */
  stateDir?: string;
  /** 凭证持久化。默认 JsonBotCredentialStore(<stateDir>/bots.json)。 */
  credentialStore?: BotCredentialStore;
  /** @internal 测试用 channel 工厂注入。 */
  _channelFactory?: ChannelFactory;
}

export interface BotManager {
  add(botId: string, creds: BotCredentials): Promise<void>;
  remove(botId: string, opts?: { purge?: boolean }): Promise<void>;
  list(): BotInfo[];
  get(botId: string): ChannelHandle | undefined;
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
}
