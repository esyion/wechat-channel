"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chunkText = chunkText;
exports.sendText = sendText;
exports.sendMedia = sendMedia;
const promises_1 = require("node:fs/promises");
const media_js_1 = require("../wechat/media.js");
const types_js_1 = require("../wechat/types.js");
const errors_js_1 = require("../errors.js");
function newClientId() {
    return `wac:${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}
function chunkText(text, max) {
    if (text.length <= max)
        return [text];
    const out = [];
    let rest = text;
    while (rest.length > 0) {
        if (rest.length <= max) {
            out.push(rest);
            break;
        }
        let cut = rest.lastIndexOf("\n", max);
        if (cut < max * 0.6)
            cut = rest.lastIndexOf(" ", max);
        if (cut < max * 0.6)
            cut = max;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut).trimStart();
    }
    return out;
}
async function sendText(ctx, text, opts) {
    const max = opts?.maxChars ?? ctx.defaultMaxChars ?? 4000;
    for (const chunk of chunkText(text, max)) {
        await ctx.api.sendMessage({
            msg: {
                from_user_id: "",
                to_user_id: ctx.toUserId,
                client_id: newClientId(),
                message_type: types_js_1.MessageType.BOT,
                message_state: types_js_1.MessageState.FINISH,
                item_list: [{ type: types_js_1.MessageItemType.TEXT, text_item: { text: chunk } }],
                context_token: ctx.contextToken,
            },
        });
    }
}
async function sendMedia(ctx, filePath, caption) {
    const st = await (0, promises_1.stat)(filePath).catch((err) => {
        throw new errors_js_1.MediaError("upload", err);
    });
    if (!st.isFile()) {
        throw new errors_js_1.MediaError("upload", new Error(`not a file: ${filePath}`));
    }
    const mime = (0, media_js_1.getMimeFromFilename)(filePath);
    const upImg = ctx.uploadImage ?? media_js_1.uploadImage;
    const upVid = ctx.uploadVideo ?? media_js_1.uploadVideo;
    const upAtt = ctx.uploadAttachment ?? media_js_1.uploadAttachment;
    let uploaded;
    if (mime.startsWith("image/"))
        uploaded = await upImg(ctx.api, filePath, ctx.toUserId);
    else if (mime.startsWith("video/"))
        uploaded = await upVid(ctx.api, filePath, ctx.toUserId);
    else
        uploaded = await upAtt(ctx.api, filePath, ctx.toUserId);
    let mediaItem;
    if (mime.startsWith("image/")) {
        mediaItem = {
            type: types_js_1.MessageItemType.IMAGE,
            image_item: {
                aeskey: uploaded.aeskey,
                media: {
                    encrypt_query_param: uploaded.downloadEncryptedQueryParam,
                    aes_key: (0, media_js_1.aesKeyHexToBase64)(uploaded.aeskey),
                    encrypt_type: 1,
                },
                mid_size: uploaded.fileSizeCiphertext,
            },
        };
    }
    else if (mime.startsWith("video/")) {
        mediaItem = {
            type: types_js_1.MessageItemType.VIDEO,
            video_item: {
                media: {
                    encrypt_query_param: uploaded.downloadEncryptedQueryParam,
                    aes_key: (0, media_js_1.aesKeyHexToBase64)(uploaded.aeskey),
                    encrypt_type: 1,
                },
                video_size: uploaded.fileSizeCiphertext,
            },
        };
    }
    else {
        const fileName = filePath.split("/").pop() ?? "file";
        mediaItem = {
            type: types_js_1.MessageItemType.FILE,
            file_item: {
                media: {
                    encrypt_query_param: uploaded.downloadEncryptedQueryParam,
                    aes_key: (0, media_js_1.aesKeyHexToBase64)(uploaded.aeskey),
                    encrypt_type: 1,
                },
                file_name: fileName,
                len: String(uploaded.fileSize),
            },
        };
    }
    if (caption) {
        await ctx.api.sendMessage({
            msg: {
                from_user_id: "",
                to_user_id: ctx.toUserId,
                client_id: newClientId(),
                message_type: types_js_1.MessageType.BOT,
                message_state: types_js_1.MessageState.FINISH,
                item_list: [{ type: types_js_1.MessageItemType.TEXT, text_item: { text: caption } }],
                context_token: ctx.contextToken,
            },
        });
    }
    await ctx.api.sendMessage({
        msg: {
            from_user_id: "",
            to_user_id: ctx.toUserId,
            client_id: newClientId(),
            message_type: types_js_1.MessageType.BOT,
            message_state: types_js_1.MessageState.FINISH,
            item_list: [mediaItem],
            context_token: ctx.contextToken,
        },
    });
}
//# sourceMappingURL=outbound.js.map