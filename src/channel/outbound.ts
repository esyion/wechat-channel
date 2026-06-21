import { stat } from "node:fs/promises";

import type { WechatApiClient } from "../wechat/api.js";
import { aesKeyHexToBase64, getMimeFromFilename, uploadAttachment, uploadImage, uploadVideo } from "../wechat/media.js";
import type { MessageItem } from "../wechat/types.js";
import { MessageItemType, MessageState, MessageType } from "../wechat/types.js";
import { MediaError } from "../errors.js";

export interface SendCtx {
  api: WechatApiClient;
  toUserId: string;
  contextToken: string;
  /** Overrideable for testing. */
  uploadImage?: typeof uploadImage;
  uploadVideo?: typeof uploadVideo;
  uploadAttachment?: typeof uploadAttachment;
  defaultMaxChars?: number;
}

function newClientId(): string {
  return `wac:${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    if (rest.length <= max) {
      out.push(rest);
      break;
    }
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.6) cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.6) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  return out;
}

export async function sendText(ctx: SendCtx, text: string, opts?: { maxChars?: number }): Promise<void> {
  const max = opts?.maxChars ?? ctx.defaultMaxChars ?? 4000;
  for (const chunk of chunkText(text, max)) {
    await ctx.api.sendMessage({
      msg: {
        from_user_id: "",
        to_user_id: ctx.toUserId,
        client_id: newClientId(),
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [{ type: MessageItemType.TEXT, text_item: { text: chunk } }],
        context_token: ctx.contextToken,
      },
    });
  }
}

export async function sendMedia(ctx: SendCtx, filePath: string, caption?: string): Promise<void> {
  const st = await stat(filePath).catch((err) => {
    throw new MediaError("upload", err);
  });
  if (!st.isFile()) {
    throw new MediaError("upload", new Error(`not a file: ${filePath}`));
  }
  const mime = getMimeFromFilename(filePath);
  const upImg = ctx.uploadImage ?? uploadImage;
  const upVid = ctx.uploadVideo ?? uploadVideo;
  const upAtt = ctx.uploadAttachment ?? uploadAttachment;
  let uploaded;
  if (mime.startsWith("image/")) uploaded = await upImg(ctx.api, filePath, ctx.toUserId);
  else if (mime.startsWith("video/")) uploaded = await upVid(ctx.api, filePath, ctx.toUserId);
  else uploaded = await upAtt(ctx.api, filePath, ctx.toUserId);

  let mediaItem: MessageItem;
  if (mime.startsWith("image/")) {
    mediaItem = {
      type: MessageItemType.IMAGE,
      image_item: {
        aeskey: uploaded.aeskey,
        media: {
          encrypt_query_param: uploaded.downloadEncryptedQueryParam,
          aes_key: aesKeyHexToBase64(uploaded.aeskey),
          encrypt_type: 1,
        },
        mid_size: uploaded.fileSizeCiphertext,
      },
    };
  } else if (mime.startsWith("video/")) {
    mediaItem = {
      type: MessageItemType.VIDEO,
      video_item: {
        media: {
          encrypt_query_param: uploaded.downloadEncryptedQueryParam,
          aes_key: aesKeyHexToBase64(uploaded.aeskey),
          encrypt_type: 1,
        },
        video_size: uploaded.fileSizeCiphertext,
      },
    };
  } else {
    const fileName = filePath.split("/").pop() ?? "file";
    mediaItem = {
      type: MessageItemType.FILE,
      file_item: {
        media: {
          encrypt_query_param: uploaded.downloadEncryptedQueryParam,
          aes_key: aesKeyHexToBase64(uploaded.aeskey),
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
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [{ type: MessageItemType.TEXT, text_item: { text: caption } }],
        context_token: ctx.contextToken,
      },
    });
  }
  await ctx.api.sendMessage({
    msg: {
      from_user_id: "",
      to_user_id: ctx.toUserId,
      client_id: newClientId(),
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: [mediaItem],
      context_token: ctx.contextToken,
    },
  });
}
