import { Buffer } from "node:buffer";
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
import { extractPdfText } from "./support/pdf-content";

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

// CR-02: the renderer embeds only PNG and JPEG. Any other bytes (WebP, GIF,
// corrupt, empty) must be skipped so one bad logo cannot block issuance, while
// a resolver FETCH failure stays a retryable, propagated error.
const TWO_PIXEL_JPEG_BASE64 =
  "/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAACAAIDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAABf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAEBv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ABwVQ//Z";
const JPEG_BYTES = new Uint8Array(Buffer.from(TWO_PIXEL_JPEG_BASE64, "base64"));

const WEBP_BYTES = new Uint8Array([
  ...Buffer.from("RIFF", "latin1"),
  0x1a, 0x00, 0x00, 0x00,
  ...Buffer.from("WEBPVP8L", "latin1"),
  0x0d, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
const GIF_BYTES = new Uint8Array([
  ...Buffer.from("GIF89a", "latin1"),
  0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff,
  0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
]);
// Correct 8-byte PNG signature, garbage body.
const CORRUPT_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad, 0xbe, 0xef, 0x00, 0x01, 0x02,
]);
// Correct SOI marker, garbage body.
const CORRUPT_JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xde, 0xad, 0xbe, 0xef]);
const EMPTY_BYTES = new Uint8Array(0);

const LOGO_KEY = "certificate-template-assets/tpl/logo";

function textPlusImageLayout(): CertificateTemplateLayoutV1 {
  const base = textOnlyLayout({ field: "literal", literal: "Sentinel Text" });
  return {
    ...base,
    elements: [
      ...base.elements,
      { kind: "image", assetKey: LOGO_KEY, x: 40, y: 40, width: 60, height: 60 },
    ],
  };
}

/** Counts image XObjects in a produced PDF (object streams are parsed, not grepped). */
async function countImageXObjects(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  let count = 0;
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    const dict = (object as { dict?: { toString(): string } }).dict;
    if (dict && /\/Subtype\s*\/Image/.test(dict.toString())) count++;
  }
  return count;
}

describe("renderCertificatePdf — undecodable image bytes are skipped (CR-02)", () => {
  const skipCases: Array<[string, Uint8Array]> = [
    ["WebP", WEBP_BYTES],
    ["GIF", GIF_BYTES],
    ["corrupt PNG (valid signature)", CORRUPT_PNG_BYTES],
    ["corrupt JPEG (valid SOI)", CORRUPT_JPEG_BYTES],
    ["empty bytes", EMPTY_BYTES],
  ];

  it.each(skipCases)("renders the rest of the certificate when the image is %s", async (_label, imageBytes) => {
    const bytes = await renderCertificatePdf({
      layout: textPlusImageLayout(),
      fields: FIELDS,
      resolveAsset: async () => imageBytes,
    });

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(extractPdfText(bytes)).toContain("Sentinel Text");
    expect(await countImageXObjects(bytes)).toBe(0);
  });

  it("still embeds a valid PNG", async () => {
    const bytes = await renderCertificatePdf({
      layout: textPlusImageLayout(),
      fields: FIELDS,
      resolveAsset: async () => ONE_PIXEL_PNG_BYTES,
    });
    expect(await countImageXObjects(bytes)).toBe(1);
  });

  it("still embeds a valid JPEG", async () => {
    const bytes = await renderCertificatePdf({
      layout: textPlusImageLayout(),
      fields: FIELDS,
      resolveAsset: async () => JPEG_BYTES,
    });
    expect(await countImageXObjects(bytes)).toBe(1);
  });

  it("still rejects with the resolver's own error when the asset cannot be fetched (retryable)", async () => {
    await expect(
      renderCertificatePdf({
        layout: textPlusImageLayout(),
        fields: FIELDS,
        resolveAsset: async () => {
          throw new Error("storage unavailable");
        },
      }),
    ).rejects.toThrow("storage unavailable");
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
