/**
 * AES-128-ECB + PKCS7 crypto utilities for CDN media.
 *
 * `aes_key` outbound encoding (per `weixin-channel-api.md` §14.3):
 *   For all outbound messages using `media.aes_key` (image / video / file),
 *   the value is `base64(hex_key_string_ascii)`. The receiver does 2-step
 *   decode: base64 → string → hex → raw 16-byte key.
 *
 *   `image_item.aeskey` is sent as the raw hex string (no base64 wrapping).
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** Encrypt buffer with AES-128-ECB (PKCS7 padding is default). */
export function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  if (key.length !== 16) {
    throw new Error(`AES-128 key must be 16 bytes, got ${key.length}`);
  }
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

/** Decrypt buffer with AES-128-ECB (PKCS7 padding). */
export function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  if (key.length !== 16) {
    throw new Error(`AES-128 key must be 16 bytes, got ${key.length}`);
  }
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Compute AES-128-ECB ciphertext size (PKCS7 padding to 16-byte boundary). */
export function aesEcbPaddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}

/** Generate a fresh 16-byte AES key. */
export function generateAesKey(): Buffer {
  return randomBytes(16);
}

/** Generate a 16-byte filekey as hex. */
export function generateFilekey(): string {
  return randomBytes(16).toString("hex");
}

/** MD5 hex (uppercase). */
export function md5Hex(buf: Buffer): string {
  return createHash("md5").update(buf).digest("hex").toUpperCase();
}

/**
 * Parse CDNMedia.aes_key into a raw 16-byte AES key.
 * Supports both common encodings:
 *   - base64(raw 16 bytes)
 *   - base64(hex string of 16 bytes)
 */
export function parseAesKey(aesKeyBase64: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, "base64");
  if (decoded.length === 16) {
    return decoded;
  }
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  throw new Error(
    `aes_key must decode to 16 raw bytes or 32-char hex, got ${decoded.length} bytes`,
  );
}

/**
 * Convert a hex AES key (32-char string, e.g. "00112233...") to the
 * `media.aes_key` field encoding for outbound messages.
 *
 * Stores the HEX STRING's ASCII bytes as base64 — NOT the raw key bytes.
 * The receiver then does base64 decode → hex decode → raw 16-byte key.
 *
 * Example with key `00 11 22 33 44 55 66 77 88 99 aa bb cc dd ee ff`:
 *   hex string:     "00112233445566778899aabbccddeeff"   (32 ASCII chars)
 *   this returns:   "MDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NjZGRlZWZm"  (44 chars)
 *
 * Old buggy behavior was `base64(<raw 16 bytes>)` = "ABEiM0RVZneImaq7zN3u/w=="
 * (24 chars) — produces a key the receiver can't decrypt.
 */
export function aesKeyHexToBase64(hexKey: string): string {
  return Buffer.from(hexKey, "utf8").toString("base64");
}

/** Convert hex AES key to raw 16-byte Buffer. */
export function aesKeyHexToBuffer(hexKey: string): Buffer {
  const buf = Buffer.from(hexKey, "hex");
  if (buf.length !== 16) {
    throw new Error(`Expected 16 bytes from hex key, got ${buf.length}`);
  }
  return buf;
}
