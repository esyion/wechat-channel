import { ChannelError } from "../errors.js";

const SAFE_BOT_ID = /^[A-Za-z0-9_-]+$/;

/**
 * 校验 botId 可安全用作目录名。botId 由调用方自由传入，直接拼进 stateDir
 * 路径，故必须挡住路径穿越（`../`、`/`）等。合法返回原串，非法抛错。
 */
export function sanitizeBotId(botId: string): string {
  if (!SAFE_BOT_ID.test(botId)) {
    throw new ChannelError(
      "INVALID_BOT_ID",
      `botId must match [A-Za-z0-9_-]+, got: ${JSON.stringify(botId)}`,
    );
  }
  return botId;
}
