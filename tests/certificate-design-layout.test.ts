import { describe, expect, it } from "vitest";
import {
  buildDesignLayout,
  designAspectMismatch,
  orientationForImage,
} from "@/server/services/certificate-design-layout";
import { parseCertificateTemplateLayout } from "@/server/services/certificate-template-layout";

/**
 * "Start from an uploaded design": the starting layout for a template whose background is a
 * school's own certificate artwork. Pure module, so nothing here touches storage or the UI.
 */

const PAGES = [
  { pageSize: "A4", orientation: "landscape", w: 841.89, h: 595.28 },
  { pageSize: "A4", orientation: "portrait", w: 595.28, h: 841.89 },
  { pageSize: "LETTER", orientation: "landscape", w: 792, h: 612 },
  { pageSize: "LETTER", orientation: "portrait", w: 612, h: 792 },
] as const;

describe("buildDesignLayout", () => {
  it.each(PAGES)("makes a valid $pageSize $orientation layout the parser accepts", ({ pageSize, orientation, w, h }) => {
    const layout = buildDesignLayout({ assetKey: "certificate-template-assets/t/abc", pageSize, orientation, pageWidth: w, pageHeight: h });
    expect(() => parseCertificateTemplateLayout(layout)).not.toThrow();
    expect(layout.pageSize).toBe(pageSize);
    expect(layout.orientation).toBe(orientation);
  });

  it.each(PAGES)("puts the design first and stretches it over the whole $pageSize $orientation page", ({ pageSize, orientation, w, h }) => {
    const layout = buildDesignLayout({ assetKey: "certificate-template-assets/t/abc", pageSize, orientation, pageWidth: w, pageHeight: h });
    expect(layout.elements[0]).toEqual({
      kind: "image",
      assetKey: "certificate-template-assets/t/abc",
      x: 0,
      y: 0,
      width: w,
      height: h,
    });
  });

  it("has no border, because the uploaded design carries its own", () => {
    const layout = buildDesignLayout({ assetKey: "k", pageSize: "A4", orientation: "landscape", pageWidth: 841.89, pageHeight: 595.28 });
    expect(layout.elements.some((element) => element.kind === "border")).toBe(false);
  });

  it.each(PAGES)("adds the four dynamic fields inside the $pageSize $orientation page, top to bottom", ({ pageSize, orientation, w, h }) => {
    const layout = buildDesignLayout({ assetKey: "k", pageSize, orientation, pageWidth: w, pageHeight: h });
    const texts = layout.elements.filter((element) => element.kind === "text");

    expect(texts.map((t) => t.field)).toEqual(["learnerName", "awardTitle", "issuedAt", "verificationRef"]);
    for (const t of texts) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.x + t.width).toBeLessThanOrEqual(w);
      expect(t.y + t.height).toBeLessThanOrEqual(h);
    }
    const ys = texts.map((t) => t.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    // Each field clears the one above it, so they don't start out on top of each other.
    for (let i = 1; i < texts.length; i++) {
      expect(texts[i].y).toBeGreaterThanOrEqual(texts[i - 1].y + texts[i - 1].height);
    }
  });
});

describe("orientationForImage", () => {
  it("follows the shape of the image, treating a square as landscape", () => {
    expect(orientationForImage(1600, 900)).toBe("landscape");
    expect(orientationForImage(900, 1600)).toBe("portrait");
    expect(orientationForImage(1000, 1000)).toBe("landscape");
  });
});

describe("designAspectMismatch", () => {
  it("is false when the image is (almost) the shape of the page", () => {
    expect(designAspectMismatch(2000, 1414, 841.89, 595.28)).toBe(false);
    expect(designAspectMismatch(1000, 707, 841.89, 595.28)).toBe(false);
  });

  it("is true when stretching would visibly distort it", () => {
    expect(designAspectMismatch(1920, 1080, 841.89, 595.28)).toBe(true);
  });

  it("is false when the image size is unknown", () => {
    expect(designAspectMismatch(0, 0, 841.89, 595.28)).toBe(false);
  });
});
