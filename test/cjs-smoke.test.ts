import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

describe("CJS entry smoke", () => {
  it("require('@esyion/wechat-channel') exports createChannel", () => {
    const require = createRequire(import.meta.url);
    // Resolve via the package.json#main fallback
    const mod = require("@esyion/wechat-channel") as typeof import("../src/index.js");
    expect(typeof mod.createChannel).toBe("function");
    expect(typeof mod.JsonFileStore).toBe("function");
    expect(typeof mod.MemoryStore).toBe("function");
    expect(typeof mod.ChannelError).toBe("function");
  });
});