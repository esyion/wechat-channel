"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createQRLoginHandle = createQRLoginHandle;
// @ts-expect-error qrcode doesn't ship types for this internal sub-path
const SvgRendererNs = __importStar(require("qrcode/lib/renderer/svg.js"));
const SvgRenderer = SvgRendererNs;
const qrcode_1 = require("qrcode");
function createQRLoginHandle(opts) {
    return {
        matrix: opts.matrix,
        toTerminal(o) {
            const margin = o?.margin ?? 2;
            const invert = o?.invert ?? false;
            const dark = invert ? " " : "█";
            const light = invert ? "█" : " ";
            const lines = [];
            for (let i = 0; i < margin; i++)
                lines.push(light.repeat(opts.matrix[0].length + margin * 2));
            for (const row of opts.matrix) {
                const line = row.map((cell) => (cell ? dark : light)).join("");
                lines.push(light.repeat(margin) + line + light.repeat(margin));
            }
            for (let i = 0; i < margin; i++)
                lines.push(light.repeat(opts.matrix[0].length + margin * 2));
            return lines.join("\n");
        },
        async toPng(o) {
            return (0, qrcode_1.toBuffer)(matrixToString(opts.matrix), {
                type: "png",
                width: o?.size ?? 300,
                margin: o?.margin ?? 2,
                errorCorrectionLevel: "M",
            });
        },
        toSvg(o) {
            const margin = o?.margin ?? 2;
            const size = opts.matrix.length;
            const totalSize = size + margin * 2;
            // Build a minimal qrData object that SvgRenderer expects
            const qrData = {
                modules: {
                    size,
                    data: matrixToUint8Array(opts.matrix),
                },
            };
            return SvgRenderer.render(qrData, { margin, width: totalSize * 4 });
        },
        async toDataURL(o) {
            return (0, qrcode_1.toDataURL)(matrixToString(opts.matrix), {
                width: o?.size ?? 300,
                margin: o?.margin ?? 2,
                errorCorrectionLevel: "M",
            });
        },
        waitForLogin: opts.waitForLogin,
    };
}
/** Flatten a 2D QR matrix into the canonical string format the `qrcode` package expects. */
function matrixToString(matrix) {
    return matrix.map((row) => row.map((cell) => (cell ? "1" : "0")).join("")).join("\n");
}
/** Convert a 2D boolean matrix to a Uint8Array for qrcode internals. */
function matrixToUint8Array(matrix) {
    const size = matrix.length;
    const data = new Uint8Array(size * size);
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            data[r * size + c] = matrix[r][c] ? 1 : 0;
        }
    }
    return data;
}
//# sourceMappingURL=login.js.map