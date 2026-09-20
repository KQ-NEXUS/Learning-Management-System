import type { CertificateTemplateLayoutV1 } from "@/server/services/certificate-template-layout";
import { presignTemplateAssetViewUrl } from "@/server/services/storage-service";

/**
 * Short-lived private view links for the images in a saved template, so the editor can show them
 * when the template is reopened. Keyed by `assetKey`, which is how the canvas looks them up.
 *
 * Runs on the server as the page loads, after the page has already authorized the actor to open
 * the template. An image whose link can't be made is left out (the canvas shows its placeholder)
 * rather than failing the whole page.
 */
export async function resolveTemplateAssetPreviews(
  layout: CertificateTemplateLayoutV1,
): Promise<Record<string, string>> {
  const keys = [
    ...new Set(
      layout.elements.flatMap((element) => (element.kind === "image" ? [element.assetKey] : [])),
    ),
  ];

  const entries = await Promise.all(
    keys.map(async (key): Promise<[string, string] | null> => {
      try {
        return [key, await presignTemplateAssetViewUrl({ key })];
      } catch {
        return null;
      }
    }),
  );

  return Object.fromEntries(entries.filter((entry): entry is [string, string] => entry !== null));
}
