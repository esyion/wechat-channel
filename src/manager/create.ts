import { createChannel } from "../channel/create.js";
import type { ChannelHandle } from "../channel/create.js";
import { JsonBotCredentialStore } from "./registry.js";
import { sanitizeBotId } from "./sanitize.js";
import type {
  BotCredentials, BotInfo, BotManager,
  BotCredentialStore, ChannelFactory, CreateBotManagerOpts,
} from "./types.js";

interface BotEntry {
  handle: ChannelHandle;
  status: "running" | "error";
}

export function createBotManager(opts: CreateBotManagerOpts): BotManager {
  const rootStateDir = opts.stateDir ?? `${process.env.HOME ?? "."}/.wechat-channel`;
  const creds: BotCredentialStore = opts.credentialStore
    ?? new JsonBotCredentialStore(`${rootStateDir}/bots.json`);
  const factory: ChannelFactory = opts._channelFactory ?? createChannel;
  const bots = new Map<string, BotEntry>();

  async function startOne(botId: string, c: BotCredentials): Promise<void> {
    const safe = sanitizeBotId(botId);
    const handle = await factory({
      botToken: c.botToken,
      accountId: c.accountId,
      baseUrl: c.baseUrl,
      stateDir: `${rootStateDir}/bots/${safe}`,
      onMessage: (msg, reply) => opts.onMessage(botId, msg, reply),
      onError: (err, ctx) => opts.onError?.(botId, err, ctx),
    });
    bots.set(botId, { handle, status: "running" });
    // 关键：start() 阻塞长轮询，detached 触发；失败标记 error 并上报。
    void handle.start().catch((err) => {
      const e = bots.get(botId);
      if (e) e.status = "error";
      opts.onError?.(botId, err, { phase: "start" });
    });
  }

  return {
    async add(botId, c) {
      sanitizeBotId(botId);                 // 先校验，非法立刻抛（不存不建）
      const existing = bots.get(botId);
      if (existing) { await existing.handle?.stop(); bots.delete(botId); }
      await creds.save(botId, c);           // 存盘失败则下一行不执行
      await startOne(botId, c);
    },

    async remove(botId, removeOpts) {
      const e = bots.get(botId);
      if (e) { await e.handle?.stop(); bots.delete(botId); }
      if (removeOpts?.purge) await creds.delete(botId);
    },

    list(): BotInfo[] {
      return [...bots.entries()].map(([botId, e]) => ({ botId, status: e.status }));
    },

    get(botId) {
      return bots.get(botId)?.handle;
    },

    async startAll() {
      const all = await creds.list();
      await Promise.allSettled(all.map(async ({ botId, creds: c }) => {
        try {
          await startOne(botId, c);
        } catch (err) {
          bots.set(botId, { handle: undefined as never, status: "error" });
          opts.onError?.(botId, err, { phase: "startAll" });
        }
      }));
    },

    async stopAll() {
      await Promise.allSettled([...bots.values()].map((e) => e.handle?.stop()));
      bots.clear();
    },
  };
}
