# AI 端代理 Claude Code — 设计文档

**日期**: 2026-06-21
**状态**: 设计确认,待实施规划

---

## 1. 背景与目标

### 1.1 项目初衷

项目的初衷是构建一个 **AI 端的 Claude Code 代理**: 通过微信作为入口,背后代理 `claude` CLI 本身——用户通过微信发起任务,Claude Code 在服务器上运行,用户可以继续/中断/回答 Claude 的中途问题、查看工具调用历史、拿到最终交付物。

### 1.2 当前实现的偏差

当前实现 (`wechat-agent-channel`) 是一个 **微信 ⇄ Claude Agent SDK 对话桥**:

- 消息进入 → Claude Agent SDK → 拿 `finalText` → 回到微信
- Claude 是**对话回复者**,用 Bash/Read/Write 工具回答问题
- 每用户独立 Claude 会话 (基于 `resume: sessionId`)
- 同步模型: 等 Claude 跑完才返回

**这与初衷的偏差**:
- Claude Code 是**执行体**, 不是回复者
- 应该保留 Claude Code CLI 全部能力 (plan mode、permission、interactive prompts)
- 应该**异步**推送结果,而不是同步等回复
- 应该支持**中途交互透传** (plan/permission/ask),让用户对 Claude 有完全控制

### 1.3 新目标

把当前实现重写为一个真正的 **AI 端代理 Claude Code** 平台:

| 维度 | 旧实现 | 新目标 |
|---|---|---|
| Claude 角色 | 对话回复者 | 被代理的执行体 |
| 集成方式 | `@anthropic-ai/claude-agent-sdk` | 直接 spawn `claude` CLI |
| 运行模型 | 同步 (等完返回) | 异步 (后台跑,推送结果) |
| 中途交互 | 无 (Claude 自决) | 全透传到微信 |
| 任务模型 | 单会话连续 | 默认接续,`/new` 可并发多 session |
| 状态存储 | JSON 文件 | SQLite |

---

## 2. 高层架构

```
┌─────────────────────────────────────────────────────────────┐
│  wechat/ (完全保留)                                          │
│  • login / api / crypto / media / types                      │
│  • 长轮询底层 — 不动                                          │
└──────────────────────────┬──────────────────────────────────┘
                           │ raw WeixinMessage
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  bot/ (重写为薄适配层)                                       │
│  • 长轮询主循环 (同当前)                                     │
│  • 消息分类: 指令 vs 普通消息                                │
│  • 把消息路由到 scheduler; 把 outbox 排空推回微信            │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  scheduler/ (新增 — 调度核心)                                │
│  • 内存索引: (userId) → sessions[], tasks[]                  │
│  • 任务生命周期管理 (状态机, 见 §3)                          │
│  • 并发控制: 每用户最多 N 个 running (默认 3)                │
│  • 健康检查: 卡死超时 / 孤儿进程清理                         │
└──────┬───────────────────────────────────┬──────────────────┘
       │ 启动 / 喂消息 / 取消               │ 读 / 写状态
       ▼                                   ▼
┌──────────────────────────┐    ┌──────────────────────────────┐
│  runner/ (新增)          │    │  store/ (新增 — SQLite)       │
│  • spawn `claude` CLI    │    │  • sessions / tasks           │
│  • 解析控制协议          │    │  • messages / pending_q       │
│  • 拦截 plan/permission  │    │  • outbox / events            │
│    请求,转给 scheduler   │    │                              │
└──────────────────────────┘    └──────────────────────────────┘
       │
       │ 事件流
       ▼
┌─────────────────────────────────────────────────────────────┐
│  notify/ (新增 — 推送器)                                    │
│  • runner 事件 → 微信消息格式化                              │
│  • 写入 outbox; bot 主循环下次轮询 flush                    │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 数据流

**入站**: 微信 → `bot/` → 分类 → 指令走命令处理; 消息 → `scheduler.submit(userId, text, media)` → 若有活跃 session 则 `runner.feed(sessionId, text)`; 否则 `runner.start(...)` 新建

**出站**: `runner` 流式产出事件 → `notify` 合并/裁剪后写 `outbox` → `bot` 下次轮询时发送

**中途交互**: `runner` 拦截 `permission_request` / `plan_proposal` → `scheduler.pause(task)` → 写 `pending_questions` → `notify` 推微信; 用户回复 → `bot` 识别为该 task 的回答 → `runner.answer(task, response)` → 进程恢复

### 2.2 边界

- `wechat/` 和 `runner/` 完全不知道对方存在
- `bot/` 不知道 `runner/` 的内部, 只通过 `scheduler` 接口交互
- `scheduler` 是唯一能"看见全图"的组件
- `store/` 提供单一持久化入口 (SQLite)

---

## 3. 任务状态机

```
                    ┌──────────┐
                    │ pending  │ (消息收到,等待调度)
                    └─────┬────┘
                          ▼
                    ┌──────────┐
                    │ starting │ (spawn claude CLI,握手)
                    └─────┬────┘
                          ▼
        ┌──────────►┌──────────┐◄────────┐
        │           │ running  │         │
        │           └────┬─────┘         │
        │                │               │
        │                ▼               │
        │         ┌───────────────┐      │
        │         │ waiting_input │──────┘ (用户回答,resume)
        │         └───────┬───────┘
        │                 │ (超时/取消/异常)
        ▼                 ▼
   ┌────────┐         ┌────────┐
   │  done  │         │failed  │
   └────────┘         └────────┘
        ▲                 ▲
        │                 │
        └────[cancelled]──┘
```

| 状态 | 含义 | 触发转移 |
|---|---|---|
| `pending` | 消息入队, 等待调度 (并发超限或上一任务未结束) | → `starting` (调度器放行) |
| `starting` | `spawn claude` 已发起, 等待首次握手 | → `running` (收到首个事件) / `failed` (spawn 失败) |
| `running` | Claude 正常推理 / 调工具 / 输出 | → `waiting_input` (拦截到 plan/permission) / `done` / `failed` |
| `waiting_input` | Claude 等用户决策 (plan 模式 / permission / ask) | → `running` (用户回答 resume) / `cancelled` |
| `done` | 正常结束 (assistant 消息 final, 无错误) | 终态 |
| `failed` | 异常退出 (进程崩溃 / 协议错 / 超时) | 终态, error 字段记录原因 |
| `cancelled` | 用户主动取消 | 终态 |

---

## 4. 微信命令协议

用户消息以 `/` 开头识别为命令, 否则按默认路由 (发给活跃 session)。

| 命令 | 含义 | 示例 |
|---|---|---|
| `/new <desc>` | 开新 session, 立即跑任务 | `/new 帮我修一下登录的 bug` |
| `/continue <msg>` | 显式续接 (默认行为, 等价裸消息) | `/continue 继续` |
| `/cancel [id]` | 取消指定 task; 不指定 id 取消活跃 task | `/cancel` |
| `/status` | 查看活跃 task + 等待中的问题 | `/status` |
| `/sessions` | 列出该用户的所有 session (活跃 / 历史) | `/sessions` |
| `/switch <sid>` | 切换默认活跃 session | `/switch s-abc123` |
| `/cwd <path>` | 改当前 session 的工作目录 | `/cwd ~/projects/api` |
| `/help` | 命令帮助 | `/help` |

### 4.1 默认路由

- 用户有活跃 `running` task → 视为回答 `waiting_input` (如果有 pending question)
- 否则 → 视为 "continue 上一个 session" (投递新 prompt 给 runner)
- 上一个 session 已 `done` / `failed` 超过 X 小时 → 提示用户开新

### 4.2 并发规则

- 每用户最多 N=3 个 `running` / `starting` task (超过排队)
- 同 session 同时只允许 1 个 task (串行)
- 跨 session 完全并行

### 4.3 任务标识

短 id 格式 `t-<6位>`, 在消息中标注, 用户回信引用即可路由。

---

## 5. SQLite Schema

使用 `better-sqlite3` 同步 API。

```sql
-- 用户会话 (Claude Code 维度)
CREATE TABLE sessions (
  user_id          TEXT NOT NULL,
  session_id       TEXT PRIMARY KEY,        -- Claude session id
  cwd              TEXT NOT NULL,            -- 工作目录
  created_at       INTEGER NOT NULL,
  last_active_at   INTEGER NOT NULL,
  is_default       INTEGER NOT NULL DEFAULT 0,
  label            TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id, last_active_at DESC);

-- 任务 (用户视角的一次请求)
CREATE TABLE tasks (
  id               TEXT PRIMARY KEY,         -- t-xxxxxx
  user_id          TEXT NOT NULL,
  session_id       TEXT NOT NULL REFERENCES sessions(session_id),
  parent_task_id   TEXT REFERENCES tasks(id),
  status           TEXT NOT NULL,            -- pending|starting|running|waiting_input|done|failed|cancelled
  prompt           TEXT NOT NULL,
  error            TEXT,
  pid              INTEGER,                  -- claude CLI 进程 pid (running 时有)
  created_at       INTEGER NOT NULL,
  started_at       INTEGER,
  ended_at         INTEGER
);
CREATE INDEX idx_tasks_user_status ON tasks(user_id, status, created_at DESC);

-- 任务的事件流 (回看 + 重启恢复)
CREATE TABLE messages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id          TEXT NOT NULL REFERENCES tasks(id),
  seq              INTEGER NOT NULL,         -- 顺序号
  role             TEXT NOT NULL,            -- system|assistant|user|tool|control
  payload_json     TEXT NOT NULL,            -- 原始 Claude 流事件
  created_at       INTEGER NOT NULL
);
CREATE INDEX idx_messages_task ON messages(task_id, seq);

-- Claude 在中途等用户回答的问题
CREATE TABLE pending_questions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id          TEXT NOT NULL REFERENCES tasks(id),
  kind             TEXT NOT NULL,            -- permission|plan|ask
  prompt           TEXT NOT NULL,
  options_json     TEXT,                     -- 候选答案 (若有)
  created_at       INTEGER NOT NULL,
  answered_at      INTEGER,
  answer           TEXT
);

-- 待推送给微信的消息队列
CREATE TABLE outbox (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT NOT NULL,
  payload_json     TEXT NOT NULL,            -- sendMessage 完整 msg 对象
  kind             TEXT NOT NULL,            -- text|image|file|video|...
  created_at       INTEGER NOT NULL,
  sent_at          INTEGER,
  attempts         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_outbox_unsent ON outbox(sent_at, id);

-- 可观测性: runner / scheduler / bot 事件
CREATE TABLE events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id          TEXT,
  level            TEXT NOT NULL,            -- debug|info|warn|error
  source           TEXT NOT NULL,            -- runner|scheduler|bot|store
  message          TEXT NOT NULL,
  data_json        TEXT,
  created_at       INTEGER NOT NULL
);
```

---

## 6. Claude CLI 控制协议

通过 `spawn('claude', [...args])` 启子进程, stdin/stdout 走 NDJSON。

### 6.1 启动参数

```bash
claude \
  --output-format stream-json \
  --input-format stream-json \
  --verbose \
  --permission-mode plan \
  --resume <session_id> \
  --cwd <path> \
  --model <model> \
  --append-system-prompt <text>
```

### 6.2 stdin 协议 (每行一个 JSON 对象)

```jsonc
{"type":"user_message","content":"帮我看下这个文件"}
{"type":"permission_response","request_id":"...","behavior":"allow"}
{"type":"plan_response","request_id":"...","approved":true}
```

### 6.3 stdout 协议 (Claude 流事件, JSON Lines)

```jsonc
{"type":"system","subtype":"init","session_id":"...","tools":[...]}
{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{...}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"...","content":"..."}]}}
{"type":"permission_request","request_id":"...","tool":"Bash","input":{...},"description":"..."}
{"type":"plan_mode","request_id":"...","plan":"...","options":[...]}
{"type":"ask","request_id":"...","question":"选择数据库","options":["Postgres","MySQL","SQLite"]}
{"type":"result","subtype":"success","total_cost_usd":0.012,"result":"...","duration_ms":12345}
```

### 6.4 事件识别规则

- 收到 `permission_request` → 转 `waiting_input`, 写 `pending_questions`
- 收到 `plan_mode` → 转 `waiting_input`, 写 `pending_questions`
- 收到 `result` 且 `subtype=success` 且 `is_error=false` → 转 `done`
- 收到 `result` 但 `subtype≠success` 或 `is_error=true` → 转 `failed`
- 任何状态收到 SIGTERM/SIGKILL → 转 `failed`

### 6.5 注意事项

- CLI 协议在 Anthropic 升级时可能变化 → runner 层封装, 变化集中在一个文件
- 新 session id 从 `system` 事件的 `session_id` 字段捕获并写入 store
- `--permission-mode` 可调: `default` / `plan` / `bypassPermissions` / `acceptEdits` 等

---

## 7. 中途交互透传

### 7.1 三类交互

| 类型 | Claude CLI 事件 | 微信消息格式 | 答案识别 |
|---|---|---|---|
| Permission | `permission_request` | `[Y/n] Claude 想执行 <tool>: <预览>` | Y/y/yes/是/好 → allow; n/no/否/不 → deny |
| Plan | `plan_mode` | `📋 方案: <摘要> \n ✅ approve / ✏️ modify / ❌ reject` | approve/ok/通过 → approve; modify + 文本 → reject with feedback; reject → reject |
| Ask | `ask` | `❓ <问题> \n <选项列表>` | 选项号或自由文本 |

### 7.2 默认行为 (Plan 模式)

启动时 `--permission-mode plan` → Claude 先给方案 (plan_mode 事件) → 用户确认后才执行工具调用。这样大多数任务**只有一次中途交互** (approve plan)。

如果用户 reject, Claude 收到 reject feedback 后重新生成 plan, 再次等待。

### 7.3 自由回复

任何非标准答案的长文本 → 默认当作 "reject + 把用户文本作为反馈传给 Claude"。

### 7.4 多问题并发

同一 task 可能同时有多个 permission / plan / ask——每一问在 `pending_questions` 表里**占一行** (按 `task_id` 一对多)。runner 依次回答: 收到用户回复 → 关联到对应 pending_questions 行 (按 created_at 最早未回答) → 写回 stdin → 检查是否还有 pending, 没有就 resume。

---

## 8. 错误处理

| 故障 | 检测 | 处置 |
|---|---|---|
| `spawn claude` 失败 | child_process error 事件 | task → `failed`, error="spawn failed: ...", 推微信 |
| 进程崩溃 | exit code ≠ 0 或 SIGKILL | task → `failed`, error 记录, 推微信 |
| 协议错 (JSON parse fail) | runner 解析异常 | task → `failed`, error="protocol error", **保留 raw bytes** 到 events 表 |
| 卡死超时 | running 状态 > 30min 无事件 | SIGTERM → 10s 宽限 → SIGKILL, task → `failed`, error="timeout" |
| 长轮询断 | getUpdates 连续失败 ≥ 3 | backoff 30s, 指数退避到 5min |
| SQLite 锁竞争 | SQLITE_BUSY | retry 3 次, 间隔 100ms; 失败则 abort 当前操作 |
| Outbox 堆积 | outbox unsent > 100 | 丢弃最旧的纯文本 debug 消息, 保留所有任务结果 |
| 用户中断网络 | task running, 微信长时间无 ack | 不动 runner (继续跑), 只在 outbox 累积 |

**Outbox 持久化**: 微信长轮询可能延迟 35s, 期间 runner 会发多条中间消息——全写 outbox, batch flush。

---

## 9. 测试策略

| 层 | 方法 | 工具 |
|---|---|---|
| 协议解析 | 单元测试: fixture JSON Lines → 解析 → 事件对象 | node:test + tsx |
| 状态机 | 单元测试: 状态转移表 + 非法转移拒绝 | node:test |
| Notify 格式化 | 单元测试: 事件 → 微信消息 → 期望文本对比 | node:test + snapshot |
| Runner ↔ CLI | 集成测试: spawn 一个 mock 脚本 (代替 claude), 发预设事件, 验证 stdin 写入 | node:test + child_process |
| Scheduler 调度 | 集成测试: 多任务并发 / cancel / timeout | node:test |
| End-to-End | 手动 + 录屏: 真实扫码、真实微信对话 (开发期) | 人工 |
| 压力 | 长跑测试: 24h 不间断, 模拟 100 任务, 看内存 / SQLite 大小 | 临时脚本 |

**Mock Claude CLI** (test 目录):
```ts
// test/fixtures/mock-claude.ts
// 按 stdin 给的指令, 输出预设事件流 (可配置延迟、错误注入)
```

---

## 10. 目录结构 (目标)

```
src/
├── index.ts                 # 入口 (启动 bot)
├── login.ts                 # 扫码登录 (保留)
├── config.ts                # 配置 (保留)
├── log.ts                   # 日志 (保留)
├── bot/                     # 重写为薄适配层
│   ├── index.ts             # 长轮询主循环
│   ├── router.ts            # 消息路由 (命令 vs 消息)
│   └── outbound.ts          # outbox flush
├── wechat/                  # 完全保留
│   ├── login.ts
│   ├── api.ts
│   ├── crypto.ts
│   ├── media.ts
│   └── types.ts
├── claude/                  # 重命名为 runner/
│   └── (删除)               # → runner/
├── runner/                  # 新增
│   ├── index.ts             # spawn claude CLI 封装
│   ├── protocol.ts          # NDJSON 解析/构造
│   ├── lifecycle.ts         # 进程状态管理 (spawn/kill/health)
│   └── interaction.ts       # 中途交互拦截与翻译
├── scheduler/               # 新增
│   ├── index.ts             # 调度入口
│   ├── state.ts             # 状态机
│   ├── queue.ts             # 并发控制
│   └── commands.ts          # 命令处理 (/new /cancel 等)
├── notify/                  # 新增
│   ├── formatter.ts         # 事件 → 微信消息
│   └── summary.ts           # 长输出摘要
└── store/                   # 重写
    ├── index.ts             # better-sqlite3 单例
    ├── schema.sql           # 表结构
    ├── migrations.ts        # 迁移 (从 JSON 迁移到 SQLite)
    └── sync-buf.ts          # 微信长轮询游标 (从 state/sync-buf.ts 迁入)
```

---

## 11. 迁移策略

### 11.1 数据迁移

旧实现的状态文件:
- `~/.wechat-agent-channel/credentials.json`
- `~/.wechat-agent-channel/sync-buf.json`
- `~/.wechat-agent-channel/context-tokens.json`
- `~/.wechat-agent-channel/sessions.json` (旧 Claude sessionId 映射)

新实现:
- `credentials.json` 保留 (不敏感)
- 旧 sessions 映射 → 新 `sessions` 表 (session_id 字段保持兼容, 旧 session_id 可直接 resume)
- sync_buf 保留 (微信长轮询游标, 不变)
- context_tokens → 新 `pending_questions` 或 sessions 元数据 (待实施时定)

### 11.2 代码迁移

不是"重构", 是"重写中间层":
- 删除: `src/claude/agent.ts` (SDK 调用)
- 删除: `src/state/sessions.ts`, `src/state/context-tokens.ts`, `src/state/sync-buf.ts` (保留 sync-buf.js 给微信长轮询)
- 删除: `src/bot.ts` (重写为 bot/index.ts)
- 删除: `src/bot/inbound.ts`, `src/bot/send.ts` (重写)
- 新增: runner/, scheduler/, notify/, store/ (SQLite)
- 保留: wechat/ 整个目录, login.ts, config.ts, log.ts

---

## 12. 已知限制与未来扩展

### 12.1 本设计内不做

- 群消息路由 (微信 group_id 处理)
- Web UI (事件流可视化) — 留作 v2
- 多端消息源 (Telegram / Slack) — 留作 v2
- Claude Code 多实例 (负载分摊) — 留作 v2
- SILK 语音转码 (硬转码需求, 留作 v2)

### 12.2 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Claude CLI 协议变化 | runner 失效 | 协议层集中在 `runner/protocol.ts` 一文件, 变更范围可控 |
| 中途交互无法识别 | 任务卡死 | events 表记录所有原始消息, 可手工介入 |
| SQLite 损坏 | 状态丢失 | 定期 VACUUM + 备份到 `~/.wechat-agent-channel/backup/` |
| 微信反作弊 (机器人检测) | 账号被封 | 长轮询频率限制 (已有); 活跃期不模拟人类节奏 |
| 长任务内存泄漏 | bot 进程 OOM | 24h 重启策略 + 内存监控 |

---

## 13. 验收标准

实施完成后, 满足以下场景即可视为完成:

1. ✅ 用户微信扫码登录 → bot 启动 → 收到 `/help` 返回帮助
2. ✅ 用户发 `/new 帮我看下 src/index.ts` → bot 立刻 ack "任务已启动" → Claude Code 在后台跑 → 完成后推微信结果 (含文件内容摘要)
3. ✅ 用户发"接着看下 bot.ts" → 自动续接 session, Claude 上下文连续
4. ✅ 用户发 `/new 修个 bug` → 新开 session 并行跑, 不影响活跃 session
5. ✅ Claude 在中途给出 plan → 微信收到 `📋 方案...` → 用户回复"approve" → Claude 继续执行
6. ✅ Claude 想执行 `rm -rf` → 微信收到 `[Y/n] Claude 想执行 Bash: ...` → 用户回复 "n" → Claude 收到拒绝, 重新规划
7. ✅ 用户发 `/cancel` → 活跃 task 立即终止, 推送 "已取消"
8. ✅ 重启 bot → 之前的 task 状态可查 (从 SQLite 恢复), 进行中的 task 标记为 `failed` 并通知用户
9. ✅ 24h 压测不出现内存泄漏 / SQLite 锁死 / 微信长轮询断