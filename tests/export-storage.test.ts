import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ uploads: [] as Array<Record<string, unknown>>, signs: [] as Array<Record<string, unknown>> }));
vi.mock("@aws-sdk/lib-storage", () => ({
  Upload: class {
    constructor(options: Record<string, unknown>) { captured.uploads.push(options); }
    done() { return Promise.resolve(); }
  },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: async (_client: unknown, command: { input: unknown }, options: Record<string, unknown>) => {
    captured.signs.push({ input: command.input, options });
    return "https://storage.test/signed";
  },
}));

// The storage client refuses to work without a key and a secret (G-02); these
// are placeholders, and the SDK calls below are mocked.
process.env.S3_ACCESS_KEY_ID = "test-access-key";
process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";

import { buildExportStorageKey, deleteExportObject, presignExportObjectUrl, uploadExportObject } from "@/server/services/storage-service";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("private export storage boundary", () => {
  // G-03: the key used to be exports/<job id>/<version>.csv, which anyone who
  // knew the job id could work out. It is now minted with a random segment; the
  // worker stores it on the job so a retry reuses it.
  it("mints a random key under the job's folder, different on every call", () => {
    const key = buildExportStorageKey("job-12345678");
    expect(key.startsWith("exports/job-12345678/")).toBe(true);
    expect(key.slice("exports/job-12345678/".length)).toMatch(UUID_V4);
    expect(new Set(Array.from({ length: 50 }, () => buildExportStorageKey("job-12345678"))).size).toBe(50);
    expect(() => buildExportStorageKey("../leak")).toThrow();
  });

  it("accepts a freshly minted key and a key stored before the change, and nothing else", async () => {
    process.env.S3_BUCKET = "private-test-bucket";
    const minted = buildExportStorageKey("job-12345678");
    await expect(uploadExportObject({ key: minted, body: Readable.from(["header"]) })).resolves.toBeUndefined();
    expect(captured.uploads.at(-1)!.params).toMatchObject({ Key: minted });
    await expect(presignExportObjectUrl({ key: minted, filename: "report.csv" })).resolves.toBe("https://storage.test/signed");
    await expect(presignExportObjectUrl({ key: "exports/job-12345678/1.0.csv", filename: "report.csv" })).resolves.toBe("https://storage.test/signed");
    for (const bad of [
      "exports/job-12345678/../../lessons/lesson-1/file",
      "lessons/lesson-1/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      "exports/job-12345678/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/extra",
      "exports/job-12345678/not-a-uuid",
      "exports/job-12345678/",
    ]) {
      await expect(uploadExportObject({ key: bad, body: Readable.from(["x"]) }), bad).rejects.toThrow("Invalid export storage key.");
      await expect(presignExportObjectUrl({ key: bad, filename: "report.csv" }), bad).rejects.toThrow("Invalid export storage key.");
      await expect(deleteExportObject(bad), bad).rejects.toThrow("Invalid export storage key.");
    }
  });

  it("uses managed multipart upload to the configured private bucket", async () => {
    process.env.S3_BUCKET = "private-test-bucket";
    const body = Readable.from(["header\n", "row\n"]);
    await uploadExportObject({ key: "exports/job-12345678/1.0.csv", body });
    const options = captured.uploads.at(-1)!;
    expect(options.queueSize).toBeGreaterThan(0);
    expect(options.partSize).toBeGreaterThanOrEqual(5 * 1024 * 1024);
    expect(options.params).toMatchObject({ Bucket: "private-test-bucket", Key: "exports/job-12345678/1.0.csv", Body: body, ContentType: "text/csv; charset=utf-8" });
  });

  it("signs a short-lived attachment with a sanitized filename", async () => {
    process.env.S3_BUCKET = "private-test-bucket";
    expect(await presignExportObjectUrl({ key: "exports/job-12345678/1.0.csv", filename: "report\"\r\n.csv" })).toBe("https://storage.test/signed");
    const signed = captured.signs.at(-1)!;
    expect((signed.options as { expiresIn: number }).expiresIn).toBeLessThanOrEqual(120);
    expect(signed.input).toMatchObject({ Bucket: "private-test-bucket", ResponseContentType: "text/csv; charset=utf-8", ResponseContentDisposition: 'attachment; filename="report.csv"' });
  });
});
