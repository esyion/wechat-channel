# @esyion/wechat-channel

[![npm](https://img.shields.io/npm/v/@esyion/wechat-channel)](https://www.npmjs.com/package/@esyion/wechat-channel)
[![license](https://img.shields.io/npm/l/@esyion/wechat-channel)](./LICENSE)
[![node](https://img.shields.io/node/v/@esyion/wechat-channel)](https://nodejs.org)

> 基于 WeChat ilink 协议的 Node.js 库。**一行 `onMessage` 回调 = 接入任意 AI**。

---

## 5 分钟快速集成

### 1. 安装

```bash
npm install @esyion/wechat-channel
```

要求 Node.js ≥ 22。

### 2. 扫码登录拿凭证

```ts
import { createChannel } from "@esyion/wechat-channel";

const ch = await createChannel({ botToken: "placeholder", accountId: "placeholder" });
const qr = await ch.loginQR();

console.log(qr.toTerminal());  // 终端显示二维码
// 或者 Web 场景: <img src={await qr.toDataURL({ size: 400 })} />

const { botToken, accountId } = await qr.waitForLogin();
// ↑ 把这两个值存到 .env 或配置文件里
```

### 3. 开始收发消息

```ts
import { createChannel } from "@esyion/wechat-channel";

const channel = await createChannel({
  botToken: process.env.WECHAT_BOT_TOKEN!,
  accountId: process.env.WECHAT_ACCOUNT_ID!,
  onMessage: async (msg, reply) => {
    // msg.text        — 文本内容
    // msg.fromUserId  — 发送者
    // msg.media       — 已解密的图片/文件/视频

    await reply.text(`你说了: ${msg.text}`);
    await reply.media("/path/to/image.png");
    await reply.typing(true);  // "正在输入…"
  },
});

await channel.start();
```

### 4. 完整示例

[`examples/debug-panel/`](./examples/debug-panel/) 是一个可直接运行的调试面板：

```
Vite + React 前端  ──HTTP/SSE──▶  Express 后端  ──createChannel──▶  WeChat
(登录/消息/回复)                   (状态机/事件广播)                  (ilink 长轮询)
```

```bash
cd examples/debug-panel
pnpm install && pnpm dev:all
# 浏览器打开 http://localhost:5173
```

启动后你就能看到完整的登录→消息→回复流程，**也可以直接把它当作你的 bot 管理面板来用**。

---

## 核心概念

### `createChannel(opts)` → 通道句柄

| 参数 | 默认值 | 说明 |
|---|---|---|
| `botToken` | — | 微信机器人令牌（从 loginQR 获取） |
| `accountId` | — | 微信机器人账号 ID |
| `onMessage` | — | 收到消息的回调 `(msg, reply) => void` |
| `onError` | `console.error` | 错误回调，带 `phase` 区分阶段 |
| `store` | `JsonFileStore` | 会话持久化接口，可换 Redis |
| `baseUrl` | `https://ilinkai.weixin.qq.com` | ilink 网关地址 |
| `cdnBaseUrl` | `https://novac2c.cdn.weixin.qq.com/c2c` | CDN 地址 |
| `stateDir` | `~/.wechat-channel` | 状态文件目录 |
| `longPollTimeoutMs` | `35000` | 长轮询超时 |
| `blockedUsers` | — | 屏蔽的用户 ID 集合 |

### 收到的消息 `msg`

```ts
interface ChannelMsg {
  fromUserId: string;           // 发送者微信 ID
  contextToken: string;         // 会话 token（自动按用户持久化）
  text: string;                 // 文本内容
  media: Array<{                // 已解密到磁盘的媒体文件
    path: string;               //   本地绝对路径
    mime: string;               //   文件类型
  }>;
  raw: WeixinMessage;           // 完整协议结构（高级用法）
}
```

### 回复 `reply`

```ts
await reply.text("你好");                    // 文本（自动处理分块）
await reply.media("/path/photo.png");        // 图片/文件/视频
await reply.media("/path/doc.pdf", "说明");   // 媒体 + 文字说明
await reply.typing(true);                    // 开启"正在输入"心跳
await reply.typing(false);                   // 停止
```

### 登录 `loginQR()`

| 渲染方式 | 适用场景 |
|---|---|
| `qr.toTerminal()` | SSH 终端 / 命令行 |
| `qr.toDataURL()` | Web 页面 `<img src>` |
| `qr.toSvg()` | 内联 SVG |
| `qr.toPng()` | 文件写入 / 推送 |
| `qr.matrix` | 自定义渲染 |

### 错误处理

```ts
const channel = await createChannel({
  onError: (err, ctx) => {
    if (ctx?.phase === "sessionExpired") {
      // 微信 session 过期，长轮询会自动暂停 1 小时
    } else if (ctx?.phase === "decrypt") {
      // 媒体解密失败，单条消息跳过，不影响后续
    }
  },
});
```

错误**不会**中断长轮询循环——下一条消息继续正常处理。

### 优雅退出

```ts
const ac = new AbortController();
process.on("SIGINT", () => ac.abort());

await channel.start({ signal: ac.signal });
// SIGINT → 长轮询中止 → 状态落盘 → 通知下线 → exit(0)
```

或者手动 `await channel.stop()`。

---

## API 参考

### 公开类型

所有类型随包发布，无需额外安装 `@types/...`：

```ts
import {
  createChannel,
  ChannelMsg, Reply,
  QRLoginHandle, LoginResult,
  Store, JsonFileStore, MemoryStore,
  ChannelError, WechatApiError, MediaError,
} from "@esyion/wechat-channel";
```

### 双格式入口

```ts
// ESM
import { createChannel } from "@esyion/wechat-channel";

// CJS
const { createChannel } = require("@esyion/wechat-channel");
```

---

## 发布历史

| 版本 | 说明 |
|---|---|
| v0.1.0 | 首次发布。扫码登录、长轮询、媒体加解密、输入状态 |

[MIT](./LICENSE)
