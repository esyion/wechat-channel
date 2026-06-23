"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadEnvOverrides = loadEnvOverrides;
require("dotenv/config");
function loadEnvOverrides(prefix) {
    const get = (suffix) => {
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
//# sourceMappingURL=config.js.map