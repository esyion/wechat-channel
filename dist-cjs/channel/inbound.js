"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildInbound = buildInbound;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const errors_js_1 = require("../errors.js");
const media_js_1 = require("../wechat/media.js");
const types_js_1 = require("../wechat/types.js");
const IMAGE_EXTS = {
    ".png": ".png",
    ".jpg": ".jpg",
    ".jpeg": ".jpg",
    ".gif": ".gif",
    ".webp": ".webp",
    ".bmp": ".bmp",
};
function sanitizeUserId(id) {
    return id.replace(/[^a-zA-Z0-9_@.\-]/g, "_").slice(0, 64);
}
async function buildInbound(opts) {
    const { api, mediaTmpDir, msg } = opts;
    const fromUserId = msg.from_user_id ?? "unknown";
    const contextToken = msg.context_token ?? "";
    const userDir = (0, node_path_1.resolve)(mediaTmpDir, sanitizeUserId(fromUserId));
    await (0, promises_1.mkdir)(userDir, { recursive: true });
    let text = "";
    const media = [];
    for (const item of msg.item_list ?? []) {
        if (item.type === types_js_1.MessageItemType.TEXT && item.text_item?.text != null) {
            text = String(item.text_item.text);
            continue;
        }
        if (item.type === types_js_1.MessageItemType.VOICE && item.voice_item?.text) {
            text = String(item.voice_item.text);
        }
        if (item.type === types_js_1.MessageItemType.IMAGE) {
            const img = item.image_item;
            if (!img?.media?.encrypt_query_param && !img?.media?.full_url)
                continue;
            try {
                const buf = await (0, media_js_1.downloadAndDecryptCdn)({
                    cdnBaseUrl: api.cdnBaseUrl,
                    encryptedQueryParam: img.media?.encrypt_query_param ?? "",
                    ...(img.aeskey ? { aesKeyHex: img.aeskey } : {}),
                    ...(img.media?.aes_key ? { aesKeyBase64: img.media.aes_key } : {}),
                    ...(img.media?.full_url ? { fullUrl: img.media.full_url } : {}),
                    label: "image",
                });
                const path = (0, node_path_1.resolve)(userDir, `img-${Date.now()}.jpg`);
                await (0, promises_1.writeFile)(path, buf);
                media.push({ path, mime: "image/jpeg" });
            }
            catch (err) {
                throw new errors_js_1.MediaError("decrypt", err);
            }
            continue;
        }
        if (item.type === types_js_1.MessageItemType.FILE) {
            const f = item.file_item;
            if (!f?.media?.encrypt_query_param && !f?.media?.full_url)
                continue;
            try {
                const buf = await (0, media_js_1.downloadAndDecryptCdn)({
                    cdnBaseUrl: api.cdnBaseUrl,
                    encryptedQueryParam: f.media?.encrypt_query_param ?? "",
                    ...(f.media?.aes_key ? { aesKeyBase64: f.media.aes_key } : {}),
                    ...(f.media?.full_url ? { fullUrl: f.media.full_url } : {}),
                    label: "file",
                });
                const name = f.file_name ?? `file-${Date.now()}.bin`;
                const path = (0, node_path_1.resolve)(userDir, name);
                await (0, promises_1.writeFile)(path, buf);
                media.push({ path, mime: "application/octet-stream" });
            }
            catch (err) {
                throw new errors_js_1.MediaError("decrypt", err);
            }
            continue;
        }
        if (item.type === types_js_1.MessageItemType.VOICE) {
            const v = item.voice_item;
            if (!v?.media?.encrypt_query_param && !v?.media?.full_url)
                continue;
            try {
                const buf = await (0, media_js_1.downloadAndDecryptCdn)({
                    cdnBaseUrl: api.cdnBaseUrl,
                    encryptedQueryParam: v.media?.encrypt_query_param ?? "",
                    ...(v.media?.aes_key ? { aesKeyBase64: v.media.aes_key } : {}),
                    ...(v.media?.full_url ? { fullUrl: v.media.full_url } : {}),
                    label: "voice",
                });
                const path = (0, node_path_1.resolve)(userDir, `voice-${Date.now()}.silk`);
                await (0, promises_1.writeFile)(path, buf);
                media.push({ path, mime: "audio/silk" });
            }
            catch (err) {
                throw new errors_js_1.MediaError("decrypt", err);
            }
            continue;
        }
        if (item.type === types_js_1.MessageItemType.VIDEO) {
            const v = item.video_item;
            if (!v?.media?.encrypt_query_param && !v?.media?.full_url)
                continue;
            try {
                const buf = await (0, media_js_1.downloadAndDecryptCdn)({
                    cdnBaseUrl: api.cdnBaseUrl,
                    encryptedQueryParam: v.media?.encrypt_query_param ?? "",
                    ...(v.media?.aes_key ? { aesKeyBase64: v.media.aes_key } : {}),
                    ...(v.media?.full_url ? { fullUrl: v.media.full_url } : {}),
                    label: "video",
                });
                const path = (0, node_path_1.resolve)(userDir, `video-${Date.now()}.mp4`);
                await (0, promises_1.writeFile)(path, buf);
                media.push({ path, mime: "video/mp4" });
            }
            catch (err) {
                throw new errors_js_1.MediaError("decrypt", err);
            }
            continue;
        }
    }
    if (!text && media.length === 0) {
        text = "[empty message]";
    }
    return { fromUserId, contextToken, text, media, raw: msg };
}
//# sourceMappingURL=inbound.js.map