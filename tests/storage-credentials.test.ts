import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * G-02 (found on staging, plan 15-30): with `S3_ACCESS_KEY_ID` or
 * `S3_SECRET_ACCESS_KEY` missing or empty, the storage client used to sign with
 * an empty string. The link looked normal, the storage service refused it, and
 * the failure showed only in the learner's browser.
 *
 * The rule proved here: a missing or empty key or secret stops the call with an
 * error that names the variable, at the point of use. Importing the module
 * never fails, because builds and most tests import it with no storage
 * variables set.
 *
 * Uses the REAL S3 client and presigner (signing is local). No call in this file
 * reaches a network: the refused calls stop before a client exists, and the
 * accepted ones only sign.
 */

type StorageModule = typeof import("@/server/services/storage-service");

const STORAGE_VARIABLES = [
  "S3_BUCKET",
  "S3_ENDPOINT",
  "S3_PUBLIC_ENDPOINT",
  "S3_FORCE_PATH_STYLE",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const name of STORAGE_VARIABLES) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
  // A fresh copy of the module per case: a client that was built once is kept.
  vi.resetModules();
});

afterEach(() => {
  for (const name of STORAGE_VARIABLES) {
    const value = saved.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function configure(overrides: Partial<Record<(typeof STORAGE_VARIABLES)[number], string | undefined>> = {}) {
  const values: Record<string, string | undefined> = {
    S3_BUCKET: "lms-private",
    S3_ENDPOINT: "https://account.r2.example.test",
    S3_FORCE_PATH_STYLE: "false",
    S3_ACCESS_KEY_ID: "test-access-key",
    S3_SECRET_ACCESS_KEY: "test-secret-key",
    ...overrides,
  };
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function load(): Promise<StorageModule> {
  return import("@/server/services/storage-service");
}

function presignUpload(storage: StorageModule): Promise<string> {
  return storage.presignLessonUploadUrl({
    key: storage.buildStagedStorageKey({ lessonId: "lesson-1" }),
    contentType: "application/pdf",
  });
}

describe("storage key and secret are required at the point of use (G-02)", () => {
  it("imports with no storage variable set at all", async () => {
    await expect(load()).resolves.toHaveProperty("presignLessonUploadUrl");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["blank", "   "],
  ])("refuses to sign an upload link when S3_ACCESS_KEY_ID is %s", async (_label, value) => {
    configure({ S3_ACCESS_KEY_ID: value });
    const storage = await load();
    await expect(presignUpload(storage)).rejects.toThrow("S3_ACCESS_KEY_ID is not configured.");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["blank", "   "],
  ])("refuses to sign an upload link when S3_SECRET_ACCESS_KEY is %s", async (_label, value) => {
    configure({ S3_SECRET_ACCESS_KEY: value });
    const storage = await load();
    await expect(presignUpload(storage)).rejects.toThrow("S3_SECRET_ACCESS_KEY is not configured.");
  });

  it("refuses a download link and a server-side call in the same way", async () => {
    configure({ S3_ACCESS_KEY_ID: "" });
    const storage = await load();
    await expect(
      storage.presignExportObjectUrl({ key: "exports/job-12345678/1.0.csv", filename: "payments.csv" }),
    ).rejects.toThrow("S3_ACCESS_KEY_ID is not configured.");
    await expect(storage.deleteExportObject("exports/job-12345678/1.0.csv")).rejects.toThrow(
      "S3_ACCESS_KEY_ID is not configured.",
    );
  });

  it("refuses when the public endpoint is set too (the separate signing client)", async () => {
    configure({ S3_PUBLIC_ENDPOINT: "https://files.example.test", S3_SECRET_ACCESS_KEY: "" });
    const storage = await load();
    await expect(presignUpload(storage)).rejects.toThrow("S3_SECRET_ACCESS_KEY is not configured.");
  });

  it("never puts the secret in the error", async () => {
    configure({ S3_ACCESS_KEY_ID: undefined, S3_SECRET_ACCESS_KEY: "do-not-print-this" });
    const storage = await load();
    const error = await presignUpload(storage).catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("do-not-print-this");
  });

  it("signs with the configured key id when both values are present", async () => {
    configure();
    const storage = await load();
    const url = new URL(await presignUpload(storage));
    expect(url.searchParams.get("X-Amz-Credential")).toMatch(/^test-access-key\//);
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("works on the next call once the missing value is set", async () => {
    configure({ S3_ACCESS_KEY_ID: undefined });
    const storage = await load();
    await expect(presignUpload(storage)).rejects.toThrow("S3_ACCESS_KEY_ID is not configured.");
    process.env.S3_ACCESS_KEY_ID = "test-access-key";
    const url = new URL(await presignUpload(storage));
    expect(url.searchParams.get("X-Amz-Credential")).toMatch(/^test-access-key\//);
  });
});
