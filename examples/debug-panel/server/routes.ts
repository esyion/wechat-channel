import { Router } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";

import type { ChannelManager } from "./channelManager.js";
import type { SseHub } from "./sse.js";

/** Where uploaded files are staged before being passed to channel.reply.media(). */
const UPLOAD_DIR = path.resolve(import.meta.dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      // Sanitize: keep word chars, dots, dashes. Prefix with timestamp + random
      // suffix to avoid collisions while keeping the original name recognizable.
      const safe = file.originalname.replace(/[^\w.\-]+/g, "_").slice(0, 80);
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      cb(null, `${stamp}-${safe}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

/** Routes mount under /api — see server/index.ts. */
export function createApiRouter(manager: ChannelManager, sse: SseHub): Router {
  const r = Router();

  // ─── status ──────────────────────────────────────────────────────────────

  r.get("/status", (_req, res) => {
    res.json(manager.getStatus());
  });

  r.get("/messages", (req, res) => {
    const limit = Number(req.query.limit ?? 50);
    res.json(manager.getRecentMessages(Number.isFinite(limit) ? limit : 50));
  });

  // ─── SSE event stream ────────────────────────────────────────────────────

  r.get("/events", (req, res) => {
    sse.add(res);
    // Push current state immediately so late subscribers don't render stale
    sse.broadcast({ type: "state", status: manager.getStatus() });
    req.on("close", () => {
      /* SseHub handles cleanup via res.on("close") */
    });
  });

  // ─── login ───────────────────────────────────────────────────────────────

  r.post("/login/start", async (_req, res, next) => {
    try {
      const qr = await manager.startLogin();
      res.json(qr);
    } catch (err) {
      next(err);
    }
  });

  r.post("/login/cancel", (_req, res) => {
    manager.cancelLogin();
    res.json({ ok: true });
  });

  // ─── channel control ─────────────────────────────────────────────────────

  r.post("/channel/start", async (_req, res, next) => {
    try {
      await manager.startChannel();
      res.json(manager.getStatus());
    } catch (err) {
      next(err);
    }
  });

  r.post("/channel/stop", async (_req, res, next) => {
    try {
      await manager.stopChannel();
      res.json(manager.getStatus());
    } catch (err) {
      next(err);
    }
  });

  // ─── reply & typing ──────────────────────────────────────────────────────

  r.post("/reply", async (req, res, next) => {
    try {
      const { messageId, text } = req.body ?? {};
      if (typeof messageId !== "string" || typeof text !== "string") {
        return res.status(400).json({ error: "messageId and text are required strings" });
      }
      await manager.replyText(messageId, text);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  r.post("/reply/media", async (req, res, next) => {
    try {
      const { messageId, mediaPath, caption } = req.body ?? {};
      if (typeof messageId !== "string" || typeof mediaPath !== "string") {
        return res.status(400).json({ error: "messageId and mediaPath are required strings" });
      }
      await manager.replyMedia(messageId, mediaPath, caption);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  r.post("/typing", async (req, res, next) => {
    try {
      const { messageId, typing } = req.body ?? {};
      if (typeof messageId !== "string" || typeof typing !== "boolean") {
        return res.status(400).json({ error: "messageId is required string; typing is required boolean" });
      }
      await manager.setTyping(messageId, typing);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // ─── file upload (multipart) ────────────────────────────────────────────

  r.post("/upload", (req, res) => {
    upload.single("file")(req, res, (err: unknown) => {
      if (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = msg.includes("File too large") ? 413 : 400;
        return res.status(status).json({ error: msg });
      }
      const f = req.file;
      if (!f) return res.status(400).json({ error: "no file uploaded under field 'file'" });
      res.json({
        path: f.path,
        mime: f.mimetype,
        name: f.originalname,
        size: f.size,
      });
    });
  });

  // ─── error funnel ────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  r.use((err: unknown, _req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }, _next: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : undefined;
    res.status(code ? 400 : 500).json({ error: message, code });
  });

  return r;
}
