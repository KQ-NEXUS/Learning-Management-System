import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CertificateTemplateLayoutV1 } from "@/server/services/certificate-template-layout";

/**
 * A saved template's images show in the editor through short-lived private links, made on the
 * server when the page loads. A link that can't be made must never take the whole page down.
 */

const { presign } = vi.hoisted(() => ({ presign: vi.fn() }));
vi.mock("@/server/services/storage-service", () => ({ presignTemplateAssetViewUrl: presign }));

import { resolveTemplateAssetPreviews } from "@/app/staff/certificates/templates/asset-previews";

const text = { kind: "text", field: "learnerName", x: 0, y: 0, width: 100, height: 20, fontSize: 12, color: "#000000", align: "left" } as const;

function layout(...elements: CertificateTemplateLayoutV1["elements"]): CertificateTemplateLayoutV1 {
  return { schema: 1, pageSize: "A4", orientation: "landscape", elements };
}

beforeEach(() => {
  presign.mockReset();
  presign.mockImplementation(async ({ key }: { key: string }) => `https://storage.example/${key}`);
});

describe("resolveTemplateAssetPreviews", () => {
  it("returns a link for each image element, keyed by its asset key", async () => {
    const result = await resolveTemplateAssetPreviews(
      layout(
        { kind: "image", assetKey: "certificate-template-assets/t/a", x: 0, y: 0, width: 10, height: 10 },
        text,
        { kind: "image", assetKey: "certificate-template-assets/t/b", x: 0, y: 0, width: 10, height: 10 },
      ),
    );
    expect(result).toEqual({
      "certificate-template-assets/t/a": "https://storage.example/certificate-template-assets/t/a",
      "certificate-template-assets/t/b": "https://storage.example/certificate-template-assets/t/b",
    });
  });

  it("signs an asset used twice only once", async () => {
    const image = { kind: "image", assetKey: "certificate-template-assets/t/a", x: 0, y: 0, width: 10, height: 10 } as const;
    await resolveTemplateAssetPreviews(layout(image, { ...image, x: 50 }));
    expect(presign).toHaveBeenCalledTimes(1);
  });

  it("returns nothing for a layout with no images", async () => {
    await expect(resolveTemplateAssetPreviews(layout(text))).resolves.toEqual({});
    expect(presign).not.toHaveBeenCalled();
  });

  it("leaves out an image whose link can't be made and still returns the others", async () => {
    presign.mockImplementation(async ({ key }: { key: string }) => {
      if (key.endsWith("/bad")) throw new Error("not a template asset");
      return `https://storage.example/${key}`;
    });
    const result = await resolveTemplateAssetPreviews(
      layout(
        { kind: "image", assetKey: "certificate-template-assets/t/bad", x: 0, y: 0, width: 10, height: 10 },
        { kind: "image", assetKey: "certificate-template-assets/t/good", x: 0, y: 0, width: 10, height: 10 },
      ),
    );
    expect(result).toEqual({ "certificate-template-assets/t/good": "https://storage.example/certificate-template-assets/t/good" });
  });
});
