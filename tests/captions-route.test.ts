import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/lesson-resources/[id]/captions (NFR-09 / NFR-06, plan 15-23).
 * The service is mocked: this proves the route's own contract — status codes,
 * headers and empty bodies on every denial. The authorisation decision itself is
 * proven against real rows in captions.integration.test.ts.
 */

const h = vi.hoisted(() => ({
  getCurrentActor: vi.fn(async (): Promise<{ userId: string } | null> => ({ userId: "learner-1" })),
  readCaptionForLearnerOrStaff: vi.fn(),
}));

vi.mock("@/server/auth/current-actor", () => ({ getCurrentActor: h.getCurrentActor }));
vi.mock("@/server/services/lesson-resource-service", () => ({
  readCaptionForLearnerOrStaff: h.readCaptionForLearnerOrStaff,
}));

const { GET } = await import("@/app/api/lesson-resources/[id]/captions/route");

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const request = () => new Request("http://localhost/api/lesson-resources/cap-1/captions");

const VTT = "WEBVTT\n\n00:00.000 --> 00:02.000\nHello\n";

beforeEach(() => {
  vi.clearAllMocks();
  h.getCurrentActor.mockResolvedValue({ userId: "learner-1" });
  h.readCaptionForLearnerOrStaff.mockResolvedValue({ id: "cap-1", body: VTT });
});

describe("GET /api/lesson-resources/[id]/captions", () => {
  it("serves the VTT body as text/vtt with a private no-store cache policy", async () => {
    const response = await GET(request(), ctx("cap-1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/vtt; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe(VTT);
    expect(h.readCaptionForLearnerOrStaff).toHaveBeenCalledWith({ userId: "learner-1" }, "cap-1");
  });

  it("answers an empty 404 when the service refuses (denial, unknown id, non-caption or not clean)", async () => {
    h.readCaptionForLearnerOrStaff.mockResolvedValueOnce(null);
    const response = await GET(request(), ctx("cap-1"));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(response.headers.get("content-type") ?? "").not.toContain("text/vtt");
  });

  it("passes a null actor through (staff access needs no learner session) and still 404s on refusal", async () => {
    h.getCurrentActor.mockResolvedValueOnce(null);
    h.readCaptionForLearnerOrStaff.mockResolvedValueOnce(null);
    const response = await GET(request(), ctx("cap-1"));
    expect(h.readCaptionForLearnerOrStaff).toHaveBeenCalledWith(null, "cap-1");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
});
