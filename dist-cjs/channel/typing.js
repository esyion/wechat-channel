"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TypingKeepalive = void 0;
class TypingKeepalive {
    opts;
    ticket = null;
    timer = null;
    stopped = false;
    intervalMs;
    constructor(opts) {
        this.opts = opts;
        this.intervalMs = opts.intervalMs ?? 5000;
    }
    async start() {
        if (this.stopped)
            return;
        try {
            const cfg = await this.opts.api.getConfig({
                ilinkUserId: this.opts.userId,
                contextToken: this.opts.contextToken,
            });
            this.ticket = cfg.typing_ticket ?? null;
            if (!this.ticket)
                return;
            await this.fire(1);
            this.timer = setInterval(() => void this.tick(), this.intervalMs);
        }
        catch {
            // best-effort; swallow
        }
    }
    stop() {
        if (this.stopped)
            return;
        this.stopped = true;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.ticket) {
            this.fire(2).catch(() => { });
        }
    }
    async fire(status) {
        if (!this.ticket)
            return;
        await this.opts.api.sendTyping({
            ilink_user_id: this.opts.userId,
            typing_ticket: this.ticket,
            status,
        });
    }
    async tick() {
        try {
            await this.fire(1);
        }
        catch {
            this.stop();
        }
    }
}
exports.TypingKeepalive = TypingKeepalive;
//# sourceMappingURL=typing.js.map