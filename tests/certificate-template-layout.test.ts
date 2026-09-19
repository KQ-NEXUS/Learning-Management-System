import { describe, expect, it } from "vitest";
import {
  EMPTY_LAYOUT_V1,
  parseCertificateTemplateLayout,
  UnsupportedCertificateLayoutError,
} from "@/server/services/certificate-template-layout";

const validLayout = {
  schema: 1,
  pageSize: "A4",
  orientation: "landscape",
  elements: [
    {
      kind: "text",
      field: "learnerName",
      x: 10,
      y: 20,
      width: 200,
      height: 40,
      fontSize: 24,
      color: "#123ABC",
      align: "center",
    },
    { kind: "image", assetKey: "certificate-template-assets/tpl/image", x: 5, y: 6, width: 80, height: 50 },
    { kind: "border", style: "double", color: "#000000", widthPt: 2 },
  ],
} as const;

describe("parseCertificateTemplateLayout", () => {
  it("parses a well-formed v1 layout containing text, image, and border elements", () => {
    expect(parseCertificateTemplateLayout(validLayout)).toEqual(validLayout);
  });

  it("rejects an unrecognised element kind and names it", () => {
    const input = { ...validLayout, elements: [{ kind: "video" }] };
    expect(() => parseCertificateTemplateLayout(input)).toThrowError(
      expect.objectContaining({ name: "UnsupportedCertificateLayoutError", message: expect.stringContaining("video") }),
    );
  });

  it("rejects an unrecognised text-element property and names it", () => {
    const text = { ...validLayout.elements[0], opacity: 0.5 };
    expect(() => parseCertificateTemplateLayout({ ...validLayout, elements: [text] })).toThrowError(
      expect.objectContaining({ message: expect.stringContaining("opacity") }),
    );
  });

  it("rejects a literal text element without literal text", () => {
    const text = { ...validLayout.elements[0], field: "literal" };
    expect(() => parseCertificateTemplateLayout({ ...validLayout, elements: [text] })).toThrow(UnsupportedCertificateLayoutError);
  });

  it("rejects literal text on a dynamic text field", () => {
    const text = { ...validLayout.elements[0], literal: "Not the learner" };
    expect(() => parseCertificateTemplateLayout({ ...validLayout, elements: [text] })).toThrow(UnsupportedCertificateLayoutError);
  });

  it("rejects a forward schema version", () => {
    expect(() => parseCertificateTemplateLayout({ ...validLayout, schema: 2 })).toThrow(UnsupportedCertificateLayoutError);
  });

  it.each([undefined, null, "", []])("rejects malformed top-level input %#", (input) => {
    expect(() => parseCertificateTemplateLayout(input)).toThrow(UnsupportedCertificateLayoutError);
  });

  it("rejects an unsupported page size", () => {
    expect(() => parseCertificateTemplateLayout({ ...validLayout, pageSize: "A3" })).toThrow(UnsupportedCertificateLayoutError);
  });

  it("rejects an unsupported orientation", () => {
    expect(() => parseCertificateTemplateLayout({ ...validLayout, orientation: "diagonal" })).toThrow(UnsupportedCertificateLayoutError);
  });

  it.each([
    ["x", -1],
    ["y", -1],
    ["width", -1],
    ["height", -1],
    ["fontSize", -1],
    ["x", Number.NaN],
    ["y", Number.POSITIVE_INFINITY],
    ["width", Number.NEGATIVE_INFINITY],
  ])("rejects invalid numeric field %s=%s", (key, value) => {
    const text = { ...validLayout.elements[0], [key]: value };
    expect(() => parseCertificateTemplateLayout({ ...validLayout, elements: [text] })).toThrow(UnsupportedCertificateLayoutError);
  });

  it("rejects an empty image asset key", () => {
    const image = { ...validLayout.elements[1], assetKey: "" };
    expect(() => parseCertificateTemplateLayout({ ...validLayout, elements: [image] })).toThrow(UnsupportedCertificateLayoutError);
  });

  // WR-03: an image assetKey is read from the object store at render time, so
  // it is confined to the certificate-template-assets/ namespace.
  const layoutWithKey = (assetKey: unknown) => ({
    ...validLayout,
    elements: [{ ...validLayout.elements[1], assetKey }],
  });

  it.each([
    "certificate-template-assets/tpl/image",
    "certificate-template-assets/draft/0b6f6c2e-6f0e-4f8e-9d0e-2f6d7c1a9b11",
    "certificate-template-assets/cmabc123def/0b6f6c2e-6f0e-4f8e-9d0e-2f6d7c1a9b11",
  ])("accepts the production asset key shape %s, returning it unchanged", (key) => {
    const parsed = parseCertificateTemplateLayout(layoutWithKey(key));
    expect(parsed.elements[0]).toMatchObject({ kind: "image", assetKey: key });
  });

  it.each([
    "   ",
    "submissions/abc",
    "lessons/x/y",
    "certificates/cert-1/0b6f6c2e",
    "certificate-template-asset-uploads/tpl/x",
    "pending-upload",
    "/certificate-template-assets/tpl/x",
    " certificate-template-assets/tpl/x",
    "certificate-template-assets/../submissions/abc",
    "certificate-template-assets/tpl/../../x",
    "certificate-template-assets/",
    "certificate-template-assets//x",
    "certificate-template-assets/tpl//x",
    "certificate-template-assets/tpl/",
    "certificate-template-assets/tpl/./x",
    "certificate-template-assets/tpl\\x",
    "certificate-template-assets/tpl/x\u0000y",
    "certificate-template-assets/tpl/x\ny",
    "certificate-template-assets",
    "Certificate-Template-Assets/tpl/x",
  ])("rejects the foreign / traversal asset key %j, reporting only the field name", (key) => {
    // `issue` is the literal field name, so the key itself is never echoed.
    expect(() => parseCertificateTemplateLayout(layoutWithKey(key))).toThrowError(
      expect.objectContaining({ name: "UnsupportedCertificateLayoutError", issue: "assetKey" }),
    );
  });

  it.each([undefined, null, 42, {}, ["certificate-template-assets/tpl/x"]])(
    "rejects a non-string asset key %j",
    (key) => {
      expect(() => parseCertificateTemplateLayout(layoutWithKey(key))).toThrow(UnsupportedCertificateLayoutError);
    },
  );

  it("rejects a colour outside the #RRGGBB format", () => {
    const text = { ...validLayout.elements[0], color: "red" };
    expect(() => parseCertificateTemplateLayout({ ...validLayout, elements: [text] })).toThrow(UnsupportedCertificateLayoutError);
  });

  it("accepts an empty element list", () => {
    expect(parseCertificateTemplateLayout(EMPTY_LAYOUT_V1)).toEqual({
      schema: 1,
      pageSize: "A4",
      orientation: "landscape",
      elements: [],
    });
  });
});
