import { describe, expect, it, vi } from "vitest";
import { chunkText, sendText, sendMedia } from "../../src/channel/outbound.js";

describe("chunkText", () => {
  it("returns single chunk if under limit", () => {
    expect(chunkText("hi", 100)).toEqual(["hi"]);
  });

  it("splits on newlines near limit", () => {
    const text = "a\n".repeat(50) + "tail"; // 105 chars
    const chunks = chunkText(text, 20);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toContain("tail");
  });
});

describe("sendText", () => {
  it("calls api.sendMessage once for short text", async () => {
    const api = { sendMessage: vi.fn().mockResolvedValue(undefined) } as any;
    await sendText({ api, toUserId: "u1", contextToken: "ctx" }, "hi");
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    const req = api.sendMessage.mock.calls[0][0];
    expect(req.msg.item_list[0].text_item.text).toBe("hi");
    expect(req.msg.context_token).toBe("ctx");
  });

  it("chunks long text into multiple sends", async () => {
    const api = { sendMessage: vi.fn().mockResolvedValue(undefined) } as any;
    const long = "x".repeat(5000);
    await sendText({ api, toUserId: "u1", contextToken: "ctx" }, long, { maxChars: 100 });
    expect(api.sendMessage.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("sendMedia", () => {
  it("dispatches to uploadImage for image mime", async () => {
    const api = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      getUploadUrl: vi.fn().mockResolvedValue({ upload_url: "u", encrypt_query_param: "q" }),
    } as any;
    const uploadImage = vi.fn().mockResolvedValue({
      aeskey: "00".repeat(16),
      downloadEncryptedQueryParam: "q",
      fileSizeCiphertext: 10,
      fileSize: 10,
    });
    const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "media-"));
    const path = join(dir, "x.png");
    await writeFile(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await sendMedia({ api, toUserId: "u1", contextToken: "ctx", uploadImage }, path);
    expect(uploadImage).toHaveBeenCalled();
    await rm(dir, { recursive: true, force: true });
  });
});
