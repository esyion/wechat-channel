"use strict";
/**
 * AES-128-ECB + PKCS7 crypto utilities for CDN media.
 *
 * Two aes_key encodings are seen in the wild:
 *   - base64(raw 16 bytes)              → images (ImageItem.aeskey is hex; we convert here)
 *   - base64(hex string of 16 bytes)   → file / voice / video (CDNMedia.aes_key)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptAesEcb = encryptAesEcb;
exports.decryptAesEcb = decryptAesEcb;
exports.aesEcbPaddedSize = aesEcbPaddedSize;
exports.generateAesKey = generateAesKey;
exports.generateFilekey = generateFilekey;
exports.md5Hex = md5Hex;
exports.parseAesKey = parseAesKey;
exports.aesKeyHexToBase64 = aesKeyHexToBase64;
exports.aesKeyHexToBuffer = aesKeyHexToBuffer;
const node_crypto_1 = require("node:crypto");
/** Encrypt buffer with AES-128-ECB (PKCS7 padding is default). */
function encryptAesEcb(plaintext, key) {
    if (key.length !== 16) {
        throw new Error(`AES-128 key must be 16 bytes, got ${key.length}`);
    }
    const cipher = (0, node_crypto_1.createCipheriv)("aes-128-ecb", key, null);
    return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}
/** Decrypt buffer with AES-128-ECB (PKCS7 padding). */
function decryptAesEcb(ciphertext, key) {
    if (key.length !== 16) {
        throw new Error(`AES-128 key must be 16 bytes, got ${key.length}`);
    }
    const decipher = (0, node_crypto_1.createDecipheriv)("aes-128-ecb", key, null);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
/** Compute AES-128-ECB ciphertext size (PKCS7 padding to 16-byte boundary). */
function aesEcbPaddedSize(plaintextSize) {
    return Math.ceil((plaintextSize + 1) / 16) * 16;
}
/** Generate a fresh 16-byte AES key. */
function generateAesKey() {
    return (0, node_crypto_1.randomBytes)(16);
}
/** Generate a 16-byte filekey as hex. */
function generateFilekey() {
    return (0, node_crypto_1.randomBytes)(16).toString("hex");
}
/** MD5 hex (uppercase). */
function md5Hex(buf) {
    return (0, node_crypto_1.createHash)("md5").update(buf).digest("hex").toUpperCase();
}
/**
 * Parse CDNMedia.aes_key into a raw 16-byte AES key.
 * Supports both common encodings:
 *   - base64(raw 16 bytes)
 *   - base64(hex string of 16 bytes)
 */
function parseAesKey(aesKeyBase64) {
    const decoded = Buffer.from(aesKeyBase64, "base64");
    if (decoded.length === 16) {
        return decoded;
    }
    if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
        return Buffer.from(decoded.toString("ascii"), "hex");
    }
    throw new Error(`aes_key must decode to 16 raw bytes or 32-char hex, got ${decoded.length} bytes`);
}
/** Convert hex AES key to base64 string for outbound CDNMedia.aes_key. */
function aesKeyHexToBase64(hexKey) {
    return Buffer.from(hexKey, "hex").toString("base64");
}
/** Convert hex AES key to raw 16-byte Buffer. */
function aesKeyHexToBuffer(hexKey) {
    const buf = Buffer.from(hexKey, "hex");
    if (buf.length !== 16) {
        throw new Error(`Expected 16 bytes from hex key, got ${buf.length}`);
    }
    return buf;
}
//# sourceMappingURL=crypto.js.map