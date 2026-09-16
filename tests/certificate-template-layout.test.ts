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
