"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runLongPoll = runLongPoll;
const errors_js_1 = require("../errors.js");
const inbound_js_1 = require("./inbound.js");
const reply_js_1 = require("./reply.js");
const SESSION_EXPIRED = -14;
const CONSECUTIVE_FAILURE_LIMIT = 3;
const BACKOFF_MS = 30_000;
const RETRY_DELAY_MS = 2_000;
const SESSION_PAUSE_MS = 60 * 60 * 1000;
async function runLongPoll(opts) {
    const { api, store, mediaTmpDir, onMessage, onError, longPollTimeoutMs, signal } = opts;
    try {
        const resp = await api.notifyStart();
        if (resp.ret !== undefined && resp.ret !== 0) {
            onError(new errors_js_1.WechatApiError({ ret: resp.ret, errmsg: resp.errmsg }), { phase: "notifyStart" });
        }
    }
    catch (err) {
        onError(err, { phase: "notifyStart" });
    }
    let consecutive = 0;
    let sessionPausedUntil = 0;
    while (!signal.aborted) {
        const now = Date.now();
        if (now < sessionPausedUntil) {
            try {
                await sleep(sessionPausedUntil - now, signal);
            }
            catch {
                break;
            }
            continue;
        }
        let resp;
        try {
            resp = await api.getUpdates({ get_updates_buf: (await store.get("sync_buf")) ?? "" }, { timeoutMs: longPollTimeoutMs, signal });
        }
        catch (err) {
            if (signal.aborted)
                break;
            consecutive += 1;
            onError(err, { phase: "getUpdates" });
            const wait = consecutive >= CONSECUTIVE_FAILURE_LIMIT ? BACKOFF_MS : RETRY_DELAY_MS;
            try {
                await sleep(wait, signal);
            }
            catch {
                break;
            }
            continue;
        }
        if (!resp || typeof resp !== "object") {
            onError(new Error("getUpdates returned non-object response"), { phase: "getUpdates" });
            const wait = consecutive >= CONSECUTIVE_FAILURE_LIMIT ? BACKOFF_MS : RETRY_DELAY_MS;
            try {
                await sleep(wait, signal);
            }
            catch {
                break;
            }
            continue;
        }
        const isError = (resp.ret !== undefined && resp.ret !== 0) || (resp.errcode !== undefined && resp.errcode !== 0);
        if (isError) {
            if (resp.errcode === SESSION_EXPIRED || resp.ret === SESSION_EXPIRED) {
                sessionPausedUntil = Date.now() + SESSION_PAUSE_MS;
                onError(new errors_js_1.WechatApiError({ ret: resp.ret, errcode: resp.errcode, errmsg: resp.errmsg }), { phase: "sessionExpired" });
                continue;
            }
            consecutive += 1;
            onError(new errors_js_1.WechatApiError({ ret: resp.ret, errcode: resp.errcode, errmsg: resp.errmsg }), { phase: "getUpdates" });
            const wait = consecutive >= CONSECUTIVE_FAILURE_LIMIT ? BACKOFF_MS : RETRY_DELAY_MS;
            try {
                await sleep(wait, signal);
            }
            catch {
                break;
            }
            continue;
        }
        consecutive = 0;
        if (resp.get_updates_buf != null && resp.get_updates_buf !== "") {
            await store.set("sync_buf", resp.get_updates_buf);
        }
        for (const fullMsg of resp.msgs ?? []) {
            if (signal.aborted)
                break;
            const userId = fullMsg.from_user_id ?? "";
            if (!userId)
                continue;
            const contextToken = fullMsg.context_token ?? (await store.get(`ctx:${userId}`)) ?? "";
            if (fullMsg.context_token) {
                await store.set(`ctx:${userId}`, fullMsg.context_token);
            }
            let msg;
            try {
                msg = await (0, inbound_js_1.buildInbound)({ api, mediaTmpDir, msg: fullMsg });
            }
            catch (err) {
                onError(err, { phase: "inbound" });
                continue;
            }
            const reply = (0, reply_js_1.createReply)({
                api,
                toUserId: userId,
                contextToken,
                defaultMaxChars: opts.defaultMaxChars,
            });
            try {
                await onMessage(msg, reply);
            }
            catch (err) {
                onError(err, { phase: "handler" });
            }
        }
    }
}
function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error("aborted"));
        }, { once: true });
    });
}
//# sourceMappingURL=long-poll.js.map