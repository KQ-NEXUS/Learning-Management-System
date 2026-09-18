import { Buffer } from "node:buffer";
import zlib from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  formatCertificateIssuedDate,
  renderCertificatePdf,
  type CertificateRenderFields,
} from "@/server/services/certificate-pdf-renderer";
import {
  EMPTY_LAYOUT_V1,
  parseCertificateTemplateLayout,
  type CertificateTemplateLayoutV1,
} from "@/server/services/certificate-template-layout";

// A 1x1 transparent PNG — the smallest legal PNG, used to prove image
// elements embed real caller-supplied bytes without needing a real logo
// asset or the object store.
const ONE_PIXEL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nVQAAAAASUVORK5CYII=";
const ONE_PIXEL_PNG_BYTES = new Uint8Array(Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"));

const FIELDS: CertificateRenderFields = {
  learnerName: "Amara Okafor",
  awardTitle: "Certificate in Applied Data Science",
  issuedAt: new Date("2026-03-14T00:00:00.000Z"),
  verificationRef: "CERT-9K2X7QF4",
};

async function resolveKnownAsset(assetKey: string): Promise<Uint8Array> {
  if (assetKey === "certificate-template-assets/tpl/logo") return ONE_PIXEL_PNG_BYTES;
  throw new Error(`No fixture asset registered for key: ${assetKey}`);
}

/**
 * Extracts the text shown by `Tj` operators from a pdf-lib-produced PDF's
 * content streams.
 *
 * pdf-lib always Flate-compresses content streams (no option disables it),
 * and exposes no public text-extraction API, so this reads the produced
 * bytes back directly: find each `stream ... endstream` object, inflate it
 * with the same zlib algorithm PDF's `/FlateDecode` uses, and pull the text
 * out of every `<HEXSTRING> Tj` operator. `pdf-lib`'s standard-font
 * embedder encodes text as WinAnsi-coded hex glyphs, which are byte-for-byte
 * identical to ASCII for the plain Latin characters this test suite uses,
 * so a straight hex-to-char decode recovers the original string.
 */
function extractPdfText(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  const latin1 = buffer.toString("latin1");
  let extracted = "";
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
      const inflated = zlib.inflateSync(raw).toString("latin1");
      const hexShowTextPattern = /<([0-9A-Fa-f]+)>\s*Tj/g;
      let match: RegExpExecArray | null;
      while ((match = hexShowTextPattern.exec(inflated)) !== null) {
        extracted += hexToLatin1(match[1]);
      }
    } catch {
      // Not a Flate-compressed text content stream (e.g. embedded image
      // data) — nothing to extract from this object.
    }

    searchFrom = endIndex + "endstream".length;
  }

  return extracted;
}

function hexToLatin1(hex: string): string {
  let text = "";
  for (let i = 0; i < hex.length; i += 2) {
    text += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  return text;
}

function textOnlyLayout(
  element: Partial<Extract<CertificateTemplateLayoutV1["elements"][number], { kind: "text" }>> & {
    field: "learnerName" | "awardTitle" | "issuedAt" | "verificationRef" | "literal";
  },
): CertificateTemplateLayoutV1 {
  return {
    schema: 1,
    pageSize: "A4",
    orientation: "landscape",
    elements: [
      {
        kind: "text",
        x: 40,
        y: 400,
        width: 400,
        height: 40,
        fontSize: 20,
        color: "#000000",
        align: "left",
        ...element,
      },
    ],
  };
}

// A realistic full-coverage template: landscape A4, a border, one image,
// all four dynamic-field text elements, and one literal text element —
// every element kind and every dynamic field the system supports, in one
// document. Built by passing a raw JSON object through
// `parseCertificateTemplateLayout` so a future layout-schema change that
// breaks this fixture fails here rather than at issuance time. Exported so
// plan 11-16's integration tests reuse this exact layout rather than
// inventing a second one that drifts.
const rawGoldenLayout = {
  schema: 1,
  pageSize: "A4",
  orientation: "landscape",
  elements: [
    { kind: "border", style: "double", color: "#123456", widthPt: 2 },
    {
      kind: "image",
      assetKey: "certificate-template-assets/tpl/logo",
      x: 40,
      y: 460,
      width: 80,
      height: 80,
    },
    {
      kind: "text",
      field: "literal",
      literal: "Certificate of Completion",
      x: 140,
      y: 500,
      width: 500,
      height: 40,
      fontSize: 28,
      color: "#123456",
      align: "left",
    },
    {
      kind: "text",
      field: "learnerName",
      x: 140,
      y: 440,
      width: 500,
      height: 32,
      fontSize: 22,
      color: "#000000",
      align: "left",
    },
    {
      kind: "text",
      field: "awardTitle",
      x: 140,
      y: 400,
      width: 500,
      height: 28,
      fontSize: 18,
      color: "#000000",
      align: "left",
    },
    {
      kind: "text",
      field: "issuedAt",
      x: 140,
      y: 360,
      width: 300,
      height: 24,
      fontSize: 14,
      color: "#000000",
      align: "left",
    },
    {
      kind: "text",
      field: "verificationRef",
      x: 140,
      y: 330,
      width: 300,
      height: 24,
      fontSize: 12,
      color: "#000000",
      align: "left",
    },
  ],
};

export const goldenCertificateLayoutFixture: CertificateTemplateLayoutV1 = parseCertificateTemplateLayout(rawGoldenLayout);

describe("renderCertificatePdf", () => {
  it("substitutes learnerName with the real value, not the field token", async () => {
    const layout = textOnlyLayout({ field: "learnerName" });
    const bytes = await renderCertificatePdf({ layout, fields: FIELDS, resolveAsset: resolveKnownAsset });
    const text = extractPdfText(bytes);

    expect(text).toContain(FIELDS.learnerName);
    expect(text).not.toContain("learnerName");
  });

  it("substitutes awardTitle with the real value, not the field token", async () => {
    const layout = textOnlyLayout({ field: "awardTitle" });
    const bytes = await renderCertificatePdf({ layout, fields: FIELDS, resolveAsset: resolveKnownAsset });
    const text = extractPdfText(bytes);

    expect(text).toContain(FIELDS.awardTitle);
    expect(text).not.toContain("awardTitle");
  });

  it("substitutes issuedAt with the formatted date, not the field token", async () => {
    const layout = textOnlyLayout({ field: "issuedAt" });
    const bytes = await renderCertificatePdf({ layout, fields: FIELDS, resolveAsset: resolveKnownAsset });
    const text = extractPdfText(bytes);

    expect(text).toContain(formatCertificateIssuedDate(FIELDS.issuedAt));
    expect(text).not.toContain("issuedAt");
  });

  it("substitutes verificationRef with the real value, not the field token", async () => {
    const layout = textOnlyLayout({ field: "verificationRef" });
    const bytes = await renderCertificatePdf({ layout, fields: FIELDS, resolveAsset: resolveKnownAsset });
    const text = extractPdfText(bytes);

    expect(text).toContain(FIELDS.verificationRef);
    expect(text).not.toContain("verificationRef");
  });

  it("renders a literal text element's literal string verbatim", async () => {
    const layout = textOnlyLayout({ field: "literal", literal: "Presented for outstanding achievement" });
    const bytes = await renderCertificatePdf({ layout, fields: FIELDS, resolveAsset: resolveKnownAsset });
    const text = extractPdfText(bytes);

    expect(text).toContain("Presented for outstanding achievement");
  });

  it("renders EMPTY_LAYOUT_V1 as a valid single-page PDF with no elements, without throwing", async () => {
    const bytes = await renderCertificatePdf({ layout: EMPTY_LAYOUT_V1, fields: FIELDS, resolveAsset: resolveKnownAsset });

    expect(Buffer.from(bytes.subarray(0, 4)).toString("ascii")).toBe("%PDF");

    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });

  it("produces a PDF whose first four bytes are the %PDF magic header", async () => {
    const bytes = await renderCertificatePdf({ layout: EMPTY_LAYOUT_V1, fields: FIELDS, resolveAsset: resolveKnownAsset });

    expect(Buffer.from(bytes.subarray(0, 4)).toString("ascii")).toBe("%PDF");
  });

  it("swaps page width/height between portrait and landscape for the same page size", async () => {
    const portrait: CertificateTemplateLayoutV1 = { ...EMPTY_LAYOUT_V1, orientation: "portrait" };
    const landscape: CertificateTemplateLayoutV1 = { ...EMPTY_LAYOUT_V1, orientation: "landscape" };

    const portraitBytes = await renderCertificatePdf({ layout: portrait, fields: FIELDS, resolveAsset: resolveKnownAsset });
    const landscapeBytes = await renderCertificatePdf({ layout: landscape, fields: FIELDS, resolveAsset: resolveKnownAsset });

    const portraitPage = (await PDFDocument.load(portraitBytes)).getPage(0).getSize();
    const landscapePage = (await PDFDocument.load(landscapeBytes)).getPage(0).getSize();

    expect(portraitPage.width).toBe(landscapePage.height);
    expect(portraitPage.height).toBe(landscapePage.width);
  });

  it("produces different page dimensions for A4 vs LETTER", async () => {
    const a4: CertificateTemplateLayoutV1 = { ...EMPTY_LAYOUT_V1, pageSize: "A4" };
    const letter: CertificateTemplateLayoutV1 = { ...EMPTY_LAYOUT_V1, pageSize: "LETTER" };

    const a4Bytes = await renderCertificatePdf({ layout: a4, fields: FIELDS, resolveAsset: resolveKnownAsset });
    const letterBytes = await renderCertificatePdf({ layout: letter, fields: FIELDS, resolveAsset: resolveKnownAsset });

    const a4Page = (await PDFDocument.load(a4Bytes)).getPage(0).getSize();
    const letterPage = (await PDFDocument.load(letterBytes)).getPage(0).getSize();

    expect(a4Page).not.toEqual(letterPage);
  });

  it("draws a border, producing a larger PDF than the same layout without it", async () => {
    const withoutBorder: CertificateTemplateLayoutV1 = { ...EMPTY_LAYOUT_V1, elements: [] };
    const withBorder: CertificateTemplateLayoutV1 = {
      ...EMPTY_LAYOUT_V1,
      elements: [{ kind: "border", style: "solid", color: "#123456", widthPt: 3 }],
    };

    const withoutBytes = await renderCertificatePdf({ layout: withoutBorder, fields: FIELDS, resolveAsset: resolveKnownAsset });
    const withBytes = await renderCertificatePdf({ layout: withBorder, fields: FIELDS, resolveAsset: resolveKnownAsset });

    expect(withBytes.length).toBeGreaterThan(withoutBytes.length);
  });

  it("embeds an image whose bytes the resolver supplies", async () => {
    const layout: CertificateTemplateLayoutV1 = {
      ...EMPTY_LAYOUT_V1,
      elements: [
        { kind: "image", assetKey: "certificate-template-assets/tpl/logo", x: 40, y: 40, width: 60, height: 60 },
      ],
    };

    await expect(
      renderCertificatePdf({ layout, fields: FIELDS, resolveAsset: resolveKnownAsset }),
    ).resolves.toBeInstanceOf(Uint8Array);
  });

  it("throws rather than silently dropping an image the resolver cannot resolve", async () => {
    const layout: CertificateTemplateLayoutV1 = {
      ...EMPTY_LAYOUT_V1,
      elements: [
        { kind: "image", assetKey: "certificate-template-assets/tpl/missing", x: 40, y: 40, width: 60, height: 60 },
      ],
    };

    await expect(
      renderCertificatePdf({ layout, fields: FIELDS, resolveAsset: resolveKnownAsset }),
    ).rejects.toThrow();
  });
});

describe("renderCertificatePdf — golden-layout regression fixture", () => {
  it("renders every element kind and every dynamic field with real values, and leaks no field token", async () => {
    const bytes = await renderCertificatePdf({
      layout: goldenCertificateLayoutFixture,
      fields: FIELDS,
      resolveAsset: resolveKnownAsset,
    });
    const text = extractPdfText(bytes);

    expect(text).toContain(FIELDS.learnerName);
    expect(text).toContain(FIELDS.awardTitle);
    expect(text).toContain(formatCertificateIssuedDate(FIELDS.issuedAt));
    expect(text).toContain(FIELDS.verificationRef);
    expect(text).toContain("Certificate of Completion");

    expect(text).not.toContain("learnerName");
    expect(text).not.toContain("awardTitle");
    expect(text).not.toContain("issuedAt");
    expect(text).not.toContain("verificationRef");

    expect(bytes.length).toBeGreaterThan(1024);
    expect(bytes.length).toBeLessThan(5 * 1024 * 1024);
  });
});
