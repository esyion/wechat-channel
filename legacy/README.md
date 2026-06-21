# legacy/ — Archived CLI Bot

**This directory is NOT part of the published `@wechat/channel` package. It is not maintained.**

It contains an earlier CLI bot implementation that hard-wired the WeChat channel to Claude Agent SDK. Kept for historical reference only.

To run the old bot:
1. Copy this `legacy/` tree to a separate repo
2. Add a fresh `package.json` with `@anthropic-ai/claude-agent-sdk`, `dotenv`, `pino`, `qrcode-terminal`, and `tsx` as deps
3. Update import paths to point at the current `@wechat/channel` package
4. Run with `tsx legacy/src/index.ts`

Do NOT import from this directory in your `@wechat/channel` code.
