#!/usr/bin/env node
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Usage: wechat-channel migrate-credentials <oldStateDir>");
    console.error("Example: wechat-channel migrate-credentials ~/.wechat-agent-channel");
    process.exit(1);
  }

  const oldDir = resolve(args[0]!.replace(/^~/, process.env.HOME ?? "."));
  const newDir = resolve(process.env.WECHAT_CHANNEL_STATE_DIR ?? "~/.wechat-channel".replace(/^~/, process.env.HOME ?? "."));

  const files = ["credentials.json", "sync-buf.json", "context-tokens.json"];
  await mkdir(newDir, { recursive: true });

  for (const f of files) {
    const src = join(oldDir, f);
    const dst = join(newDir, f);
    if (!existsSync(src)) {
      console.log(`skip ${f} (not present in ${oldDir})`);
      continue;
    }
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(src, dst);
    console.log(`migrated ${f}: ${src} → ${dst}`);
  }

  console.log(`done. New state dir: ${newDir}`);
  console.log(`Next: set WECHAT_CHANNEL_STATE_DIR=${newDir} in your .env`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
