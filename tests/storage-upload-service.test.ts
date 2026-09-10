import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PutObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

/**
 * The staged direct-upload operations are exercised against a mocked S3
 * client and presigner: the real command objects are constructed, so their
 * `input` shape is the contract this test pins.
 */

const mockSend = vi.fn();
const mockGetSignedUrl = vi.fn();

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...actual,
    S3Client: class {
      send = mockSend;
    },
  };
});

process.env.S3_BUCKET = "lms-private";
process.env.S3_PUBLIC_ENDPOINT = "";

const {
  buildStagedStorageKey,
  finalStorageKeyFor,
  presignLessonUploadUrl,
  inspectLessonObject,
  promoteLessonObject,
  deleteLessonObject,
} = await import("@/server/services/storage-service");

beforeEach(() => {
  mockSend.mockReset();
  mockGetSignedUrl.mockReset();
});

describe("buildStagedStorageKey / finalStorageKeyFor", () => {
  it("stages under lesson-uploads/ and never collides", () => {
    const a = buildStagedStorageKey({ lessonId: "l1" });
    const b = buildStagedStorageKey({ lessonId: "l1" });
    expect(a).toMatch(/^lesson-uploads\/l1\/[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });

  it("derives a final key only from a staged key", () => {
    expect(finalStorageKeyFor("lesson-uploads/l1/opaque")).toBe("lessons/l1/opaque");
    expect(() => finalStorageKeyFor("lessons/l1/opaque")).toThrow(/staged/i);
  });
});

describe("presignLessonUploadUrl", () => {
  it("binds the PUT URL to the staged key and content type for 900s", async () => {
    mockGetSignedUrl.mockResolvedValue("https://storage.example/presigned-put");

    const url = await presignLessonUploadUrl({
      key: "lesson-uploads/l1/opaque",
      contentType: "application/pdf",
    });

    expect(url).toBe("https://storage.example/presigned-put");
    const [, presignedCommand, presignOptions] = mockGetSignedUrl.mock.calls[0];
    expect(presignedCommand).toBeInstanceOf(PutObjectCommand);
    expect(presignedCommand.input).toMatchObject({
      Bucket: "lms-private",
      Key: "lesson-uploads/l1/opaque",
      ContentType: "application/pdf",
    });
    expect(presignOptions).toEqual({ expiresIn: 900 });
  });
});

describe("inspectLessonObject", () => {
  it("returns the stored byte count as bigint and a normalised content type", async () => {
    mockSend.mockResolvedValue({
      ContentLength: 2000,
      ContentType: "application/pdf; charset=binary",
    });

    const headResult = await inspectLessonObject("lesson-uploads/l1/opaque");

    expect(mockSend.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
    expect(headResult).toEqual({ sizeBytes: BigInt(2000), contentType: "application/pdf" });
  });

  it("throws when the stored object has no byte length", async () => {
    mockSend.mockResolvedValue({ ContentType: "application/pdf" });
    await expect(inspectLessonObject("lesson-uploads/l1/opaque")).rejects.toThrow();
  });
});

describe("promoteLessonObject", () => {
  it("copies the staged object to the final key", async () => {
    mockSend.mockResolvedValue({});

    await promoteLessonObject({
      stagedKey: "lesson-uploads/l1/opaque",
      finalKey: "lessons/l1/opaque",
    });

    const copyCommand = mockSend.mock.calls[0][0];
    expect(copyCommand).toBeInstanceOf(CopyObjectCommand);
    expect(copyCommand.input.Key).toBe("lessons/l1/opaque");
    expect(copyCommand.input.CopySource).toBe("lms-private/lesson-uploads/l1/opaque");
  });
});

describe("deleteLessonObject", () => {
  it("deletes the staged key", async () => {
    mockSend.mockResolvedValue({});

    await deleteLessonObject("lesson-uploads/l1/opaque");

    const deleteCommand = mockSend.mock.calls[0][0];
    expect(deleteCommand).toBeInstanceOf(DeleteObjectCommand);
    expect(deleteCommand.input.Key).toBe("lesson-uploads/l1/opaque");
  });
});
