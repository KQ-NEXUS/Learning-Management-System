import { beforeEach, describe, expect, it, vi } from "vitest";
import { downloadTtlFor } from "@/lib/upload-limits";

/**
 * The lesson-resource route handlers are exercised directly with a constructed
 * Request and injected service doubles — eslint and tsc prove they compile;
 * only this proves they behave. The three-request upload flow is
 * upload-intent -> direct PUT (browser only) -> complete.
 */

const h = vi.hoisted(() => ({
  authorize: vi.fn(async () => {}),
  buildStagedStorageKey: vi.fn(() => "lesson-uploads/l1/opaque"),
  presignLessonUploadUrl: vi.fn(async () => "https://storage.example/presigned-put"),
  presignLessonObjectUrl: vi.fn(
    async (args: { lessonType: string }) =>
      `https://s3.example/o?X-Amz-Expires=${downloadTtlFor(args.lessonType)}`,
  ),
  beginLessonResourceUpload: vi.fn(),
  completeLessonResourceUpload: vi.fn(),
  removeLessonResource: vi.fn(async () => {}),
  listLessonResources: vi.fn(),
  getDownloadableResource: vi.fn(),
  getLessonTypeById: vi.fn(async (): Promise<string | null> => "FILE"),
}));

class AuthenticationError extends Error {}
class AuthorizationError extends Error {}
class ResourceUploadValidationError extends Error {
  constructor(
    message: string,
    readonly resource: unknown,
  ) {
    super(message);
  }
}
class ResourceUploadPendingError extends Error {}
class ResourceUploadUnavailableError extends Error {}

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
  buildStagedStorageKey: h.buildStagedStorageKey,
  presignLessonUploadUrl: h.presignLessonUploadUrl,
  presignLessonObjectUrl: h.presignLessonObjectUrl,
}));

vi.mock("@/server/services/lesson-resource-service", () => ({
  beginLessonResourceUpload: h.beginLessonResourceUpload,
  completeLessonResourceUpload: h.completeLessonResourceUpload,
  removeLessonResource: h.removeLessonResource,
  listLessonResources: h.listLessonResources,
  getDownloadableResource: h.getDownloadableResource,
  ResourceUploadValidationError,
  ResourceUploadPendingError,
  ResourceUploadUnavailableError,
}));

const { POST: POST_INTENT } = await import("@/app/api/lesson-resources/upload-intent/route");
const { POST: POST_COMPLETE } = await import("@/app/api/lesson-resources/[id]/complete/route");
const { DELETE: DELETE_RESOURCE } = await import("@/app/api/lesson-resources/[id]/route");
const { GET: GET_LIST } = await import("@/app/api/lesson-resources/route");
const { GET: GET_DOWNLOAD } = await import("@/app/api/lesson-resources/[id]/download/route");

const uploadingRecord = {
  id: "res-1",
  lessonId: "l1",
  title: "Slides",
  storageKey: "lesson-uploads/l1/opaque",
  filename: "slides.pdf",
  mimeType: "application/pdf",
  sizeBytes: BigInt(2000),
  uploadStatus: "UPLOADING" as const,
  uploadedById: "staff-1",
  uploadedAt: null,
  uploadDetail: null,
  position: 0,
  createdAt: new Date("2026-09-10T12:00:00Z"),
};

const intentRequest = (overrides: Record<string, unknown> = {}) =>
  new Request("http://localhost/api/lesson-resources/upload-intent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      lessonId: "l1",
      title: "Slides",
      filename: "slides.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2000,
      ...overrides,
    }),
  });

const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.authorize.mockResolvedValue(undefined);
  h.getLessonTypeById.mockResolvedValue("FILE");
  h.buildStagedStorageKey.mockReturnValue("lesson-uploads/l1/opaque");
  h.presignLessonUploadUrl.mockResolvedValue("https://storage.example/presigned-put");
  h.beginLessonResourceUpload.mockResolvedValue(uploadingRecord);
});

describe("POST /api/lesson-resources/upload-intent", () => {
  it("returns 201 with the UPLOADING row and a PUT URL bound to the declared type", async () => {
    const response = await POST_INTENT(intentRequest());
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      resource: { id: "res-1", uploadStatus: "UPLOADING" },
      upload: {
        url: "https://storage.example/presigned-put",
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        expiresIn: 900,
      },
    });
    expect(h.presignLessonUploadUrl).toHaveBeenCalledWith({
      key: "lesson-uploads/l1/opaque",
      contentType: "application/pdf",
    });
  });

  it("returns 400 for a body that is not valid JSON", async () => {
    const response = await POST_INTENT(
      new Request("http://localhost/api/lesson-resources/upload-intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ not json",
      }),
    );
    expect(response.status).toBe(400);
    expect(h.presignLessonUploadUrl).not.toHaveBeenCalled();
  });

  it("returns empty 404 before presigning when courses.edit is denied", async () => {
    h.authorize.mockRejectedValueOnce(new AuthorizationError("courses.edit"));
    const response = await POST_INTENT(intentRequest());
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(h.presignLessonUploadUrl).not.toHaveBeenCalled();
  });

  it.each([
    ["ZIP", { mimeType: "application/zip" }],
    ["oversized file", { sizeBytes: 60 * 1024 * 1024 }],
  ] as const)("returns 422 for %s", async (_case, overrides) => {
    const response = await POST_INTENT(intentRequest(overrides));
    expect(response.status).toBe(422);
    expect(h.beginLessonResourceUpload).not.toHaveBeenCalled();
    expect(h.presignLessonUploadUrl).not.toHaveBeenCalled();
  });

  it("returns 422 when the real lesson type does not accept uploads", async () => {
    h.getLessonTypeById.mockResolvedValueOnce("TEXT");
    const response = await POST_INTENT(intentRequest());
    expect(response.status).toBe(422);
    expect(h.presignLessonUploadUrl).not.toHaveBeenCalled();
  });

  it("returns empty 404 for an unknown lesson without confirming existence", async () => {
    h.getLessonTypeById.mockResolvedValueOnce(null);
    const response = await POST_INTENT(intentRequest());
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
});

describe("POST /api/lesson-resources/[id]/complete", () => {
  it("completes an authorized staged resource and returns READY", async () => {
    h.completeLessonResourceUpload.mockResolvedValueOnce({
      ...uploadingRecord,
      uploadStatus: "READY",
    });
    const response = await POST_COMPLETE(
      new Request("http://localhost/complete", { method: "POST" }),
      routeCtx("res-1"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ resource: { id: "res-1", uploadStatus: "READY" } });
  });

  it("returns 422 with the ERROR resource when object verification fails", async () => {
    const failed = {
      ...uploadingRecord,
      uploadStatus: "ERROR",
      uploadDetail: "The uploaded object could not be verified.",
    };
    h.completeLessonResourceUpload.mockRejectedValueOnce(
      new ResourceUploadValidationError(failed.uploadDetail, failed),
    );
    const response = await POST_COMPLETE(
      new Request("http://localhost/complete", { method: "POST" }),
      routeCtx("res-1"),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ resource: { uploadStatus: "ERROR" } });
  });

  it("returns empty 404 when completion is not authorized", async () => {
    h.completeLessonResourceUpload.mockRejectedValueOnce(new AuthorizationError("courses.edit"));
    const response = await POST_COMPLETE(
      new Request("http://localhost/complete", { method: "POST" }),
      routeCtx("res-1"),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
});

describe("DELETE /api/lesson-resources/[id]", () => {
  it("removes an authorized resource with 204 and no body", async () => {
    const response = await DELETE_RESOURCE(
      new Request("http://localhost/resource", { method: "DELETE" }),
      routeCtx("res-1"),
    );
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(h.removeLessonResource).toHaveBeenCalledWith("res-1");
  });

  it("returns empty 404 when removal is not authorized", async () => {
    h.removeLessonResource.mockRejectedValueOnce(new AuthorizationError("courses.edit"));
    const response = await DELETE_RESOURCE(
      new Request("http://localhost/resource", { method: "DELETE" }),
      routeCtx("res-1"),
    );
    expect(response.status).toBe(404);
  });
});

describe("GET /api/lesson-resources", () => {
  it("returns browser-safe rows with BigInt serialized and storage details omitted", async () => {
    h.listLessonResources.mockResolvedValueOnce([
      { ...uploadingRecord, uploadStatus: "ERROR", uploadDetail: "Upload failed.", sizeBytes: BigInt(2_147_483_648) },
    ]);
    const response = await GET_LIST(
      new Request("http://localhost/api/lesson-resources?lessonId=l1"),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.resources).toEqual([
      {
        id: "res-1",
        title: "Slides",
        filename: "slides.pdf",
        mimeType: "application/pdf",
        sizeBytes: "2147483648",
        uploadStatus: "ERROR",
        uploadDetail: "Upload failed.",
        position: 0,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("storageKey");
    expect(JSON.stringify(body)).not.toContain("uploadedById");
  });

  it("returns 400 when lessonId is missing", async () => {
    const response = await GET_LIST(new Request("http://localhost/api/lesson-resources"));
    expect(response.status).toBe(400);
    expect(h.listLessonResources).not.toHaveBeenCalled();
  });

  it("returns an empty 404 for an unknown or unauthorized lesson", async () => {
    h.listLessonResources.mockRejectedValueOnce(new AuthorizationError("courses.view"));
    const response = await GET_LIST(
      new Request("http://localhost/api/lesson-resources?lessonId=l1"),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
});

describe("GET /api/lesson-resources/[id]/download", () => {
  it("302s a READY FILE resource to a 60-second URL with no-store", async () => {
    h.getDownloadableResource.mockResolvedValueOnce({
      id: "res-1",
      storageKey: "lessons/l1/k",
      filename: "f.pdf",
      mimeType: "application/pdf",
      lesson: { type: "FILE" },
    });
    const response = await GET_DOWNLOAD(new Request("http://localhost/d"), routeCtx("res-1"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("X-Amz-Expires=60");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("302s a READY VIDEO resource to a 14400-second URL that differs from FILE", async () => {
    h.getDownloadableResource.mockResolvedValueOnce({
      id: "res-2",
      storageKey: "lessons/l1/v",
      filename: "v.mp4",
      mimeType: "video/mp4",
      lesson: { type: "VIDEO" },
    });
    const response = await GET_DOWNLOAD(new Request("http://localhost/d"), routeCtx("res-2"));
    expect(response.headers.get("location")).toContain("X-Amz-Expires=14400");
    expect(downloadTtlFor("VIDEO")).not.toBe(downloadTtlFor("FILE"));
  });

  it("returns 409 without Location while a resource is UPLOADING", async () => {
    h.getDownloadableResource.mockRejectedValueOnce(new ResourceUploadPendingError());
    const response = await GET_DOWNLOAD(new Request("http://localhost/d"), routeCtx("res-1"));
    expect(response.status).toBe(409);
    expect(response.headers.get("location")).toBeNull();
  });

  it("returns empty 404 without Location for an ERROR resource", async () => {
    h.getDownloadableResource.mockRejectedValueOnce(new ResourceUploadUnavailableError());
    const response = await GET_DOWNLOAD(new Request("http://localhost/d"), routeCtx("res-1"));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(response.headers.get("location")).toBeNull();
  });

  it("returns 404 for a caller lacking courses.view — never 403", async () => {
    h.getDownloadableResource.mockRejectedValueOnce(new AuthorizationError("courses.view"));
    const response = await GET_DOWNLOAD(new Request("http://localhost/d"), routeCtx("res-1"));
    expect(response.status).toBe(404);
  });
});
