# Architecture

This document describes how `@wechat/channel` is wired internally. For installation and quick start, see [README.md](./README.md). For API reference, see [API.md](./API.md) (planned). For the design rationale, see [`docs/superpowers/specs/2026-06-21-wechat-channel-library-design.md`](./docs/superpowers/specs/2026-06-21-wechat-channel-library-design.md).

## Why this library exists

`@wechat/channel` is an **agent-agnostic bridge** between the WeChat ilink long-poll protocol and user-defined message handlers. It owns:

- The WeChat protocol layer (long-poll, media I/O, login, crypto)
- Per-message state (context tokens, sync cursor)
- Outbound helpers (text/media/typing)

It explicitly does **not** own any agent logic — Claude / GPT / RAG / business workflows are all out of scope. Consumers wire their own agent via `onMessage(msg, reply)`.

## Layered architecture

```
┌────────────────────────────────────────────────────────────┐
│  PUBLIC API (src/index.ts)                                 │
│  createChannel · ChannelMsg · Reply · QRLoginHandle        │
│  Store · JsonFileStore · MemoryStore                       │
│  ChannelError · WechatApiError · MediaError                │
└────────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ channel/      │  │ channel/      │  │ store/        │
│  create.ts    │  │  reply.ts     │  │  types.ts     │
│  long-poll.ts │  │  inbound.ts   │  │  file.ts      │
│  typing.ts    │  │  outbound.ts  │  │  memory.ts    │
│  login.ts     │  │  types.ts     │  │               │
└───────────────┘  └───────────────┘  └───────────────┘
        │                 │                 │
        └─────────────────┼─────────────────┘
                          ▼
              ┌───────────────────────┐
              │  wechat/ (protocol)   │
              │  api.ts · crypto.ts   │
              │  login.ts · media.ts  │
              │  types.ts             │
              └───────────────────────┘
                          │
                          ▼ HTTPS
                   ilinkai.weixin.qq.com
```

The library has **no dependencies on any agent SDK**. A consumer can pull in `@anthropic-ai/claude-agent-sdk`, `openai`, a local model, or hand-written business logic — none of it touches the library.

## Module map

| File | LOC | Responsibility |
|---|---:|---|
| `src/index.ts` | 10 | Public exports surface |
| `src/config.ts` | 21 | `loadEnvOverrides(prefix)` env-driven defaults |
| `src/errors.ts` | 42 | `ChannelError`, `WechatApiError`, `MediaError` |
| `src/channel/types.ts` | 59 | `ChannelMsg`, `Reply`, `QRLoginHandle`, `LoginResult`, option types |
| `src/channel/create.ts` | 118 | `createChannel()` factory — wires api/store/loop/login |
| `src/channel/long-poll.ts` | 141 | Long-poll loop with errcode=-14 pause, backoff, abort |
| `src/channel/inbound.ts` | 132 | Decrypt inbound media → `ChannelMsg` |
| `src/channel/outbound.ts` | 141 | `sendText` + `sendMedia` + `chunkText` |
| `src/channel/typing.ts` | 64 | `TypingKeepalive` heartbeat |
| `src/channel/reply.ts` | 43 | `createReply()` factory |
| `src/channel/login.ts` | 84 | `createQRLoginHandle()` — terminal/PNG/SVG/data-URL renderers |
| `src/store/types.ts` | 7 | `Store` interface (4 methods) |
| `src/store/file.ts` | 71 | `JsonFileStore` (coalesced atomic writes, ENOENT-tolerant) |
| `src/store/memory.ts` | 21 | `MemoryStore` (Map backend; testing) |
| `src/bin/migrate-credentials.ts` | 40 | CLI for `~/.wechat-agent-channel/` → `~/.wechat-channel/` |
| `src/wechat/api.ts` | 270 | `WechatApiClient` — 11 ilink endpoints |
| `src/wechat/crypto.ts` | 80 | AES-128-ECB + MD5 |
| `src/wechat/login.ts` | 280 | `requestQrCode` + `decodeQrMatrix` + `pollQrLogin` + back-compat `runLoginFlow` |
| `src/wechat/media.ts` | 280 | CDN upload/download + encrypt/decrypt |
| `src/wechat/types.ts` | 202 | ilink protocol types |
| **Total** | **2066** | |

## Data flow: a message lifecycle

```
[ WeChat ilink server ]
   │
   │  POST /ilink/bot/getupdates (35s long-poll)
   ▼
WechatApiClient.getUpdates()   ── in src/wechat/api.ts
   │
   │  resp.msgs[]
   ▼
runLongPoll()                   ── in src/channel/long-poll.ts
   │
   │  persist sync_buf to Store
   │  for each msg:
   │    persist ctx:<userId> if present
   │    buildInbound() → ChannelMsg
   │      │
   │      │  downloads encrypted media to mediaTmpDir/<userId>/
   │      │  decrypts (AES-128-ECB)
   │      │  returns local file paths
   │      ▼
   │    createReply(api, userId, ctxToken)
   │      │
   │      ▼
   │    user onMessage(msg, reply)   ── consumer code
   │      │
   │      │  reply.text("hi")        ── chunked sendMessage
   │      │  reply.media("/path")    ── upload + sendMessage
   │      │  reply.typing(true)      ── TypingKeepalive
   │      ▼
   │    handler errors → onError({ phase: "handler" }), continue
   │    inbound errors → onError({ phase: "inbound" }), continue
```

**Key invariants**:

1. `sync_buf` is persisted **after** each successful `getUpdates`. The next poll picks up from there.
2. `ctx:<userId>` is persisted **only when** the inbound message includes a `context_token`. Handlers that need to reply can use the in-memory `ChannelMsg.contextToken`.
3. Inbound media is decrypted to disk **before** the handler runs. The handler never touches encrypted bytes.
4. Handler errors do **not** crash the long-poll loop. They are reported via `onError({ phase: "handler" })` and the next message is processed.
5. Inbound errors (media download/decrypt) do **not** crash the loop. They are reported via `onError({ phase: "inbound" })` and the message is dropped.

## State storage schema

The library uses a single `Store` interface with three reserved key prefixes:

| Key | Set by | Read by | Persistence |
|---|---|---|---|
| `sync_buf` | `runLongPoll` after successful `getUpdates` | `runLongPoll` on next poll | Coalesced via `JsonFileStore.writing` chain |
| `ctx:<userId>` | `runLongPoll` when inbound msg carries `context_token` | `runLongPoll` as fallback when msg doesn't | Same |
| `credentials` | (reserved, not yet written by library) | `loginQR()` consumers | Optional — users may persist their own |

`Store` interface (full):

```ts
interface Store {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  flush(): Promise<void>;
}
```

All values are strings (JSON-serialize your own structures). The library calls `store.flush()` during `channel.stop()` so any pending writes are durable before the process exits.

**Note**: application-specific keys (e.g. `claude_session:<userId>` for a Claude adapter) are not the library's concern. They live in a separate `Store` instance owned by the adapter.

## Error model

Three error classes, all extending native `Error`:

| Class | When | `phase` (if `MediaError`) |
|---|---|---|
| `ChannelError` | Lifecycle errors: missing `botToken`, missing `accountId`, double `start()`, etc. Codes: `"AUTH_REQUIRED"`, `"INVALID_TOKEN"`, `"ABORTED"` | — |
| `WechatApiError` | ilink server returned non-zero `ret`/`errcode`, or HTTP transport failure. `errcode=-14` triggers the 1-hour pause | — |
| `MediaError` | Media download/decrypt/upload/encrypt failure. Always wraps a `cause: unknown` | `"download" \| "decrypt" \| "upload" \| "encrypt"` |

**Long-poll error recovery** (in `src/channel/long-poll.ts`):

| Error type | Action |
|---|---|
| `errcode = -14` (session expired) | Pause 1 hour (`SESSION_PAUSE_MS = 60*60*1000`), `onError({ phase: "sessionExpired" })`, resume after pause |
| 3 consecutive network/timeout errors | Backoff 30s (`BACKOFF_MS`), reset counter on next success |
| < 3 consecutive errors | 2s retry (`RETRY_DELAY_MS`) |
| `abortSignal.aborted` | Break loop, flush store, return |

**Handler errors**: wrapped by `onError({ phase: "handler" })`. The library does NOT retry — the next inbound message is processed normally.

## Key design decisions

1. **No `EventEmitter` for the public API.** `channel.events` was considered but cut. Reasoning: a single `onMessage(msg, reply)` callback is sufficient and more discoverable than subscribe/unsubscribe semantics. Power users who need multiple handlers can register inside their own `onMessage`.

2. **Dual ESM + CJS.** `tsconfig.base.json` produces ESM, `tsconfig.cjs.json` overrides to CommonJS. `package.json#exports` routes both entry points. The `dist-cjs/package.json` contains `{"type": "commonjs", "private": true}` to override the parent's `"type": "module"` for that subtree.

3. **No agent SDK in the library.** `MEDIA:` directives, streaming chunks, markdown cleaning — all Claude-specific patterns belong in the consumer's agent code. The library's `reply` is a dumb pipe (`text`, `media`, `typing`).

4. **Function-level factory, not class-level.** `createChannel()` returns a `ChannelHandle` plain object. Easier to mock, easier to tree-shake, no `this` binding surprises.

5. **TDD throughout.** Every `src/channel/*.ts` and `src/store/*.ts` module has a co-located `test/*.test.ts`. 36/36 tests passing.

6. **The `qr` package (not deprecated `@paulmillr/qr`) decodes QR matrices.** `qrcode` (separate package) renders to PNG/SVG/data-URL. Both are direct dependencies.

## Build & test

```bash
npm install                # restore deps
npm run build              # tsc ESM + tsc CJS → dist/ + dist-cjs/
npm run typecheck          # tsc --noEmit
npm test                   # vitest run (36 tests)
npx vitest run --pool=forks  # alternative worker pool if default OOMs on Node 24

# Smoke test the CLI
npm run build && node dist/bin/migrate-credentials.js   # prints usage + exit 1

# Inspect the publishable tarball
npm pack --dry-run
```

**Known environment issue**: vitest worker teardown can OOM on Node 24 due to a stream listener leak in `tinypool`. Tests themselves pass; the crash happens after the suite completes. Use `--reporter=json` in CI to capture clean results before the teardown crash, or use `--pool=forks` to work around.

## Legacy code

`legacy/` contains the previous CLI bot implementation (Claude Agent SDK adapter + manual `runLoginFlow` + raw long-poll loop). It is **not** part of the published package — `vitest.config.ts` excludes `legacy/**` from tests, `package.json#files` excludes it from npm publish, and `tsconfig.cjs.json` excludes it from build.

If you need to revive the old bot, see [`legacy/README.md`](./legacy/README.md) for instructions.