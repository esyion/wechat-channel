import "dotenv/config";

export interface Config {
  wechat: {
    baseUrl: string;
    cdnBaseUrl: string;
    botToken: string;
    accountId: string;
    botAgent: string;
    channelVersion: string;
  };
  claude: {
    apiKey: string;
    /** Custom Anthropic-compatible endpoint (e.g. proxy / LiteLLM / vLLM). */
    baseUrl: string;
    /** Custom auth token (overrides API key when set; e.g. proxy-issued token). */
    authToken: string;
    /** Custom model name (e.g. claude-sonnet-4-6, claude-opus-4-8, or proxy-mapped name). */
    model: string;
    workDir: string;
    allowedTools: string[];
    maxTurns: number;
  };
  bot: {
    maxTextChars: number;
    longPollTimeoutMs: number;
    blockedUsers: Set<string>;
    mediaTmpDir: string;
    accountStateDir: string;
    /** Min chars to trigger an immediate streaming flush. Default 200. */
    streamMinChars: number;
    /** Idle ms before forcing a streaming flush. Default 3000. */
    streamIdleMs: number;
    /** Hard cap per streaming packet. Default 4000 (matches WeChat max text). */
    streamMaxChars: number;
  };
}

function envStr(key: string, fallback = ""): string {
  const v = process.env[key]?.trim();
  return v && v.length > 0 ? v : fallback;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key]?.trim();
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envList(key: string): string[] {
  return process.env[key]
    ?.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0) ?? [];
}

const PKG_VERSION = "0.1.0";

export const config: Config = {
  wechat: {
    baseUrl: envStr("WECHAT_BASE_URL", "https://ilinkai.weixin.qq.com"),
    cdnBaseUrl: envStr("WECHAT_CDN_BASE_URL", "https://novac2c.cdn.weixin.qq.com/c2c"),
    botToken: envStr("WECHAT_BOT_TOKEN"),
    accountId: envStr("WECHAT_ACCOUNT_ID"),
    botAgent: envStr("WECHAT_BOT_AGENT", `wechat-agent-channel/${PKG_VERSION}`),
    channelVersion: PKG_VERSION,
  },
  claude: {
    apiKey: envStr("ANTHROPIC_API_KEY"),
    // Prefer CLAUDE_* aliases; fall back to ANTHROPIC_* (used by Claude Code CLI natively).
    baseUrl: envStr("CLAUDE_BASE_URL") || envStr("ANTHROPIC_BASE_URL"),
    authToken: envStr("CLAUDE_AUTH_TOKEN") || envStr("ANTHROPIC_AUTH_TOKEN"),
    model: envStr("CLAUDE_MODEL", "claude-sonnet-4-6"),
    workDir: envStr("CLAUDE_WORK_DIR", "./workspace"),
    allowedTools: envList("CLAUDE_ALLOWED_TOOLS"),
    maxTurns: envInt("CLAUDE_MAX_TURNS", 0),
  },
  bot: {
    maxTextChars: envInt("MAX_TEXT_CHARS", 4000),
    longPollTimeoutMs: envInt("LONG_POLL_TIMEOUT_MS", 35000),
    blockedUsers: new Set(envList("BLOCKED_USERS")),
    mediaTmpDir: envStr("MEDIA_TMP_DIR", "./tmp/media"),
    accountStateDir: envStr("ACCOUNT_STATE_DIR", `${process.env.HOME}/.wechat-agent-channel`),
    streamMinChars: envInt("STREAM_MIN_CHARS", 200),
    streamIdleMs: envInt("STREAM_IDLE_MS", 3000),
    streamMaxChars: envInt("STREAM_MAX_CHARS", 4000),
  },
};

export function requireWechatToken(): string {
  if (!config.wechat.botToken) {
    throw new Error(
      `WECHAT_BOT_TOKEN is not set. Run \`npm run login\` to log in via QR code, or set WECHAT_BOT_TOKEN in .env`,
    );
  }
  return config.wechat.botToken;
}
