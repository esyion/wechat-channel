"use strict";
/**
 * CDN upload / download + AES-128-ECB encryption.
 * All file paths use Node fs/promises for non-blocking I/O.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.aesKeyHexToBase64 = void 0;
exports.buildCdnUploadUrl = buildCdnUploadUrl;
exports.buildCdnDownloadUrl = buildCdnDownloadUrl;
exports.getMimeFromFilename = getMimeFromFilename;
exports.uploadBufferToCdn = uploadBufferToCdn;
exports.uploadFile = uploadFile;
exports.uploadImage = uploadImage;
exports.uploadVideo = uploadVideo;
exports.uploadAttachment = uploadAttachment;
exports.downloadAndDecryptCdn = downloadAndDecryptCdn;
exports.saveInboundMedia = saveInboundMedia;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const log_js_1 = require("../log.js");
const crypto_js_1 = require("./crypto.js");
Object.defineProperty(exports, "aesKeyHexToBase64", { enumerable: true, get: function () { return crypto_js_1.aesKeyHexToBase64; } });
const types_js_1 = require("./types.js");
const UPLOAD_MAX_RETRIES = 3;
// ---------------------------------------------------------------------------
// CDN URL builders (client-side fallback when upload_full_url is missing)
// ---------------------------------------------------------------------------
function buildCdnUploadUrl(params) {
    return `${params.cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(params.uploadParam)}&filekey=${encodeURIComponent(params.filekey)}`;
}
function buildCdnDownloadUrl(cdnBaseUrl, encryptedQueryParam) {
    return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`;
}
// ---------------------------------------------------------------------------
// MIME helpers (minimal table — extend as needed)
// ---------------------------------------------------------------------------
const EXT_TO_MIME = {
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
function getMimeFromFilename(filename) {
    const ext = (0, node_path_1.extname)(filename).toLowerCase();
    return EXT_TO_MIME[ext] ?? "application/octet-stream";
}
// ---------------------------------------------------------------------------
// Upload pipeline
// ---------------------------------------------------------------------------
async function uploadBufferToCdn(params) {
    const { buf, uploadFullUrl, uploadParam, filekey, cdnBaseUrl, aeskey } = params;
    const label = params.label ?? "uploadBufferToCdn";
    const ciphertext = (0, crypto_js_1.encryptAesEcb)(buf, aeskey);
    const trimmed = uploadFullUrl?.trim();
    let cdnUrl;
    if (trimmed) {
        cdnUrl = trimmed;
    }
    else if (uploadParam) {
        cdnUrl = buildCdnUploadUrl({ cdnBaseUrl, uploadParam, filekey });
    }
    else {
        throw new Error(`${label}: CDN upload URL missing (need upload_full_url or upload_param)`);
    }
    let downloadParam;
    let lastError;
    for (let attempt = 1; attempt <= UPLOAD_MAX_RETRIES; attempt += 1) {
        try {
            const res = await fetch(cdnUrl, {
                method: "POST",
                headers: { "Content-Type": "application/octet-stream" },
                body: new Uint8Array(ciphertext),
            });
            if (log_js_1.isDev) {
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
        }
        catch (err) {
            lastError = err;
            if (err instanceof Error && err.message.includes("client error"))
                throw err;
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
async function uploadFile(params) {
    const { api, filePath, toUserId, mediaType } = params;
    const label = params.label ?? "uploadFile";
    const noNeedThumb = params.noNeedThumb ?? true;
    const plaintext = await (0, promises_1.readFile)(filePath);
    const rawsize = plaintext.length;
    const rawfilemd5 = (0, crypto_js_1.md5Hex)(plaintext);
    const filesize = (0, crypto_js_1.aesEcbPaddedSize)(rawsize);
    const filekey = (0, crypto_js_1.generateFilekey)();
    const aeskey = (0, crypto_js_1.generateAesKey)();
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
async function uploadImage(api, filePath, toUserId) {
    return uploadFile({ api, filePath, toUserId, mediaType: types_js_1.UploadMediaType.IMAGE, label: "uploadImage" });
}
async function uploadVideo(api, filePath, toUserId) {
    return uploadFile({ api, filePath, toUserId, mediaType: types_js_1.UploadMediaType.VIDEO, label: "uploadVideo" });
}
async function uploadAttachment(api, filePath, toUserId) {
    return uploadFile({
        api,
        filePath,
        toUserId,
        mediaType: types_js_1.UploadMediaType.FILE,
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
async function downloadAndDecryptCdn(params) {
    const { cdnBaseUrl, encryptedQueryParam, aesKeyBase64, aesKeyHex, fullUrl, label } = params;
    let key;
    if (aesKeyHex) {
        key = (0, crypto_js_1.aesKeyHexToBuffer)(aesKeyHex);
    }
    else if (aesKeyBase64) {
        key = (0, crypto_js_1.parseAesKey)(aesKeyBase64);
    }
    else {
        throw new Error(`${label ?? "download"}: neither aesKeyHex nor aesKeyBase64 provided`);
    }
    const url = fullUrl || buildCdnDownloadUrl(cdnBaseUrl, encryptedQueryParam);
    const res = await fetch(url);
    if (!res.ok) {
        const body = await res.text().catch(() => "(unreadable)");
        throw new Error(`${label ?? "download"}: CDN ${res.status} ${res.statusText} body=${body}`);
    }
    const ciphertext = Buffer.from(await res.arrayBuffer());
    return (0, crypto_js_1.decryptAesEcb)(ciphertext, key);
}
// ---------------------------------------------------------------------------
// Save inbound media to local disk
// ---------------------------------------------------------------------------
async function saveInboundMedia(params) {
    await (0, promises_1.mkdir)(params.destDir, { recursive: true });
    const filePath = (0, node_path_1.join)(params.destDir, params.filename);
    await (0, promises_1.writeFile)(filePath, params.buf);
    return filePath;
}
//# sourceMappingURL=media.js.map