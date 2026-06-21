import type { WechatApiClient } from "../wechat/api.js";
import type { Reply, ReplyTextOpts } from "./types.js";
import { sendMedia, sendText, type SendCtx } from "./outbound.js";
import { TypingKeepalive } from "./typing.js";

export interface ReplyDeps {
  api: WechatApiClient;
  toUserId: string;
  contextToken: string;
  defaultMaxChars?: number;
}

export function createReply(deps: ReplyDeps): Reply {
  const sendCtx: SendCtx = {
    api: deps.api,
    toUserId: deps.toUserId,
    contextToken: deps.contextToken,
    defaultMaxChars: deps.defaultMaxChars,
  };
  const typing = new TypingKeepalive({
    api: deps.api,
    userId: deps.toUserId,
    contextToken: deps.contextToken,
  });
  let typingStarted = false;

  return {
    async text(content: string, opts?: ReplyTextOpts): Promise<void> {
      await sendText(sendCtx, content, opts);
    },
    async media(filePath: string, caption?: string): Promise<void> {
      await sendMedia(sendCtx, filePath, caption);
    },
    async typing(on: boolean = true): Promise<void> {
      if (on && !typingStarted) {
        await typing.start();
        typingStarted = true;
      } else if (!on && typingStarted) {
        typing.stop();
        typingStarted = false;
      }
    },
  };
}