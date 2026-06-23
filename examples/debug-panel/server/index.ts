/**
 * Backend entry — Express + SSE + ChannelManager.
 * Run with `pnpm server` (tsx watch) or `pnpm dev:all` to start both ends.
 */
import cors from "cors";
import express from "express";

import { createApiRouter } from "./routes.js";
import { ChannelManager } from "./channelManager.js";
import { SseHub } from "./sse.js";

const PORT = Number(process.env.PORT ?? process.env.BACKEND_PORT ?? 3001);

const sse = new SseHub();
const manager = new ChannelManager(sse);

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, sseClients: sse.size() }));
app.use("/api", createApiRouter(manager, sse));

// Centralized error handler — last middleware
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[server] unhandled error:", err);
  res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
});

const server = app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] SSE stream: GET /api/events`);
  console.log(`[server] status: GET  /api/status`);
});

// Graceful shutdown — close SSE clients, then exit
const shutdown = (signal: string) => {
  console.log(`[server] received ${signal}, shutting down...`);
  void manager.stopChannel().finally(() => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
