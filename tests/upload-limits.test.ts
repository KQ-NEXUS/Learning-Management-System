import { describe, expect, it } from "vitest";
import {
  UPLOAD_LIMITS,
  validateUpload,
  DOWNLOAD_TTL_SECONDS,
  downloadTtlFor,
} from "@/lib/upload-limits";
import { buildStorageKey } from "@/server/services/storage-service";

describe("validateUpload — per-LessonType allow-list", () => {
  it("accepts a small PNG for an IMAGE lesson", () => {
    expect(
      validateUpload({ lessonType: "IMAGE", mimeType: "image/png", sizeBytes: 1_000 }),
    ).toEqual({ ok: true });
  });

  it("rejects image/svg+xml — SVG is script-capable", () => {
    const result = validateUpload({
      lessonType: "IMAGE",
      mimeType: "image/svg+xml",
      sizeBytes: 1_000,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a PNG over the 10 MB IMAGE cap", () => {
    const result = validateUpload({
      lessonType: "IMAGE",
      mimeType: "image/png",
      sizeBytes: 11 * 1024 * 1024,
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a 500 MB MP4 for a VIDEO lesson (2 GB cap)", () => {
    expect(
      validateUpload({
        lessonType: "VIDEO",
        mimeType: "video/mp4",
        sizeBytes: 500 * 1024 * 1024,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a VIDEO over the 2 GB cap", () => {
    const result = validateUpload({
      lessonType: "VIDEO",
      mimeType: "video/mp4",
      sizeBytes: 2 * 1024 * 1024 * 1024 + 1,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects text/html for a FILE lesson — an app-origin XSS vector", () => {
    const result = validateUpload({
      lessonType: "FILE",
      mimeType: "text/html",
      sizeBytes: 1_000,
    });
    expect(result.ok).toBe(false);
  });

  it("accepts application/pdf for a FILE lesson", () => {
    expect(
      validateUpload({
        lessonType: "FILE",
        mimeType: "application/pdf",
        sizeBytes: 1_000,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a TEXT lesson outright — it carries no resource", () => {
    const result = validateUpload({
      lessonType: "TEXT",
      mimeType: "text/plain",
      sizeBytes: 1,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects any LessonType absent from UPLOAD_LIMITS", () => {
    expect(Object.keys(UPLOAD_LIMITS).sort()).toEqual(["FILE", "IMAGE", "VIDEO"]);
    expect(validateUpload({ lessonType: "QUIZ", mimeType: "application/pdf", sizeBytes: 1 }).ok).toBe(
      false,
    );
  });

  it("UPLOAD_LIMITS is frozen and never lists image/svg+xml or text/html", () => {
    expect(Object.isFrozen(UPLOAD_LIMITS)).toBe(true);
    const allMimes = Object.values(UPLOAD_LIMITS).flatMap((l) => [...l.mimeTypes]);
    expect(allMimes).not.toContain("image/svg+xml");
    expect(allMimes).not.toContain("text/html");
  });
});

describe("downloadTtlFor — per-content-type presign lifetime (D-37)", () => {
  it("returns 60 for FILE and IMAGE", () => {
    expect(downloadTtlFor("FILE")).toBe(60);
    expect(downloadTtlFor("IMAGE")).toBe(60);
  });

  it("returns 14400 (4 hours) for VIDEO", () => {
    expect(downloadTtlFor("VIDEO")).toBe(14_400);
  });

  it("gives VIDEO a different window from FILE — the regression guard against one shared constant", () => {
    expect(downloadTtlFor("VIDEO")).not.toBe(downloadTtlFor("FILE"));
  });

  it("falls back to the tight 60-second window for an unrecognised type", () => {
    expect(downloadTtlFor("SOMETHING_ELSE")).toBe(60);
  });

  it("exposes DOWNLOAD_TTL_SECONDS as a frozen record", () => {
    expect(Object.isFrozen(DOWNLOAD_TTL_SECONDS)).toBe(true);
    expect(DOWNLOAD_TTL_SECONDS.VIDEO).toBe(14_400);
  });
});

describe("buildStorageKey — unguessable, never filename-derived (NFR-06)", () => {
  it("ignores a path-traversal filename and yields a key with neither .. nor the filename", () => {
    const key = buildStorageKey({
      lessonId: "clesson123",
      filename: "../../etc/passwd",
    } as { lessonId: string; filename: string });
    expect(key).toMatch(/^lessons\/[A-Za-z0-9_-]+\/[0-9a-f-]{36}$/);
    expect(key).not.toContain("..");
    expect(key).not.toContain("passwd");
  });

  it("returns a different key on every call with identical arguments", () => {
    const a = buildStorageKey({ lessonId: "clesson123" });
    const b = buildStorageKey({ lessonId: "clesson123" });
    expect(a).not.toBe(b);
  });
});
