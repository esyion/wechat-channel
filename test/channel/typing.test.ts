import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TypingKeepalive } from "../../src/channel/typing.js";

describe("TypingKeepalive", () => {
  let api: any;
  beforeEach(() => {
    vi.useFakeTimers();
    api = {
      getConfig: vi.fn().mockResolvedValue({ typing_ticket: "ticket-1" }),
      sendTyping: vi.fn().mockResolvedValue(undefined),
    };
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends status=1 immediately on start", async () => {
    const t = new TypingKeepalive({ api, userId: "u", contextToken: "c", intervalMs: 1000 });
    await t.start();
    expect(api.sendTyping).toHaveBeenCalledWith({
      ilink_user_id: "u",
      typing_ticket: "ticket-1",
      status: 1,
    });
  });

  it("re-sends status=1 every interval", async () => {
    const t = new TypingKeepalive({ api, userId: "u", contextToken: "c", intervalMs: 1000 });
    await t.start();
    api.sendTyping.mockClear();
    await vi.advanceTimersByTimeAsync(3500);
    expect(api.sendTyping.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("stop() sends status=2 once and clears interval", async () => {
    const t = new TypingKeepalive({ api, userId: "u", contextToken: "c", intervalMs: 1000 });
    await t.start();
    api.sendTyping.mockClear();
    t.stop();
    expect(api.sendTyping).toHaveBeenCalledWith({
      ilink_user_id: "u",
      typing_ticket: "ticket-1",
      status: 2,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.sendTyping.mock.calls.length).toBe(1); // no further calls
  });

  it("stop() without ticket is a no-op", async () => {
    api.getConfig.mockResolvedValue({ typing_ticket: undefined });
    const t = new TypingKeepalive({ api, userId: "u", contextToken: "c" });
    await t.start();
    api.sendTyping.mockClear();
    t.stop();
    expect(api.sendTyping).not.toHaveBeenCalled();
  });
});
