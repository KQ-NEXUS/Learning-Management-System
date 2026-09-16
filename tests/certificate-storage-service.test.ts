import { beforeEach, describe, expect, it, vi } from "vitest";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

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
  buildCertificateStorageKey,
  buildStagedTemplateAssetStorageKey,
  buildTemplateAssetStorageKey,
  finalTemplateAssetKeyFor,
  presignCertificateObjectUrl,
  presignTemplateAssetUploadUrl,
  putGeneratedCertificateObject,
} = await import("@/server/services/storage-service");

beforeEach(() => {
  mockSend.mockReset();
  mockGetSignedUrl.mockReset();
});

describe("certificate storage keys", () => {
  it("creates a fresh unguessable key for every certificate write", () => {
    const first = buildCertificateStorageKey({ certificateId: "cert-1" });
    const second = buildCertificateStorageKey({ certificateId: "cert-1" });
    expect(first).toMatch(/^certificates\/cert-1\/[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
  });

  it("creates final and staged template-asset keys in distinct domains", () => {
    expect(buildTemplateAssetStorageKey({ templateId: "tpl-1" })).toMatch(
      /^certificate-template-assets\/tpl-1\/[0-9a-f-]{36}$/,
    );
    expect(buildStagedTemplateAssetStorageKey({ templateId: "tpl-1" })).toMatch(
      /^certificate-template-asset-uploads\/tpl-1\/[0-9a-f-]{36}$/,
    );
  });

  it("promotes only staged template-asset keys", () => {
    expect(finalTemplateAssetKeyFor("certificate-template-asset-uploads/tpl-1/opaque")).toBe(
      "certificate-template-assets/tpl-1/opaque",
    );
    expect(() => finalTemplateAssetKeyFor("certificates/abc")).toThrow(/staged/i);
  });
});

describe("putGeneratedCertificateObject", () => {
  it("writes PDF bytes directly with PutObjectCommand", async () => {
    mockSend.mockResolvedValue({});
    const body = new Uint8Array([1, 2, 3]);
    await putGeneratedCertificateObject({
      key: "certificates/cert-1/opaque",
      body,
      contentType: "application/pdf",
    });

    const command = mockSend.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: "lms-private",
      Key: "certificates/cert-1/opaque",
      Body: body,
      ContentType: "application/pdf",
    });
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects every non-PDF content type before contacting storage", async () => {
    await expect(
      putGeneratedCertificateObject({
        key: "certificates/cert-1/opaque",
        body: new Uint8Array(),
        contentType: "text/html",
      }),
    ).rejects.toThrow(/application\/pdf/i);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("certificate and template-asset presigning", () => {
  it("presigns certificate downloads with the FILE-class lifetime", async () => {
    mockGetSignedUrl.mockResolvedValue("https://storage.example/certificate");
    await expect(
      presignCertificateObjectUrl({ key: "certificates/cert-1/opaque" }),
    ).resolves.toBe("https://storage.example/certificate");

    const [, command, options] = mockGetSignedUrl.mock.calls[0];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: "lms-private",
      Key: "certificates/cert-1/opaque",
      ResponseContentType: "application/pdf",
    });
    expect(options).toEqual({ expiresIn: 60 });
  });

  it("presigns an allowed raster image upload with its declared length", async () => {
    mockGetSignedUrl.mockResolvedValue("https://storage.example/template-asset");
    await presignTemplateAssetUploadUrl({
      key: "certificate-template-asset-uploads/tpl-1/opaque",
      contentType: "image/png",
      contentLength: 1024,
    });

    const [, command] = mockGetSignedUrl.mock.calls[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      ContentType: "image/png",
      ContentLength: 1024,
    });
  });

  it("rejects script-capable image types through the shared IMAGE rules", async () => {
    await expect(
      presignTemplateAssetUploadUrl({
        key: "certificate-template-asset-uploads/tpl-1/opaque",
        contentType: "image/svg+xml",
        contentLength: 1024,
      }),
    ).rejects.toThrow(/not an accepted type/i);
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });
});
