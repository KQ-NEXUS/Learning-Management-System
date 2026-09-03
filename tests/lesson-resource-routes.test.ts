import { beforeEach, describe, expect, it, vi } from "vitest";
import { downloadTtlFor } from "@/lib/upload-limits";

/**
 * The route handlers are exercised directly with a constructed Request and
 * injected service doubles — eslint and tsc prove they compile; only this
 * proves they behave.
 */

const h = vi.hoisted(() => ({
  authorize: vi.fn(async () => {}),
  putLessonObject: vi.fn(async () => ({ bytesUploaded: 1 })),
  buildStorageKey: vi.fn(() => "lessons/l1/opaque-key"),
  presignLessonObjectUrl: vi.fn(
    async (args: {
      key: string;
      lessonType: string;
      filename?: string;
      contentType?: string;
    }) => `https://storage.example/o?lessonType=${args.lessonType}`,
  ),
  createLessonResource: vi.fn(async () => ({ id: "res-1", scanStatus: "PENDING" })),
  enqueueScan: vi.fn(async () => {}),
  getLessonTypeById: vi.fn(async () => "FILE"),
}));

class AuthenticationError extends Error {}
class AuthorizationError extends Error {}
class ResourceNotScannedError extends Error {}
class ResourceInfectedError extends Error {}
class UploadTooLargeError extends Error {}

vi.mock("@/server/permissions", () => ({
  AuthenticationError,
  AuthorizationError,
  withPermission:
    (_permission: string, resolveScope: (input: unknown) => unknown) =>
    (handler: (input: unknown, ctx: { actor: { userId: string } }) => unknown) =>
    async (input: unknown) => {
      await resolveScope(input);
      await h.authorize();
      return handler(input, { actor: { userId: "tester" } });
    },
}));

vi.mock("@/server/services/lesson-service", () => ({
  lessonScope: vi.fn(async () => ({ courseIds: ["c1"] })),
  getLessonTypeById: h.getLessonTypeById,
}));

vi.mock("@/server/services/storage-service", () => ({
  buildStorageKey: h.buildStorageKey,
  putLessonObject: h.putLessonObject,
  toNodeStream: (body: unknown) => body,
  presignLessonObjectUrl: h.presignLessonObjectUrl,
  UploadTooLargeError,
}));

vi.mock("@/server/services/lesson-resource-service", () => ({
  createLessonResource: h.createLessonResource,
  getDownloadableResource: vi.fn(),
  ResourceNotScannedError,
  ResourceInfectedError,
}));

vi.mock("@/server/jobs/queue", () => ({ enqueueScan: h.enqueueScan }));

const { POST } = await import("@/app/api/lesson-resources/upload/route");
const { GET } = await import("@/app/api/lesson-resources/[id]/download/route");
const lessonResourceService = await import("@/server/services/lesson-resource-service");
const getDownloadableResource = vi.mocked(lessonResourceService.getDownloadableResource);

function uploadRequest(overrides: Partial<Record<string, string>> = {}, body = "x") {
  const params = new URLSearchParams({
    lessonId: "l1",
    title: "Slides",
    filename: "slides.pdf",
    mimeType: "application/pdf",
    sizeBytes: "2000",
    ...overrides,
  });
  return new Request(`http://localhost/api/lesson-resources/upload?${params}`, {
    method: "POST",
    body,
    // @ts-expect-error — Node/undici requires duplex for a streamed body
    duplex: "half",
  });
}

const downloadCtx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.authorize.mockResolvedValue(undefined);
  h.getLessonTypeById.mockResolvedValue("FILE");
  h.createLessonResource.mockResolvedValue({ id: "res-1", scanStatus: "PENDING" });
});

describe("POST /api/lesson-resources/upload", () => {
  it("accepts a body larger than 1 MB — the reason this is a Route Handler", async () => {
    const big = "a".repeat(1_500_000);
    const res = await POST(uploadRequest({ sizeBytes: String(big.length) }, big));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "res-1", scanStatus: "PENDING" });
    expect(h.putLessonObject).toHaveBeenCalledOnce();
  });

  it("returns 404 with an empty body for a caller without courses.edit — never 403", async () => {
    h.authorize.mockRejectedValueOnce(new AuthorizationError("courses.edit"));
    const res = await POST(uploadRequest());
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(h.putLessonObject).not.toHaveBeenCalled();
  });

  it("returns 422 and never streams when the declared mimeType fails validateUpload", async () => {
    const res = await POST(uploadRequest({ mimeType: "text/html" }));
    expect(res.status).toBe(422);
    expect(h.putLessonObject).not.toHaveBeenCalled();
  });

  it("streams only AFTER authorization has resolved", async () => {
    await POST(uploadRequest());
    expect(h.authorize).toHaveBeenCalled();
    expect(h.putLessonObject.mock.invocationCallOrder[0]).toBeGreaterThan(
      h.authorize.mock.invocationCallOrder[0],
    );
  });

  it("enqueues a scan for the created resource", async () => {
    await POST(uploadRequest());
    expect(h.enqueueScan).toHaveBeenCalledWith("res-1");
  });
});

describe("GET /api/lesson-resources/[id]/download", () => {
  it("302s a CLEAN FILE resource to a URL whose expiry is 60 seconds", async () => {
    getDownloadableResource.mockResolvedValueOnce({
      id: "res-1",
      storageKey: "lessons/l1/k",
      filename: "f.pdf",
      mimeType: "application/pdf",
      lesson: { type: "FILE" },
    } as never);
    h.presignLessonObjectUrl.mockImplementationOnce(
      async ({ lessonType }) =>
        `https://s3.example/o?X-Amz-Expires=${downloadTtlFor(lessonType)}`,
    );

    const res = await GET(new Request("http://localhost/d"), downloadCtx("res-1"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("X-Amz-Expires=60");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("302s a CLEAN VIDEO resource to a URL whose expiry is 14400 and differs from FILE", async () => {
    getDownloadableResource.mockResolvedValueOnce({
      id: "res-2",
      storageKey: "lessons/l1/v",
      filename: "v.mp4",
      mimeType: "video/mp4",
      lesson: { type: "VIDEO" },
    } as never);
    h.presignLessonObjectUrl.mockImplementationOnce(
      async ({ lessonType }) =>
        `https://s3.example/o?X-Amz-Expires=${downloadTtlFor(lessonType)}`,
    );

    const res = await GET(new Request("http://localhost/d"), downloadCtx("res-2"));
    expect(res.headers.get("location")).toContain("X-Amz-Expires=14400");
    expect(downloadTtlFor("VIDEO")).not.toBe(downloadTtlFor("FILE"));
  });

  it("returns 409 and no Location for a PENDING resource", async () => {
    getDownloadableResource.mockRejectedValueOnce(new ResourceNotScannedError());
    const res = await GET(new Request("http://localhost/d"), downloadCtx("res-3"));
    expect(res.status).toBe(409);
    expect(res.headers.get("location")).toBeNull();
  });

  it("returns 404 and no Location for an INFECTED resource — never 403", async () => {
    getDownloadableResource.mockRejectedValueOnce(new ResourceInfectedError());
    const res = await GET(new Request("http://localhost/d"), downloadCtx("res-4"));
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
  });

  it("returns 404 for a caller lacking courses.view — never 403", async () => {
    getDownloadableResource.mockRejectedValueOnce(new AuthorizationError("courses.view"));
    const res = await GET(new Request("http://localhost/d"), downloadCtx("res-5"));
    expect(res.status).toBe(404);
  });
});
