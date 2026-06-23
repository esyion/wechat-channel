import type { Response } from "express";
import type { SseEvent } from "../src/shared/types.js";

/**
 * Minimal in-process SSE broadcaster. Each connected client gets a `Response`
 * with headers set; events are written as `data: <json>\n\n` lines.
 *
 * Clients subscribe via `GET /api/events` and receive every SseEvent the
 * manager emits.
 */
export class SseHub {
  private clients = new Set<Response>();

  add(res: Response): void {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    // Initial comment to open the stream immediately
    res.write(": connected\n\n");

    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));

    // Heartbeat every 25s to keep proxies from closing the connection
    const heartbeat = setInterval(() => {
      if (res.writableEnded) return;
      res.write(": heartbeat\n\n");
    }, 25_000);
    res.on("close", () => clearInterval(heartbeat));
  }

  broadcast(event: SseEvent): void {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of this.clients) {
      if (res.writableEnded) {
        this.clients.delete(res);
        continue;
      }
      res.write(payload);
    }
  }

  size(): number {
    return this.clients.size;
  }
}
