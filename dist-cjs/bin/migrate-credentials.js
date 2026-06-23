#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_fs_1 = require("node:fs");
async function main() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error("Usage: wechat-channel migrate-credentials <oldStateDir>");
        console.error("Example: wechat-channel migrate-credentials ~/.wechat-agent-channel");
        process.exit(1);
    }
    const oldDir = (0, node_path_1.resolve)(args[0].replace(/^~/, process.env.HOME ?? "."));
    const newDir = (0, node_path_1.resolve)(process.env.WECHAT_CHANNEL_STATE_DIR ?? "~/.wechat-channel".replace(/^~/, process.env.HOME ?? "."));
    const files = ["credentials.json", "sync-buf.json", "context-tokens.json"];
    await (0, promises_1.mkdir)(newDir, { recursive: true });
    for (const f of files) {
        const src = (0, node_path_1.join)(oldDir, f);
        const dst = (0, node_path_1.join)(newDir, f);
        if (!(0, node_fs_1.existsSync)(src)) {
            console.log(`skip ${f} (not present in ${oldDir})`);
            continue;
        }
        await (0, promises_1.mkdir)((0, node_path_1.dirname)(dst), { recursive: true });
        await (0, promises_1.copyFile)(src, dst);
        console.log(`migrated ${f}: ${src} → ${dst}`);
    }
    console.log(`done. New state dir: ${newDir}`);
    console.log(`Next: set WECHAT_CHANNEL_STATE_DIR=${newDir} in your .env`);
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=migrate-credentials.js.map