import { describe, expect, it } from "vitest";

/**
 * Uses the REAL S3 client and presigner (signing is local, no network call).
 * A presigned upload link must not carry a body checksum: the SDK would sign
 * the checksum of an empty body, and Cloudflare R2 then refuses the browser's
 * real file. Local MinIO accepts such links, so only this test catches it.
 */

process.env.S3_BUCKET = "lms-private";
process.env.S3_ENDPOINT = "https://account.r2.example.test";
process.env.S3_PUBLIC_ENDPOINT = "";
process.env.S3_FORCE_PATH_STYLE = "false";
process.env.S3_ACCESS_KEY_ID = "test-access-key";
process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";

const { presignLessonUploadUrl, presignTemplateAssetUploadUrl, buildStagedStorageKey } =
  await import("@/server/services/storage-service");

function expectNoChecksum(url: string) {
  const parsed = new URL(url);
  const names = [...parsed.searchParams.keys()].map((name) => name.toLowerCase());
  expect(names).toContain("x-amz-signature");
  expect(names.filter((name) => name.includes("checksum"))).toEqual([]);
  const signedHeaders = parsed.searchParams.get("X-Amz-SignedHeaders") ?? "";
  expect(signedHeaders).not.toContain("checksum");
}

describe("presigned upload links", () => {
  it("carry no body checksum for a lesson upload", async () => {
    const url = await presignLessonUploadUrl({
      key: buildStagedStorageKey({ lessonId: "lesson-1" }),
      contentType: "application/pdf",
    });
    expectNoChecksum(url);
  });

  it("carry no body checksum for a template asset upload", async () => {
    const url = await presignTemplateAssetUploadUrl({
      key: "template-asset-uploads/template-1/asset",
      contentType: "image/png",
      contentLength: 1024,
    });
    expectNoChecksum(url);
  });
});
