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

import { buildExportStorageKey, presignExportObjectUrl, uploadExportObject } from "@/server/services/storage-service";

describe("private export storage boundary", () => {
  it("derives one safe deterministic key from the job identity and version", () => {
    expect(buildExportStorageKey("job-12345678", "1.0")).toBe("exports/job-12345678/1.0.csv");
    expect(() => buildExportStorageKey("../leak", "1.0")).toThrow();
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
