/**
 * The starting layout for a certificate template built from a school's own artwork
 * ("Start from an uploaded design").
 *
 * The uploaded image becomes a full-page background and the four dynamic fields are laid over it,
 * ready to be dragged into place in the editor. PURE MODULE — no data-access, storage or UI
 * imports — so the same builder serves the upload form and its tests. The caller supplies the page
 * size in points (the editor already knows them), so no third copy of the page table lives here.
 *
 * There is deliberately no border: an uploaded design carries its own.
 */

import type { CertificateElementV1, CertificateTemplateLayoutV1 } from "./certificate-template-layout";

type PageSize = CertificateTemplateLayoutV1["pageSize"];
type Orientation = CertificateTemplateLayoutV1["orientation"];

/** How far an image's shape may differ from the page's before we warn that it will be stretched. */
const ASPECT_TOLERANCE = 0.03;

/**
 * Where each field starts, as a share of the page. The block is centred and sits in the middle of
 * the page, where most certificates leave room, and every field clears the one above it.
 */
const FIELDS: ReadonlyArray<{
  field: "learnerName" | "awardTitle" | "issuedAt" | "verificationRef";
  top: number;
  height: number;
  fontSize: number;
}> = [
  { field: "learnerName", top: 0.4, height: 40, fontSize: 28 },
  { field: "awardTitle", top: 0.52, height: 32, fontSize: 18 },
  { field: "issuedAt", top: 0.66, height: 24, fontSize: 14 },
  { field: "verificationRef", top: 0.88, height: 20, fontSize: 12 },
];

export function buildDesignLayout(input: {
  assetKey: string;
  pageSize: PageSize;
  orientation: Orientation;
  pageWidth: number;
  pageHeight: number;
}): CertificateTemplateLayoutV1 {
  const { assetKey, pageSize, orientation, pageWidth, pageHeight } = input;
  const marginX = Math.round(pageWidth * 0.15);
  const fieldWidth = Math.round(pageWidth - marginX * 2);

  const elements: CertificateElementV1[] = [
    { kind: "image", assetKey, x: 0, y: 0, width: pageWidth, height: pageHeight },
    ...FIELDS.map(
      ({ field, top, height, fontSize }): CertificateElementV1 => ({
        kind: "text",
        field,
        x: marginX,
        y: Math.round(pageHeight * top),
        width: fieldWidth,
        height,
        fontSize,
        color: "#000000",
        align: "center",
      }),
    ),
  ];

  return { schema: 1, pageSize, orientation, elements };
}

/** Landscape unless the image is taller than it is wide; a square counts as landscape. */
export function orientationForImage(imageWidth: number, imageHeight: number): Orientation {
  return imageHeight > imageWidth ? "portrait" : "landscape";
}

/** True when stretching the image over the page would visibly distort it. Unknown size: no warning. */
export function designAspectMismatch(
  imageWidth: number,
  imageHeight: number,
  pageWidth: number,
  pageHeight: number,
): boolean {
  if (!(imageWidth > 0) || !(imageHeight > 0)) return false;
  const imageRatio = imageWidth / imageHeight;
  const pageRatio = pageWidth / pageHeight;
  return Math.abs(imageRatio - pageRatio) / pageRatio > ASPECT_TOLERANCE;
}
