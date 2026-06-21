import "dotenv/config";

export interface EnvOverrides {
  baseUrl?: string;
  cdnBaseUrl?: string;
  stateDir?: string;
  longPollTimeoutMs?: number;
}

export function loadEnvOverrides(prefix: string): EnvOverrides {
  const get = (suffix: string): string | undefined => {
    const v = process.env[`${prefix}${suffix}`]?.trim();
    return v && v.length > 0 ? v : undefined;
  };
  const longPollRaw = get("LONG_POLL_TIMEOUT_MS");
  return {
    baseUrl: get("BASE_URL"),
    cdnBaseUrl: get("CDN_BASE_URL"),
    stateDir: get("STATE_DIR"),
    longPollTimeoutMs: longPollRaw ? Number.parseInt(longPollRaw, 10) : undefined,
  };
}