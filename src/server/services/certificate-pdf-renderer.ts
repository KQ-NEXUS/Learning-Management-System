/**
 * The single PDF-construction surface for issued certificates (D-07, D-08).
 *
 * This module is the sole boundary to the `pdf-lib` library in this
 * repository — no other file may import it. D-08 explicitly rejects
 * HTML-to-PDF / headless-browser rendering (Puppeteer, Playwright), so
 * nobody should "improve" this module later by reaching for a browser
 * binary; the PDF is built by direct, positioned drawing calls against a
 * `CertificateTemplateLayoutV1`, exactly as recorded in
 * `.planning/phases/11-certificates-completion-lifecycle/11-DECISIONS.md`.
 *
 * Pure transform: no database-client import, no data access. Every input
 * (the parsed layout, the four learner facts, and an injected asset
 * resolver) is passed in by the caller, which keeps this module unit
 * testable without a database or an object store.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont, PDFPage, RGB } from "pdf-lib";
import type { CertificateElementV1, CertificateTemplateLayoutV1 } from "@/server/services/certificate-template-layout";

export type CertificateRenderFields = {
  learnerName: string;
  awardTitle: string;
  issuedAt: Date;
  verificationRef: string;
};

export type CertificateAssetResolver = (assetKey: string) => Promise<Uint8Array>;

// Point dimensions for the two supported page sizes, in portrait
// orientation. `pageDimensionsFor` swaps width/height for landscape.
const A4_PORTRAIT_PT = { width: 595.28, height: 841.89 } as const;
const LETTER_PORTRAIT_PT = { width: 612, height: 792 } as const;

const PAGE_SIZES: Record<CertificateTemplateLayoutV1["pageSize"], { width: number; height: number }> = {
  A4: A4_PORTRAIT_PT,
  LETTER: LETTER_PORTRAIT_PT,
};

// How far a border is inset from the page edge, and the gap between the
// two concentric rectangles of a "double" border.
const BORDER_INSET_PT = 24;
const BORDER_DOUBLE_GAP_PT = 6;

function pageDimensionsFor(
  pageSize: CertificateTemplateLayoutV1["pageSize"],
  orientation: CertificateTemplateLayoutV1["orientation"],
): { width: number; height: number } {
  const portrait = PAGE_SIZES[pageSize];
  return orientation === "landscape"
    ? { width: portrait.height, height: portrait.width }
    : { width: portrait.width, height: portrait.height };
}

/**
 * The single shared date formatter for a certificate's `issuedAt` field.
 * Exported so the template editor's sample-value preview (plan 11-12) can
 * call the identical function and staff see the same date shape they will
 * get on the real, rendered certificate.
 */
export function formatCertificateIssuedDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function parseHexColor(hex: string): RGB {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  return rgb(r, g, b);
}

type TextElement = Extract<CertificateElementV1, { kind: "text" }>;
type ImageElement = Extract<CertificateElementV1, { kind: "image" }>;
type BorderElement = Extract<CertificateElementV1, { kind: "border" }>;

function resolveTextElementValue(element: TextElement, fields: CertificateRenderFields): string {
  if (element.field === "literal") return element.literal ?? "";
  if (element.field === "issuedAt") return formatCertificateIssuedDate(fields.issuedAt);
  return fields[element.field];
}

function drawTextElement(page: PDFPage, font: PDFFont, element: TextElement, fields: CertificateRenderFields): void {
  const value = resolveTextElementValue(element, fields);
  const color = parseHexColor(element.color);
  const textWidth = font.widthOfTextAtSize(value, element.fontSize);

  // `align` positions the drawn text relative to the element's x/width box.
  // Overflow (a value wider than the box) is drawn as-is — never truncated,
  // never dropped — so a long learner name is still visible rather than
  // silently missing from the certificate.
  let x = element.x;
  if (element.align === "center") {
    x = element.x + (element.width - textWidth) / 2;
  } else if (element.align === "right") {
    x = element.x + element.width - textWidth;
  }

  page.drawText(value, { x, y: element.y, size: element.fontSize, font, color });
}

async function drawImageElement(
  document: PDFDocument,
  page: PDFPage,
  element: ImageElement,
  resolveAsset: CertificateAssetResolver,
): Promise<void> {
  // The renderer never touches the object store itself (T-11-14) — it only
  // calls the caller-injected resolver. An asset key the resolver cannot
  // resolve throws here and is never swallowed, so a template referencing a
  // missing logo fails the render rather than silently omitting it.
  const bytes = await resolveAsset(element.assetKey);

  let embedded;
  try {
    embedded = await document.embedPng(bytes);
  } catch {
    embedded = await document.embedJpg(bytes);
  }

  page.drawImage(embedded, { x: element.x, y: element.y, width: element.width, height: element.height });
}

function drawBorderElement(page: PDFPage, element: BorderElement, pageWidth: number, pageHeight: number): void {
  const color = parseHexColor(element.color);

  const drawInsetRectangle = (inset: number) => {
    page.drawRectangle({
      x: inset,
      y: inset,
      width: pageWidth - inset * 2,
      height: pageHeight - inset * 2,
      borderColor: color,
      borderWidth: element.widthPt,
    });
  };

  drawInsetRectangle(BORDER_INSET_PT);
  if (element.style === "double") {
    drawInsetRectangle(BORDER_INSET_PT + BORDER_DOUBLE_GAP_PT);
  }
}

/**
 * Render one learner's certificate: a saved template layout plus that
 * learner's award facts become a fresh, readable PDF, generated per learner
 * rather than a single static upload (D-07).
 *
 * Elements are iterated in `layout.elements` array order, so later elements
 * draw over earlier ones — the editor's z-order is array order, and plan
 * 11-12's canvas must render the same way.
 */
export async function renderCertificatePdf(input: {
  layout: CertificateTemplateLayoutV1;
  fields: CertificateRenderFields;
  resolveAsset: CertificateAssetResolver;
}): Promise<Uint8Array> {
  const { layout, fields, resolveAsset } = input;

  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const { width, height } = pageDimensionsFor(layout.pageSize, layout.orientation);
  const page = document.addPage([width, height]);

  for (const element of layout.elements) {
    if (element.kind === "text") {
      drawTextElement(page, font, element, fields);
    } else if (element.kind === "image") {
      await drawImageElement(document, page, element, resolveAsset);
    } else {
      drawBorderElement(page, element, width, height);
    }
  }

  return document.save();
}
