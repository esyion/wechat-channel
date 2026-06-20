# 微信 Channel 协议文档

> 基于 `@tencent-weixin/openclaw-weixin` v2.4.3 反推的微信 Channel 通信协议。
> 全部接口走 **HTTPS + JSON**(CDN 媒体走二进制),无需任何微信私有 SDK。

---

## 一、基础信息

### 1.1 服务地址

| 服务 | URL |
|---|---|
| ilink 网关(登录 + 业务 API) | `https://ilinkai.weixin.qq.com` |
| 微信 CDN(媒体上传/下载) | `https://novac2c.cdn.weixin.qq.com/c2c` |

### 1.2 通用请求头

所有 ilink 接口(无论是否需要鉴权)都会带:

| Header | 取值 | 说明 |
|---|---|---|
| `Content-Type` | `application/json` |  |
| `AuthorizationType` | `ilink_bot_token` | 固定值 |
| `Authorization` | `Bearer <bot_token>` | 仅登录后的接口需要 |
| `X-WECHAT-UIN` | `base64(随机 uint32 字符串)` | 模拟设备指纹,每次请求随机 |
| `iLink-App-Id` | `bot` | 从 `package.json#ilink_appid` 读取 |
| `iLink-App-ClientVersion` | `(major<<16)\|(minor<<8)\|patch` | 例:`2.4.3` → `131587` |
| `SKRouteTag` | (可选) | 灰度路由标签,从 `openclaw.json` 读 |

### 1.3 请求体公共字段

每个 ilink JSON 请求都会带 `base_info`:

```json
{
  "base_info": {
    "channel_version": "2.4.3",
    "bot_agent": "OpenClaw"
  }
}
```

> `bot_agent` 类似 HTTP `User-Agent`,默认 `OpenClaw`,可在 `openclaw.json` 的 `channels.openclaw-weixin.botAgent` 自定义。

---

## 二、接口速查表

| # | 接口 | URL | 方法 | 鉴权 | 触发时机 |
|---|---|---|---|---|---|
| 1 | `get_bot_qrcode` | `/ilink/bot/get_bot_qrcode?bot_type=3` | POST | 无 | 登录,申请二维码 |
| 2 | `get_qrcode_status` | `/ilink/bot/get_qrcode_status?qrcode=&verify_code=` | GET | 无 | 登录,长轮询扫码状态 |
| 3 | `notifystart` | `/ilink/bot/msg/notifystart` | POST | Bearer | gateway 启动 |
| 4 | `notifystop` | `/ilink/bot/msg/notifystop` | POST | Bearer | gateway 关闭 |
| 5 | `getupdates` | `/ilink/bot/getupdates` | POST | Bearer | **长轮询拉消息(主循环)** |
| 6 | `getconfig` | `/ilink/bot/getconfig` | POST | Bearer | 取 `typing_ticket`(24h 缓存) |
| 7 | `sendtyping` | `/ilink/bot/sendtyping` | POST | Bearer | 输入状态指示 |
| 8 | `getuploadurl` | `/ilink/bot/getuploadurl` | POST | Bearer | 出站媒体第 1 步:申请 CDN 凭证 |
| 9 | `sendmessage` | `/ilink/bot/sendmessage` | POST | Bearer | 出站消息(文本/媒体) |
| 10 | `cdn/upload` | `{cdnBase}/upload?encrypted_query_param=&filekey=` 或 `upload_full_url` | POST | 无 | 出站媒体第 2 步:上传密文 |
| 11 | `cdn/download` | `{cdnBase}/download?encrypted_query_param=` 或 `full_url` | GET | 无 | 入站媒体:下载密文 |

> 所有 CDN 接口 `Content-Type: application/octet-stream`,不需要 Authorization。

### 2.1 接口超时配置

📌 **补充(对应源码 `api/api.ts:209-214`)**:

不同接口有不同的客户端超时:

| 接口 | 客户端超时 | 说明 |
|---|---|---|
| `getupdates` | **35 000 ms** | 与服务端 `longpolling_timeout_ms` 一致;**实际**会被 `abortSignal` 提前中断(热重载) |
| `getuploadurl` / `sendmessage` | 15 000 ms | 常规业务 |
| `getconfig` / `sendtyping` / `notifystart` / `notifystop` | 10 000 ms | 轻量操作 |
| `get_qrcode_status` | 35 000 ms | 登录长轮询 |
| CDN 上传 | 无客户端超时 | 走 `UPLOAD_MAX_RETRIES=3` 重试(4xx 立即终止) |

**`getupdates` 行为细节**(对应 `api/api.ts:374-420` `getUpdates`):

- 客户端 35s 触发 `AbortController.abort()` → `fetch` 抛 `AbortError`。
- **捕获后不抛**,而是返回 `{ ret: 0, msgs: [], get_updates_buf: <原 buf> }`(模拟"无新消息")。
- 这样调用方长轮询主循环不用区分"真没消息"和"客户端超时",直接 `continue` 即可。
- **如果 `abortSignal` 已经被外部 abort**(gateway stop),则只记 debug 日志,然后**正常返回空响应**;主循环在每次循环开头检查 `abortSignal?.aborted` 退出。

### 2.2 `combineAbortSignals`:内部 + 外部 abort 合并

📌 **补充(对应源码 `api/api.ts:298-317`)**:

```ts
function combineAbortSignals(internal: AbortController | undefined, external: AbortSignal | undefined) {
  // 任意一个 abort 都会终止 fetch
  // 用于:
  //   - 内部 35s 长轮询 timeout
  //   - 外部 gateway 5s 停机 budget(#141 修复:防止停机超 5s 后被跳过)
}
```

---

---

## 三、登录流程

### 3.1 状态机

`get_qrcode_status` 返回的 `status` 字段值:

| status | 含义 | 客户端动作 |
|---|---|---|
| `wait` | 等用户扫码 | 1s 后重试 |
| `scaned` | 已扫码,等用户确认 | 1s 后重试 |
| `need_verifycode` | 需要输入 6 位配对码 | 读 stdin 拼到 `verify_code=` 参数重试 |
| `expired` | 二维码过期 | refreshQRCode()(最多 3 次) |
| `verify_code_blocked` | 验证码多次错误 | refreshQRCode() |
| `scaned_but_redirect` | 需切换 IDC 节点 | 把 host 切到响应里的 `redirect_host` |
| `binded_redirect` | 本机 token 已绑定 | **视为登录成功**(`alreadyConnected=true`) |
| `confirmed` | 完成 | 提取 `bot_token`、`ilink_bot_id` 保存 |

### 3.2 完整登录 curl 流程

```bash
ILINK_BASE="https://ilinkai.weixin.qq.com"

# === 步骤 1: 申请二维码 ===
QR_RESP=$(curl -s -X POST "$ILINK_BASE/ilink/bot/get_bot_qrcode?bot_type=3" \
  -H "Content-Type: application/json" \
  -H "iLink-App-Id: bot" \
  -H "iLink-App-ClientVersion: 131587" \
  -d '{"local_token_list": []}')

QRCODE=$(echo "$QR_RESP"       | jq -r '.qrcode')
QR_IMG=$(echo "$QR_RESP"       | jq -r '.qrcode_img_content')

echo "请用微信扫描二维码(若终端无法渲染,访问: $QR_IMG)"

# === 步骤 2: 长轮询扫码状态(35s/次,最长 8 分钟) ===
while true; do
  STATUS_RESP=$(curl -s -m 40 "$ILINK_BASE/ilink/bot/get_qrcode_status?qrcode=$QRCODE")
  STATUS=$(echo "$STATUS_RESP" | jq -r '.status')

  case "$STATUS" in
    confirmed)
      BOT_TOKEN=$(echo "$STATUS_RESP" | jq -r '.bot_token')
      BOT_ID=$(echo "$STATUS_RESP"    | jq -r '.ilink_bot_id')
      USER_ID=$(echo "$STATUS_RESP"   | jq -r '.ilink_user_id')
      echo "登录成功!bot_id=$BOT_ID"
      break
      ;;
    binded_redirect)
      echo "已绑定过此 OpenClaw,无需重复连接"
      break
      ;;
    expired|verify_code_blocked)
      echo "二维码过期,重新申请..."
      QR_RESP=$(curl -s -X POST "$ILINK_BASE/ilink/bot/get_bot_qrcode?bot_type=3" \
        -H "Content-Type: application/json" \
        -H "iLink-App-Id: bot" \
        -H "iLink-App-ClientVersion: 131587" \
        -d '{"local_token_list": []}')
      QRCODE=$(echo "$QR_RESP" | jq -r '.qrcode')
      ;;
    wait|scaned)
      sleep 1
      ;;
  esac
done
```

> **保存凭证**:把 `BOT_TOKEN` 写到 `~/.openclaw/openclaw-weixin/accounts/<normalizeAccountId(BOT_ID)>.json`,`chmod 600`。

### 3.3 登录流程的容错与边界(源码实有)

📌 **补充(对应源码 `auth/login-qr.ts:waitForWeixinLogin` + `channel.ts:auth.login`)**:

#### 3.3.1 客户端长轮询超时降级

`pollQRStatus` 在 35s 后收到 `AbortError`:

```ts
} catch (err) {
  if (err instanceof Error && err.name === "AbortError") {
    return { status: "wait" };  // 视为"继续等",不抛
  }
  // 网关超时(如 Cloudflare 524)或其他网络错误,也视为"等"
  return { status: "wait" };
}
```

**所有异常都被吞掉转 `wait`**,保证 8 分钟登录窗口(`loginTimeoutMs = 480_000`)内能持续重试。

#### 3.3.2 登录窗口

```ts
const loginTimeoutMs = 480_000;  // 8 分钟
```

超过 8 分钟 → 删 `activeLogins` 中的 sessionKey,返回 `connected: false, message: "登录超时,请重试。"`。

#### 3.3.3 `binded_redirect` 路径不写账号文件

`channel.ts:376-384` 处理 `waitForWeixinLogin` 返回 `alreadyConnected: true` 时:

```ts
} else if (waitResult.alreadyConnected) {
  // 本地凭证保持不变,什么都不写
  // 这样自动化安装器重连不会因"未新建账号"被当作登录失败
  logger.info(`auth.login: bot already connected to this OpenClaw accountId=${...}`);
}
```

#### 3.3.4 账号文件保存失败的容错

```ts
try {
  saveWeixinAccount(normalizedId, {...});
  registerWeixinAccountId(normalizedId);
  ...
} catch (err) {
  logger.error(`auth.login: failed to save account data err=${...}`);
  log(`⚠️  保存账号数据失败: ${err}`);
  // 注意:不抛错!登录仍视作成功(token 在内存里)
  // 后果:进程退出后 token 会丢失,需要重新登录
}
```

#### 3.3.5 `loginWithQrStart` / `loginWithQrWait` 两段式

对应 `channel.ts:483-536`,用于 **MCP / 远程 / 自动化场景**(不需要 stdin):

```bash
# 1. 启动:拿 sessionKey + qrDataUrl
RESP=$(curl ... rpc loginWithQrStart '{"accountId":"...","force":false}')
QR_DATAURL=$(echo $RESP | jq -r '.qrDataUrl')
SESSION_KEY=$(echo $RESP | jq -r '.sessionKey')
# 在客户端 UI 渲染 qrDataUrl (data:image/...;base64,...)

# 2. 等待:客户端用 sessionKey 续接
RESP=$(curl ... rpc loginWithQrWait '{"accountId":"...","sessionKey":"...","timeoutMs":480000}')
```

- 两段共享**进程内 Map** `activeLogins`(按 `sessionKey` 索引),所以**必须**在同一个 OpenClaw 进程内调用。
- sessionKey 默认就是 `accountId`(如果有),没有则用 `randomUUID()`。

#### 3.3.6 `triggerWeixinChannelReload` 配置热重载

登录成功保存凭证后立即调用 `triggerWeixinChannelReload()`,触发 OpenClaw 重新读取 `channels.openclaw-weixin` 配置 → 启动新账号的 gateway。

---

## 四、收消息(getUpdates 长轮询)

### 4.1 单次请求

```bash
BOT_TOKEN="<登录拿到的 token>"

curl -s -X POST "$ILINK_BASE/ilink/bot/getupdates" \
  -H "Content-Type: application/json" \
  -H "AuthorizationType: ilink_bot_token" \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -H "iLink-App-Id: bot" \
  -H "iLink-App-ClientVersion: 131587" \
  -d '{
    "get_updates_buf": "",          # 首次空,后续用上次响应的 get_updates_buf
    "base_info": {
      "channel_version": "2.4.3",
      "bot_agent": "OpenClaw"
    }
  }'
```

> **超时**:客户端 `timeoutMs=35_000`(35 秒)。服务端持有请求直到有新消息或超时。

### 4.2 响应结构

```json
{
  "ret": 0,
  "errcode": 0,
  "errmsg": "",
  "msgs": [
    {
      "seq": 1001,
      "message_id": 9876543210,
      "from_user_id": "wxid_abc@im.wechat",
      "to_user_id": "bot@im.wechat",
      "create_time_ms": 1718234567890,
      "message_type": 1,                // 1=USER, 2=BOT
      "message_state": 0,               // 0=NEW, 1=GENERATING, 2=FINISH
      "session_id": "s_xxxx",
      "context_token": "ctx_abcdef",    // ← 发消息时必须原样带回
      "item_list": [
        { "type": 1, "text_item": { "text": "你好" } },
        { "type": 2, "image_item": {
            "aeskey": "1a2b3c4d...",    // 16 字节 hex(图片优先用此字段)
            "media": {
              "encrypt_query_param": "eyJx...",
              "aes_key": "AB...",       // base64(文件/语音/视频用此字段)
              "encrypt_type": 0,
              "full_url": ""           // 完整 URL,优先用
            },
            "mid_size": 12345
        }}
      ]
    }
  ],
  "get_updates_buf": "buf_next_xxx",   // ← 下次请求原样带回(增量游标)
  "longpolling_timeout_ms": 35000      // 服务端建议的下次超时
}
```

### 4.3 错误处理

| 场景 | errcode/ret | 处置 |
|---|---|---|
| 正常无消息 | `ret=0, msgs=[]` | 立刻重连 |
| 会话过期 | `errcode=-14` 或 `ret=-14` | 暂停该账号所有请求 1 小时,再重试 |
| 临时网络错误 | HTTP 5xx / 解析失败 | 累计重试,3 次失败后 backoff 30s |

#### 4.3.1 源码中的实际退避策略(对应 `monitor/monitor.ts:14-15, 89-213`)

| 失败计数 | 等待时间 | 触发后行为 |
|---|---|---|
| 第 1 次 | 2 000 ms(`RETRY_DELAY_MS`) | 重置 `consecutiveFailures = 0` |
| 第 2 次 | 2 000 ms | 同上 |
| 第 3 次 | 2 000 ms | 触发后 `consecutiveFailures = 0` |
| 第 4 次起 | **30 000 ms**(`BACKOFF_DELAY_MS`) | 每 3 次触发 backoff |
| `errcode == -14` | **整 1 小时**(`pauseSession`) | `consecutiveFailures` 重置,跳过 backoff |

> **注意**:源码是"3 次连续失败后 backoff 30s 并**重置**计数",不是"线性 3 步 backoff"。

#### 4.3.2 `errcode === ret === 0` 的判定

```ts
const isApiError =
  (resp.ret !== undefined && resp.ret !== 0) ||
  (resp.errcode !== undefined && resp.errcode !== 0);
```

只有当 `ret` 或 `errcode` **显式非 0** 才算 API 错误。如果两个都缺省/为 0,即使 `msgs=[]` 也视为正常。

### 4.4 收消息主循环(bash 版)### 4.4 收消息主循环(bash 版)

```bash
BUF=""
while true; do
  RESP=$(curl -s -m 40 -X POST "$ILINK_BASE/ilink/bot/getupdates" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $BOT_TOKEN" \
    -d "{\"get_updates_buf\":\"$BUF\",\"base_info\":{\"channel_version\":\"2.4.3\",\"bot_agent\":\"OpenClaw\"}}")

  # 错误处理
  ERR=$(echo "$RESP" | jq -r '.errcode // 0')
  if [ "$ERR" = "-14" ]; then
    echo "[$(date)] 会话过期,暂停 1 小时"; sleep 3600; continue
  fi

  # 保存增量游标
  BUF=$(echo "$RESP" | jq -r '.get_updates_buf // ""')

  # 处理每条消息
  echo "$RESP" | jq -c '.msgs[]?' | while read -r msg; do
    FROM=$(echo "$msg" | jq -r '.from_user_id')
    CTX=$(echo "$msg"  | jq -r '.context_token')
    TEXT=$(echo "$msg" | jq -r '.item_list[]? | select(.type==1) | .text_item.text' | head -1)
    echo "[$(date)] 收到 from=$FROM text=$TEXT"

    # TODO: 调 AI / 命令解析 → 生成回复
    REPLY="你说了: $TEXT"

    # 用第四节 sendmessage 回发
    # ...
  done
done
```

---

## 五、发消息(sendMessage)

📌 **重要(本章节是文档与源码差异最大的地方)**:

源码出站路径(`channel.ts:outbound`)有 4 层包装,顺序是:

1. `assertSessionActive(accountId)` — 冻结期拦截。
2. `applyWeixinMessageSendingHook` — **可取消的出站钩子**(改写文本/取消发送)。
3. **MIME 自动路由**(`sendWeixinMediaFile`)— 按文件 MIME 决定走 image/video/file。
4. 拆条发送(`sendMediaItems`)— text + image **分两次** sendMessage,而不是同一 item_list。

### 5.0 出站前钩子系统

📌 **补充(对应源码 `/Users/chario/workspace/openclaw-weixin/src/messaging/outbound-hooks.ts`)**:

```ts
// 调用方:channel.ts:sendWeixinOutbound / sendMedia
const sendingResult = await applyWeixinMessageSendingHook({
  to: params.to,
  text: filteredText,
  accountId: account.accountId,
  mediaUrl,  // 仅 sendMedia 时存在
});
if (sendingResult.cancelled) {
  // 钩子返回 cancelled → 直接返回空 messageId,不实际发送
  return { channel: "openclaw-weixin", messageId: "" };
}
filteredText = sendingResult.text;  // 钩子可能改写了文本
```

发送完成后(成功或失败)调 `emitWeixinMessageSent({to, content, success, error?, accountId})`,用于埋点和后续处理。

> 钩子由 OpenClaw 框架注入,本插件不实现具体的钩子逻辑,只做调用约定。

### 5.0.1 出站消息的 `MEDIA:` 指令

📌 **补充(对应源码 `channel.ts:196` 的 `messageToolHints`)**:

Agent 输出文本中可以包含 **`MEDIA:<path>`** 指令,要求发送附件。**严格格式要求**:

- `MEDIA:` 必须独立成行,**不能**和正文同行。
- `path` 必须是**绝对路径**(相对路径如 `./photo.png` **无法解析,文件不会发出**)。
- 协议 plugin 会自动把 MEDIA 行从正文中剥离,作为附件一并发送。

✅ 正确:
```
这是您要的图片:
MEDIA:/tmp/photo.png
```

❌ 错误(同行):
```
这是您要的图片:MEDIA:/tmp/photo.png
```

❌ 错误(相对路径):
```
MEDIA:./photo.png
```

### 5.1 发纯文本

```bash
send_text() {
  local to="$1" text="$2" ctx="$3"
  curl -s -X POST "$ILINK_BASE/ilink/bot/sendmessage" \
    -H "Content-Type: application/json" \
    -H "AuthorizationType: ilink_bot_token" \
    -H "Authorization: Bearer $BOT_TOKEN" \
    -H "iLink-App-Id: bot" \
    -H "iLink-App-ClientVersion: 131587" \
    -d "$(cat <<EOF
{
  "msg": {
    "from_user_id": "",
    "to_user_id": "$to",
    "client_id": "openclaw-weixin:$(date +%s)-$(openssl rand -hex 4)",
    "message_type": 2,                // BOT
    "message_state": 2,               // FINISH
    "item_list": [
      { "type": 1, "text_item": { "text": "$text" } }
    ],
    "context_token": "$ctx"           // 从入站消息拿到的
  },
  "base_info": {
    "channel_version": "2.4.3",
    "bot_agent": "OpenClaw"
  }
}
EOF
)"
}

send_text "wxid_abc@im.wechat" "你好,这是回复" "ctx_abcdef"
```

> **必须带 `context_token`**:它是会话的延续凭证,缺失会被服务端拒绝或视作新会话。

### 5.2 发图片(两步走:CDN 上传 + sendMessage 引用)

```bash
# 第 1 步:计算文件元数据
FILE="/tmp/photo.png"
FILEKEY=$(openssl rand -hex 16)              # 16 字节 hex
AESKEY=$(openssl rand -hex 16)                # 16 字节 hex,AES-128 key
RAWSIZE=$(stat -c%s "$FILE")
RAWMD5=$(md5 -q "$FILE" | tr a-z A-Z)
FILESIZE=$(( (($RAWSIZE + 1) + 15) / 16 * 16 ))   # AES-128-ECB + PKCS7 后的密文大小

# 第 2 步:申请 CDN 上传凭证
UPLOAD_RESP=$(curl -s -X POST "$ILINK_BASE/ilink/bot/getuploadurl" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -H "iLink-App-Id: bot" \
  -H "iLink-App-ClientVersion: 131587" \
  -d "$(cat <<EOF
{
  "filekey": "$FILEKEY",
  "media_type": 2,                  // 1=IMAGE, 2=VIDEO, 3=FILE
  "to_user_id": "$TO",
  "rawsize": $RAWSIZE,
  "rawfilemd5": "$RAWMD5",
  "filesize": $FILESIZE,
  "no_need_thumb": true,
  "aeskey": "$AESKEY",
  "base_info": { "channel_version": "2.4.3", "bot_agent": "OpenClaw" }
}
EOF
)")

UPLOAD_URL=$(echo "$UPLOAD_RESP" | jq -r '.upload_full_url // empty')
if [ -z "$UPLOAD_URL" ]; then
  PARAM=$(echo "$UPLOAD_RESP" | jq -r '.upload_param')
  UPLOAD_URL="$CDN_BASE/upload?encrypted_query_param=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$PARAM'))")&filekey=$FILEKEY"
fi

# 第 3 步:AES-128-ECB 加密 + POST 密文到 CDN
openssl enc -aes-128-ecb -K "$AESKEY" -in "$FILE" -out /tmp/photo.enc -nopad
DOWNLOAD_PARAM=$(curl -s -D - -X POST "$UPLOAD_URL" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@/tmp/photo.enc" \
  | tr -d '\r' | awk -F': ' 'tolower($1)=="x-encrypted-param"{print $2}')

# 第 4 步:sendMessage 引用 CDN 资源
AESKEY_BASE64=$(echo -n "$AESKEY" | xxd -r -p | base64 -w0)

curl -s -X POST "$ILINK_BASE/ilink/bot/sendmessage" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -H "iLink-App-Id: bot" \
  -H "iLink-App-ClientVersion: 131587" \
  -d "$(cat <<EOF
{
  "msg": {
    "from_user_id": "",
    "to_user_id": "$TO",
    "client_id": "openclaw-weixin:$(date +%s)-$(openssl rand -hex 4)",
    "message_type": 2,
    "message_state": 2,
    "item_list": [
      {
        "type": 2,
        "image_item": {
          "media": {
            "encrypt_query_param": "$DOWNLOAD_PARAM",
            "aes_key": "$AESKEY_BASE64",
            "encrypt_type": 1
          },
          "mid_size": $FILESIZE
        }
      }
    ],
    "context_token": "$CTX"
  },
  "base_info": { "channel_version": "2.4.3", "bot_agent": "OpenClaw" }
}
EOF
)"
```

### 5.3 发文件 / 视频

与图片完全一致,只需把:

| 字段 | 图片 | 文件 | 视频 |
|---|---|---|---|
| `getuploadurl.media_type` | `1` | `3` | `2` |
| `sendmessage.item_list[].type` | `2` | `4` | `5` |
| `item_list[].xxx_item` 字段 | `image_item.{media, mid_size}` | `file_item.{media, file_name, len}` | `video_item.{media, video_size, play_length}` |

> **字段类型对应**(`MessageItemType` 枚举):
> - `TEXT=1, IMAGE=2, VOICE=3, FILE=4, VIDEO=5`
>
> **媒体类型**(`UploadMediaType` 枚举,用于 `getuploadurl`):
> - `IMAGE=1, VIDEO=2, FILE=3, VOICE=4`(插件当前未使用 VOICE 出站)

### 5.4 源码实际行为:MIME 自动路由(对应 `/Users/chario/workspace/openclaw-weixin/src/messaging/send-media.ts`)

📌 **补充**:5.2/5.3 是底层 curl 示意。源码上层 `sendWeixinMediaFile` **不会**让调用方手动选 media_type,而是按文件的 MIME 推断:

| 文件 MIME 头 | 路由 | 调用链 |
|---|---|---|
| `video/*` | 视频消息 | `uploadVideoToWeixin` + `sendVideoMessageWeixin` |
| `image/*` | 图片消息 | `uploadFileToWeixin` + `sendImageMessageWeixin` |
| 其他(`.pdf`/`.zip`/`.doc`/...) | 文件附件 | `uploadFileAttachmentToWeixin` + `sendFileMessageWeixin` |

MIME 推断由 `media/mime.ts: getMimeFromFilename()` 基于**扩展名**实现,不是读文件 magic bytes(不解析真实内容)。

### 5.5 远程 URL 出站(对应 `/Users/chario/workspace/openclaw-weixin/src/cdn/upload.ts:30-47` + `/Users/chario/workspace/openclaw-weixin/src/channel.ts:258-261`)

📌 **补充**:agent 给的 `media` 可以是**远程 HTTPS URL**(`http://`/`https://` 开头),不用 agent 先下载:

```ts
// channel.ts:sendMedia 简化
if (isRemoteUrl(mediaUrl)) {
  filePath = await downloadRemoteImageToTemp(mediaUrl, MEDIA_OUTBOUND_TEMP_DIR);
  // 后续上传 CDN + sendMessage 与本地路径完全一致
}
```

- 临时目录:`<state_dir>/weixin/media/outbound-temp/`。
- 文件名:`weixin-remote-<uuid>.<ext>`,扩展名从 `Content-Type` 或 URL 后缀推断。
- **不要** agent 重复下载,会浪费时间和带宽(参见 `channel.ts:193` 的 messageToolHints 第 2 条)。

### 5.6 text + media 拆条发送(对应 `messaging/send.ts:sendMediaItems`)

📌 **补充**:5.2 示例把 text 和 image 放在同一个 `item_list` 是**简化的 curl 演示**。源码 `sendMediaItems` 实际是**分两次独立 sendMessage 请求**:

```ts
// send.ts:94-140 简化
const items: MessageItem[] = [];
if (text) items.push({ type: TEXT, text_item: { text } });
items.push(mediaItem);  // image/video/file item

for (const item of items) {
  await sendMessageApi({ ..., body: { msg: { ..., item_list: [item] } } });
}
```

- 每次 sendMessage 都有自己的 `client_id`。
- **好处**:text 发送失败不会影响 media(反之亦然),**用户至少能收到一条**。
- 副作用:`client_id` 不再是"整条对话"唯一的,而是每条消息独立。

### 5.7 出站消息的 `encrypt_type: 1`

📌 **补充(对应源码 `/Users/chario/workspace/openclaw-weixin/src/messaging/send.ts:171, 202, 233`)**:

所有出站 media 固定写 `encrypt_type: 1`,含义见 §9.3 表格:`打包缩略图/中图等信息`。`encrypt_type: 0`(只加密 fileid)当前未使用。

### 5.8 错误处理:`error-notice.ts` 自动告知用户

📌 **补充(对应源码 `/Users/chario/workspace/openclaw-weixin/src/messaging/error-notice.ts`)**:

出站 sendMessage 抛错时,如果还有 contextToken(说明这是回复某条入站),会**自动**给用户发一条错误提示(类似 "⚠️ 消息发送失败,请稍后再试"),而不是默默吞掉。

---

## 六、输入状态指示(sendTyping)

```bash
# 1. 拿 typing_ticket(每个用户独立,缓存 24 小时)
TYPING_TICKET=$(curl -s -X POST "$ILINK_BASE/ilink/bot/getconfig" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -d "$(cat <<EOF
{
  "ilink_user_id": "$TO",
  "context_token": "$CTX",
  "base_info": { "channel_version": "2.4.3", "bot_agent": "OpenClaw" }
}
EOF
)" | jq -r '.typing_ticket')

# 2. 发"正在输入"
curl -s -X POST "$ILINK_BASE/ilink/bot/sendtyping" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -d "$(cat <<EOF
{
  "ilink_user_id": "$TO",
  "typing_ticket": "$TYPING_TICKET",
  "status": 1,                       // 1=开始, 2=取消
  "base_info": { "channel_version": "2.4.3", "bot_agent": "OpenClaw" }
}
EOF
)"

# ... AI 生成中 ...

# 3. 发完回复后,取消输入状态
curl -s -X POST "$ILINK_BASE/ilink/bot/sendtyping" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -d "{
    \"ilink_user_id\": \"$TO\",
    \"typing_ticket\": \"$TYPING_TICKET\",
    \"status\": 2,
    \"base_info\": { \"channel_version\": \"2.4.3\", \"bot_agent\": \"OpenClaw\" }
  }"
```

### 6.1 源码中的 `typing_ticket` 缓存(对应 `/Users/chario/workspace/openclaw-weixin/src/api/config-cache.ts`)

📌 **补充**:6 节的 curl 流程是底层示意。源码用 `WeixinConfigManager` 包了一层,关键行为:

- **每个用户独立缓存**:`cache: Map<ilinkUserId, ConfigCacheEntry>`。
- **24h 随机刷新**:
  ```ts
  nextFetchAt = now + Math.random() * 24 * 60 * 60 * 1000;
  ```
  每次成功取到后,下次刷新时间是 [now, now+24h] 区间内的**随机点**,避免所有用户在同一时刻触发刷新峰值。
- **失败时指数退避**:
  ```ts
  CONFIG_CACHE_INITIAL_RETRY_MS = 2_000;
  CONFIG_CACHE_MAX_RETRY_MS = 60 * 60 * 1000;  // 1h
  // 失败时:delay *= 2,直到 1h 上限
  ```
- **容错**:`getConfig` 失败时返回空 `typingTicket`,**不抛错**,保证长轮询主循环不被打断。

### 6.2 调用时机

`monitorWeixinProvider` 在**处理每条入站消息之前**调 `configManager.getForUser(fromUserId, contextToken)`,然后在 `processOneMessage` 内使用 `typingTicket` 发"正在输入"。

> 注意:不是每个用户每天拉一次,而是**每个用户的每条消息**都可能触发一次(只要缓存到期)。

---

## 七、网关启停通知

```bash
# 启动:gateway 启动时
curl -s -X POST "$ILINK_BASE/ilink/bot/msg/notifystart" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -d '{"base_info":{"channel_version":"2.4.3","bot_agent":"OpenClaw"}}'

# 关闭:gateway 退出时
curl -s -X POST "$ILINK_BASE/ilink/bot/msg/notifystop" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -d '{"base_info":{"channel_version":"2.4.3","bot_agent":"OpenClaw"}}'
```

### 7.1 源码中的完整生命周期(对应 `/Users/chario/workspace/openclaw-weixin/src/channel.ts:gateway`)

📌 **补充**:

#### 7.1.1 `startAccount`(对应 `/Users/chario/workspace/openclaw-weixin/src/channel.ts:395-463`)

调用顺序:

1. **空 ctx 防御**:`ctx === undefined` → 直接 return(防止 plugin SDK 误调)。
2. `restoreContextTokens(accountId)` — 从磁盘恢复该账号的 context_token 缓存。
3. `ctx.setStatus({ running: true, lastStartAt, lastEventAt })`。
4. `assertSessionActive` — 冻结期账号直接抛错,不进入主循环。
5. `notifyStart` — 调 ilink 网关 notifystart,**失败仅 warn,不中断启动**。
6. `ctx.channelRuntime` 校验 — host 版本太老(< 2026.2.19)直接抛错。
7. `import("./monitor/monitor.js")` 懒加载 — 避免启动时拉起 process-message → command-auth 链。
8. `monitorWeixinProvider({...})` 阻塞到 `abortSignal` 触发。

#### 7.1.2 `stopAccount`(对应 `/Users/chario/workspace/openclaw-weixin/src/channel.ts:464-482`)

```ts
async stopAccount: async (ctx) => {
  if (!account.configured || !account.token?.trim()) return;  // 未配置账号直接跳过
  try {
    const resp = await notifyStop({ baseUrl, token });
    if (resp.ret !== undefined && resp.ret !== 0) {
      aLog.warn(`notifyStop: ret=${resp.ret}`);
    }
  } catch (err) {
    aLog.warn(`notifyStop failed during shutdown (ignored): ${err}`);
    // 注意:不抛错,网关关闭不应该被 ilink 错误阻塞
  }
}
```

**关键设计**:`notifyStop` 用的是**独立短超时**(`DEFAULT_CONFIG_TIMEOUT_MS = 10_000 ms`),**不**用 gateway abortSignal,所以即使 OpenClaw 已经 abort 了长轮询,这个请求也能完成。

#### 7.1.3 `setStatus` 状态上报(对应 `/Users/chario/workspace/openclaw-weixin/src/channel.ts:294-315` + `/Users/chario/workspace/openclaw-weixin/src/monitor/monitor.ts`)

每次成功 getUpdates / 处理一条入站消息都会上报:

| 字段 | 触发时机 | 含义 |
|---|---|---|
| `running: true` | startAccount 入口 | gateway 已起来 |
| `lastStartAt` | startAccount 入口 | 启动时间戳 |
| `lastEventAt` | 每次成功 getUpdates | 最近一次长轮询成功 |
| `lastInboundAt` | 每条入站消息处理 | 最近一次入站 |
| `lastError` | 错误处理 | 最近一次错误 |
| `accountId` | 始终 | 用于多账号区分 |

### 7.2 5s 停机预算(#141 修复)

📌 **补充(对应 `/Users/chario/workspace/openclaw-weixin/src/api/api.ts:384-385` 注释 + `/Users/chario/workspace/openclaw-weixin/src/monitor/monitor.ts:99-105`)**:

OpenClaw 网关的 channel-stop 预算是 **5s**。如果长轮询不响应 abort,Monitor 退出会卡 35s,导致下一次重启被跳过、Monitor 永久停摆。修复:

```ts
// api/api.ts:374 内部 abort controller
const controller = params.timeoutMs !== undefined ? new AbortController() : undefined;
const t = setTimeout(() => controller.abort(), params.timeoutMs);  // 35s
// 合并外部 abortSignal
const { signal, cleanup } = combineAbortSignals(controller, params.abortSignal);
```

这样 gateway 5s 触发 `abortSignal.abort()`,`fetch` 立即终止,Monitor 在 5s 内退出。

```

---

## 八、入站媒体解密(收图/语音/文件/视频)

```bash
# 字段来源:从 getupdates 响应的 msgs[].item_list[].<media>_item
EQP="eyJx..."                        # media.encrypt_query_param

# 图片(image_item.aeskey 是 hex 字符串)
AESKEY_HEX="1a2b3c4d..."
curl -s "$CDN_BASE/download?encrypted_query_param=$EQP" \
  | openssl enc -aes-128-ecb -d -K "$AESKEY_HEX" -nopad > photo.png

# 文件/语音/视频(media.aes_key 是 base64,且 base64 解码后是 hex 字符串)
AESKEY_B64="AB..."
AESKEY_HEX2=$(echo "$AESKEY_B64" | base64 -d)        # 32 字符 hex
curl -s "$CDN_BASE/download?encrypted_query_param=$EQP" \
  | openssl enc -aes-128-ecb -d -K "$AESKEY_HEX2" -nopad > file.bin

# 语音额外: SILK 格式需要用 silk-wasm 等转码器转 WAV 才好播放
```

> **AES key 编码差异**(代码在 `src/cdn/pic-decrypt.ts:40-52`):
> - **图片**:`image_item.aeskey` 是 32 字符 hex 字符串(优先用此字段)
> - **文件/语音/视频**:`media.aes_key` 是 base64,base64 解码后是 32 字符 hex,需要再 hex 解码一次

### 8.1 源码中的 `parseAesKey` 容错(对应 `/Users/chario/workspace/openclaw-weixin/src/cdn/pic-decrypt.ts:40-52`)

📌 **补充**:源码用 `parseAesKey` 函数支持**两种**编码,自动判断:

```ts
function parseAesKey(aesKeyBase64: string, label: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, "base64");
  if (decoded.length === 16) {
    return decoded;  // 已经是 16 字节原始 key(图片路径)
  }
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex");  // 二次 hex 解码(文件/语音/视频路径)
  }
  throw new Error(`${label}: aes_key must decode to 16 raw bytes or 32-char hex string, got ${decoded.length} bytes`);
}
```

**注意**:解析失败会**抛错**,上层 `processOneMessage` 捕获后转 `error-notice.ts` 给用户告知"消息处理失败",**不会**静默丢弃。

### 8.2 CDN URL 回退拼接(对应 `cdn/cdn-url.ts:ENABLE_CDN_URL_FALLBACK`)

📌 **补充**:

```ts
export const ENABLE_CDN_URL_FALLBACK = true;
```

当服务端**不返回** `full_url` / `upload_full_url` 字段时,客户端回退到:

```
{cdnBase}/download?encrypted_query_param={eqp}
{cdnBase}/upload?encrypted_query_param={eqp}&filekey={filekey}
```

如果关闭(`= false`),直接抛错"fullUrl is required (CDN URL fallback is disabled)"。

**当前线上服务端总是返回 full_url**,所以 fallback 路径基本不会触发;但保留它是为了**对老版本服务端/灰度环境**的兼容。

### 8.3 CDN 上传重试策略(对应 `/Users/chario/workspace/openclaw-weixin/src/cdn/cdn-upload.ts:7, 40-78`)

📌 **补充**:

| 状态码 | 行为 | 说明 |
|---|---|---|
| 200 | 成功,读 `x-encrypted-param` | 正常路径 |
| 4xx(400-499) | **立即抛错,不重试** | 客户端错误,重试无意义 |
| 5xx(500-599) | 重试,最多 `UPLOAD_MAX_RETRIES=3` 次 | 服务端临时故障 |
| `x-encrypted-param` 缺失 | 抛错"CDN upload response missing x-encrypted-param header" | 不解析 body |

**4xx 错误信息**从响应头 `x-error-message` 读取(若存在),否则用 body。

### 8.4 SILK 自动转码(对应 `media/silk-transcode.ts` + `media/media-download.ts:8`)

📌 **补充**:8 节末尾说"SILK 需要 silk-wasm 转码",**源码自带**这个能力,基于 `silk-wasm` npm 包:

```ts
// media-download.ts 简化
if (item.type === VOICE) {
  const voice = item.voice_item;
  // 1. CDN 下载 + AES-128-ECB 解密
  const silk = await downloadAndDecryptBuffer(eqp, voice.media.aes_key, ...);
  // 2. silk → wav
  const wav = await silkToWav(silk);
  return { filePath, mediaType: "audio/wav" };
}
```

- 输出格式固定 WAV(不是 MP3),`mediaType = "audio/wav"`。
- `silk-wasm` 是 WebAssembly 模块,**纯 JS 也能跑**,不依赖 ffmpeg。
- `devDependencies` 里:`"silk-wasm": "^3.7.1"`。

### 8.5 入站媒体的优先级(对应 `messaging/inbound.ts:218`)

📌 **补充**:一条消息里如果有多媒体(`item_list` 多个非 TEXT),源码按这个优先级选**第一个**作为 agent 看到的附件:

```
image > video > file > voice
```

语音还有一层特判:**如果 `voice_item.text` 字段存在(STT 转写结果),直接用 text,不下载音频**(`process-message.ts:128-130`):

```ts
i.type === MessageItemType.VOICE &&
  hasDownloadableMedia(i.voice_item?.media) &&
  !i.voice_item?.text  // ← 有 text 就不下载
```

---

## 九、消息 / 媒体结构参考

### 9.1 WeixinMessage

| 字段 | 类型 | 说明 |
|---|---|---|
| `seq` | number | 消息序列号 |
| `message_id` | number | 消息唯一 ID |
| `from_user_id` | string | 发送者 ID |
| `to_user_id` | string | 接收者 ID |
| `create_time_ms` | number | 创建时间戳(ms) |
| `session_id` | string | 会话 ID |
| `message_type` | number | `1`=USER, `2`=BOT |
| `message_state` | number | `0`=NEW, `1`=GENERATING, `2`=FINISH |
| `item_list` | MessageItem[] | 消息内容 |
| `context_token` | string | 会话上下文令牌,回复时原样回传 |

### 9.2 MessageItem.type

| 值 | 含义 | 字段 |
|---|---|---|
| `1` | TEXT | `text_item: {text}` |
| `2` | IMAGE | `image_item: {media, aeskey, mid_size, ...}` |
| `3` | VOICE | `voice_item: {media, encode_type, sample_rate, playtime, text}` |
| `4` | FILE | `file_item: {media, file_name, md5, len}` |
| `5` | VIDEO | `video_item: {media, video_size, play_length, video_md5, ...}` |

### 9.3 CDNMedia(媒体引用)

| 字段 | 类型 | 说明 |
|---|---|---|
| `encrypt_query_param` | string | CDN 加解密参数 |
| `aes_key` | string | base64 编码的 AES-128 key |
| `encrypt_type` | number | `0`=只加密 fileid, `1`=打包缩略图信息 |
| `full_url` | string | 完整 URL(优先用) |

---

## 十、加密细节

| 项 | 值 |
|---|---|
| 算法 | **AES-128-ECB** |
| 填充 | PKCS7(OpenSSL 默认) |
| Key 来源 | 客户端随机 16 字节,hex 编码后传给 `getuploadurl.aeskey` |
| 密文大小 | `ceil((rawsize + 1) / 16) * 16`(代码:`aesEcbPaddedSize`) |
| openssl 命令 | `openssl enc -aes-128-ecb -K <hex_key> [-nopad]` |

---

## 十一、端到端时序图

```
┌──────────┐                ┌────────────┐                ┌──────────────┐
│   CLI    │                │ ilinkai.qq │                │  novac2c.cdn │
│ / 你脚本 │                │  (网关)    │                │   (媒体)     │
└────┬─────┘                └──────┬─────┘                └──────┬───────┘
     │                             │                             │
     │ ① POST get_bot_qrcode      │                             │
     │ ─────────────────────────► │                             │
     │ ◄─ {qrcode, qrcode_img}    │                             │
     │                             │                             │
     │ ② GET get_qrcode_status (loop, 35s long-poll)            │
     │ ─────────────────────────► │                             │
     │ ◄─ {status:confirmed, bot_token, ilink_bot_id}           │
     │                             │                             │
     │ 保存 bot_token              │                             │
     │                             │                             │
     │ ③ POST msg/notifystart     │                             │
     │ ─────────────────────────► │                             │
     │                             │                             │
     │ ④ POST getupdates (35s 长轮询, 持续)                      │
     │ ─────────────────────────► │                             │
     │ ◄─ {msgs:[{context_token, item_list:[图片]}]}             │
     │                             │                             │
     │ GET cdn/download?eqp=...    │                             │
     │ ────────────────────────────────────────────────────────► │
     │ ◄─ 密文二进制                                              │
     │ AES-128-ECB 解密           │                             │
     │                             │                             │
     │ POST getconfig (拿 typing_ticket)                         │
     │ ─────────────────────────► │                             │
     │ POST sendtyping (status=1)  │                             │
     │ ─────────────────────────► │                             │
     │ (AI 处理中...)              │                             │
     │                             │                             │
     │ POST getuploadurl           │                             │
     │ ─────────────────────────► │                             │
     │ ◄─ {upload_full_url}        │                             │
     │                             │                             │
     │ POST cdn/upload (密文)      │                             │
     │ ────────────────────────────────────────────────────────► │
     │ ◄─ x-encrypted-param        │                             │
     │                             │                             │
     │ POST sendmessage (text+image)                             │
     │ ─────────────────────────► │                             │
     │ POST sendtyping (status=2)  │                             │
     │ ─────────────────────────► │                             │
     │                             │                             │
     │ ⑤ POST getupdates (下一轮,带新游标)                       │
     │ ─────────────────────────► │                             │
     │ (挂起...)                   │                             │
     │                             │                             │
     │ (网关关闭)                  │                             │
     │ ⑥ POST msg/notifystop      │                             │
     │ ─────────────────────────► │                             │
```

---

## 十二、最小可运行示例

完整脚本(放进 `weixin_bot.sh` 即可跑):

```bash
#!/usr/bin/env bash
set -euo pipefail

ILINK_BASE="https://ilinkai.weixin.qq.com"
BOT_TOKEN="${BOT_TOKEN:?请先登录获取 bot_token}"
BOT_AGENT="${BOT_AGENT:-OpenClaw}"
VERSION="${VERSION:-2.4.3}"

# 计算 iLink-App-ClientVersion
calc_app_ver() {
  local v="$1" IFS='.'
  read -r -a p <<< "$v"
  echo $(( (${p[0]:-0} << 16) | (${p[1]:-0} << 8) | ${p[2]:-0} ))
}
APP_VER=$(calc_app_ver "$VERSION")

# 启动通知
curl -s -X POST "$ILINK_BASE/ilink/bot/msg/notifystart" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -d "{\"base_info\":{\"channel_version\":\"$VERSION\",\"bot_agent\":\"$BOT_AGENT\"}}" >/dev/null

# 退出时通知服务端
trap 'curl -s -X POST "$ILINK_BASE/ilink/bot/msg/notifystop" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BOT_TOKEN" \
  -d "{\"base_info\":{\"channel_version\":\"$VERSION\",\"bot_agent\":\"$BOT_AGENT\"}}" >/dev/null' EXIT

BUF=""
echo "[$(date)] Bot 启动,进入长轮询..."

while true; do
  RESP=$(curl -s -m 40 -X POST "$ILINK_BASE/ilink/bot/getupdates" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $BOT_TOKEN" \
    -d "{\"get_updates_buf\":\"$BUF\",\"base_info\":{\"channel_version\":\"$VERSION\",\"bot_agent\":\"$BOT_AGENT\"}}")

  ERR=$(echo "$RESP" | jq -r '.errcode // 0')
  if [ "$ERR" = "-14" ]; then
    echo "[$(date)] 会话过期,暂停 1 小时"
    sleep 3600; continue
  fi

  BUF=$(echo "$RESP" | jq -r '.get_updates_buf // ""')

  echo "$RESP" | jq -c '.msgs[]?' | while read -r msg; do
    FROM=$(echo "$msg" | jq -r '.from_user_id')
    CTX=$(echo "$msg"  | jq -r '.context_token')
    TEXT=$(echo "$msg" | jq -r '[.item_list[]? | select(.type==1) | .text_item.text] | first // ""')
    echo "[$(date)] <<<$FROM>>> $TEXT"

    # ====== 业务逻辑(AI / 命令解析)======
    REPLY="你说了: $TEXT"

    # 回发
    curl -s -X POST "$ILINK_BASE/ilink/bot/sendmessage" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $BOT_TOKEN" \
      -d "$(jq -nc --arg to "$FROM" --arg ctx "$CTX" --arg text "$REPLY" --arg ver "$VERSION" --arg ba "$BOT_AGENT" '{
        msg: {
          to_user_id: $to,
          client_id: ("openclaw-weixin:" + (now|tostring)),
          message_type: 2,
          message_state: 2,
          item_list: [{type: 1, text_item: {text: $text}}],
          context_token: $ctx
        },
        base_info: {channel_version: $ver, bot_agent: $ba}
      }')"
  done
done
```

运行:

```bash
BOT_TOKEN="AbCdEf..."  bash weixin_bot.sh
```

---

## 十三、附:常用工具命令

```bash
# 1. 生成 random X-WECHAT-UIN
python3 -c "import random,base64; print(base64.b64encode(str(random.randint(0,2**32-1)).encode()).decode())"

# 2. 计算 AES-128-ECB 密文大小
python3 -c "import math; rawsize=$1; print(math.ceil((rawsize+1)/16)*16)"

# 3. AES-128-ECB 加密(单文件)
openssl enc -aes-128-ecb -K <hex_key> -in <input> -out <output> -nopad

# 4. AES-128-ECB 解密
openssl enc -aes-128-ecb -d -K <hex_key> -in <input> -out <output> -nopad

# 5. 文件 MD5(传给 getuploadurl.rawfilemd5)
md5 -q <file> | tr a-z A-Z

# 6. 生成 16 字节随机 hex(filekey / aeskey)
openssl rand -hex 16

# 7. hex 字符串转 base64(发图片时给 aes_key)
echo -n "<hex>" | xxd -r -p | base64 -w0

# 8. base64 解码后判断是否为 hex(校验 file/voice/video 的 aes_key)
echo "<base64>" | base64 -d | xxd -p -c 32
```

---

## 十四、注意事项

1. **`context_token` 必须原样回传**:它是会话延续的关键,缺失等于开启新会话。
2. **`get_updates_buf` 必须持久化**:重启后从磁盘恢复,保证消息不丢不重(`sync-buf.ts`)。
3. **图片/媒体的 `aeskey` 字段位置不同**:
   - 图片:`image_item.aeskey`(hex 字符串)
   - 文件/语音/视频:`media.aes_key`(base64,需二次 hex 解码)
4. **CDN 上传响应头 `x-encrypted-param`** 就是下载参数,不要解析 body。
5. **缩略图未启用**:当前所有出站媒体都设 `no_need_thumb: true`(`src/cdn/upload.ts:81`)。
6. **errcode=-14 → 冻结 1 小时**:避免雪崩,期间 `assertSessionActive` 会拦截所有出站请求。
7. **`X-WECHAT-UIN` 每次请求都要随机**:模拟设备指纹,服务端会校验。
8. **`bot_type=3`**:这是插件当前使用的 bot 类型,登录前从环境/配置可能需要调整。

### 14.5 多账号部署的额外注意

📌 **补充**:

1. **多账号时 `cron job` 必须显式带 `delivery.to` + `delivery.accountId`**,否则:
   - 1 个账号:能用,但不推荐(显式更清晰)。
   - 多个账号:抛 `ambiguous` 或 `cannot determine` 错误,**不会自动兜底**。

2. **同一 `ilink_user_id` 在多账号间冲突**:新登录会触发 `clearStaleAccountsForUserId`,旧账号被清(包括 contextToken)。同一台 OpenClaw 不要"先登 botA 给用户 X,再登 botB 给同一用户 X"。

3. **账号文件 IO 失败不影响登录**:token 仍在内存,进程退出前可用;但**重启后会失效**,需重登。

4. **配置热重载**:`configPrefixes: ["channels.openclaw-weixin"]`,改 `openclaw.json` 后**不需要**手动重启,OpenClaw 会重新加载并触发对应账号的 start/stop。

5. **`MEDIA:` 指令路径必须是绝对路径**(详见 §5.0.1),相对路径会被 `path.resolve()` 转成绝对路径,可能不是 agent 期望的位置。

### 14.6 长度限制与常量

| 限制项 | 值 | 来源 |
|---|---|---|
| 文本 chunk 上限 | 4000 字符 | `channel.ts:textChunkLimit` |
| `bot_agent` 长度上限 | 256 字节 | `sanitizeBotAgent` |
| `local_token_list` 数量 | 最多 10 个 | `login-qr.ts:69` |
| 登录窗口 | 480 000 ms(8 分钟) | `loginTimeoutMs` |
| 冻结时长(errcode=-14) | 3 600 000 ms(1 小时) | `SESSION_PAUSE_DURATION_MS` |
| 长轮询超时 | 35 000 ms(客户端) | `DEFAULT_LONG_POLL_TIMEOUT_MS` |
| 业务 API 超时 | 15 000 ms | `DEFAULT_API_TIMEOUT_MS` |
| 轻量 API 超时 | 10 000 ms | `DEFAULT_CONFIG_TIMEOUT_MS` |
| typing_ticket 缓存 | 24h(随机刷新) | `CONFIG_CACHE_TTL_MS` |
| getConfig 失败退避 | 2s → 1h(指数) | `CONFIG_CACHE_*_RETRY_MS` |
| QR 刷新次数 | 3 次 | `MAX_QR_REFRESH_COUNT` |
| 单账号 contextToken 存储粒度 | (accountId, fromUserId) | `inbound.ts:recordInboundSession` |
| CDN 上传重试 | 3 次(4xx 跳过) | `UPLOAD_MAX_RETRIES` |
| 退避阈值(连续失败) | 3 次 | `MAX_CONSECUTIVE_FAILURES` |
| 退避等待(连续失败) | 30 000 ms | `BACKOFF_DELAY_MS` |
| 普通重试等待 | 2 000 ms | `RETRY_DELAY_MS` |

### 14.7 进程内状态(无持久化)

下列状态是**进程内**的,重启即丢,不影响正确性:

| 状态 | 位置 | 持久化? |
|---|---|---|
| `pauseUntilMap`(会话冻结到期时间) | `api/session-guard.ts` | ❌ 重启后清空 |
| `activeLogins`(进行中的登录会话) | `auth/login-qr.ts` | ❌ 重启后需重新发起 |
| `cache: Map<userId, ConfigCacheEntry>` | `api/config-cache.ts` | ❌ 重启后重新拉 |
| 临时出站媒体文件 | `<state_dir>/weixin/media/outbound-temp/` | ❌ 可随时清空 |

> 进程重启会重置 `pauseUntilMap`,所以**重启可作为"立即解除冻结"的应急手段**(虽然不推荐)。

---

## 十五、日志 & 可观测性(对应 `/Users/chario/workspace/openclaw-weixin/src/util/logger.ts` + `/Users/chario/workspace/openclaw-weixin/src/util/redact.ts`)

📌 **补充**:源码用 `logger.withAccount(accountId)` 给每个账号建独立 logger,所有日志自动带上 `[account=xxx]` 前缀,方便多账号排障。

### 15.1 日志脱敏(`redact.ts`)

`redactBody` / `redactUrl` / `redactToken` 在打日志前自动打码敏感字段:

```ts
// util/redact.ts:25
const SENSITIVE_FIELDS = /\b(context_token|bot_token|token|authorization|Authorization)\b/;
// 匹配后替换为 "<redacted>"
```

例如:
```
POST https://ilinkai.weixin.qq.com/ilink/bot/sendmessage body={"to":"user1","context_token":"secret123","text":"hello"}
```
会被打码为:
```
POST https://ilinkai.weixin.qq.com/ilink/bot/sendmessage body={"to":"user1","context_token":"<redacted>","text":"hello"}
```

CDN URL 中的 `filekey`/`encrypted_query_param` 不脱敏(它们是公开 token,不含鉴权信息)。

### 15.2 关键日志点

| 触发 | 日志内容 | 用途 |
|---|---|---|
| 启动 | `Monitor started: baseUrl=... timeoutMs=...` | 确认 gateway 拉起 |
| 入站 | `inbound message: from=... types=...` | 消息流追踪 |
| 长轮询成功 | `getUpdates response: ret=..., msgs=..., get_updates_buf_length=...` | 同步健康度 |
| 同步游标更新 | `Saved new get_updates_buf (N bytes)` | 重启恢复点 |
| 退避触发 | `getUpdates failed: ret=... errcode=... (N/3)` | 故障计数 |
| 冻结 | `session-guard: paused accountId=... until=...` | errcode=-14 |
| 上传 | `CDN upload success attempt=N` | CDN 健康度 |
| 出站 | `sendMessageWeixin: failed to=... clientId=...` | 出站排障 |
| 登录成功 | `✅ Login confirmed! ilink_bot_id=... ilink_user_id=***` | 登录成功 |

---

**含义**:
- **群消息忽略**:`chatTypes: ["direct"]` 让 OpenClaw 框架在收到群消息时跳过本 channel。
- **`@im.wechat` 后缀直接当 ID**:不做 directory 查询,降低延迟。
- **块流式 + 200/3000 阈值**:`StreamingMarkdownFilter` 把"未完成"的 markdown 块暂存,直到累积到 200 字符或静默 3s 才发出,避免"```" 配对错误。

---

## 十九、`StreamingMarkdownFilter` 流式过滤(对应 `messaging/markdown-filter.ts`)

📌 **补充**:流式回包时,LLM 还在生成,会输出未闭合的 markdown 块(比如先输出 ```` ``` ```` 但还没到 ```` ``` ````)。直接 sendMessage 会让微信客户端渲染出"代码块截断"。`StreamingMarkdownFilter` 做两件事:

1. **把未闭合的代码块/链接暂存**,不立即发出。
2. **`feed()` + `flush()` 模式**:
   - 每收到一段流式输出,调 `feed(chunk)`。
   - 如果累积了 `minChars=200` 或 `idleMs=3000`,自动 flush 已完成部分。
   - 流结束调 `flush()` 强制发出剩余内容(即使不完整)。

测试覆盖:`messaging/markdown-filter.test.ts`(25 KB 的 fixtures)。

---
