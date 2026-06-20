/**
 * Convert an inbound WeixinMessage into the canonical "user input" for Claude.
 * Downloads + decrypts any media attachments to MEDIA_TMP_DIR/<userId>/.
 */

import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { isDev } from "../log.js";
import type { MediaAttachment } from "../claude/agent.js";
import { inboundLog } from "../log.js";
import { downloadAndDecryptCdn } from "../wechat/media.js";
import type { WeixinMessage } from "../wechat/types.js";
import { MessageItemType } from "../wechat/types.js";
import type { WechatApiClient } from "../wechat/api.js";

export interface InboundPayload {
  text: string;
  media: MediaAttachment[];
}

const IMAGE_MIMES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

function extFromFilename(name: string | undefined, fallbackMime: string): string {
  if (name) {
    const dot = name.lastIndexOf(".");
    if (dot !== -1) {
      const ext = name.slice(dot).toLowerCase();
      if (ext.length <= 5) return ext;
    }
  }
  // derive from mime
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "video/mp4": ".mp4",
    "audio/silk": ".silk",
    "audio/wav": ".wav",
    "application/pdf": ".pdf",
  };
  return map[fallbackMime] ?? ".bin";
}

function getFilenameFromItem(item: WeixinMessage["item_list"] extends (infer T)[] | undefined ? T : never): string {
  if (!item) return "attachment.bin";
  if (item.file_item?.file_name) return item.file_item.file_name;
  if (item.type === MessageItemType.IMAGE) return "image.bin";
  if (item.type === MessageItemType.VOICE) return "voice.silk";
  if (item.type === MessageItemType.VIDEO) return "video.mp4";
  return "attachment.bin";
}

function inferImageMime(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot === -1) return "image/jpeg";
  return IMAGE_MIMES[filename.slice(dot).toLowerCase()] ?? "image/jpeg";
}

export async function buildInboundPayload(args: {
  api: WechatApiClient;
  mediaTmpDir: string;
  msg: WeixinMessage;
}): Promise<InboundPayload> {
  const { api, mediaTmpDir, msg } = args;
  const userId = msg.from_user_id ?? "unknown";
  // 文档 §5.0.1 / §14.5: MEDIA: 指令要求绝对路径;用 resolve 把入站图片存为
  // 绝对路径,Claude 写 MEDIA: 时也会原样用绝对路径,匹配 send.ts 的正则。
  const userDir = resolve(mediaTmpDir, sanitizeUserId(userId));
  await mkdir(userDir, { recursive: true });

  const itemList = msg.item_list ?? [];
  let text = "";
  const media: MediaAttachment[] = [];

  for (const item of itemList) {
    if (isDev) {
      // 完整 dump item,方便对比入站 vs 出站 image_item 结构
      console.error(`>>> INBOUND item type=${item.type} ${JSON.stringify(item)}`);
    }
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      text = String(item.text_item.text);
      continue;
    }

    // Voice with text transcription
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      text = String(item.voice_item.text);
      // Still try to download the audio file
    }

    // Media download
    if (item.type === MessageItemType.IMAGE) {
      const img = item.image_item;
      if (!img?.media?.encrypt_query_param && !img?.media?.full_url) continue;
      const aesHex = img.aeskey;
      const aesB64 = img.media?.aes_key;
      const eqp = img.media?.encrypt_query_param ?? "";
      const fullUrl = img.media?.full_url;
      try {
        const buf = await downloadAndDecryptCdn({
          cdnBaseUrl: api.cdnBaseUrl,
          encryptedQueryParam: eqp,
          ...(aesHex ? { aesKeyHex: aesHex } : {}),
          ...(aesB64 ? { aesKeyBase64: aesB64 } : {}),
          ...(fullUrl ? { fullUrl } : {}),
          label: "image",
        });
        const ext = extFromFilename(getFilenameFromItem(item), "image/jpeg");
        const mime = inferImageMime(`x${ext}`);
        const path = resolve(userDir, `img-${Date.now()}${ext}`);
        const { writeFile } = await import("node:fs/promises");
        await writeFile(path, buf);
        media.push({ path, mime });
      } catch (err) {
        inboundLog.warn({ userId, err: String(err) }, "image download failed");
      }
      continue;
    }

    if (item.type === MessageItemType.FILE) {
      const f = item.file_item;
      if (!f?.media?.encrypt_query_param && !f?.media?.full_url) continue;
      try {
        const buf = await downloadAndDecryptCdn({
          cdnBaseUrl: api.cdnBaseUrl,
          encryptedQueryParam: f.media?.encrypt_query_param ?? "",
          ...(f.media?.aes_key ? { aesKeyBase64: f.media.aes_key } : {}),
          ...(f.media?.full_url ? { fullUrl: f.media.full_url } : {}),
          label: "file",
        });
        const name = f.file_name ?? `file-${Date.now()}.bin`;
        const path = resolve(userDir, name);
        const { writeFile } = await import("node:fs/promises");
        await writeFile(path, buf);
        media.push({ path, mime: "application/octet-stream" });
      } catch (err) {
        inboundLog.warn({ userId, err: String(err) }, "file download failed");
      }
      continue;
    }

    if (item.type === MessageItemType.VOICE) {
      const v = item.voice_item;
      if (!v?.media?.encrypt_query_param && !v?.media?.full_url) continue;
      try {
        const buf = await downloadAndDecryptCdn({
          cdnBaseUrl: api.cdnBaseUrl,
          encryptedQueryParam: v.media?.encrypt_query_param ?? "",
          ...(v.media?.aes_key ? { aesKeyBase64: v.media.aes_key } : {}),
          ...(v.media?.full_url ? { fullUrl: v.media.full_url } : {}),
          label: "voice",
        });
        const ext = extFromFilename(getFilenameFromItem(item), "audio/silk");
        const path = resolve(userDir, `voice-${Date.now()}${ext}`);
        const { writeFile } = await import("node:fs/promises");
        await writeFile(path, buf);
        media.push({ path, mime: "audio/silk" });
      } catch (err) {
        inboundLog.warn({ userId, err: String(err) }, "voice download failed");
      }
      continue;
    }

    if (item.type === MessageItemType.VIDEO) {
      const v = item.video_item;
      if (!v?.media?.encrypt_query_param && !v?.media?.full_url) continue;
      try {
        const buf = await downloadAndDecryptCdn({
          cdnBaseUrl: api.cdnBaseUrl,
          encryptedQueryParam: v.media?.encrypt_query_param ?? "",
          ...(v.media?.aes_key ? { aesKeyBase64: v.media.aes_key } : {}),
          ...(v.media?.full_url ? { fullUrl: v.media.full_url } : {}),
          label: "video",
        });
        const path = resolve(userDir, `video-${Date.now()}.mp4`);
        const { writeFile } = await import("node:fs/promises");
        await writeFile(path, buf);
        media.push({ path, mime: "video/mp4" });
      } catch (err) {
        inboundLog.warn({ userId, err: String(err) }, "video download failed");
      }
      continue;
    }
  }

  // Fallback: synthesize placeholder text when no text and no media
  if (!text && media.length === 0) {
    text = "[empty message]";
  }

  // Avoid silent zero-byte files
  for (const m of media) {
    try {
      const s = await stat(m.path);
      if (s.size === 0) {
        inboundLog.warn({ userId, path: m.path }, "media file is empty");
      }
    } catch {
      // ignore
    }
  }

  return { text, media };
}

function sanitizeUserId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_@.\-]/g, "_").slice(0, 64);
}
