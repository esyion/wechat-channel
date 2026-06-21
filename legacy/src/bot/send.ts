/**
 * Outbound send helpers.
 *
 * Extracts `MEDIA:/path` directives from Claude's response text, uploads the
 * referenced files to the WeChat CDN, then sends text + media as separate
 * MessageItems in item_list (per openclaw-weixin convention).
 */

import { stat } from "node:fs/promises";

import { WechatApiClient } from "../wechat/api.js";
import { aesKeyHexToBase64, getMimeFromFilename, uploadAttachment, uploadImage, uploadVideo } from "../wechat/media.js";
import type { MessageItem } from "../wechat/types.js";
import { MessageItemType, MessageState, MessageType } from "../wechat/types.js";
import { config as defaultConfig } from "../config.js";

/** Match MEDIA:/absolute/path on its own line. Must exclude \n to prevent greedy leak. */
const MEDIA_DIRECTIVE = /^[ \t]*MEDIA:(\/[^ \t\r\n]+)[ \t]*$/gm;

export interface ParsedReply {
  /** Text with MEDIA: lines removed. */
  text: string;
  /** Absolute paths to files to send as media. */
  mediaFiles: string[];
}

export function parseMediaDirectives(text: string): ParsedReply {
  const mediaFiles: string[] = [];
  const stripped = text.replace(MEDIA_DIRECTIVE, (_match, p1: string) => {
    mediaFiles.push(p1);
    return ""; // remove directive line
  });
  return { text: stripped.trim(), mediaFiles };
}

export function newClientId(): string {
  return `wac:${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

interface SendOptions {
  api: WechatApiClient;
  toUserId: string;
  contextToken: string;
  /** Max text chars per message (default: config.bot.maxTextChars). */
  maxTextChars?: number;
}

export async function sendReplyText(opts: SendOptions, text: string): Promise<string> {
  const max = opts.maxTextChars ?? defaultConfig.bot.maxTextChars;
  // Split if too long; send first chunk, others follow
  const chunks = chunkText(text, max);
  let lastClientId = "";
  for (const chunk of chunks) {
    const clientId = newClientId();
    lastClientId = clientId;
    await opts.api.sendMessage({
      msg: {
        from_user_id: "",
        to_user_id: opts.toUserId,
        client_id: clientId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [{ type: MessageItemType.TEXT, text_item: { text: chunk } }],
        context_token: opts.contextToken,
      },
    });
  }
  return lastClientId;
}

export async function sendReplyMedia(
  opts: SendOptions,
  text: string,
  filePath: string,
): Promise<string> {
  const st = await stat(filePath);
  if (!st.isFile()) {
    throw new Error(`MEDIA target is not a file: ${filePath}`);
  }

  const mime = getMimeFromFilename(filePath);
  let uploaded;
  if (mime.startsWith("image/")) {
    uploaded = await uploadImage(opts.api, filePath, opts.toUserId);
  } else if (mime.startsWith("video/")) {
    uploaded = await uploadVideo(opts.api, filePath, opts.toUserId);
  } else {
    uploaded = await uploadAttachment(opts.api, filePath, opts.toUserId);
  }

  // Decide item type
  let mediaItem: MessageItem;
  if (mime.startsWith("image/")) {
    mediaItem = {
      type: MessageItemType.IMAGE,
      image_item: {
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

  // Send: optional text caption as separate TEXT item, then media
  if (text) {
    await opts.api.sendMessage({
      msg: {
        from_user_id: "",
        to_user_id: opts.toUserId,
        client_id: newClientId(),
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [{ type: MessageItemType.TEXT, text_item: { text } }],
        context_token: opts.contextToken,
      },
    });
  }

  const clientId = newClientId();
  await opts.api.sendMessage({
    msg: {
      from_user_id: "",
      to_user_id: opts.toUserId,
      client_id: clientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: [mediaItem],
      context_token: opts.contextToken,
    },
  });

  return clientId;
}

function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    if (rest.length <= max) {
      out.push(rest);
      break;
    }
    // Try to split on a newline boundary near the limit
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.6) cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.6) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  return out;
}
