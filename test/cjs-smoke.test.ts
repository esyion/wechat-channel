// TODO: This test will pass once Task 15 resolves the pre-existing tsc errors
// that currently prevent `dist-cjs/index.js` from being emitted by `npm run build`.
// At that point, `npm run build && npx vitest run test/cjs-smoke.test.ts` should yield 1 passed.

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

describe("CJS entry smoke", () => {
  it("require('@wechat/channel') exports createChannel", () => {
    const require = createRequire(import.meta.url);
    // Resolve via the package.json#main fallback
    const mod = require("@wechat/channel") as typeof import("../src/index.js");
    expect(typeof mod.createChannel).toBe("function");
    expect(typeof mod.JsonFileStore).toBe("function");
    expect(typeof mod.MemoryStore).toBe("function");
    expect(typeof mod.ChannelError).toBe("function");
  });
});