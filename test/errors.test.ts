import { describe, expect, it } from "vitest";
import { ChannelError, MediaError, WechatApiError } from "../src/errors.js";

describe("errors", () => {
  it("ChannelError carries code", () => {
    const e = new ChannelError("AUTH_REQUIRED", "missing token");
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("AUTH_REQUIRED");
    expect(e.message).toBe("missing token");
  });

  it("WechatApiError carries ret + errcode + errmsg", () => {
    const e = new WechatApiError({ ret: -14, errcode: -14, errmsg: "session expired" });
    expect(e).toBeInstanceOf(Error);
    expect(e.ret).toBe(-14);
    expect(e.errcode).toBe(-14);
    expect(e.errmsg).toBe("session expired");
  });

  it("MediaError carries phase + cause", () => {
    const cause = new Error("boom");
    const e = new MediaError("decrypt", cause);
    expect(e.phase).toBe("decrypt");
    expect(e.cause).toBe(cause);
  });
});
