import type { WechatApiClient } from "../wechat/api.js";

export interface TypingOpts {
  api: WechatApiClient;
  userId: string;
  contextToken: string;
  intervalMs?: number;
}

export class TypingKeepalive {
  private ticket: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private readonly intervalMs: number;

  constructor(private readonly opts: TypingOpts) {
    this.intervalMs = opts.intervalMs ?? 5000;
  }

  async start(): Promise<void> {
    if (this.stopped) return;
    try {
      const cfg = await this.opts.api.getConfig({
        ilinkUserId: this.opts.userId,
        contextToken: this.opts.contextToken,
      });
      this.ticket = cfg.typing_ticket ?? null;
      if (!this.ticket) return;
      await this.fire(1);
      this.timer = setInterval(() => void this.tick(), this.intervalMs);
    } catch {
      // best-effort; swallow
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ticket) {
      this.fire(2).catch(() => {});
    }
  }

  private async fire(status: 1 | 2): Promise<void> {
    if (!this.ticket) return;
    await this.opts.api.sendTyping({
      ilink_user_id: this.opts.userId,
      typing_ticket: this.ticket,
      status,
    });
  }

  private async tick(): Promise<void> {
    try {
      await this.fire(1);
    } catch {
      this.stop();
    }
  }
}
