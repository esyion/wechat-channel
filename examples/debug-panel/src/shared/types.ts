/**
 * Wire-format types shared between React frontend and Express backend.
 * Keep this file dependency-free (no imports from @wechat/channel).
 */

export type AppPhase =
  | "idle"
  | "login_pending"
  | "logged_in"
  | "channel_running"
  | "error";

export interface QrPayload {
  /** data:image/png;base64,... — embeddable in <img src> directly. */
  dataURL: string;
  /** Inline SVG string — for HTML rendering. */
  svg: string;
  /** ASCII art for terminal users. */
  terminal: string;
  /** Raw boolean matrix — for custom renderers. */
  matrix: boolean[][];
}

export interface PublicCredentials {
  botToken: string;
  accountId: string;
}

export interface PublicMessage {
  id: string;
  fromUserId: string;
  contextToken: string;
  text: string;
  media: ReadonlyArray<{ path: string; mime: string }>;
  receivedAt: number;
}

export interface AppStatus {
  phase: AppPhase;
  qr: QrPayload | null;
  credentials: PublicCredentials | null;
  channelRunning: boolean;
  messageCount: number;
  error: { message: string; phase?: string } | null;
}

export interface ReplyRequest {
  userId: string;
  contextToken: string;
  text?: string;
  mediaPath?: string;
  caption?: string;
}

export interface TypingRequest {
  userId: string;
  contextToken: string;
  typing: boolean;
}

export type SseEvent =
  | { type: "state"; status: AppStatus }
  | { type: "message"; message: PublicMessage }
  | { type: "error"; message: string; phase?: string }
  | { type: "log"; level: "info" | "warn" | "error"; message: string };

/** Result from `POST /api/upload` — the server-side absolute path the channel
 *  library will read when calling `reply.media(path)`. */
export interface UploadResponse {
  path: string;
  mime: string;
  name: string;
  size: number;
}

/** Browser-side pending upload, kept in component state before send. */
export interface PendingMedia {
  /** data: URL for instant image preview, or null for non-image. */
  localPreview: string | null;
  /** MIME guessed from File.type */
  mime: string;
  /** Original filename */
  name: string;
  /** File size in bytes */
  size: number;
  /** Server-side path returned from /api/upload */
  serverPath: string | null;
}
