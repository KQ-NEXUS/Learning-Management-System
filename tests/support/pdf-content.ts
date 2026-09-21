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

    // Do NOT trim trailing CR/LF: the last byte of a Flate stream can legitimately be
    // 0x0a or 0x0d, and inflate stops at the end-of-stream marker so the EOL before
    // `endstream` is harmless. (Trimming corrupted the ToUnicode map of full-font PDFs.)
    const raw = buffer.subarray(start, endIndex);

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

/**
 * Builds a glyph-id -> string map from every ToUnicode CMap in the document
 * (`beginbfchar` pairs and `beginbfrange` ranges). Embedded (fontkit) fonts
 * write 2-byte glyph ids, not character codes, so the CMap is the only way to
 * recover the drawn text. Returns null when the document has no CMap (the
 * standard-14 Helvetica embedding, whose hex is plain Latin-1 codes).
 */
function readToUnicodeMap(streams: string[]): Map<number, string> | null {
  const map = new Map<number, string>();
  let found = false;
  const utf16BeHexToString = (hex: string): string => {
    let out = "";
    for (let i = 0; i + 4 <= hex.length; i += 4) {
      out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16));
    }
    return out;
  };

  for (const stream of streams) {
    if (!stream.includes("begincmap")) continue;
    found = true;

    for (const section of stream.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const pair of section[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        map.set(Number.parseInt(pair[1], 16), utf16BeHexToString(pair[2]));
      }
    }

    for (const section of stream.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const range of section[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[^\]]*\])/g)) {
        const low = Number.parseInt(range[1], 16);
        const high = Number.parseInt(range[2], 16);
        const target = range[3];
        if (target.startsWith("[")) {
          const items = [...target.matchAll(/<([0-9A-Fa-f]+)>/g)];
          for (let id = low; id <= high; id++) {
            const item = items[id - low];
            if (item) map.set(id, utf16BeHexToString(item[1]));
          }
        } else {
          const base = Number.parseInt(target.slice(1, -1), 16);
          for (let id = low; id <= high; id++) map.set(id, String.fromCharCode(base + (id - low)));
        }
      }
    }
  }

  return found ? map : null;
}

function decodeShownHex(hex: string, toUnicode: Map<number, string> | null): string {
  if (toUnicode === null) return hexToLatin1(hex);
  let text = "";
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    text += toUnicode.get(Number.parseInt(hex.slice(i, i + 4), 16)) ?? "�";
  }
  return text;
}

/** All text shown in the document, in drawing order, concatenated. */
export function extractPdfText(bytes: Uint8Array): string {
  return readTextPlacements(bytes)
    .map((placement) => placement.text)
    .join("");
}

export function readTextPlacements(bytes: Uint8Array): TextPlacement[] {
  const placements: TextPlacement[] = [];
  const blockPattern = /BT([\s\S]*?)ET/g;
  const sizePattern = new RegExp(`/\\S+\\s+${NUM}\\s+Tf`);
  const originPattern = new RegExp(`1\\s+0\\s+0\\s+1\\s+${NUM}\\s+${NUM}\\s+Tm`);
  const showPattern = /<([0-9A-Fa-f]*)>\s*Tj/;

  const streams = inflatedContentStreams(bytes);
  const toUnicode = readToUnicodeMap(streams);

  for (const stream of streams) {
    let block: RegExpExecArray | null;
    while ((block = blockPattern.exec(stream)) !== null) {
      const body = block[1];
      const size = sizePattern.exec(body);
      const origin = originPattern.exec(body);
      const show = showPattern.exec(body);
      if (!size || !origin || !show) continue;
      placements.push({
        text: decodeShownHex(show[1], toUnicode),
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
