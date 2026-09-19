import { Buffer } from "node:buffer";
import zlib from "node:zlib";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderCertificatePdf, type CertificateRenderFields } from "@/server/services/certificate-pdf-renderer";
import type { CertificateElementV1, CertificateTemplateLayoutV1 } from "@/server/services/certificate-template-layout";
import { readImagePlacements, readTextPlacements } from "./support/pdf-content";

// UAT test 11: the PDF was vertically mirrored relative to the editor and
// images were stretched. These tests read positions back OUT of the produced
// PDF bytes, so "the text is present" can no longer pass for a mirrored layout.

const FIELDS: CertificateRenderFields = {
  learnerName: "Amara Okafor",
  awardTitle: "Certificate in Applied Data Science",
  issuedAt: new Date("2026-03-14T00:00:00.000Z"),
  verificationRef: "CERT-9K2X7QF4",
};

// A4 landscape page height in points (595.28 x 841.89 swapped).
const PAGE_HEIGHT = 595.28;
const TOLERANCE = 0.01;

/** Minimal valid RGBA PNG of the given pixel size, built without any dependency. */
function makePng(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(typeAndData));
    return Buffer.concat([length, typeAndData, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowBytes = 1 + width * 4;
  const scanlines = Buffer.alloc(rowBytes * height); // filter byte 0 + zeroed pixels
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(scanlines)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

const ASSETS: Record<string, Uint8Array> = {
  "assets/square": makePng(1, 1),
  "assets/wide": makePng(2, 1),
  "assets/tall": makePng(1, 2),
};

async function resolveAsset(assetKey: string): Promise<Uint8Array> {
  const bytes = ASSETS[assetKey];
  if (!bytes) throw new Error(`No fixture asset registered for key: ${assetKey}`);
  return bytes;
}

function layoutOf(elements: CertificateElementV1[]): CertificateTemplateLayoutV1 {
  return { schema: 1, pageSize: "A4", orientation: "landscape", elements };
}

function textElement(
  overrides: Partial<Extract<CertificateElementV1, { kind: "text" }>> = {},
): Extract<CertificateElementV1, { kind: "text" }> {
  return {
    kind: "text",
    field: "literal",
    literal: "Sample",
    x: 40,
    y: 40,
    width: 400,
    height: 40,
    fontSize: 20,
    color: "#000000",
    align: "left",
    ...overrides,
  };
}

function imageElement(
  assetKey: string,
  box: { x: number; y: number; width: number; height: number },
): Extract<CertificateElementV1, { kind: "image" }> {
  return { kind: "image", assetKey, ...box };
}

async function render(elements: CertificateElementV1[]): Promise<Uint8Array> {
  return renderCertificatePdf({ layout: layoutOf(elements), fields: FIELDS, resolveAsset });
}

/**
 * The editor lays a line of height 1.25 x fontSize (Tailwind `leading-tight`)
 * with the glyph box centred in it, starting at the top of the element box.
 * The baseline therefore sits this far below the box top.
 */
async function editorBaselineOffset(size: number): Promise<number> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const full = font.heightAtSize(size);
  const ascent = font.heightAtSize(size, { descender: false });
  return (1.25 * size - full) / 2 + ascent;
}

describe("content-stream reader", () => {
  it("reads a text placement back out of a plain pdf-lib document", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([600, 800]);
    page.drawText("Hello", { x: 40, y: 400, size: 18, font });
    const placements = readTextPlacements(await document.save());
    expect(placements).toEqual([{ text: "Hello", x: 40, y: 400, size: 18 }]);
  });

  it("reads an image placement back out of a plain pdf-lib document", async () => {
    const document = await PDFDocument.create();
    const image = await document.embedPng(makePng(1, 1));
    const page = document.addPage([600, 800]);
    page.drawImage(image, { x: 40, y: 100, width: 80, height: 80 });
    const placements = readImagePlacements(await document.save());
    expect(placements).toEqual([{ x: 40, y: 100, width: 80, height: 80 }]);
  });
});

describe("certificate PDF positions (top-origin layout -> PDF space)", () => {
  it("draws text designed near the top near the top, inside its box's vertical extent", async () => {
    const bytes = await render([textElement({ y: 40, height: 40, fontSize: 20 })]);
    const [placement] = readTextPlacements(bytes);
    expect(placement.y).toBeGreaterThan(PAGE_HEIGHT / 2);
    expect(placement.y).toBeGreaterThanOrEqual(PAGE_HEIGHT - 40 - 40);
    expect(placement.y).toBeLessThanOrEqual(PAGE_HEIGHT - 40);
    const offset = await editorBaselineOffset(20);
    expect(Math.abs(placement.y - (PAGE_HEIGHT - 40 - offset))).toBeLessThan(TOLERANCE);
  });

  it("draws text designed near the bottom near the bottom", async () => {
    const bytes = await render([textElement({ y: 500, height: 40, fontSize: 20 })]);
    const [placement] = readTextPlacements(bytes);
    expect(placement.y).toBeLessThan(PAGE_HEIGHT / 2);
    const offset = await editorBaselineOffset(20);
    expect(Math.abs(placement.y - (PAGE_HEIGHT - 500 - offset))).toBeLessThan(TOLERANCE);
  });

  it("preserves top-to-bottom order: ascending designed y gives strictly descending baselines", async () => {
    const bytes = await render([
      textElement({ literal: "first", y: 60 }),
      textElement({ literal: "second", y: 240 }),
      textElement({ literal: "third", y: 420 }),
    ]);
    const placements = readTextPlacements(bytes);
    expect(placements.map((p) => p.text)).toEqual(["first", "second", "third"]);
    expect(placements[0].y).toBeGreaterThan(placements[1].y);
    expect(placements[1].y).toBeGreaterThan(placements[2].y);
  });

  it("draws a square image at the converted bottom edge without changing its size", async () => {
    const bytes = await render([imageElement("assets/square", { x: 40, y: 40, width: 80, height: 80 })]);
    const [placement] = readImagePlacements(bytes);
    expect(placement.x).toBeCloseTo(40, 2);
    expect(placement.y).toBeCloseTo(PAGE_HEIGHT - 40 - 80, 2);
    expect(placement.width).toBeCloseTo(80, 2);
    expect(placement.height).toBeCloseTo(80, 2);
  });

  it("keeps a 2:1 image at ratio 2, centred vertically in its box (never stretched)", async () => {
    const bytes = await render([imageElement("assets/wide", { x: 50, y: 50, width: 100, height: 100 })]);
    const [placement] = readImagePlacements(bytes);
    expect(placement.width).toBeCloseTo(100, 2);
    expect(placement.height).toBeCloseTo(50, 2);
    expect(placement.width / placement.height).toBeCloseTo(2, 2);
    expect(placement.x).toBeCloseTo(50, 2);
    expect(placement.y).toBeCloseTo(PAGE_HEIGHT - (50 + (100 - 50) / 2) - 50, 2);
  });

  it("keeps a 1:2 image at ratio 0.5, centred horizontally in its box", async () => {
    const bytes = await render([imageElement("assets/tall", { x: 50, y: 50, width: 100, height: 100 })]);
    const [placement] = readImagePlacements(bytes);
    expect(placement.width).toBeCloseTo(50, 2);
    expect(placement.height).toBeCloseTo(100, 2);
    expect(placement.x).toBeCloseTo(50 + (100 - 50) / 2, 2);
    expect(placement.y).toBeCloseTo(PAGE_HEIGHT - 50 - 100, 2);
  });

  it("lays out a full certificate with the logo above the title and the reference at the bottom", async () => {
    const bytes = await render([
      { kind: "border", style: "double", color: "#123456", widthPt: 2 },
      imageElement("assets/square", { x: 40, y: 40, width: 80, height: 80 }),
      textElement({ literal: "Certificate of Completion", y: 140, fontSize: 28 }),
      textElement({ field: "learnerName", y: 220, fontSize: 24 }),
      textElement({ field: "awardTitle", y: 280, fontSize: 18 }),
      textElement({ field: "issuedAt", y: 340, fontSize: 14 }),
      textElement({ field: "verificationRef", y: 520, fontSize: 10 }),
    ]);
    const images = readImagePlacements(bytes);
    const texts = readTextPlacements(bytes);
    expect(images).toHaveLength(1);
    expect(texts).toHaveLength(5);

    const imageBottomEdge = images[0].y;
    for (const text of texts) {
      expect(imageBottomEdge).toBeGreaterThan(text.y);
    }

    const title = texts.find((t) => t.text === "Certificate of Completion");
    const reference = texts.find((t) => t.text === FIELDS.verificationRef);
    expect(title).toBeDefined();
    expect(reference).toBeDefined();
    expect(reference!.y).toBeLessThan(title!.y);
  });

  it("does not throw and draws no visible image for an image box of zero width (T-11-77)", async () => {
    const bytes = await render([imageElement("assets/square", { x: 40, y: 40, width: 0, height: 80 })]);
    // Nothing visible: either no placement at all (post-fix) or a zero-area one (pre-fix).
    for (const placement of readImagePlacements(bytes)) {
      expect(placement.width * placement.height).toBe(0);
    }
  });
});
