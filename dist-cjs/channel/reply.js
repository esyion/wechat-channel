"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createReply = createReply;
const outbound_js_1 = require("./outbound.js");
const typing_js_1 = require("./typing.js");
function createReply(deps) {
    const sendCtx = {
        api: deps.api,
        toUserId: deps.toUserId,
        contextToken: deps.contextToken,
        defaultMaxChars: deps.defaultMaxChars,
    };
    const typing = new typing_js_1.TypingKeepalive({
        api: deps.api,
        userId: deps.toUserId,
        contextToken: deps.contextToken,
    });
    let typingStarted = false;
    return {
        async text(content, opts) {
            await (0, outbound_js_1.sendText)(sendCtx, content, opts);
        },
        async media(filePath, caption) {
            await (0, outbound_js_1.sendMedia)(sendCtx, filePath, caption);
        },
        async typing(on = true) {
            if (on && !typingStarted) {
                await typing.start();
                typingStarted = true;
            }
            else if (!on && typingStarted) {
                typing.stop();
                typingStarted = false;
            }
        },
    };
}
//# sourceMappingURL=reply.js.map