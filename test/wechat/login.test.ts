/**
 * Unit tests for wechat/login.ts helpers.
 */

import { describe, it, expect } from "vitest";
import { toBuffer } from "qrcode";
import { decodeQrMatrix } from "../../src/wechat/login.js";

describe("decodeQrMatrix", () => {
  it("decodes a QR code PNG to a non-empty boolean matrix", async () => {
    const TEST_URL = "https://example.com";
    const buf = await toBuffer(TEST_URL, { type: "png" });
    const matrix = await decodeQrMatrix(`data:image/png;base64,${buf.toString("base64")}`);

    // Matrix must be non-empty
    expect(matrix.length).toBeGreaterThan(0);
    expect(matrix[0]!.length).toBeGreaterThan(0);

    // Must be square (QR codes are square)
    expect(matrix.length).toBe(matrix[0]!.length);

    // All rows must have the same length
    for (const row of matrix) {
      expect(row.length).toBe(matrix[0]!.length);
    }

    // Must contain at least some dark and some light modules
    // (a real QR code is not all-white and not all-black)
    const flat = matrix.flat();
    const darkCount = flat.filter(Boolean).length;
    expect(darkCount).toBeGreaterThan(0);
    expect(darkCount).toBeLessThan(flat.length);
  });

  it("treats a plain URL as text input and encodes it as QR", async () => {
    const matrix = await decodeQrMatrix("https://example.com/login?qrcode=abc123&bot_type=3");
    expect(matrix.length).toBeGreaterThan(0);
    expect(matrix[0]!.length).toBeGreaterThan(0);
    expect(matrix.length).toBe(matrix[0]!.length);
    // Should contain both dark and light modules
    const flat = matrix.flat();
    expect(flat.filter(Boolean).length).toBeGreaterThan(0);
    expect(flat.filter(Boolean).length).toBeLessThan(flat.length);
  });

  it("throws for a non-QR PNG", async () => {
    // A solid 10x10 black PNG — not a valid QR code
    const solidBlackPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFklEQVQYV2P8////fwYGDgYGABH1AQXZkRWPAAAAAElFTkSuQmCC",
      "base64",
    );
    await expect(
      decodeQrMatrix(`data:image/png;base64,${solidBlackPng.toString("base64")}`),
    ).rejects.toThrow();
  });
});