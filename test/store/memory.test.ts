import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/store/memory.js";

describe("MemoryStore", () => {
  it("returns undefined for missing keys", async () => {
    const s = new MemoryStore();
    expect(await s.get("missing")).toBeUndefined();
  });

  it("round-trips values", async () => {
    const s = new MemoryStore();
    await s.set("k", "v");
    expect(await s.get("k")).toBe("v");
  });

  it("deletes values", async () => {
    const s = new MemoryStore();
    await s.set("k", "v");
    await s.delete("k");
    expect(await s.get("k")).toBeUndefined();
  });

  it("flush resolves without error", async () => {
    const s = new MemoryStore();
    await expect(s.flush()).resolves.toBeUndefined();
  });
});
