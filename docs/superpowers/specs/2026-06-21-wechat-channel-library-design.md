# wechat-channel 库抽取 — 设计文档

**日期**: 2026-06-21
**状态**: 设计确认,待实施规划
**取代范围**: 现有 `src/` 的整块 CLI bot 实现

---

## 1. 背景与目标

### 1.1 当前实现的偏差

`wechat-agent-channel` 仓库目前是一份 **单进程 CLI bot**:

- `src/index.ts` 启动长轮询 → `bot.ts` 派发 → `claude/agent.ts` 调 Claude → `bot/send.ts` 把回复塞回微信
- Claude Agent SDK 是**硬耦合**的实现细节
- `MEDIA:` 指令、`streaming.ts` 增量推送、`markdown-filter.ts` 都是 Claude 输出端的特化逻辑
- `state/` 下三份 JSON 文件存储 (`sessions.json` / `context-tokens.json` / `sync-buf.json`) 也是为这个 bot 量身定做

**与初衷的偏差**: 一开始想做的是**给其他项目用的开源桥接工具**——别人 `npm install` 进来就能把自己的 agent(Claude / GPT / 本地模型 / RAG / 业务系统)接到微信上。Claude 只是其中一种可能的消费者,**不是**库的责任。

### 1.2 新目标

把现有仓库重构成**单一 npm 包** `@wechat/channel`:

| 范围 | 处理 |
|---|---|
| `src/wechat/*`(协议层) | 保留为库核心 |
| `src/state/{store,context-tokens,sync-buf}.ts`(通道状态) | 保留为库核心 |
| `src/state/sessions.ts`(Claude 会话) | **迁出**到 `legacy/` |
| `src/bot.ts`、`src/bot/*`(bot 编排) | **迁出**到 `legacy/` |
| `src/claude/agent.ts`(Claude SDK 调用) | **迁出**到 `legacy/` |
| `src/index.ts`(CLI 入口) | **删除** |
| `src/login.ts`(CLI 登录入口) | **删除**,库内提供 `channel.loginQR()` |
| `src/config.ts`(全局 .env 读取) | 重写为 `loadEnvOverrides()`,不再是模块级单例 |
| 根 `package.json` | 改为 `wechat-channel`,删除 Claude SDK 依赖 |

**库的核心原则**:

1. **`wechat-channel` 不引用任何 agent SDK**——它是 agent-agnostic 的桥
2. **Claude bot 的所有特化逻辑**(`MEDIA:` 指令、`streaming.ts`、`markdown-filter.ts`、`sessions.json`)整体迁出到 `legacy/` 目录,作为存档保留(不维护)
3. **库对外 API 极简**,只有 `createChannel()` + 一个 handler 形态;不暴露底座构造细节
4. **状态存储抽象为接口**,内置 JSON 文件实现 + 内存实现(测试用);第三方可注入自定义实现

---

## 2. 高层架构

```
┌──────────────────────────────────────────────────────────────┐
│  wechat-channel (本仓库, 单一 npm 包)                         │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ wechat/                                                │  │
│  │   api.ts          WechatApiClient (11 endpoints)       │  │
│  │   crypto.ts       AES-128-ECB / MD5                    │  │
│  │   media.ts        CDN 上传/下载 + 加解密                │  │
│  │   login.ts        QR 登录状态机                        │  │
│  │   types.ts        ilink 协议类型                       │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ channel/                                               │  │
│  │   create.ts       createChannel() 入口                 │  │
│  │   long-poll.ts    长轮询 + 错误恢复 (errcode=-14 等)  │  │
│  │   inbound.ts      解密媒体 → 本地路径                  │  │
│  │   outbound.ts     text/media 上传 helper               │  │
│  │   reply.ts        Reply 对象 (handler 用)              │  │
│  │   typing.ts       "对方正在输入" 心跳 (通用)           │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ store/                                                 │  │
│  │   types.ts        Store 接口 (sync_buf / ctx_token)   │  │
│  │   file.ts         JsonFileStore (默认)                │  │
│  │   memory.ts       MemoryStore (测试用)                │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ config.ts        loadEnvOverrides() 默认值解析         │  │
│  │ errors.ts        ChannelError / WechatApiError         │  │
│  │ index.ts         导出 createChannel / 类型 / 错误     │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                          ▲
                          │ import { createChannel } from "wechat-channel"
                          │
              ┌───────────┴───────────┐
              │                       │
              ▼                       ▼
        用户的 Claude bot      用户的 GPT bot
        (在自己的仓库)         (在自己的仓库)
                              ...
```

`legacy/` 目录在仓库根,放之前整套 Claude bot 实现 + 老的 `package.json` + 老的 README,**不维护**,仅作历史参考。

---

## 3. 公开 API

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
  botType?: string,        // 默认 "3";扫码登录时传给 ilink

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
channel.api;       // WechatApiClient 实例(原始 HTTP,给 power user)
channel.loginQR(); // 触发扫码登录,见下方
```

**`channel.loginQR()`** 同时支持终端和 Web 渲染:

```ts
interface QRLoginHandle {
  /** 原始二维矩阵 (rows × cols, true = 深色模块) */
  matrix: boolean[][];
  /** 渲染为终端 ASCII 字符画(无外部依赖) */
  toTerminal(opts?: { margin?: number; invert?: boolean }): string;
  /** 渲染为 PNG buffer(懒加载 `qrcode` 依赖) */
  toPng(opts?: { size?: number; margin?: number }): Promise<Buffer>;
  /** 渲染为 SVG 字符串 */
  toSvg(opts?: { margin?: number }): string;
  /** 渲染为 data URL (base64 PNG,直接在 <img src=...> 用) */
  toDataURL(opts?: { size?: number; margin?: number }): Promise<string>;
  /** 等待扫码确认登录 */
  waitForLogin(opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<{
    botToken: string;
    accountId: string;
    baseUrl: string;
  }>;
}
```

```ts
// 终端用户
const qr = await channel.loginQR();
process.stdout.write(qr.toTerminal());
const { botToken, accountId } = await qr.waitForLogin();

// Web 用户
const qr = await channel.loginQR();
const dataUrl = await qr.toDataURL({ size: 300 });
res.send(`<img src="${dataUrl}" />`);
const result = await qr.waitForLogin({ signal: reqAbortSignal });
```

### 3.5 不在库内(明确划线)

- ❌ **任何 agent SDK 引用**——Claude / GPT / LangChain / 都不属于本库
- ❌ **Markdown 清洗**——agent 输出端的特化,各 agent 自己处理
- ❌ **流式分块推送**——同上,各 agent 自己处理
- ❌ **`MEDIA:` 指令约定**——Claude 风格的"返回文件"协议,各 agent 自己定
- ❌ **Agent 业务会话**(Claude session_id / GPT thread)——完全应用层

---

## 4. 状态存储抽象

### 4.1 接口

```ts
export interface Store {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** 一次性把内存里所有 pending 改动落盘;库会在 stop() 时调一次 */
  flush(): Promise<void>;
}
```

### 4.2 键空间

| Key | 内容 | 所属 |
|---|---|---|
| `sync_buf` | getUpdates 长轮询游标 | 库 |
| `ctx:<userId>` | per-user context_token | 库 |
| `credentials` | bot_token + account_id(可选,扫码登录后写) | 库 |

**库**只读 `sync_buf` + `ctx:*`,不会触碰任何 agent 自己的键。应用/agent 适配器在自己的 Store 实现里管理自己的键(`claude_session:<userId>` 等)。

### 4.3 内置实现

- `JsonFileStore` — 全部键塞一个 JSON 文件(默认 `stateDir/store.json`),原子写
- `MemoryStore` — Map 后端,库测试用

---

## 5. 错误处理

### 5.1 库抛出三类错误

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

### 5.2 长轮询错误恢复

- `errcode = -14` → 暂停 1 小时(写 warn 日志,handler 不感知)
- 连续 3 次网络/超时错误 → backoff 30s
- `abortSignal` 触发 → 优雅退出

---

## 6. 仓库目录结构

```
wechat-agent-channel/                    # 仓库根
├── package.json                         # name: "@wechat/channel",无 Claude 依赖,双入口 ESM+CJS
├── tsconfig.json
├── README.md                            # wechat-channel 库文档
├── docs/
│   └── superpowers/specs/...            # 设计文档
├── src/
│   ├── index.ts                         # 导出 createChannel / ChannelMsg / Reply / Store / 错误
│   ├── wechat/                          # api / crypto / login / media / types
│   ├── channel/                         # create / long-poll / inbound / outbound / reply / typing
│   ├── store/                           # types / file / memory
│   ├── config.ts                        # loadEnvOverrides()
│   └── errors.ts
├── test/
│   ├── channel.test.ts                  # createChannel + 长轮询 + 错误恢复
│   ├── inbound.test.ts                  # 媒体解密
│   ├── outbound.test.ts                 # text/media/typing
│   ├── store.test.ts                    # JsonFileStore + MemoryStore
│   └── wechat-api.test.ts               # ilink 端点契约测试
└── legacy/                              # 老的 Claude bot 实现, 存档, 不维护
    ├── README.md                        # 说明: 这是上个实验, 仅作历史参考
    ├── src/                             # 老的 src/ 整棵(源码, 不带 package.json/node_modules)
    ├── test/                            # 老的 test/ 整棵(源码)
    └── ...
```

### 6.1 迁移清单

| 现位置 | 迁至 |
|---|---|
| `src/wechat/api.ts` | `src/wechat/api.ts`(原地) |
| `src/wechat/crypto.ts` | `src/wechat/crypto.ts`(原地) |
| `src/wechat/types.ts` | `src/wechat/types.ts`(原地) |
| `src/wechat/login.ts` | `src/wechat/login.ts`(原地,内部封装为 `channel.loginQR()`) |
| `src/wechat/media.ts` | `src/wechat/media.ts`(原地) |
| `src/state/store.ts` | `src/store/file.ts`(改名,内部 API 适配新 Store 接口) |
| `src/state/context-tokens.ts` | 折进 `src/store/file.ts`(键 `ctx:<userId>`) |
| `src/state/sync-buf.ts` | 折进 `src/store/file.ts`(键 `sync_buf`) |
| `src/state/sessions.ts` | **`legacy/src/state/sessions.ts`** |
| `src/bot.ts` 的长轮询循环 | `src/channel/long-poll.ts`(去掉 Claude 相关代码) |
| `src/bot.ts` 的 TypingKeepalive | `src/channel/typing.ts` |
| `src/bot/inbound.ts` | `src/channel/inbound.ts`(去掉 config 依赖,改用入参) |
| `src/bot/send.ts` 的通用部分(text/media) | `src/channel/outbound.ts` |
| `src/bot/send.ts` 的 MEDIA: 解析 | **`legacy/src/bot/send.ts`** |
| `src/bot/streaming.ts` | **`legacy/src/bot/streaming.ts`** |
| `src/bot/markdown-filter.ts` | **`legacy/src/bot/markdown-filter.ts`** |
| `src/claude/agent.ts` | **`legacy/src/claude/agent.ts`** |
| `src/bot.ts`(整体) | **`legacy/src/bot.ts`** |
| `src/index.ts`(CLI 入口) | **`legacy/src/index.ts`** + README 说明如何手动跑 |
| `src/login.ts`(CLI 入口) | **`legacy/src/login.ts`** + README 说明 `wechat-channel` 改用 `channel.loginQR()` |
| `src/config.ts`(全局 .env 单例) | `src/config.ts` 改为 `loadEnvOverrides(prefix)`,不再 module-level 单例 |
| `src/log.ts` | 各自包自带 logger,接受外部注入;库默认用 pino |
| `test/bot/inbound.test.ts` | `test/inbound.test.ts`(适配新 API) |
| `test/bot/send.test.ts` | `test/outbound.test.ts`(适配新 API) |
| `test/bot/streaming.test.ts` | **`legacy/test/bot/streaming.test.ts`** |
| `test/bot/markdown-filter.test.ts` | **`legacy/test/bot/markdown-filter.test.ts`** |
| 根 `package.json` | 改为 `@wechat/channel`,删除 `@anthropic-ai/claude-agent-sdk` 依赖;加 `qrcode` 作为 `toPng/toSvg/toDataURL` 的依赖;配置 `exports` 字段支持 ESM + CJS 双入口;`publishConfig.access: "public"`(scoped 默认 private) |
| 根 `tsconfig.json` | 拆为 `tsconfig.base.json`(ESM) + `tsconfig.cjs.json`(覆盖 `module: CommonJS`,输出到 `dist-cjs/`) |
| 根 `README.md` | 重写为 `@wechat/channel` 库 README |

### 6.2 不迁移,直接删除

- `src/bot.ts` 中手写的 markdown 清洗分支
- 老的 `index.ts` 中的 SIGINT 优雅退出逻辑(库内由 `channel.stop()` 处理)
- 老的 `login.ts` 中的终端二维码渲染(库内通过 `QRLoginHandle.toTerminal()` 实现,不依赖外部包)
- `MEDIA:` 指令解析的代码路径(`legacy/` 完整保留,主仓库不引用)

### 6.3 `legacy/` 目录硬性约束

- **`legacy/` 不带 `package.json` 也不带 `node_modules`**——纯源码 + 静态说明
- `legacy/README.md` 第一行写明:**This directory contains an earlier CLI bot implementation. It is not part of the published `@wechat/channel` package and is not maintained. To run the old bot: copy `legacy/src/*.ts` to a separate repo and install its dependencies manually.**
- `legacy/` 下的代码引用一律用相对路径,不动 `src/` 的导出
- 仓库顶层 vitest 不跑 `legacy/test/`
- `package.json#files` 显式 `["dist", "dist-cjs", "README.md"]`,**排除 `legacy/`**,确保 npm publish 不带出去

---

## 7. 测试策略

### 7.1 库 (`@wechat/channel`)

- **单元测试**:Store(file/memory)、crypto、inbound 解密、outbound helper、errors、QRLoginHandle 各渲染形态
- **集成测试**:用 `MemoryStore` + mock `WechatApiClient`(MSW 或手写 stub)模拟:
  - 长轮询 + 多消息
  - 媒体下载/上传往返
  - errcode=-14 暂停
  - SIGINT 优雅退出
- **契约测试**:mock `fetch` 后,断言发出的 ilink 请求体符合 `weixin-channel-api.md`
- **CJS 入口冒烟测试**:`require("@wechat/channel")` 在 Node 22 下能正常导入并调用 `createChannel`(避免 ESM/CJS 互操作回归)
- **`legacy/` 不进测试**——独立 vitest 配置,只手动跑

### 7.2 文档测试

- README 里的 `createChannel` / `channel.loginQR` 代码片段必须可粘贴运行(用 vitest `test.each` 验证至少 default export 存在)

---

## 8. 配置传递与默认值

每个包自带 `loadEnvOverrides(prefix)` helper,从 `process.env` 读默认值,允许用户不传参直接 `createChannel({ botToken, accountId })`。

| 配置 | 默认值 | 来源 |
|---|---|---|
| `botToken` | 无,必填 | 入参 → env(`WECHAT_BOT_TOKEN`)→ 必填报错 |
| `accountId` | 无,必填 | 入参 → env(`WECHAT_ACCOUNT_ID`)→ 必填报错 |
| `baseUrl` | `https://ilinkai.weixin.qq.com` | 入参 → env(`WECHAT_BASE_URL`)→ 默认 |
| `cdnBaseUrl` | `https://novac2c.cdn.weixin.qq.com/c2c` | 入参 → env(`WECHAT_CDN_BASE_URL`)→ 默认 |
| `stateDir` | `~/.wechat-channel` | 入参 → env(`WECHAT_CHANNEL_STATE_DIR`)→ 默认 |
| `mediaTmpDir` | `<stateDir>/media` | 派生 |
| `longPollTimeoutMs` | `35_000` | 入参 → env(`LONG_POLL_TIMEOUT_MS`)→ 默认 |
| `botType` | `"3"` | 入参 → env(`WECHAT_BOT_TYPE`)→ 默认 |

**`ANTHROPIC_API_KEY` / `CLAUDE_*` 等 Claude 相关变量全部不再读取**——库不关心。

---

## 9. 兼容性 / 迁移路径

### 9.1 不保留旧 CLI 入口

- 根 `npm start` 删除
- 老的 `.env` 变量(`WECHAT_BOT_TOKEN` / `WECHAT_ACCOUNT_ID` 等)继续支持,行为不变
- `ANTHROPIC_API_KEY` / `CLAUDE_MODEL` 等 Claude 相关变量**不再读取**,用户使用 Claude bot 时自己管理

### 9.2 凭证迁移

- 老的 `~/.wechat-agent-channel/credentials.json` 不再被读;改为 `~/.wechat-channel/credentials.json`(或写到 Store 的 `credentials` 键)
- 提供一次性迁移命令(放在库内,作为 CLI bin):`wechat-channel migrate-credentials <oldPath>` 把老凭证复制到新位置
- `sync-buf.json` 同理迁移

### 9.3 协议文档保留

- `weixin-channel-api.md` 仍在仓库根,作为协议参考(库测试以它为准)

### 9.4 包名

- 仓库根 `package.json#name` 改为 `"@wechat/channel"`(scoped)
- `publishConfig.access: "public"` 确保 scoped 包公开发布
- `import { createChannel } from "@wechat/channel"` 是用户导入路径
- **npm 发布需 `@wechat` org 归属**——实施规划阶段确认归属;若尚未拥有,先用 unscoped 临时名 `wechat-channel` 占位,待获取 org 后迁移

---

## 10. 已决策的设计点

下面这些在 brainstorming 阶段已拍板,实施时按此执行:

1. **`channel.events` 砍掉**——库只暴露 `createChannel()` + `channel.api` + `channel.loginQR()` + `channel.start/stop()`,不引入 EventEmitter
2. **CJS 入口要做**——发布时同时提供 ESM (`dist/index.mjs`) + CJS (`dist-cjs/index.js`),`package.json#exports` 字段映射双入口
3. **包名用 `@wechat/channel`(scoped)**——`publishConfig.access: "public"`;若 `@wechat` org 暂无归属,先用 unscoped `wechat-channel` 占位
4. **`channel.loginQR()` 返回 `QRLoginHandle`**——同时支持 `.toTerminal()`(ASCII 字符画,无外部依赖)和 `.toPng()` / `.toSvg()` / `.toDataURL()`(依赖 `qrcode` 包)
5. **`legacy/` 不带 `package.json`**——纯源码 + README,用户想跑老 bot 自己拷贝到独立项目

---

## 11. 验收标准

库实现完成的判定:

- [ ] 根 `package.json` `name === "@wechat/channel"`,**不依赖** `@anthropic-ai/claude-agent-sdk`
- [ ] `src/` 只包含 `wechat/` / `channel/` / `store/` + `index.ts` / `config.ts` / `errors.ts`,**无** `claude/` 或 `bot.ts`
- [ ] `npm pack` 出一个干净的 tarball,含 `dist/`(ESM) + `dist-cjs/`(CJS),**不含** `legacy/`
- [ ] `package.json#exports` 同时声明 ESM 和 CJS 入口,CJS 入口冒烟测试通过
- [ ] `legacy/` 完整保存老的 Claude bot **源码**(无 `package.json`),带"ARCHIVED"README 标注
- [ ] 仓库根 `vitest run` 只跑 `test/`,不跑 `legacy/test/`
- [ ] `npm install` 到一个全新目录后 `vitest run` 全绿
- [ ] 仓库 README 用一段 5 行代码展示"接收 + 回复"完整路径(纯 `createChannel`,无 agent 引用)
- [ ] README 给出从老 `wechat-agent-channel` bot 迁移的 1:1 配置对照表(去掉 Claude 相关变量,其余平移)
- [ ] README 给出 `channel.loginQR()` 终端 + Web 两种用法示例
- [ ] 现有协议文档 `weixin-channel-api.md` 不动,作为契约测试的 source of truth
- [ ] 老的 `src/index.ts` / `src/login.ts` 已迁移到 `legacy/`,根目录无 CLI 入口
- [ ] ESM 用户 `import { createChannel } from "@wechat/channel"` 可用,CJS 用户 `const { createChannel } = require("@wechat/channel")` 也可用