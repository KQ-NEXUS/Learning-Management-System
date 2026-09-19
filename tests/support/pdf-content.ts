import { Buffer } from "node:buffer";
import zlib from "node:zlib";

/**
 * Content-stream readers for pdf-lib-produced PDFs.
 *
 * The certificate renderer tests must assert WHERE things are drawn, not only
 * that they are present. pdf-lib exposes no read API, so these helpers inflate
 * every Flate content stream and parse the operators pdf-lib emits:
 *
 *   drawText  -> BT, `/Font <size> Tf`, `24 TL`, `1 0 0 1 <x> <y> Tm`, `<HEX> Tj`, T*, ET
 *   drawImage -> q, `1 0 0 1 <x> <y> cm`, `1 0 0 1 0 0 cm`, `<w> 0 0 <h> 0 0 cm`, ..., `/Image Do`, Q
 *
 * Coordinates are in PDF space: origin bottom-left, y increasing upward.
 */

export type TextPlacement = { text: string; x: number; y: number; size: number };
export type ImagePlacement = { x: number; y: number; width: number; height: number };

const NUM = "([-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?)";

function inflatedContentStreams(bytes: Uint8Array): string[] {
  const buffer = Buffer.from(bytes);
  const latin1 = buffer.toString("latin1");
  const streams: string[] = [];
  let searchFrom = 0;

  for (;;) {
    const streamIndex = latin1.indexOf("stream", searchFrom);
    if (streamIndex === -1) break;

    let start = streamIndex + "stream".length;
    if (latin1[start] === "\r") start++;
    if (latin1[start] === "\n") start++;

    const endIndex = latin1.indexOf("endstream", start);
    if (endIndex === -1) break;

    let raw = buffer.subarray(start, endIndex);
    while (raw.length > 0 && (raw[raw.length - 1] === 0x0a || raw[raw.length - 1] === 0x0d)) {
      raw = raw.subarray(0, raw.length - 1);
    }

    try {
      streams.push(zlib.inflateSync(raw).toString("latin1"));
    } catch {
      // Not a Flate content stream (e.g. raw image data) - nothing to read.
    }

    searchFrom = endIndex + "endstream".length;
  }

  return streams;
}

function hexToLatin1(hex: string): string {
  let text = "";
  for (let i = 0; i < hex.length; i += 2) {
    text += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  return text;
}

export function readTextPlacements(bytes: Uint8Array): TextPlacement[] {
  const placements: TextPlacement[] = [];
  const blockPattern = /BT([\s\S]*?)ET/g;
  const sizePattern = new RegExp(`/\\S+\\s+${NUM}\\s+Tf`);
  const originPattern = new RegExp(`1\\s+0\\s+0\\s+1\\s+${NUM}\\s+${NUM}\\s+Tm`);
  const showPattern = /<([0-9A-Fa-f]*)>\s*Tj/;

  for (const stream of inflatedContentStreams(bytes)) {
    let block: RegExpExecArray | null;
    while ((block = blockPattern.exec(stream)) !== null) {
      const body = block[1];
      const size = sizePattern.exec(body);
      const origin = originPattern.exec(body);
      const show = showPattern.exec(body);
      if (!size || !origin || !show) continue;
      placements.push({
        text: hexToLatin1(show[1]),
        x: Number(origin[1]),
        y: Number(origin[2]),
        size: Number(size[1]),
      });
    }
  }

  return placements;
}

export function readImagePlacements(bytes: Uint8Array): ImagePlacement[] {
  const placements: ImagePlacement[] = [];
  const blockPattern = /\bq\b([\s\S]*?)\bQ\b/g;
  // pdf-lib emits four `cm` operators per image, in order: translate, rotate
  // (identity), scale, skew (identity). Read them positionally.
  const matrixPattern = new RegExp(`${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+cm`, "g");

  for (const stream of inflatedContentStreams(bytes)) {
    let block: RegExpExecArray | null;
    while ((block = blockPattern.exec(stream)) !== null) {
      const body = block[1];
      if (!/\bDo\b/.test(body)) continue;
      const matrices = [...body.matchAll(matrixPattern)];
      if (matrices.length < 3) continue;
      const translate = matrices[0];
      const scale = matrices[2];
      placements.push({
        x: Number(translate[5]),
        y: Number(translate[6]),
        width: Number(scale[1]),
        height: Number(scale[4]),
      });
    }
  }

  return placements;
}
