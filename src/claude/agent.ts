/**
 * Claude Agent SDK wrapper.
 *
 * Exposes a single function `runClaudeTurn` that:
 *   - Resumes (or starts) a per-user conversation via `resume: sessionId`
 *   - Streams the assistant's text response back via a callback
 *   - Returns the new session_id so the caller can persist it
 *
 * Input prompt is built from the inbound WeChat message + any local media paths.
 * Images are passed as base64 content blocks (vision) when available; non-image
 * media is referenced as a file path that Claude can read via the Read tool.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import type { Config } from "../config.js";

export interface MediaAttachment {
  /** Local path to a file Claude should read. */
  path: string;
  /** MIME type — if image and we want vision, the SDK can ingest via streaming input. */
  mime: string;
}

export interface TurnInput {
  userId: string;
  text: string;
  media: MediaAttachment[];
  /** Existing Claude session ID to resume, or undefined to start fresh. */
  sessionId?: string;
}

export interface TurnOutput {
  /** Final assistant text (concatenated). May be empty on error. */
  finalText: string;
  /** New session ID — persist this for next turn. */
  sessionId: string;
  /** True if the turn completed successfully. */
  ok: boolean;
  /** Error message if !ok. */
  error?: string;
  /** Cost in USD (informational). */
  totalCostUsd?: number;
}

export interface TurnCallbacks {
  /** Called on each streaming text delta (best-effort, may not fire on every backend). */
  onTextChunk?: (delta: string) => void;
  /** Called when an assistant message completes (full text for that message). */
  onAssistantMessage?: (text: string) => void;
  /** Called when a tool is invoked (informational). */
  onToolUse?: (name: string, input: unknown) => void;
}

export interface TurnOptions {
  cfg: Config;
  abortSignal?: AbortSignal;
}

export async function runClaudeTurn(
  input: TurnInput,
  callbacks: TurnCallbacks,
  opts: TurnOptions,
): Promise<TurnOutput> {
  const cfg = opts.cfg;

  // The Claude Agent SDK spawns the `claude` CLI binary under the hood.
  // Custom endpoints / auth tokens are propagated via environment variables
  // (the standard Anthropic SDK convention), which the CLI reads on startup.
  // Set them ONLY when user opted in via config — don't clobber host env.
  if (cfg.claude.baseUrl) {
    process.env.ANTHROPIC_BASE_URL = cfg.claude.baseUrl;
  }
  if (cfg.claude.authToken) {
    process.env.ANTHROPIC_AUTH_TOKEN = cfg.claude.authToken;
  }

  // Build options
  const options: Options = {
    model: cfg.claude.model,
    cwd: cfg.claude.workDir,
    allowedTools: cfg.claude.allowedTools.length > 0 ? cfg.claude.allowedTools : undefined,
    maxTurns: cfg.claude.maxTurns > 0 ? cfg.claude.maxTurns : undefined,
    includePartialMessages: true, // get text deltas
  };

  // Resume previous session if we have one
  const existingSessionId = input.sessionId;
  if (existingSessionId) {
    options.resume = existingSessionId;
  }

  // Build a single string prompt with media references appended.
  // For images: embed as base64 (vision works inline).
  // For non-images: reference the path so Claude can use Read tool.
  const promptText = await buildPromptText(input);

  let finalText = "";
  let sessionId = existingSessionId ?? "";
  let ok = false;
  let errorMsg: string | undefined;
  let totalCostUsd: number | undefined;

  let partialTextBuffer = "";

  try {
    const stream = query({
      prompt: promptText,
      options,
    });

    for await (const message of stream as AsyncIterable<SDKMessage>) {
      const m = message as { session_id?: string; type?: string };
      if (m.session_id) {
        sessionId = m.session_id;
      }
      const type = m.type;

      if (type === "stream_event") {
        const evt = (message as { event?: { type?: string; delta?: { type?: string; text?: string } } }).event;
        if (evt?.type === "content_block_delta" && evt.delta?.type === "text_delta" && evt.delta.text) {
          partialTextBuffer += evt.delta.text;
          callbacks.onTextChunk?.(evt.delta.text);
        }
        continue;
      }

      if (type === "assistant") {
        const msg = (message as { message?: { content?: Array<{ type: string; text?: string; name?: string; input?: unknown }> } }).message;
        const blocks = msg?.content ?? [];
        const text = blocks
          .filter((b) => b.type === "text" && typeof b.text === "string")
          .map((b) => b.text as string)
          .join("");
        const toolUses = blocks.filter((b) => b.type === "tool_use");
        for (const t of toolUses) {
          callbacks.onToolUse?.(t.name ?? "unknown", t.input);
        }
        if (text) {
          // Only seed partialTextBuffer if stream_event deltas haven't already
          // accumulated the same content. Overwriting risks losing streamed
          // deltas if the assistant message arrives out of order.
          if (!partialTextBuffer) {
            partialTextBuffer = text;
          }
          callbacks.onAssistantMessage?.(text);
        }
        continue;
      }

      if (type === "result") {
        const result = message as {
          subtype?: string;
          is_error?: boolean;
          result?: string;
          errors?: string[];
          total_cost_usd?: number;
        };
        totalCostUsd = result.total_cost_usd;
        if (result.subtype === "success" && !result.is_error) {
          ok = true;
          if (typeof result.result === "string" && result.result) {
            finalText = result.result;
          } else {
            finalText = partialTextBuffer;
          }
        } else {
          errorMsg = result.errors?.join("; ") ?? `subtype=${result.subtype ?? "unknown"}`;
          finalText = partialTextBuffer;
        }
        break;
      }
    }
  } catch (err) {
    errorMsg = String(err);
  }

  return {
    finalText: finalText.trim(),
    sessionId,
    ok,
    error: errorMsg,
    totalCostUsd,
  };
}

/**
 * Build the string prompt for Claude.
 * Note: when the SDK supports inline image content blocks via streaming input,
 * this could be enhanced. For now we pass image file paths and rely on Claude's
 * Read tool to view them.
 */
async function buildPromptText(input: TurnInput): Promise<string> {
  const lines: string[] = [];

  const userText = input.text?.trim();
  if (userText) {
    lines.push(userText);
  } else if (input.media.length === 0) {
    lines.push("[empty message]");
  }

  // Append media references
  for (const m of input.media) {
    lines.push(`<media path="${m.path}" mime="${m.mime}"/>`);
    lines.push(`(Use the Read tool on ${m.path} to view this ${m.mime.startsWith("image/") ? "image" : "file"}. ${m.mime.startsWith("image/") ? "It will be rendered for vision." : ""})`);
  }

  // Footer hint about returning files via MEDIA: directive
  if (input.media.length > 0) {
    lines.push("");
    lines.push(`(To send a file back to the user, write it to disk and emit a line: MEDIA:/absolute/path)`);
  }

  return lines.join("\n");
}
