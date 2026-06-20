/**
 * Smoke test: verify crypto roundtrip + media directive parsing.
 * Run with: npx tsx test/smoke.ts
 */

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
} from "../src/wechat/crypto.js";
import { parseMediaDirectives } from "../src/bot/send.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

// 1. AES roundtrip
{
  const key = generateAesKey();
  const plaintext = Buffer.from("Hello, WeChat! 你好,微信! This is a longer test message.");
  const ciphertext = encryptAesEcb(plaintext, key);
  const decrypted = decryptAesEcb(ciphertext, key);
  assert(decrypted.equals(plaintext), "AES-128-ECB roundtrip");
  assert(ciphertext.length === aesEcbPaddedSize(plaintext.length), `padded size = ${aesEcbPaddedSize(plaintext.length)}, got ${ciphertext.length}`);
}

// 2. Filekey + hex → base64 roundtrip
{
  const filekey = generateFilekey();
  assert(filekey.length === 32, "filekey is 32 hex chars");
  const keyBuf = generateAesKey();
  const hex = keyBuf.toString("hex");
  const b64 = aesKeyHexToBase64(hex);
  const back = aesKeyHexToBuffer(hex);
  assert(back.equals(keyBuf), "hex → Buffer roundtrip");
  assert(parseAesKey(b64).equals(keyBuf), "base64-encoded raw bytes parse");
}

// 3. MD5 hex uppercase
{
  const md5 = md5Hex(Buffer.from("test"));
  assert(md5 === "098F6BCD4621D373CADE4E832627B4F6", `MD5 uppercase: got ${md5}`);
}

// 4. Media directive parsing
{
  const sample = `Here is the file you asked for:

Some text here
MEDIA:/tmp/photo.png

Done.`;

  const parsed = parseMediaDirectives(sample);
  assert(parsed.mediaFiles.length === 1, "1 MEDIA: directive found");
  assert(parsed.mediaFiles[0] === "/tmp/photo.png", "MEDIA: path parsed");
  assert(!parsed.text.includes("MEDIA:"), "MEDIA: stripped from text");
  assert(parsed.text.includes("Some text here"), "other text preserved");
}

// 5. Multiple media files
{
  const sample = `MEDIA:/tmp/a.png
Some inline text
MEDIA:/tmp/b.pdf
More text
MEDIA:/tmp/c.mp4`;
  const parsed = parseMediaDirectives(sample);
  assert(parsed.mediaFiles.length === 3, `3 MEDIA: directives found (got ${parsed.mediaFiles.length})`);
  assert(parsed.mediaFiles.join(",") === "/tmp/a.png,/tmp/b.pdf,/tmp/c.mp4", "all paths captured");
}

// 6. No media
{
  const sample = "Just a plain text reply, no media.";
  const parsed = parseMediaDirectives(sample);
  assert(parsed.mediaFiles.length === 0, "no media in plain text");
  assert(parsed.text === sample, "text unchanged");
}

// 7. AES padded size math
{
  assert(aesEcbPaddedSize(0) === 16, "0 → 16");
  assert(aesEcbPaddedSize(1) === 16, "1 → 16");
  assert(aesEcbPaddedSize(16) === 32, "16 → 32");
  assert(aesEcbPaddedSize(17) === 32, "17 → 32");
  assert(aesEcbPaddedSize(32) === 48, "32 → 48");
}

console.log("\n✓ All smoke tests passed");
