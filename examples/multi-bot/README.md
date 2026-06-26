# 多 Bot 真机验收

验证 createBotManager 能同时托管多个真实微信号。

先在仓库根目录构建库（example 通过 `link:../..` 引用 dist 产物）：

```bash
# 仓库根目录
pnpm install
pnpm build
```

再安装并运行 example：

```bash
cd examples/multi-bot
pnpm install --ignore-workspace   # 创建 node_modules，@esyion/wechat-channel 被软链到仓库根
pnpm verify
```

按提示用两个不同微信号各扫一次码。绑定后分别给两个号发消息，
终端会回显 `[bot-a] 收到: ...` / `[bot-b] 收到: ...`，每个号收到
`收到，你是 bot-a/bot-b`。

验收点见脚本结尾打印的清单。凭证存于 `./.multibot-state/bots.json`。
