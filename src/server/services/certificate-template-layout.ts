/**
 * The versioned certificate-template layout payload and its pure parser.
 *
 * PURE MODULE — no data-access, UI-framework, or authorization imports. Stored
 * JSON crosses into the PDF renderer only after every object and field has
 * passed a closed allow-list, so newer or malformed layouts fail loudly.
 */

export type CertificateTextField =
  | "learnerName"
  | "awardTitle"
  | "issuedAt"
  | "verificationRef"
  | "literal";

export type CertificateElementV1 =
  | {
      kind: "text";
      field: CertificateTextField;
      literal?: string;
      x: number;
      y: number;
      width: number;
      height: number;
      fontSize: number;
      color: string;
      align: "left" | "center" | "right";
    }
  | {
      kind: "image";
      assetKey: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | {
      kind: "border";
      style: "solid" | "double";
      color: string;
      widthPt: number;
    };

export type CertificateTemplateLayoutV1 = {
  schema: 1;
  pageSize: "A4" | "LETTER";
  orientation: "landscape" | "portrait";
  elements: CertificateElementV1[];
};

export const EMPTY_LAYOUT_V1: CertificateTemplateLayoutV1 = {
  schema: 1,
  pageSize: "A4",
  orientation: "landscape",
  elements: [],
};

const RECOGNISED_LAYOUT_KEYS = ["schema", "pageSize", "orientation", "elements"] as const;
const RECOGNISED_TEXT_KEYS = [
  "kind",
  "field",
  "literal",
  "x",
  "y",
  "width",
  "height",
  "fontSize",
  "color",
  "align",
] as const;
const RECOGNISED_IMAGE_KEYS = ["kind", "assetKey", "x", "y", "width", "height"] as const;
const RECOGNISED_BORDER_KEYS = ["kind", "style", "color", "widthPt"] as const;
const TEXT_FIELDS: readonly CertificateTextField[] = [
  "learnerName",
  "awardTitle",
  "issuedAt",
  "verificationRef",
  "literal",
];
const ALIGNMENTS = ["left", "center", "right"] as const;
const BORDER_STYLES = ["solid", "double"] as const;
const HEX_COLOUR = /^#[0-9A-Fa-f]{6}$/;

export class UnsupportedCertificateLayoutError extends Error {
  readonly issue: unknown;

  constructor(issue: unknown) {
    super(`Unsupported certificate layout value: ${JSON.stringify(issue)}`);
    this.name = "UnsupportedCertificateLayoutError";
    this.issue = issue;
  }
}

function fail(issue: unknown): never {
  throw new UnsupportedCertificateLayoutError(issue);
}

function asRecord(value: unknown, issue: unknown = value): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(issue);
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(record: Record<string, unknown>, recognised: readonly string[]): void {
  for (const key of Object.keys(record)) {
    if (!recognised.includes(key)) fail(key);
  }
}

function nonNegativeFinite(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`${key}=${String(value)}`);
  return value;
}

function colour(record: Record<string, unknown>): string {
  const value = record.color;
  if (typeof value !== "string" || !HEX_COLOUR.test(value)) fail(`color=${String(value)}`);
  return value;
}

function parseTextElement(record: Record<string, unknown>): CertificateElementV1 {
  rejectUnknownKeys(record, RECOGNISED_TEXT_KEYS);
  if (!TEXT_FIELDS.includes(record.field as CertificateTextField)) fail(`field=${String(record.field)}`);
  if (!ALIGNMENTS.includes(record.align as (typeof ALIGNMENTS)[number])) fail(`align=${String(record.align)}`);

  const field = record.field as CertificateTextField;
  if (field === "literal") {
    if (typeof record.literal !== "string") fail("literal");
  } else if ("literal" in record) {
    fail("literal");
  }

  return {
    kind: "text",
    field,
    ...(field === "literal" ? { literal: record.literal as string } : {}),
    x: nonNegativeFinite(record, "x"),
    y: nonNegativeFinite(record, "y"),
    width: nonNegativeFinite(record, "width"),
    height: nonNegativeFinite(record, "height"),
    fontSize: nonNegativeFinite(record, "fontSize"),
    color: colour(record),
    align: record.align as "left" | "center" | "right",
  };
}

/**
 * WR-03 — the only namespace a template image's `assetKey` may name. The
 * renderer reads the key straight from the object store, so an unconfined key
 * would let a `certificates.manage` holder embed any bucket object (a
 * submission, another learner's certificate) into a certificate. This module
 * must stay pure (no imports — guarded by tests/certificate-phase-invariants),
 * so the prefix is duplicated here; it MUST equal the prefix
 * `storage-service.ts`'s `buildTemplateAssetStorageKey` /
 * `finalTemplateAssetKeyFor` produce (`certificate-template-assets/<id>/<uuid>`).
 */
export const CERTIFICATE_TEMPLATE_ASSET_KEY_PREFIX = "certificate-template-assets/";

/** No control characters (incl. NUL/newline) anywhere in a key. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function isConfinedAssetKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!value.startsWith(CERTIFICATE_TEMPLATE_ASSET_KEY_PREFIX)) return false;
  if (value.includes("\\") || CONTROL_CHARACTERS.test(value)) return false;
  const remainder = value.slice(CERTIFICATE_TEMPLATE_ASSET_KEY_PREFIX.length);
  if (remainder === "") return false;
  // No empty segment (`//`, trailing `/`), no `.` / `..` traversal segment.
  return remainder.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function parseImageElement(record: Record<string, unknown>): CertificateElementV1 {
  rejectUnknownKeys(record, RECOGNISED_IMAGE_KEYS);
  // The key is returned verbatim (never trimmed/normalised) so a stored key
  // round-trips byte-for-byte; the issue text is the field name, never the key.
  if (!isConfinedAssetKey(record.assetKey)) fail("assetKey");

  return {
    kind: "image",
    assetKey: record.assetKey,
    x: nonNegativeFinite(record, "x"),
    y: nonNegativeFinite(record, "y"),
    width: nonNegativeFinite(record, "width"),
    height: nonNegativeFinite(record, "height"),
  };
}

function parseBorderElement(record: Record<string, unknown>): CertificateElementV1 {
  rejectUnknownKeys(record, RECOGNISED_BORDER_KEYS);
  if (!BORDER_STYLES.includes(record.style as (typeof BORDER_STYLES)[number])) fail(`style=${String(record.style)}`);

  return {
    kind: "border",
    style: record.style as "solid" | "double",
    color: colour(record),
    widthPt: nonNegativeFinite(record, "widthPt"),
  };
}

function parseElement(value: unknown): CertificateElementV1 {
  const record = asRecord(value, "element");
  if (record.kind === "text") return parseTextElement(record);
  if (record.kind === "image") return parseImageElement(record);
  if (record.kind === "border") return parseBorderElement(record);
  return fail(`kind=${String(record.kind)}`);
}

export function parseCertificateTemplateLayout(raw: unknown): CertificateTemplateLayoutV1 {
  const record = asRecord(raw);
  rejectUnknownKeys(record, RECOGNISED_LAYOUT_KEYS);

  if (record.schema !== 1) fail(`schema=${String(record.schema)}`);
  if (record.pageSize !== "A4" && record.pageSize !== "LETTER") fail(`pageSize=${String(record.pageSize)}`);
  if (record.orientation !== "landscape" && record.orientation !== "portrait") {
    fail(`orientation=${String(record.orientation)}`);
  }
  if (!Array.isArray(record.elements)) fail("elements");

  return {
    schema: 1,
    pageSize: record.pageSize,
    orientation: record.orientation,
    elements: record.elements.map(parseElement),
  };
}
