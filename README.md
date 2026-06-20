# wechat-agent-channel

> Bridge between WeChat (ilink protocol) and **Claude Agent SDK**.
> Spec & protocol reverse-engineered in [`weixin-channel-api.md`](./weixin-channel-api.md).

## 架构

```
微信用户 ──消息──► ilinkai.weixin.qq.com (HTTPS+JSON)
                       │
                       │ getUpdates (35s 长轮询)
                       ▼
              ┌────────────────────┐
              │     bot.ts 主循环   │  ← 本项目
              └─────────┬──────────┘
                        │ (1 条 user msg)
                        ▼
              ┌────────────────────┐
              │  bot/inbound.ts    │  CDN 下载 + AES-128-ECB 解密 → 本地文件
              └─────────┬──────────┘
                        │
                        ▼
              ┌────────────────────┐
              │ claude/agent.ts    │  Claude Agent SDK (per-user session, 流式)
              │   (query + resume) │
              └─────────┬──────────┘
                        │ text + MEDIA: 指令
                        ▼
              ┌────────────────────┐
              │  bot/send.ts       │  MEDIA 上传 + AES 加密 → 引用消息
              └─────────┬──────────┘
                        │
                        ▼
                   微信用户
```

## 功能

- ✅ **扫码登录**(`npm run login`)→ 保存 `bot_token` 到 `~/.wechat-agent-channel/credentials.json`
- ✅ **35 秒长轮询**(`getUpdates`),增量游标 `get_updates_buf` 落盘,重启不丢消息
- ✅ **每用户独立 Claude 会话**(基于 `resume: sessionId`),Claude 记住每个微信用户的对话上下文
- ✅ **完整媒体支持**:
  - 入站图片/文件/语音/视频 → CDN 下载 + AES 解密 → 写入 `tmp/media/<userId>/`,图片走 vision,其他以路径传给 Claude
  - 出站:`MEDIA:/path/to/file` 指令自动识别 → CDN 上传 → 以引用消息发送
- ✅ **流式输入**(`streaming input mode`):支持图片多模态
- ✅ **Markdown 文本清理**(简易,后续可加)
- ✅ **错误处理**:errcode=-14 → 1 小时冷却;3 次连续失败 → backoff 30s
- ✅ **优雅退出**:SIGINT → `notifyStop` + flush state

## 目录结构

```
src/
├── index.ts              # 入口(bot 启动)
├── login.ts              # 扫码登录独立入口
├── config.ts             # 环境变量加载
├── bot.ts                # 主长轮询循环 + 入站处理
├── bot/
│   ├── inbound.ts        # WeChat 消息 → Claude 输入
│   └── send.ts           # Claude 输出 → WeChat 消息
├── claude/
│   └── agent.ts          # Claude Agent SDK 封装
├── wechat/
│   ├── types.ts          # ilink 协议类型
│   ├── crypto.ts         # AES-128-ECB + MD5
│   ├── api.ts            # 11 个 ilink 端点
│   ├── media.ts          # CDN 上传/下载
│   └── login.ts          # QR 登录状态机
└── state/
    ├── store.ts          # 原子 JSON 文件 KV
    ├── context-tokens.ts # per-user context_token
    ├── sync-buf.ts       # 长轮询游标
    └── sessions.ts       # per-user Claude session_id
```

## 快速开始

### 1. 安装

```bash
npm install
cp .env.example .env
```

### 2. 配置 .env

```env
# Anthropic API key (必需)
ANTHROPIC_API_KEY=sk-ant-...

# Claude 模型
CLAUDE_MODEL=claude-sonnet-4-6

# Claude 工作目录(给它 Bash/Read/Write 的范围)
CLAUDE_WORK_DIR=./workspace

# 允许的工具(逗号分隔,留空 = 全部)
# CLAUDE_ALLOWED_TOOLS=Read,Bash,Edit,Write,Glob,Grep

# WeChat 配置
# WECHAT_BOT_TOKEN=
# WECHAT_ACCOUNT_ID=
```

### 2.5 自定义 API / 模型 / 代理

支持**全部**自定义场景,无需改代码:

```bash
# ----- 场景 1: 用 Claude 官方,只是换个模型 -----
CLAUDE_MODEL=claude-opus-4-8

# ----- 场景 2: 走代理 / 中转(国内访问 / LiteLLM / vLLM)-----
CLAUDE_BASE_URL=https://your-proxy.example.com
# 可选:代理颁发自己的 token(覆盖 ANTHROPIC_API_KEY)
CLAUDE_AUTH_TOKEN=sk-proxy-xxxxx
# 模型名可能跟官方不同:
CLAUDE_MODEL=claude-sonnet-proxy-v1

# ----- 场景 3: 指向自建 ilink 网关 -----
WECHAT_BASE_URL=https://your-ilink-gateway.local
WECHAT_CDN_BASE_URL=https://your-cdn.local/c2c

# ----- 场景 4: 同时改 WeChat + Claude + 模型 -----
WECHAT_BASE_URL=https://ilink-staging.internal
CLAUDE_BASE_URL=https://llm-gateway.internal
CLAUDE_MODEL=claude-sonnet-4-6
```

#### 实现细节

| 环境变量 | 作用 | 何时设置 |
|---|---|---|
| `WECHAT_BASE_URL` | ilink 网关地址 | 启动时读入 `WechatApiClient.baseUrl` |
| `WECHAT_CDN_BASE_URL` | CDN 域名 | 启动时读入 `WechatApiClient.cdnBaseUrl` |
| `CLAUDE_MODEL` | Claude 模型名 | 直接传给 SDK `Options.model` |
| `CLAUDE_BASE_URL` / `ANTHROPIC_BASE_URL` | 自定义 Anthropic 兼容端点 | 首次调 Claude 时设置 `process.env.ANTHROPIC_BASE_URL`(CLI 子进程继承) |
| `CLAUDE_AUTH_TOKEN` / `ANTHROPIC_AUTH_TOKEN` | 自定义 token(覆盖 API key) | 首次调 Claude 时设置 `process.env.ANTHROPIC_AUTH_TOKEN` |

> 自定义 WeChat 网关时,`bot_type` 仍写死为 `"3"`(`src/login.ts:67`),如果你的网关支持其他 bot_type,改那里即可。
>
> 走 Anthropic 兼容代理时,代理需要支持 `/v1/messages` 端点和 Anthropic Messages API 的请求/响应格式(LiteLLM、`claude-code-proxy`、vLLM with Anthropic 适配层都行)。

### 3. 扫码登录

```bash
npm run login
```

终端显示二维码 → 用微信扫码 → 在手机上点"确认登录" → 完成。

成功后:

```
[login] ✅ Login successful
        bot_id:     x9f8e7d6c5b4a-im-bot
        user_id:    u12345
        baseUrl:    https://ilinkai.weixin.qq.com
[login] Saved credentials to /Users/you/.wechat-agent-channel/credentials.json
[login] Next steps — add to your .env:
        WECHAT_BOT_TOKEN=AbCdEf...
        WECHAT_ACCOUNT_ID=x9f8e7d6c5b4a-im-bot
```

把这两行复制到 `.env`。

### 4. 启动 bot

```bash
npm start
```

现在给绑定的微信号(扫码的那个微信)发消息,bot 会用 Claude 智能回复。

## 使用示例

### 纯文本对话

```
你: 帮我用 Python 写一个快速排序
Bot: <claude 生成的代码,带流式输出>
```

### 发图片

```
你: <发送一张架构图>
Bot: [Claude 通过 Read 工具看图,然后回答]
     这张架构图展示了...
```

### Claude 生成文件并发回

通过 Claude Agent SDK 的工具,它可以在 `CLAUDE_WORK_DIR` 下创建文件,然后告诉用户:

```
你: 帮我分析这段日志,生成一个总结报告
Bot: 我已经创建了报告: /path/to/workspace/report.md
MEDIA:/path/to/workspace/report.md
     [文件已上传到微信并发送]
```

**`MEDIA:` 指令规则**(必须独占一行,见 `src/bot/send.ts:12`):

```
✅ Some text here
   MEDIA:/abs/path/to/file.png

❌ Some text here MEDIA:/abs/path/to/file.png
```

## 状态文件位置

`~/.wechat-agent-channel/`:

| 文件 | 内容 |
|---|---|
| `credentials.json` | `bot_token` + `accountId` + `baseUrl` + `userId`,chmod 600 |
| `sync-buf.json` | `get_updates_buf` 长轮询游标 |
| `context-tokens.json` | 每个用户的 context_token |
| `sessions.json` | 每个用户的 Claude session_id |

## 开发

```bash
# 类型检查(不编译)
npm run typecheck

# 编译
npm run build

# 开发模式(tsx 直接运行)
npm run dev
```

## 协议参考

完整的微信 channel 协议见 [`weixin-channel-api.md`](./weixin-channel-api.md),包含:

- 11 个端点的 curl 示例
- AES-128-ECB 加解密细节
- 端到端时序图
- 错误处理(`errcode=-14` 含义等)
- 完整 bash 示例脚本

## 已知限制

- 仅支持**私聊**,群消息(`group_id` 字段)暂未路由
- `bot_type=3` 写死(`src/login.ts:67`),其他机器人形态需扩展
- SILK 语音转码未实现(收到的语音文件原样保存,不转 WAV)
- 缩略图未启用(`no_need_thumb: true`)
- Markdown 过滤未实现(微信会渲染原始 markdown 符号)

## License

MIT
