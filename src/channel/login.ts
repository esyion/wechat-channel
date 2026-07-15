// @ts-expect-error qrcode doesn't ship types for this internal sub-path
import * as SvgRendererNs from "qrcode/lib/renderer/svg.js";
const SvgRenderer = SvgRendererNs as unknown as {
  render: (data: unknown, opts: { margin: number; width: number }) => string;
};

import { toBuffer as qrToBuffer, toDataURL as qrToDataURL, toString as qrToString } from "qrcode";
import { Buffer } from "node:buffer";

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
  /**
   * Original payload from the ilink service.
   *   - `https://liteapp.weixin.qq.com/q/...?qrcode=...` (or any http(s)/weixin URL):
   *     the text we re-encode into our own PNG / SVG / data URL outputs, so
   *     the rendered QR points at the same destination the user would scan
   *     from the ilink-provided image.
   *   - `data:image/png;base64,...`: a baked PNG; we pass the bytes through
   *     `toPng` / `toDataURL` (so what the user scans is exactly what the
   *     server gave us — guaranteed scan-correct).
   *
   * When `qrcodeImgContent` is omitted we fall back to re-encoding the
   * boolean matrix. That fallback is only valid for ASCII/matrix printing —
   * do NOT rely on it if the QR must be scannable.
   */
  qrcodeImgContent?: string;
  waitForLogin: (opts?: WaitForLoginOpts) => Promise<LoginResult>;
}

interface ParsedImgContent {
  bakedPng: Buffer | null;
  text: string | null;
}

function parseImgContent(content: string | undefined): ParsedImgContent {
  if (!content) return { bakedPng: null, text: null };
  const dataMatch = content.match(/^data:image\/png;base64,(.+)$/);
  if (dataMatch) {
    return { bakedPng: Buffer.from(dataMatch[1]!, "base64"), text: null };
  }
  return { bakedPng: null, text: content };
}

export function createQRLoginHandle(opts: CreateQRLoginOpts): QRLoginHandle {
  const parsed = parseImgContent(opts.qrcodeImgContent);
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
      if (parsed.bakedPng && !o?.size && !o?.margin) {
        return parsed.bakedPng;
      }
      const text = parsed.text;
      if (text) {
        return qrToBuffer(text, {
          type: "png",
          width: o?.size ?? 300,
          margin: o?.margin ?? 2,
          errorCorrectionLevel: "M",
        });
      }
      return qrToBuffer(matrixToString(opts.matrix), {
        type: "png",
        width: o?.size ?? 300,
        margin: o?.margin ?? 2,
        errorCorrectionLevel: "M",
      });
    },
    toSvg(o?: QrSvgOpts): string {
      const margin = o?.margin ?? 2;
      if (parsed.bakedPng) {
        return bakedPngToSvg(parsed.bakedPng, margin);
      }
      const text = parsed.text;
      if (text) {
        const out: unknown = qrToString(text, {
          type: "svg",
          margin,
          errorCorrectionLevel: "M",
        });
        if (typeof out === "string") return out;
      }
      const size = opts.matrix.length;
      const totalSize = size + margin * 2;
      const qrData = {
        modules: { size, data: matrixToUint8Array(opts.matrix) },
      };
      return SvgRenderer.render(qrData, { margin, width: totalSize * 4 });
    },
    async toDataURL(o?: QrPngOpts): Promise<string> {
      if (parsed.bakedPng && !o?.size && !o?.margin) {
        return `data:image/png;base64,${parsed.bakedPng.toString("base64")}`;
      }
      const text = parsed.text;
      if (text) {
        return qrToDataURL(text, {
          width: o?.size ?? 300,
          margin: o?.margin ?? 2,
          errorCorrectionLevel: "M",
        });
      }
      return qrToDataURL(matrixToString(opts.matrix), {
        width: o?.size ?? 300,
        margin: o?.margin ?? 2,
        errorCorrectionLevel: "M",
      });
    },
    waitForLogin: opts.waitForLogin,
  };
}

function bakedPngToSvg(png: Buffer, _margin: number): string {
  const b64 = png.toString("base64");
  const side = 600;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}">`,
    `<image href="data:image/png;base64,${b64}" x="0" y="0" width="${side}" height="${side}" preserveAspectRatio="xMidYMid meet"/>`,
    `</svg>`,
  ].join("\n");
}

function matrixToString(matrix: boolean[][]): string {
  return matrix.map((row) => row.map((cell) => (cell ? "1" : "0")).join("")).join("\n");
}

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
