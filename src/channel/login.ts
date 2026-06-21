// eslint-disable-next-line @typescript-eslint/no-require-imports
const SvgRenderer = require("qrcode/lib/renderer/svg.js");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QRCode = require("qrcode/lib/core/qrcode.js");

import { toBuffer as qrToBuffer, toDataURL as qrToDataURL } from "qrcode";

import type {
  LoginResult,
  QRLoginHandle,
  QrPngOpts,
  QrSvgOpts,
  QrTerminalOpts,
  WaitForLoginOpts,
} from "./types.js";

export interface CreateQRLoginOpts {
  matrix: boolean[][];
  waitForLogin: (opts?: WaitForLoginOpts) => Promise<LoginResult>;
}

export function createQRLoginHandle(opts: CreateQRLoginOpts): QRLoginHandle {
  return {
    matrix: opts.matrix,
    toTerminal(o?: QrTerminalOpts): string {
      const margin = o?.margin ?? 2;
      const invert = o?.invert ?? false;
      const dark = invert ? " " : "█";
      const light = invert ? "█" : " ";
      const lines: string[] = [];
      for (let i = 0; i < margin; i++) lines.push(light.repeat(opts.matrix[0]!.length + margin * 2));
      for (const row of opts.matrix) {
        const line = row.map((cell) => (cell ? dark : light)).join("");
        lines.push(light.repeat(margin) + line + light.repeat(margin));
      }
      for (let i = 0; i < margin; i++) lines.push(light.repeat(opts.matrix[0]!.length + margin * 2));
      return lines.join("\n");
    },
    async toPng(o?: QrPngOpts): Promise<Buffer> {
      return qrToBuffer(matrixToString(opts.matrix), {
        type: "png",
        width: o?.size ?? 300,
        margin: o?.margin ?? 2,
        errorCorrectionLevel: "M",
      });
    },
    toSvg(o?: QrSvgOpts): string {
      const margin = o?.margin ?? 2;
      const size = opts.matrix.length;
      const totalSize = size + margin * 2;
      const data: boolean[] = [];
      // Build flat data array row by row (qrcode uses row-major order)
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          // Margin handling: cells in margin zone are "light" (false)
          const inMargin = r < margin || r >= size - margin || c < margin || c >= size - margin;
          data.push(inMargin ? false : !!opts.matrix[r]![c]);
        }
      }
      // Build a minimal qrData object that SvgRenderer expects
      const qrData = {
        modules: {
          size,
          data: matrixToUint8Array(opts.matrix),
        },
      };
      return SvgRenderer.render(qrData, { margin, width: totalSize * 4 });
    },
    async toDataURL(o?: QrPngOpts): Promise<string> {
      return qrToDataURL(matrixToString(opts.matrix), {
        width: o?.size ?? 300,
        margin: o?.margin ?? 2,
        errorCorrectionLevel: "M",
      });
    },
    waitForLogin: opts.waitForLogin,
  };
}

/** Flatten a 2D QR matrix into the canonical string format the `qrcode` package expects. */
function matrixToString(matrix: boolean[][]): string {
  return matrix.map((row) => row.map((cell) => (cell ? "1" : "0")).join("")).join("\n");
}

/** Convert a 2D boolean matrix to a Uint8Array for qrcode internals. */
function matrixToUint8Array(matrix: boolean[][]): Uint8Array {
  const size = matrix.length;
  const data = new Uint8Array(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      data[r * size + c] = matrix[r]![c] ? 1 : 0;
    }
  }
  return data;
}
