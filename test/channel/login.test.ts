import { describe, expect, it, vi } from "vitest";
import { createQRLoginHandle } from "../../src/channel/login.js";

describe("QRLoginHandle", () => {
  const matrix = [
    [true, false, true],
    [false, true, false],
    [true, false, true],
  ];

  it("toTerminal renders ASCII", () => {
    const h = createQRLoginHandle({ matrix, waitForLogin: vi.fn() });
    const out = h.toTerminal({ margin: 0 });
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("█");
    expect(out).toContain(" ");
  });

  it("toTerminal invert swaps characters", () => {
    const h = createQRLoginHandle({ matrix, waitForLogin: vi.fn() });
    const normal = h.toTerminal({ margin: 0 });
    const inverted = h.toTerminal({ margin: 0, invert: true });
    expect(inverted).not.toBe(normal);
  });

  it("toPng returns Buffer", async () => {
    const h = createQRLoginHandle({ matrix, waitForLogin: vi.fn() });
    const buf = await h.toPng({ size: 100 });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("toSvg returns string", () => {
    const h = createQRLoginHandle({ matrix, waitForLogin: vi.fn() });
    const svg = h.toSvg({ margin: 1 });
    expect(typeof svg).toBe("string");
    expect(svg).toContain("<svg");
  });

  it("toDataURL returns data URL", async () => {
    const h = createQRLoginHandle({ matrix, waitForLogin: vi.fn() });
    const url = await h.toDataURL({ size: 100 });
    expect(url).toMatch(/^data:image\/png;base64,/);
  });

  it("waitForLogin delegates to injected function", async () => {
    const fn = vi.fn().mockResolvedValue({ botToken: "t", accountId: "a", baseUrl: "b" });
    const h = createQRLoginHandle({ matrix, waitForLogin: fn });
    const r = await h.waitForLogin();
    expect(r.botToken).toBe("t");
  });
});
