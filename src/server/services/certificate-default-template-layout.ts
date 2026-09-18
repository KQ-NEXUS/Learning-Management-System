/**
 * The seeded "Default certificate" template's layout (plan 11-05 Task 3).
 *
 * PURE MODULE — no data-access import, so both `prisma/seed.ts` (which
 * cannot be safely imported elsewhere; its bottom-of-file `main()` call
 * would run against a real database on import) and
 * `tests/certificate-template-service.test.ts` import this SAME object
 * rather than each keeping their own copy that could silently drift apart
 * — the exact "second, untested layout" plan 11-05 Task 3 warns against.
 *
 * Shape mirrors `tests/certificate-pdf-renderer.test.ts`'s golden-layout
 * fixture (border + all four dynamic-field text elements + one literal
 * text element) minus the `image` element: a seed cannot reference an
 * uploaded asset that does not exist yet, and an unresolvable `assetKey`
 * makes the renderer throw (`certificate-pdf-renderer.ts`'s contract).
 */

import { parseCertificateTemplateLayout, type CertificateTemplateLayoutV1 } from "./certificate-template-layout";

/** The fixed natural key the seed upserts on — see plan 11-05 Task 3. */
export const DEFAULT_CERTIFICATE_TEMPLATE_NAME = "Default certificate";

const rawDefaultCertificateTemplateLayout = {
  schema: 1,
  pageSize: "A4",
  orientation: "landscape",
  elements: [
    { kind: "border", style: "solid", color: "#123456", widthPt: 3 },
    {
      kind: "text",
      field: "literal",
      literal: "KQ NEXUS Training",
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

/**
 * Parsed through `parseCertificateTemplateLayout` at import time, exactly
 * as a real create/update call would parse it — a future layout-schema
 * change that breaks this fixture fails at import here, not silently at
 * seed time or issuance time.
 */
export const defaultCertificateTemplateLayout: CertificateTemplateLayoutV1 =
  parseCertificateTemplateLayout(rawDefaultCertificateTemplateLayout);
