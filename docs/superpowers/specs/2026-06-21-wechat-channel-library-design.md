# wechat-channel 库抽取 — 设计文档

**日期**: 2026-06-21
**状态**: 设计确认,待实施规划
**取代范围**: 现有 `src/` 的整块 CLI bot 实现,被拆为两个 npm 包

---

## 1. 背景与目标

### 1.1 当前实现的偏差

`wechat-agent-channel` 仓库目前是一份 **单进程 CLI bot**:

- `src/index.ts` 启动长轮询 → `bot.ts` 派发 → `claude/agent.ts` 调 Claude → `bot/send.ts` 把回复塞回微信
- Claude Agent SDK 是**硬耦合**的实现细节
- `MEDIA:` 指令、`streaming.ts` 增量推送、`markdown-filter.ts` 都是 Claude 输出端的特化逻辑
- `state/` 下三份 JSON 文件存储 (`sessions.json` / `context-tokens.json` / `sync-buf.json`) 也是为这个 bot 量身定做

**与初衷的偏差**: 一开始想做的是**给其他项目用的开源通道组件**——别人 `npm install` 进来就能把自己的 agent(Claude / GPT / 本地模型 / RAG / 业务系统)接到微信上。

### 1.2 新目标

把现有仓库重构为 npm workspaces 上的两个独立包:

| 包 | 职责 | 依赖 |
|---|---|---|
| **`wechat-channel`** | 微信 ilink 协议通道: 长轮询 + 媒体 I/O + 状态存储 + 事件分发 | 无业务依赖 |
| **`@wechat/channel-claude`** | 把 Claude Agent SDK 接到 `wechat-channel` 的参考适配器 | `wechat-channel` + `@anthropic-ai/claude-agent-sdk` |

**库的核心原则**:

1. `wechat-channel` **不依赖**任何 agent SDK——它是 agent-agnostic 的
2. Claude bot 的所有特化逻辑(`MEDIA:` 指令、`streaming.ts`、`markdown-filter.ts`、`sessions.json`)迁移到 `@wechat/channel-claude`
3. 库对外 API 极简,只有 `createChannel()` + 一个 handler 形态;不暴露底座构造细节
4. 状态存储抽象为接口,内置 JSON 文件实现 + 内存实现(测试用);第三方可注入自定义实现

---

## 2. 高层架构

```
┌──────────────────────────────────────────────────────────────┐
│  wechat-channel (库)                                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ wechat/api.ts        WechatApiClient (11 endpoints)    │  │
│  │ wechat/crypto.ts     AES-128-ECB / MD5                  │  │
│  │ wechat/media.ts      CDN 上传/下载 + 加解密            │  │
│  │ wechat/login.ts      QR 登录状态机                      │  │
│  │ wechat/types.ts      ilink 协议类型                     │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ channel/                                              │  │
│  │   create.ts          createChannel() 入口              │  │
│  │   long-poll.ts       长轮询 + 错误恢复 (errcode=-14 等)│  │
│  │   inbound.ts         解密媒体 → 本地路径               │  │
│  │   outbound.ts        text/media 上传 helper            │  │
│  │   reply.ts           Reply 对象 (handler 用)           │  │
│  │   typing.ts          "对方正在输入" 心跳 (通用)        │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ store/                                                │  │
│  │   types.ts           Store 接口 (sync_buf / context)  │  │
│  │   file.ts            JsonFileStore (默认)             │  │
│  │   memory.ts          MemoryStore (测试用)             │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                          ▲
                          │ handler(msg, reply)
                          │
┌──────────────────────────────────────────────────────────────┐
│  @wechat/channel-claude (适配器)                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ index.ts          createClaudeBot() 工厂               │  │
│  │ agent.ts          runClaudeTurn() — Claude Agent SDK   │  │
│  │ sessions.ts       per-user Claude session_id 存储      │  │
│  │ streaming.ts      Claude 输出 → 微信增量推送           │  │
│  │ markdown-filter.ts 清理 Claude markdown 输出            │  │
│  │ media-directive.ts 解析 MEDIA:/path 指令               │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. 公开 API — `wechat-channel`

### 3.1 主入口

```ts
import { createChannel } from "wechat-channel";

const channel = await createChannel({
  // 必填
  botToken: string,
  accountId: string,

  // 可填,默认官方地址
  baseUrl?: string,        // 默认 https://ilinkai.weixin.qq.com
  cdnBaseUrl?: string,     // 默认 https://novac2c.cdn.weixin.qq.com/c2c
  channelVersion?: string, // 默认读 package.json
  botAgent?: string,      // 默认 wechat-channel/<version>

  // 状态存储 (默认 JSON 文件于 stateDir)
  stateDir?: string,       // 默认 ~/.wechat-channel
  store?: Store,           // 注入自定义 store(优先于 stateDir)

  // 处理器
  onMessage?: (msg: ChannelMsg, reply: Reply) => Promise<void> | void,
  onError?: (err: Error, ctx?: { phase: string }) => void,

  // 长轮询调优
  longPollTimeoutMs?: number, // 默认 35_000
  mediaTmpDir?: string,       // 默认 <stateDir>/media
  blockedUsers?: Set<string>, // 默认空
});

await channel.start();   // notifyStart + 进入长轮询
await channel.stop();    // notifyStop + flush + 退出
```

### 3.2 给 handler 看的 `ChannelMsg`

```ts
export interface ChannelMsg {
  /** 发送方微信用户 ID (ilink_user_id) */
  fromUserId: string;
  /** 本轮 context_token,已存;handler 通常不用,但 raw 调用 api 时需要 */
  contextToken: string;
  /** TEXT 或 VOICE 识别出的文本(空字符串表示仅含媒体) */
  text: string;
  /** 已下载+解密到 mediaTmpDir/<userId>/ 下的文件,handler 直接读路径 */
  media: ReadonlyArray<{ path: string; mime: string }>;
  /** 原始入站 WeixinMessage — 高级用法(解析引用/未覆盖的 item 类型) */
  raw: WeixinMessage;
}
```

### 3.3 给 handler 用的 `Reply`

```ts
export interface Reply {
  /** 发文本(>maxTextChars 自动按换行分块发) */
  text(content: string, opts?: { maxChars?: number }): Promise<void>;
  /** 发文件(图/视/文件三态自动判断) */
  media(filePath: string, caption?: string): Promise<void>;
  /** typing 心跳: typing(true) 启动,typing(false) 取消 */
  typing(on?: boolean): Promise<void>;
}
```

### 3.4 高级逃生口

```ts
channel.api;     // WechatApiClient 实例(原始 HTTP,给 power user)
channel.events;  // EventEmitter — "message" / "error" / "ready" / "stopped"
channel.loginQR();  // 触发扫码登录流程,返回 { qrcodeImg: Buffer, waitForLogin }
```

### 3.5 不在库内

- ❌ Markdown 清洗 — agent 输出端的特化,放 channel-claude
- ❌ 流式分块推送 — 同上,放 channel-claude
- ❌ `MEDIA:` 指令约定 — Claude 风格的"返回文件"协议,放 channel-claude
- ❌ Agent 业务会话(Claude session_id / GPT thread)— 完全应用层

---

## 4. 公开 API — `@wechat/channel-claude`

### 4.1 主入口

```ts
import { createClaudeBot } from "@wechat/channel-claude";

const bot = await createClaudeBot({
  // wechat 通道配置 (透传给 createChannel)
  wechat: {
    botToken: string,
    accountId: string,
    baseUrl?: string,
    cdnBaseUrl?: string,
    stateDir?: string,   // 默认 ~/.wechat-channel-claude
  },

  // claude 配置
  claude: {
    apiKey?: string,        // 优先于 process.env.ANTHROPIC_API_KEY
    baseUrl?: string,       // CLAUDE_BASE_URL,代理 / LiteLLM / vLLM
    authToken?: string,     // CLAUDE_AUTH_TOKEN,覆盖 apiKey
    model: string,          // 默认 claude-sonnet-4-6
    workDir: string,        // 默认 ./workspace
    allowedTools?: string[],// 空数组 = 全部工具
    maxTurns?: number,      // 0 = 不限
  },

  // 行为开关
  streaming?: {
    enabled: boolean,        // 默认 true
    minChars: number,        // 默认 200
    idleMs: number,          // 默认 3000
    maxChars: number,        // 默认 4000
  },
  markdownFilter?: boolean,  // 默认 true
  blockedUsers?: Set<string>,
  onError?: (err: Error, ctx: { phase: string; userId?: string }) => void,
});

await bot.start();
await bot.stop();
```

### 4.2 适配器内部做的事

```ts
// 伪代码(实际写在 packages/wechat-channel-claude/src/index.ts)
const channel = await createChannel({
  botToken: opts.wechat.botToken,
  accountId: opts.wechat.accountId,
  baseUrl: opts.wechat.baseUrl,
  stateDir: opts.wechat.stateDir,
  onError: opts.onError,
});

channel.events.on("message", async (msg) => {
  const reply = new ClaudeReply(channel.api, msg, {
    streaming: opts.streaming,
    markdownFilter: opts.markdownFilter,
  });
  const sessionId = sessions.get(msg.fromUserId);
  const turn = await runClaudeTurn(
    { userId: msg.fromUserId, text: msg.text, media: [...msg.media], sessionId },
    reply.callbacks(),
    { cfg: claudeCfg },
  );
  if (turn.sessionId) await sessions.set(msg.fromUserId, turn.sessionId);
  // MEDIA: 指令 + fallback
  await reply.finalize(turn);
});
```

---

## 5. 状态存储抽象

### 5.1 接口

```ts
export interface Store {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** 一次性把内存里所有 pending 改动落盘;库会在 stop() 时调一次 */
  flush(): Promise<void>;
}
```

### 5.2 键空间

| Key | 内容 | 库/适配器 |
|---|---|---|
| `sync_buf` | getUpdates 长轮询游标 | wechat-channel |
| `ctx:<userId>` | per-user context_token | wechat-channel |
| `claude_session:<userId>` | per-user Claude session_id | channel-claude |

库只读 `sync_buf` + `ctx:*`,不会触碰 Claude 的键。适配器读 `ctx:*`(复用库存的 context_token)并写自己的 `claude_session:*`。

### 5.3 内置实现

- `JsonFileStore` — 全部键塞一个 JSON 文件(默认 `stateDir/store.json`),原子写
- `MemoryStore` — Map 后端,库测试用

---

## 6. 仓库目录结构 (npm workspaces)

```
wechat-agent-channel/                    # 仓库根
├── package.json                         # workspaces: ["packages/*"]
├── tsconfig.base.json                   # 共享 tsconfig
├── README.md                            # 仓库概览,链接到两个子包
├── docs/
│   └── superpowers/specs/...            # 设计文档保留
├── packages/
│   ├── wechat-channel/                  # 通道库
│   │   ├── package.json                 # name: "wechat-channel",无 Claude 依赖
│   │   ├── tsconfig.json
│   │   ├── README.md
│   │   ├── src/
│   │   │   ├── index.ts                 # 导出 createChannel / ChannelMsg / Reply / Store / 错误
│   │   │   ├── wechat/                  # api / crypto / login / media / types
│   │   │   ├── channel/                 # create / long-poll / inbound / outbound / reply / typing
│   │   │   ├── store/                   # types / file / memory
│   │   │   └── errors.ts                # ChannelError / WechatApiError
│   │   └── test/                        # vitest
│   │       ├── channel.test.ts
│   │       ├── inbound.test.ts
│   │       ├── outbound.test.ts
│   │       └── store.test.ts
│   │
│   └── wechat-channel-claude/           # Claude 适配器
│       ├── package.json                 # name: "@wechat/channel-claude",依赖 wechat-channel + claude-agent-sdk
│       ├── tsconfig.json
│       ├── README.md
│       ├── src/
│       │   ├── index.ts                 # createClaudeBot 工厂
│       │   ├── agent.ts                 # runClaudeTurn (从 src/claude/agent.ts 搬)
│       │   ├── sessions.ts              # Claude session_id 存储
│       │   ├── streaming.ts             # 流式推送 (从 src/bot/streaming.ts 搬)
│       │   ├── markdown-filter.ts       # markdown 清洗 (从 src/bot/markdown-filter.ts 搬)
│       │   └── media-directive.ts       # MEDIA: 解析 (从 src/bot/send.ts 抽出)
│       └── test/
│           ├── agent.test.ts
│           ├── streaming.test.ts
│           └── media-directive.test.ts
│
└── (删除) src/, 根目录 dist/, 根目录 test/, 根 .env.example 残留
```

### 6.1 删除/迁移清单

| 现位置 | 迁至 |
|---|---|
| `src/wechat/*` | `packages/wechat-channel/src/wechat/*` |
| `src/state/store.ts` | `packages/wechat-channel/src/store/file.ts` |
| `src/state/context-tokens.ts` | `packages/wechat-channel/src/store/{types,file}.ts` |
| `src/state/sync-buf.ts` | 同上 |
| `src/state/sessions.ts` | `packages/wechat-channel-claude/src/sessions.ts` |
| `src/bot.ts` 的长轮询循环 | `packages/wechat-channel/src/channel/long-poll.ts` |
| `src/bot.ts` 的 TypingKeepalive | `packages/wechat-channel/src/channel/typing.ts` |
| `src/bot/inbound.ts` | `packages/wechat-channel/src/channel/inbound.ts`(去掉 config 依赖,改用入参) |
| `src/bot/send.ts` 的通用部分(text/media) | `packages/wechat-channel/src/channel/outbound.ts` |
| `src/bot/send.ts` 的 MEDIA: 解析 | `packages/wechat-channel-claude/src/media-directive.ts` |
| `src/bot/streaming.ts` | `packages/wechat-channel-claude/src/streaming.ts` |
| `src/bot/markdown-filter.ts` | `packages/wechat-channel-claude/src/markdown-filter.ts` |
| `src/claude/agent.ts` | `packages/wechat-channel-claude/src/agent.ts` |
| `src/index.ts` | `packages/wechat-channel-claude/src/index.ts`(工厂内部调 createChannel) |
| `src/login.ts` | `packages/wechat-channel/src/wechat/login.ts`(保留)+ `packages/wechat-channel-claude/bin/login.ts`(CLI 包装) |
| `src/config.ts` | 拆为两个包的 options schema,不再有全局 config |
| `src/log.ts` | 各自包自带 logger,接受外部注入 |
| 根 `package.json` | 改成 workspaces 配置 |
| 根 `tsconfig.json` | 拆为 `tsconfig.base.json` + 各包 `tsconfig.json` |
| 根 `README.md` | 重写为概览 + 两个子包链接 |
| 根 `test/` | 拆到两个包的 `test/` |

---

## 7. 错误处理

### 7.1 库抛出三类错误

```ts
export class ChannelError extends Error {
  constructor(public code: "AUTH_REQUIRED" | "INVALID_TOKEN" | "ABORTED", msg: string);
}
export class WechatApiError extends Error {
  constructor(public ret?: number, public errcode?: number, public errmsg?: string);
}
export class MediaError extends Error {
  constructor(public phase: "download" | "decrypt" | "upload" | "encrypt", public cause: unknown);
}
```

### 7.2 长轮询错误恢复

- `errcode = -14` → 暂停 1 小时(写 warn 日志,handler 不感知)
- 连续 3 次网络/超时错误 → backoff 30s
- `abortSignal` 触发 → 优雅退出

---

## 8. 测试策略

### 8.1 库 (`wechat-channel`)

- **单元测试**:Store(file/memory)、crypto、markdown 过滤(不在库内,跳过)
- **集成测试**:用 `MemoryStore` + mock `WechatApiClient`(MSW 或手写 stub)模拟:
  - 长轮询 + 多消息
  - 媒体下载/上传往返
  - errcode=-14 暂停
  - SIGINT 优雅退出
- **契约测试**:mock `fetch` 后,断言发出的 ilink 请求体符合 `weixin-channel-api.md`

### 8.2 适配器 (`@wechat/channel-claude`)

- **单元测试**:`runClaudeTurn`、`streaming.ts`、`markdown-filter.ts`、`media-directive.ts`
- **集成测试**:mock Claude Agent SDK 输出 → 验证 reply 序列

### 8.3 文档测试

- README 里的 `createChannel` / `createClaudeBot` 代码片段必须可粘贴运行(用 vitest `test.each` 验证至少 default export 存在)

---

## 9. 配置传递与默认值

| 配置 | 默认值 | 来源 |
|---|---|---|
| `botToken` | 无,必填 | 入参 |
| `accountId` | 无,必填 | 入参 |
| `baseUrl` | `https://ilinkai.weixin.qq.com` | 入参 → env(`WECHAT_BASE_URL`)→ 默认 |
| `cdnBaseUrl` | `https://novac2c.cdn.weixin.qq.com/c2c` | 同上 |
| `stateDir` | `~/.wechat-channel` | 入参 → env(`WECHAT_CHANNEL_STATE_DIR`)→ 默认 |
| `mediaTmpDir` | `<stateDir>/media` | 派生 |
| `longPollTimeoutMs` | `35_000` | 入参 → env → 默认 |
| `claude.model` | `claude-sonnet-4-6` | 入参 → env(`CLAUDE_MODEL`)→ 默认 |
| `claude.workDir` | `./workspace` | 入参 → env(`CLAUDE_WORK_DIR`)→ 默认 |

每个包自带 `loadEnvOverrides(prefix)` helper,从 `process.env` 读默认值,允许用户不传参直接 `createChannel({ botToken, accountId })`。

---

## 10. 兼容性 / 迁移路径

### 10.1 不保留旧 CLI 入口

- 根 `npm start` 删除。改用 `npx @wechat/channel-claude`(或装到全局)
- 老的 `.env` 变量(`WECHAT_BOT_TOKEN` / `ANTHROPIC_API_KEY` 等)继续支持,行为不变

### 10.2 现有 `bot_token` / 凭证文件复用

- `~/.wechat-agent-channel/credentials.json` 不再被读;改为 `~/.wechat-channel/credentials.json`
- 提供一次性迁移命令(放在 channel 包):`wechat-channel migrate-credentials <oldPath>` 把老凭证复制到新位置
- `sync-buf.json` 同理迁移

### 10.3 协议文档保留

- `weixin-channel-api.md` 仍在仓库根,作为协议参考(库测试以它为准)

---

## 11. 开放问题

1. **`channel.events` 是必须的吗?** 函数式 API 极简,但多 handler / 异步订阅会受限。倾向**保留** events 作为逃生口,但不写进 README 头部。
2. **是否提供 CJS 入口?** 当前仓库纯 ESM,Node 22+。倾向**只 ESM**,简化打包。
3. **`@wechat/channel-claude` 用 scoped 名 vs unscoped?** scoped (`@wechat/channel-claude`) 更专业,但用户得配 npm scope。倾向**scoped**,后续如果出 `@wechat/channel-openai` 等对称。
4. **`channel.loginQR()` 的形态?** 倾向返回 `{ qrcodeImg: Buffer, waitForLogin(): Promise<{ botToken, accountId, baseUrl }> }`,让用户自己决定渲染方式(终端 / web / mobile)。
5. **是否暴露 `bot_type` 配置?** 当前 `bot_type=3` 写死。倾向**暴露**,不复杂。

这些问题在实施规划阶段再次确认;不影响本设计主干。

---

## 12. 验收标准

库实现完成的判定:

- [ ] `packages/wechat-channel` `npm pack` 出一个不依赖 `@anthropic-ai/claude-agent-sdk` 的 tarball
- [ ] `packages/wechat-channel-claude` `npm pack` 出一个依赖 `wechat-channel` 和 `@anthropic-ai/claude-agent-sdk` 的 tarball
- [ ] 两个包都能 `npm install` 到一个全新目录并跑通 vitest
- [ ] `wechat-channel` 的 README 用一段 5 行代码展示"接收 + 回复"完整路径
- [ ] `@wechat/channel-claude` 的 README 给出从老 `wechat-agent-channel` bot 迁移的 1:1 配置对照表
- [ ] 现有协议文档 `weixin-channel-api.md` 不动,作为契约测试的 source of truth
- [ ] 老的 `src/` 全部删除,根目录只剩 workspaces 顶层 + `docs/`