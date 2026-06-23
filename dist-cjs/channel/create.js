"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createChannel = createChannel;
const config_js_1 = require("../config.js");
const errors_js_1 = require("../errors.js");
const file_js_1 = require("../store/file.js");
const api_js_1 = require("../wechat/api.js");
const login_js_1 = require("../wechat/login.js");
const long_poll_js_1 = require("./long-poll.js");
const login_js_2 = require("./login.js");
/**
 * Create a fully-wired WeChat channel handle.
 *
 * Main entry point. Validates auth credentials, resolves defaults (env overrides +
 * hardcoded fallbacks), constructs a `WechatApiClient` and a `Store` (defaults to
 * `JsonFileStore` at `~/.wechat-channel/store.json`), and returns a `ChannelHandle`
 * you can `start()` to begin long-polling.
 *
 * The library is agent-agnostic: pass `onMessage(msg, reply)` to react to inbound
 * messages with whatever logic you want (Claude, GPT, RAG, business workflow).
 *
 * @throws {@link ChannelError} `"AUTH_REQUIRED"` if `botToken` is empty
 * @throws {@link ChannelError} `"INVALID_TOKEN"` if `accountId` is empty
 */
async function createChannel(opts) {
    if (!opts.botToken)
        throw new errors_js_1.ChannelError("AUTH_REQUIRED", "botToken is required");
    if (!opts.accountId)
        throw new errors_js_1.ChannelError("INVALID_TOKEN", "accountId is required");
    const env = (0, config_js_1.loadEnvOverrides)("WECHAT_CHANNEL_");
    const baseUrl = opts.baseUrl ?? env.baseUrl ?? "https://ilinkai.weixin.qq.com";
    const cdnBaseUrl = opts.cdnBaseUrl ?? env.cdnBaseUrl ?? "https://novac2c.cdn.weixin.qq.com/c2c";
    const channelVersion = opts.channelVersion ?? "wechat-channel/0.1.0";
    const botAgent = opts.botAgent ?? channelVersion;
    const longPollTimeoutMs = opts.longPollTimeoutMs ?? env.longPollTimeoutMs ?? 35_000;
    const api = new api_js_1.WechatApiClient({
        baseUrl,
        cdnBaseUrl,
        botToken: opts.botToken,
        channelVersion,
        botAgent,
        longPollTimeoutMs,
    });
    const stateDir = opts.stateDir ?? env.stateDir ?? `${process.env.HOME ?? "."}/.wechat-channel`;
    const store = opts.store ?? new file_js_1.JsonFileStore(`${stateDir}/store.json`);
    const mediaTmpDir = opts.mediaTmpDir ?? `${stateDir}/media`;
    const onError = opts.onError ?? ((err) => console.error("[wechat-channel]", err));
    let abortController = null;
    let loopPromise = null;
    async function start(startOpts) {
        if (loopPromise)
            throw new errors_js_1.ChannelError("ABORTED", "channel already started");
        abortController = new AbortController();
        if (startOpts?.signal) {
            startOpts.signal.addEventListener("abort", () => abortController?.abort(), { once: true });
        }
        if (opts.onMessage) {
            const handler = opts.onMessage;
            loopPromise = (0, long_poll_js_1.runLongPoll)({
                api,
                store,
                mediaTmpDir,
                onMessage: (msg, reply) => {
                    if (opts.blockedUsers?.has(msg.fromUserId))
                        return Promise.resolve();
                    return handler(msg, reply);
                },
                onError,
                longPollTimeoutMs,
                signal: abortController.signal,
            });
        }
        await loopPromise;
    }
    async function stop() {
        abortController?.abort();
        try {
            await api.notifyStop();
        }
        catch (err) {
            onError(err, { phase: "notifyStop" });
        }
        await store.flush();
        loopPromise = null;
    }
    async function loginQR(loginOpts) {
        const botType = loginOpts?.botType ?? opts.botType ?? "3";
        const { qrcode, qrcodeImgContent } = await (0, login_js_1.requestQrCode)(api, { botType });
        const matrix = await (0, login_js_1.decodeQrMatrix)(qrcodeImgContent);
        return (0, login_js_2.createQRLoginHandle)({
            matrix,
            waitForLogin: async (waitOpts) => {
                const result = await (0, login_js_1.pollQrLogin)(api, {
                    qrcode,
                    timeoutMs: waitOpts?.timeoutMs ?? loginOpts?.timeoutMs ?? 120_000,
                    signal: waitOpts?.signal ?? loginOpts?.signal,
                });
                // DIAG: log the raw LoginResult so we can see what ilink actually returned.
                // Remove once the underlying API/protocol is patched.
                // eslint-disable-next-line no-console
                console.log("[diag] pollQrLogin raw result:", JSON.stringify(result));
                return { botToken: result.botToken, accountId: result.accountId, baseUrl: result.baseUrl ?? baseUrl };
            },
        });
    }
    return { api, start, stop, loginQR };
}
//# sourceMappingURL=create.js.map