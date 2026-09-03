import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  listLessonResources: vi.fn(),
  retryLessonResource: vi.fn(),
  markRetryEnqueueFailed: vi.fn(),
  enqueueScan: vi.fn(async () => {}),
}));

class AuthenticationError extends Error {}
class AuthorizationError extends Error {}
class ResourceRetryNotAllowedError extends Error {}

vi.mock("@/server/permissions", () => ({ AuthenticationError, AuthorizationError }));
vi.mock("@/server/services/lesson-resource-service", () => ({
  listLessonResources: h.listLessonResources,
  retryLessonResource: h.retryLessonResource,
  markRetryEnqueueFailed: h.markRetryEnqueueFailed,
  ResourceRetryNotAllowedError,
}));
vi.mock("@/server/jobs/queue", () => ({ enqueueScan: h.enqueueScan }));

const { GET } = await import("@/app/api/lesson-resources/route");
const { POST } = await import("@/app/api/lesson-resources/[id]/retry/route");

const record = {
  id: "resource-1",
  lessonId: "lesson-1",
  title: "Handout",
  storageKey: "lessons/lesson-1/secret-key",
  filename: "handout.pdf",
  mimeType: "application/pdf",
  sizeBytes: BigInt(2_147_483_648),
  scanStatus: "ERROR" as const,
  uploadedById: "staff-1",
  scannedAt: new Date("2026-09-03T09:00:00Z"),
  scanDetail: "Scanner unavailable",
  position: 0,
  createdAt: new Date("2026-09-03T08:59:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  h.listLessonResources.mockResolvedValue([record]);
  h.retryLessonResource.mockResolvedValue({
    ...record,
    scanStatus: "PENDING",
    scanDetail: null,
    scannedAt: null,
  });
  h.markRetryEnqueueFailed.mockResolvedValue({
    ...record,
    scanStatus: "ERROR",
    scanDetail: "The scan could not be queued. Try again in a moment.",
    scannedAt: null,
  });
});

describe("GET /api/lesson-resources", () => {
  it("returns browser-safe status rows with BigInt serialized and storage details omitted", async () => {
    const response = await GET(
      new Request("http://localhost/api/lesson-resources?lessonId=lesson-1"),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.resources).toEqual([
      {
        id: "resource-1",
        title: "Handout",
        filename: "handout.pdf",
        mimeType: "application/pdf",
        sizeBytes: "2147483648",
        scanStatus: "ERROR",
        scanDetail: "Scanner unavailable",
        position: 0,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("storageKey");
    expect(JSON.stringify(body)).not.toContain("uploadedById");
  });

  it("returns 400 when lessonId is missing", async () => {
    const response = await GET(new Request("http://localhost/api/lesson-resources"));
    expect(response.status).toBe(400);
    expect(h.listLessonResources).not.toHaveBeenCalled();
  });

  it("returns an empty 404 for an unknown or unauthorized lesson", async () => {
    h.listLessonResources.mockRejectedValueOnce(new AuthorizationError("courses.view"));
    const response = await GET(
      new Request("http://localhost/api/lesson-resources?lessonId=lesson-1"),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
});

describe("POST /api/lesson-resources/[id]/retry", () => {
  it("resets the authorized ERROR row before enqueuing a fresh scan", async () => {
    const response = await POST(new Request("http://localhost/retry", { method: "POST" }), {
      params: Promise.resolve({ id: "resource-1" }),
    });
    expect(response.status).toBe(200);
    expect(h.retryLessonResource).toHaveBeenCalledWith("resource-1");
    expect(h.enqueueScan).toHaveBeenCalledWith("resource-1");
    expect(h.enqueueScan.mock.invocationCallOrder[0]).toBeGreaterThan(
      h.retryLessonResource.mock.invocationCallOrder[0],
    );
    expect(await response.json()).toMatchObject({
      resource: { id: "resource-1", scanStatus: "PENDING", scanDetail: null },
    });
  });

  it("rolls the row back to ERROR and returns 503 when the scan cannot be enqueued", async () => {
    h.enqueueScan.mockRejectedValueOnce(new Error("queue unavailable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(new Request("http://localhost/retry", { method: "POST" }), {
      params: Promise.resolve({ id: "resource-1" }),
    });

    expect(response.status).toBe(503);
    expect(h.retryLessonResource).toHaveBeenCalledWith("resource-1");
    expect(h.markRetryEnqueueFailed).toHaveBeenCalledWith("resource-1");
    const body = await response.json();
    expect(body.error).toMatch(/could not be queued/i);
    expect(body.resource).toMatchObject({ id: "resource-1", scanStatus: "ERROR" });
    errorSpy.mockRestore();
  });

  it("still returns 503 when the rollback write also fails", async () => {
    h.enqueueScan.mockRejectedValueOnce(new Error("queue unavailable"));
    h.markRetryEnqueueFailed.mockRejectedValueOnce(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(new Request("http://localhost/retry", { method: "POST" }), {
      params: Promise.resolve({ id: "resource-1" }),
    });

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatch(/could not be queued/i);
    expect(body.resource).toBeUndefined();
    errorSpy.mockRestore();
  });

  it("returns 409 and does not enqueue when the row is not in ERROR", async () => {
    h.retryLessonResource.mockRejectedValueOnce(new ResourceRetryNotAllowedError());
    const response = await POST(new Request("http://localhost/retry", { method: "POST" }), {
      params: Promise.resolve({ id: "resource-1" }),
    });
    expect(response.status).toBe(409);
    expect(h.enqueueScan).not.toHaveBeenCalled();
  });

  it("returns an empty 404 and does not enqueue on an authorization failure", async () => {
    h.retryLessonResource.mockRejectedValueOnce(new AuthenticationError());
    const response = await POST(new Request("http://localhost/retry", { method: "POST" }), {
      params: Promise.resolve({ id: "resource-1" }),
    });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(h.enqueueScan).not.toHaveBeenCalled();
  });
});
