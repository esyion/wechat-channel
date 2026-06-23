# @wechat/channel · Debug Panel

Reference example showing a complete end-to-end integration of [`@wechat/channel`](../../):

- QR-code login (with PNG / SVG / terminal-ASCII renderers)
- Channel lifecycle (start / stop / status)
- Real-time inbound messages over **Server-Sent Events**
- Per-message **reply** (text + media) and **typing indicator**
- File / image / video upload via multipart

> The backend is a thin wrapper around `createChannel()` — see
> [`server/channelManager.ts`](./server/channelManager.ts) for the full state
> machine. The React UI subscribes to SSE for live updates; mutations go
> through plain JSON POST endpoints.

---

## Architecture

```
┌────────────────────────┐    /api/* (HTTP + SSE)    ┌──────────────────────────┐
│ Vite + React (5173)    │  ─────────────────────▶  │ Express + tsx (3001)     │
│                        │                           │                          │
│  LoginPanel · QR       │                           │  ChannelManager          │
│  ChannelStatus · pill  │  ◀────── SSE stream ────  │   ├─ login_pending       │
│  MessageList · live    │                           │   ├─ logged_in           │
│  ReplyBox · upload     │                           │   └─ channel_running     │
└────────────────────────┘                           │                          │
                                                     │  @wechat/channel         │
                                                     │   ├─ loginQR             │
                                                     │   ├─ createChannel       │
                                                     │   └─ onMessage → SSE     │
                                                     └──────────────────────────┘
```

| Layer | Path | Purpose |
|---|---|---|
| **Frontend** | `src/App.tsx` + `src/components/*` | React UI, SSE hook, fetch helpers |
| **Shared types** | `src/shared/types.ts` | Wire format between React and Express |
| **Backend** | `server/index.ts` | Express bootstrap + CORS + graceful shutdown |
| | `server/channelManager.ts` | Singleton state machine + reply routing |
| | `server/sse.ts` | In-process SSE broadcaster |
| | `server/routes.ts` | REST endpoints under `/api` |

## Requirements

- Node.js ≥ 22
- pnpm (or npm/yarn — pnpm-lock.yaml is committed for reproducibility)
- A real WeChat account to scan the QR code with

## Setup

This example lives inside the `@wechat/channel` monorepo and resolves the
library via a relative `link:` reference.

```bash
# from the repo root
pnpm install                  # installs library deps + builds dist/
pnpm build                    # makes dist/ and dist-cjs/ available for linking

cd examples/debug-panel
pnpm install                  # creates node_modules; @wechat/channel is symlinked
```

## Run

```bash
# from examples/debug-panel
pnpm dev:all                  # starts Vite (5173) + Express (3001) together
```

Open **<http://localhost:5173>** in your browser. The Vite dev server proxies
`/api/*` to the Express backend on `:3001`.

| URL | What |
|---|---|
| `http://localhost:5173` | Debug panel UI |
| `http://localhost:5173/api/status` | Channel state (JSON) |
| `http://localhost:5173/api/events` | SSE stream of live events |
| `http://localhost:3001/health` | Backend liveness |

## What it shows

1. **Login** — click *Start login*, scan the QR with WeChat. The panel polls
   the ilink API until the scan is confirmed, then transitions to `logged_in`
   and auto-starts the channel.
2. **Long-poll** — incoming messages appear in real time via SSE, with author,
   timestamp, context token (truncated), and decrypted media references.
3. **Reply** — every message has an inline reply box. Type text, click send,
   or click the 📎 paperclip to upload a file / image / video. Uploaded
   files are staged in `server/uploads/` and sent to the channel with
   `reply.media(absolutePath, caption?)`.
4. **Typing** — *Typing…* / *Stop typing* buttons drive `reply.typing()`,
   keeping the WeChat "typing…" indicator alive.

## API surface

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/status` | Current phase + QR (if login_pending) + credentials + message count |
| `GET`  | `/api/messages?limit=N` | Last N buffered inbound messages |
| `GET`  | `/api/events` | SSE stream of `state` / `message` / `log` / `error` events |
| `POST` | `/api/login/start` | Begin QR login; returns `{ dataURL, svg, terminal, matrix }` |
| `POST` | `/api/login/cancel` | Abort pending login |
| `POST` | `/api/channel/start` | Start channel with stored credentials |
| `POST` | `/api/channel/stop` | Stop channel + clear reply handles |
| `POST` | `/api/reply` | `{ messageId, text }` → text reply |
| `POST` | `/api/reply/media` | `{ messageId, mediaPath, caption? }` → media reply |
| `POST` | `/api/typing` | `{ messageId, typing: bool }` → typing indicator |
| `POST` | `/api/upload` | `multipart/form-data` → `{ path, mime, name, size }` |

## Notes

- **Credentials** are kept in memory only. Restart the backend and you'll need
  to scan the QR again. (Persisting to `.env` would be a small extension.)
- **Reply handles** are stored in an in-memory `Map<messageId, Reply>`. They
  expire after 10 minutes to prevent unbounded growth if a user never replies.
- **First-time login** takes ~5-10 seconds: the user scans the QR, confirms in
  WeChat, then the ilink API flips status to `confirmed` and the channel
  auto-starts.
- The QR renders three ways for convenience — PNG (web embed), SVG
  (scalable), and terminal ASCII (for SSH sessions).

## License

MIT (same as the parent project).
