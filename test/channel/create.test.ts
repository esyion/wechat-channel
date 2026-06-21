import { describe, expect, it, vi } from "vitest";
import { createChannel } from "../../src/channel/create.js";
import { MemoryStore } from "../../src/store/memory.js";

describe("createChannel", () => {
  it("returns handle with api/start/stop/loginQR", async () => {
    const ch = await createChannel({
      botToken: "tok",
      accountId: "acc",
      store: new MemoryStore(),
    });
    expect(ch.api).toBeDefined();
    expect(typeof ch.start).toBe("function");
    expect(typeof ch.stop).toBe("function");
    expect(typeof ch.loginQR).toBe("function");
  });

  it("start() calls api.notifyStart and runs long-poll", async () => {
    const ch = await createChannel({
      botToken: "tok",
      accountId: "acc",
      store: new MemoryStore(),
      onMessage: vi.fn(),
    });
    vi.spyOn(ch.api, "notifyStart").mockResolvedValue({ ret: 0 } as any);
    vi.spyOn(ch.api, "getUpdates").mockResolvedValue({ ret: 0, msgs: [] } as any);
    const ac = new AbortController();
    const p = ch.start({ signal: ac.signal });
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    await p.catch(() => {});
    expect(ch.api.notifyStart).toHaveBeenCalled();
  });
});
