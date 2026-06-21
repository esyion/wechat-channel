import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildInbound } from "../../src/channel/inbound.js";

// Mock the media module so downloadAndDecryptCdn doesn't hit the real network.
vi.mock("../../src/wechat/media.js", () => ({
  downloadAndDecryptCdn: vi.fn().mockResolvedValue(Buffer.from([1, 2, 3])),
}));

describe("buildInbound", () => {
  let mediaTmpDir: string;

  beforeEach(async () => {
    mediaTmpDir = await mkdtemp(join(tmpdir(), "inbound-"));
  });

  afterEach(async () => {
    await rm(mediaTmpDir, { recursive: true, force: true });
  });

  it("returns text-only ChannelMsg for a TEXT item", async () => {
    const cdn = { download: vi.fn() } as any;
    const result = await buildInbound({
      api: cdn,
      mediaTmpDir,
      msg: {
        from_user_id: "u1",
        context_token: "ctx",
        item_list: [{ type: 1 /* TEXT */, text_item: { text: "hi" } }],
      } as any,
    });
    expect(result.text).toBe("hi");
    expect(result.media).toEqual([]);
    expect(result.fromUserId).toBe("u1");
  });

  it("downloads IMAGE items and adds to media[]", async () => {
    const result = await buildInbound({
      api: { cdnBaseUrl: "https://cdn" },
      mediaTmpDir,
      msg: {
        from_user_id: "u1",
        context_token: "ctx",
        item_list: [{
          type: 2 /* IMAGE */,
          image_item: {
            aeskey: "00".repeat(16),
            media: { encrypt_query_param: "x", aes_key: "AAAA", full_url: "https://cdn/x" },
          },
        }],
      } as any,
    });
    expect(result.media).toHaveLength(1);
    expect(result.media[0]?.mime).toBe("image/jpeg");
    expect(result.media[0]?.path.startsWith(mediaTmpDir)).toBe(true);
    await writeFile(result.media[0]!.path, Buffer.from([1, 2, 3])); // pretend
    // file should now exist on disk
  });
});
