# @wechat/channel

Agent-agnostic WeChat ilink channel library. Bridges the WeChat long-poll protocol to user-defined message handlers.

## Install

```bash
npm install @wechat/channel
```

## Quick start (5 lines)

```ts
import { createChannel } from "@wechat/channel";

const channel = await createChannel({
  botToken: process.env.WECHAT_BOT_TOKEN!,
  accountId: process.env.WECHAT_ACCOUNT_ID!,
  onMessage: async (msg, reply) => {
    await reply.text(`echo: ${msg.text}`);
  },
});
await channel.start();
```

## Login

```ts
const qr = await channel.loginQR();
console.log(qr.toTerminal());           // terminal users
// or for web:
const dataUrl = await qr.toDataURL({ size: 300 });
const { botToken, accountId } = await qr.waitForLogin();
```

## Migrating from old `wechat-agent-channel` bot

| Old | New |
|---|---|
| `WECHAT_BOT_TOKEN` | `WECHAT_BOT_TOKEN` (unchanged) |
| `WECHAT_ACCOUNT_ID` | `WECHAT_ACCOUNT_ID` (unchanged) |
| `ANTHROPIC_API_KEY` | (drop — your agent manages this) |
| `CLAUDE_MODEL` | (drop) |
| `CLAUDE_WORK_DIR` | (drop) |
| `~/.wechat-agent-channel/credentials.json` | run `npx wechat-channel migrate-credentials ~/.wechat-agent-channel` |

## ESM + CJS

```ts
// ESM
import { createChannel } from "@wechat/channel";

// CJS
const { createChannel } = require("@wechat/channel");
```

## License

MIT