import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonFileStore } from "../../src/store/file.js";

describe("JsonFileStore", () => {
  let dir: string;
  let store: JsonFileStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "json-store-"));
    store = new JsonFileStore(join(dir, "store.json"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists across instances", async () => {
    await store.set("k", "v");
    await store.flush();
    const reopened = new JsonFileStore(join(dir, "store.json"));
    expect(await reopened.get("k")).toBe("v");
  });

  it("survives concurrent sets", async () => {
    await Promise.all([
      store.set("a", "1"),
      store.set("b", "2"),
      store.set("c", "3"),
    ]);
    await store.flush();
    expect(await store.get("a")).toBe("1");
    expect(await store.get("b")).toBe("2");
    expect(await store.get("c")).toBe("3");
  });

  it("deletes keys", async () => {
    await store.set("k", "v");
    await store.delete("k");
    expect(await store.get("k")).toBeUndefined();
  });

  it("creates parent directory if missing", async () => {
    const nested = new JsonFileStore(join(dir, "a", "b", "store.json"));
    await nested.set("k", "v");
    await nested.flush();
    expect(await nested.get("k")).toBe("v");
  });

  it("flush is idempotent", async () => {
    await store.set("k", "v");
    await store.flush();
    await expect(store.flush()).resolves.toBeUndefined();
  });
});
