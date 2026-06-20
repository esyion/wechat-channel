/**
 * CDN upload / download + AES-128-ECB encryption.
 * All file paths use Node fs/promises for non-blocking I/O.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { isDev } from "../log.js";
import {
  aesEcbPaddedSize,
  aesKeyHexToBase64,
  aesKeyHexToBuffer,
  decryptAesEcb,
  encryptAesEcb,
  generateAesKey,
  generateFilekey,
  md5Hex,
  parseAesKey,
} from "./crypto.js";
import { WechatApiClient } from "./api.js";
import type { UploadedFileInfo } from "./types.js";
import { UploadMediaType } from "./types.js";

const UPLOAD_MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// CDN URL builders (client-side fallback when upload_full_url is missing)
// ---------------------------------------------------------------------------

export function buildCdnUploadUrl(params: {
  cdnBaseUrl: string;
  uploadParam: string;
  filekey: string;
}): string {
  return `${params.cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(params.uploadParam)}&filekey=${encodeURIComponent(params.filekey)}`;
}

export function buildCdnDownloadUrl(cdnBaseUrl: string, encryptedQueryParam: string): string {
  return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`;
}

// ---------------------------------------------------------------------------
// MIME helpers (minimal table — extend as needed)
// ---------------------------------------------------------------------------

const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".zip": "application/zip",
};

export function getMimeFromFilename(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return EXT_TO_MIME[ext] ?? "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Upload pipeline
// ---------------------------------------------------------------------------

export async function uploadBufferToCdn(params: {
  cdnBaseUrl: string;
  buf: Buffer;
  uploadFullUrl?: string;
  uploadParam?: string;
  filekey: string;
  aeskey: Buffer;
  label?: string;
}): Promise<{ downloadParam: string }> {
  const { buf, uploadFullUrl, uploadParam, filekey, cdnBaseUrl, aeskey } = params;
  const label = params.label ?? "uploadBufferToCdn";
  const ciphertext = encryptAesEcb(buf, aeskey);

  const trimmed = uploadFullUrl?.trim();
  let cdnUrl: string;
  if (trimmed) {
    cdnUrl = trimmed;
  } else if (uploadParam) {
    cdnUrl = buildCdnUploadUrl({ cdnBaseUrl, uploadParam, filekey });
  } else {
    throw new Error(`${label}: CDN upload URL missing (need upload_full_url or upload_param)`);
  }

  let downloadParam: string | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= UPLOAD_MAX_RETRIES; attempt += 1) {
    try {
      const res = await fetch(cdnUrl, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(ciphertext),
      });
      if (isDev) {
        console.error(`>>> CDN UPLOAD ${cdnUrl} bytes=${ciphertext.length}`);
        console.error(`<<< STATUS ${res.status}`);
        for (const [k, v] of res.headers) {
          if (k.toLowerCase() === "x-error-message" || k.toLowerCase().startsWith("x-")) {
            console.error(`<<< HDR ${k}: ${v}`);
          }
        }
      }
      if (res.status >= 400 && res.status < 500) {
        const errMsg = res.headers.get("x-error-message") ?? (await res.text());
        throw new Error(`CDN upload client error ${res.status}: ${errMsg}`);
      }
      if (res.status !== 200) {
        const errMsg = res.headers.get("x-error-message") ?? `status ${res.status}`;
        throw new Error(`CDN upload server error: ${errMsg}`);
      }
      downloadParam = res.headers.get("x-encrypted-param") ?? undefined;
      if (!downloadParam) {
        throw new Error("CDN upload response missing x-encrypted-param header");
      }
      break;
    } catch (err) {
      lastError = err;
      if (err instanceof Error && err.message.includes("client error")) throw err;
      if (attempt < UPLOAD_MAX_RETRIES) {
        // continue retry
      }
    }
  }

  if (!downloadParam) {
    throw lastError instanceof Error ? lastError : new Error(`CDN upload failed after ${UPLOAD_MAX_RETRIES} attempts`);
  }
  return { downloadParam };
}

/**
 * Upload a local file to the CDN with AES-128-ECB encryption.
 * Returns the encrypted_query_param + key + sizes needed for sendMessage.
 */
export async function uploadFile(params: {
  api: WechatApiClient;
  filePath: string;
  toUserId: string;
  mediaType: number;
  noNeedThumb?: boolean;
  label?: string;
}): Promise<UploadedFileInfo> {
  const { api, filePath, toUserId, mediaType } = params;
  const label = params.label ?? "uploadFile";
  const noNeedThumb = params.noNeedThumb ?? true;

  const plaintext = await readFile(filePath);
  const rawsize = plaintext.length;
  const rawfilemd5 = md5Hex(plaintext);
  const filesize = aesEcbPaddedSize(rawsize);
  const filekey = generateFilekey();
  const aeskey = generateAesKey();

  const uploadUrlResp = await api.getUploadUrl({
    filekey,
    media_type: mediaType,
    to_user_id: toUserId,
    rawsize,
    rawfilemd5,
    filesize,
    no_need_thumb: noNeedThumb,
    aeskey: aeskey.toString("hex"),
  });

  const uploadFullUrl = uploadUrlResp.upload_full_url?.trim();
  const uploadParam = uploadUrlResp.upload_param;
  if (!uploadFullUrl && !uploadParam) {
    throw new Error(`${label}: getUploadUrl returned no upload URL`);
  }

  const { downloadParam } = await uploadBufferToCdn({
    cdnBaseUrl: api.cdnBaseUrl,
    buf: plaintext,
    uploadFullUrl,
    uploadParam,
    filekey,
    aeskey,
    label: `${label}[filekey=${filekey}]`,
  });

  return {
    filekey,
    downloadEncryptedQueryParam: downloadParam,
    aeskey: aeskey.toString("hex"),
    fileSize: rawsize,
    fileSizeCiphertext: filesize,
  };
}

export async function uploadImage(api: WechatApiClient, filePath: string, toUserId: string): Promise<UploadedFileInfo> {
  return uploadFile({ api, filePath, toUserId, mediaType: UploadMediaType.IMAGE, label: "uploadImage" });
}

export async function uploadVideo(api: WechatApiClient, filePath: string, toUserId: string): Promise<UploadedFileInfo> {
  return uploadFile({ api, filePath, toUserId, mediaType: UploadMediaType.VIDEO, label: "uploadVideo" });
}

export async function uploadAttachment(
  api: WechatApiClient,
  filePath: string,
  toUserId: string,
): Promise<UploadedFileInfo> {
  return uploadFile({
    api,
    filePath,
    toUserId,
    mediaType: UploadMediaType.FILE,
    label: "uploadAttachment",
  });
}

// ---------------------------------------------------------------------------
// Download pipeline
// ---------------------------------------------------------------------------

/**
 * Download (and decrypt) a CDN media file referenced by encrypt_query_param.
 * Returns the plaintext buffer.
 */
export async function downloadAndDecryptCdn(params: {
  cdnBaseUrl: string;
  encryptedQueryParam: string;
  /** Base64-encoded AES key (CDNMedia.aes_key encoding). */
  aesKeyBase64?: string;
  /** Hex-encoded AES key (ImageItem.aeskey). */
  aesKeyHex?: string;
  fullUrl?: string;
  label?: string;
}): Promise<Buffer> {
  const { cdnBaseUrl, encryptedQueryParam, aesKeyBase64, aesKeyHex, fullUrl, label } = params;

  let key: Buffer;
  if (aesKeyHex) {
    key = aesKeyHexToBuffer(aesKeyHex);
  } else if (aesKeyBase64) {
    key = parseAesKey(aesKeyBase64);
  } else {
    throw new Error(`${label ?? "download"}: neither aesKeyHex nor aesKeyBase64 provided`);
  }

  const url = fullUrl || buildCdnDownloadUrl(cdnBaseUrl, encryptedQueryParam);
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`${label ?? "download"}: CDN ${res.status} ${res.statusText} body=${body}`);
  }
  const ciphertext = Buffer.from(await res.arrayBuffer());
  return decryptAesEcb(ciphertext, key);
}

// ---------------------------------------------------------------------------
// Save inbound media to local disk
// ---------------------------------------------------------------------------

export async function saveInboundMedia(params: {
  destDir: string;
  filename: string;
  buf: Buffer;
}): Promise<string> {
  await mkdir(params.destDir, { recursive: true });
  const filePath = join(params.destDir, params.filename);
  await writeFile(filePath, params.buf);
  return filePath;
}

// ---------------------------------------------------------------------------
// Helpers used by send side
// ---------------------------------------------------------------------------

export { aesKeyHexToBase64 };
