# @esyion/wechat-channel

> Agent-agnostic WeChat ilink channel library — bridges the long-poll protocol to user-defined message handlers.

[![npm](https://img.shields.io/npm/v/@esyion/wechat-channel)](https://www.npmjs.com/package/@esyion/wechat-channel)
[![license](https://img.shields.io/npm/l/@esyion/wechat-channel)](./LICENSE)
[![node](https://img.shields.io/node/v/@esyion/wechat-channel)](https://nodejs.org)
[![types](https://img.shields.io/badge/types-included-blue)](./src)

`@esyion/wechat-channel` owns the WeChat protocol layer (long-poll loop, media I/O, login, crypto, state persistence) and exposes a tiny `onMessage(msg, reply)` hook. You bring your own agent — Claude, GPT, RAG, or hand-written business logic. The library never imports an agent SDK.

For internal design, see [ARCHITECTURE.md](./ARCHITECTURE.md). For the underlying protocol, see [`weixin-channel-api.md`](./weixin-channel-api.md).

## Examples

| Example | What it shows |
|---|---|
| [`examples/debug-panel/`](./examples/debug-panel/) | Full debug UI — Vite + React frontend, Express backend, SSE live updates, QR login, long-poll, text/media reply. **Start here.** |

## Features

- **Long-poll driver** with `errcode=-14` 1-hour pause + backoff on network errors
- **Agent-agnostic**: bring any handler — no SDK coupling
- **Per-user sessions**: `context_token` auto-persisted, ready for any agent's session store
- **Full media support**: download/decrypt inbound images/files/voice/video; upload/send outbound
- **QR login** with **4 renderers**: terminal ASCII, PNG buffer, SVG string, data URL — works for CLI bots, web apps, and embedded use
- **Typing heartbeat** — `reply.typing(true)` keeps the WeChat "typing…" indicator alive
- **Pluggable `Store`** interface — ship with `JsonFileStore` (default) or `MemoryStore` (testing); bring your own Redis/Postgres impl
- **Dual ESM + CJS** with full TypeScript types included

## Requirements

- Node.js **≥ 22**
- TypeScript 5+ if using TypeScript (consumer project)

## Install

```bash
npm install @esyion/wechat-channel
```

## Quick start

```ts
import { createChannel } from "@esyion/wechat-channel";

const channel = await createChannel({
  botToken: process.env.WECHAT_BOT_TOKEN!,
  accountId: process.env.WECHAT_ACCOUNT_ID!,
  onMessage: async (msg, reply) => {
    await reply.text(`echo: ${msg.text}`);
  },
});

await channel.start();
```

That's the entire pipeline. The library handles long-polling, media decryption, message persistence, and graceful shutdown — you focus on the reply.

## Login

First time only — obtain `botToken` and `accountId` via QR scan, then put them in `.env`.

### Terminal

```ts
import { createChannel } from "@esyion/wechat-channel";

const channel = await createChannel({ botToken: "", accountId: "" }); // dummy; not used by login
const qr = await channel.loginQR();

console.log(qr.toTerminal());            // ASCII block chars, ready for stdout
const { botToken, accountId } = await qr.waitForLogin();
console.log(`Set these in your .env:\n  WECHAT_BOT_TOKEN=${botToken}\n  WECHAT_ACCOUNT_ID=${accountId}`);
```

### Web

```ts
const qr = await channel.loginQR();
const dataUrl = await qr.toDataURL({ size: 400 });   // data:image/png;base64,...
res.send(`<img src="${dataUrl}" />`);
const { botToken, accountId } = await qr.waitForLogin({ signal: reqAbortSignal });
```

Other renderers:

```ts
qr.toPng({ size: 400 });                  // Promise<Buffer> — write to file or pipe
qr.toSvg({ margin: 2 });                  // string — embed inline in HTML
qr.matrix;                               // boolean[][] — render however you like
```

## API tour

### `createChannel(opts)` → `Promise<ChannelHandle>`

| Option | Default | Purpose |
|---|---|---|
| `botToken` | (required) | From `loginQR().waitForLogin()` |
| `accountId` | (required) | Same |
| `baseUrl` | `https://ilinkai.weixin.qq.com` | Override for staging / proxy gateway |
| `cdnBaseUrl` | `https://novac2c.cdn.weixin.qq.com/c2c` | Override for self-hosted CDN |
| `stateDir` | `~/.wechat-channel` | Where `JsonFileStore` persists by default |
| `store` | `new JsonFileStore(stateDir + "/store.json")` | Inject a custom `Store` (Redis, etc.) |
| `longPollTimeoutMs` | `35_000` | Server hold time |
| `mediaTmpDir` | `<stateDir>/media` | Where inbound media is decrypted |
| `blockedUsers` | `undefined` | `Set<string>` of user IDs to silently drop |
| `onMessage` | `undefined` | `(msg, reply) => void` — your agent lives here |
| `onError` | `console.error` | `(err, { phase }) => void` — see Error model below |

Returns `{ api, start, stop, loginQR }`. See [ARCHITECTURE.md](./ARCHITECTURE.md#data-flow-a-message-lifecycle) for the runtime model.

### `reply` — outbound helpers

```ts
onMessage: async (msg, reply) => {
  // Plain text (auto-chunks at maxChars; default 4000)
  await reply.text("hello!");

  // File/image/video (MIME auto-detected from extension)
  await reply.media("/abs/path/to/photo.png");
  await reply.media("/abs/path/to/report.pdf", "Here's the report you asked for");

  // Typing indicator — start/stop heartbeat
  await reply.typing(true);
  // ... long-running work ...
  await reply.typing(false);
}
```

### `msg` — inbound message

```ts
interface ChannelMsg {
  fromUserId: string;
  contextToken: string;
  text: string;
  media: ReadonlyArray<{ path: string; mime: string }>;  // already decrypted to disk
  raw: WeixinMessage;                                     // full protocol payload (advanced)
}
```

Inbound media is decrypted **before** your handler runs. `msg.media[i].path` points to a file you can read, pipe, or pass to an agent's tool.

### Graceful shutdown

```ts
const ac = new AbortController();
process.on("SIGINT", () => ac.abort());
process.on("SIGTERM", () => ac.abort());

await channel.start({ signal: ac.signal });
// On SIGINT: long-poll aborts, store flushes, api.notifyStop() fires, then process.exit(0)
```

If you don't pass a signal, call `await channel.stop()` yourself.

## Error model

Errors fall into three classes (full details in [ARCHITECTURE.md](./ARCHITECTURE.md#error-model)):

| Class | Fires when | `phase` (if `MediaError`) |
|---|---|---|
| `ChannelError` | Bad input, double `start()`, etc. — synchronous | — |
| `WechatApiError` | ilink server non-zero `ret`/`errcode`, HTTP failure | — |
| `MediaError` | File download / decrypt / upload / encrypt failure | `download` / `decrypt` / `upload` / `encrypt` |

`onError` receives `{ phase }` so you can route:

```ts
onError: (err, ctx) => {
  if (ctx?.phase === "sessionExpired") {
    log.warn("wechat session expired; channel will resume in 1 hour");
  } else {
    log.error({ err, phase: ctx?.phase }, "channel error");
  }
}
```

Handler errors (`onMessage` throws) and inbound errors (media download fails) are reported but do **not** crash the long-poll loop — the next inbound message is processed normally.

## Environment variables

All optional. `createChannel()` reads these via `loadEnvOverrides("WECHAT_CHANNEL_")` — the prefix is optional.

| Variable | Default | Purpose |
|---|---|---|
| `WECHAT_BOT_TOKEN` | (none) | Required to start |
| `WECHAT_ACCOUNT_ID` | (none) | Required to start |
| `WECHAT_BASE_URL` | `https://ilinkai.weixin.qq.com` | Override ilink gateway |
| `WECHAT_CDN_BASE_URL` | `https://novac2c.cdn.weixin.qq.com/c2c` | Override CDN |
| `WECHAT_CHANNEL_STATE_DIR` | `~/.wechat-channel` | `JsonFileStore` location |
| `LONG_POLL_TIMEOUT_MS` | `35000` | Long-poll hold time |
| `WECHAT_BOT_TYPE` | `3` | ilink `bot_type` for `loginQR()` |

## Migrating from old `wechat-agent-channel` bot

If you previously used the bundled CLI bot that wrapped Claude Agent SDK, here's how the surface changed:

| Old | New |
|---|---|
| `WECHAT_BOT_TOKEN` | `WECHAT_BOT_TOKEN` (unchanged) |
| `WECHAT_ACCOUNT_ID` | `WECHAT_ACCOUNT_ID` (unchanged) |
| `ANTHROPIC_API_KEY` | (drop — your agent manages this) |
| `CLAUDE_MODEL` | (drop) |
| `CLAUDE_WORK_DIR` | (drop) |
| `~/.wechat-agent-channel/credentials.json` | run `npx wechat-channel migrate-credentials ~/.wechat-agent-channel` |
| `npm start` (CLI bot) | run your own `await channel.start()` from Quick start above |
| `npm run login` | call `channel.loginQR()` programmatically (see Login section) |

## ESM + CJS

Both entry points are exported from `package.json#exports`:

```ts
// ESM
import { createChannel } from "@esyion/wechat-channel";

// CJS
const { createChannel } = require("@esyion/wechat-channel");
```

TypeScript types are included — no `@types/...` package needed.

## CLI: `wechat-channel migrate-credentials`

A one-shot helper for users upgrading from `wechat-agent-channel`:

```bash
npx wechat-channel migrate-credentials ~/.wechat-agent-channel
```

Copies `credentials.json`, `sync-buf.json`, `context-tokens.json` from the old state dir to the new one (`~/.wechat/channel` by default; override with `WECHAT_CHANNEL_STATE_DIR`).

## See also

- [ARCHITECTURE.md](./ARCHITECTURE.md) — internal design, data flow, state schema, error model
- [`docs/superpowers/specs/2026-06-21-wechat-channel-library-design.md`](./docs/superpowers/specs/2026-06-21-wechat-channel-library-design.md) — full design spec
- [`weixin-channel-api.md`](./weixin-channel-api.md) — underlying ilink protocol reference
- [`legacy/`](./legacy/) — the previous CLI bot, archived for reference only

## License

MIT