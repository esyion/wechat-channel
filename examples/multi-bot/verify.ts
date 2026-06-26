import { loginQR, createBotManager } from "@esyion/wechat-channel";
import { createInterface } from "node:readline/promises";

const rl = createInterface({ input: process.stdin, output: process.stdout });

const manager = createBotManager({
  stateDir: "./.multibot-state",
  onMessage: async (botId, msg, reply) => {
    console.log(`[${botId}] 收到: ${msg.text}  (来自 ${msg.fromUserId})`);
    await reply.text(`收到，你是 ${botId}`);
  },
  onError: (botId, err, ctx) => {
    console.error(`[${botId}] 错误 (${ctx?.phase}):`, err);
  },
});

async function bind(botId: string): Promise<void> {
  console.log(`\n=== 请用「${botId}」对应的微信扫码 ===`);
  const qr = await loginQR();
  console.log(qr.toTerminal());
  const creds = await qr.waitForLogin();
  await manager.add(botId, creds);
  console.log(`✓ ${botId} 已绑定并启动`);
}

console.log("先恢复已绑定的 bot（如有）...");
await manager.startAll();
console.log("当前在线:", manager.list());

await bind("bot-a");
await rl.question("绑定第二个 bot？回车继续，Ctrl-C 退出 ");
await bind("bot-b");

console.log("\n两个 bot 已在线。分别给两个微信号发消息，观察上面的回显。");
console.log("验收清单:");
console.log("  [ ] 消息没串、botId 对得上");
console.log("  [ ] 两个号能同时收发(bot 间并发)");
console.log("  [ ] ./.multibot-state/bots.json 里存了两份凭证");
console.log("  [ ] Ctrl-C 后重跑本脚本，startAll 能恢复两个 bot");

process.on("SIGINT", async () => {
  console.log("\n停止所有 bot...");
  await manager.stopAll();
  rl.close();
  process.exit(0);
});
