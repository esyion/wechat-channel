"use strict";
/**
 * WeChat ilink protocol types.
 * Mirrors the JSON shapes used by ilinkai.weixin.qq.com.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TypingStatus = exports.MessageItemType = exports.MessageState = exports.MessageType = exports.UploadMediaType = void 0;
exports.UploadMediaType = {
    IMAGE: 1,
    VIDEO: 2,
    FILE: 3,
    VOICE: 4,
};
exports.MessageType = {
    USER: 1,
    BOT: 2,
};
exports.MessageState = {
    NEW: 0,
    GENERATING: 1,
    FINISH: 2,
};
exports.MessageItemType = {
    TEXT: 1,
    IMAGE: 2,
    VOICE: 3,
    FILE: 4,
    VIDEO: 5,
};
exports.TypingStatus = {
    TYPING: 1,
    CANCEL: 2,
};
//# sourceMappingURL=types.js.map