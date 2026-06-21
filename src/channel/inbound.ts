import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { MediaError } from "../errors.js";
import { downloadAndDecryptCdn } from "../wechat/media.js";
import type { WeixinMessage } from "../wechat/types.js";
import { MessageItemType } from "../wechat/types.js";
import type { ChannelMsg, MediaRef } from "./types.js";

export interface BuildInboundOpts {
  api: { cdnBaseUrl: string };
  mediaTmpDir: string;
  msg: WeixinMessage;
}

const IMAGE_EXTS: Record<string, string> = {
  ".png": ".png",
  ".jpg": ".jpg",
  ".jpeg": ".jpg",
  ".gif": ".gif",
  ".webp": ".webp",
  ".bmp": ".bmp",
};

function sanitizeUserId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_@.\-]/g, "_").slice(0, 64);
}

export async function buildInbound(opts: BuildInboundOpts): Promise<ChannelMsg> {
  const { api, mediaTmpDir, msg } = opts;
  const fromUserId = msg.from_user_id ?? "unknown";
  const contextToken = msg.context_token ?? "";
  const userDir = resolve(mediaTmpDir, sanitizeUserId(fromUserId));
  await mkdir(userDir, { recursive: true });

  let text = "";
  const media: MediaRef[] = [];

  for (const item of msg.item_list ?? []) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      text = String(item.text_item.text);
      continue;
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      text = String(item.voice_item.text);
    }
    if (item.type === MessageItemType.IMAGE) {
      const img = item.image_item;
      if (!img?.media?.encrypt_query_param && !img?.media?.full_url) continue;
      try {
        const buf = await downloadAndDecryptCdn({
          cdnBaseUrl: api.cdnBaseUrl,
          encryptedQueryParam: img.media?.encrypt_query_param ?? "",
          ...(img.aeskey ? { aesKeyHex: img.aeskey } : {}),
          ...(img.media?.aes_key ? { aesKeyBase64: img.media.aes_key } : {}),
          ...(img.media?.full_url ? { fullUrl: img.media.full_url } : {}),
          label: "image",
        });
        const path = resolve(userDir, `img-${Date.now()}.jpg`);
        await writeFile(path, buf);
        media.push({ path, mime: "image/jpeg" });
      } catch (err) {
        throw new MediaError("decrypt", err);
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
        await writeFile(path, buf);
        media.push({ path, mime: "application/octet-stream" });
      } catch (err) {
        throw new MediaError("decrypt", err);
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
        const path = resolve(userDir, `voice-${Date.now()}.silk`);
        await writeFile(path, buf);
        media.push({ path, mime: "audio/silk" });
      } catch (err) {
        throw new MediaError("decrypt", err);
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
        await writeFile(path, buf);
        media.push({ path, mime: "video/mp4" });
      } catch (err) {
        throw new MediaError("decrypt", err);
      }
      continue;
    }
  }

  if (!text && media.length === 0) {
    text = "[empty message]";
  }

  return { fromUserId, contextToken, text, media, raw: msg };
}
