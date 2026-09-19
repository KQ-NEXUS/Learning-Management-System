import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/api/certificates/[id]/download` exercised directly with a constructed
 * Request and injected service doubles, mirroring
 * `tests/lesson-resource-routes.test.ts`'s own GET-download suite — the
 * precedent this route's structure was copied from. Denial parity (T-11-59)
 * is the load-bearing property: the not-yours and does-not-exist cases must
 * assert byte-identical responses, not merely "both 404".
 */

const h = vi.hoisted(() => ({
  certificateGet: vi.fn(),
  getOwnCertificateForDownload: vi.fn(),
  presignCertificateObjectUrl: vi.fn(async () => "https://s3.example/o?X-Amz-Expires=60"),
  getCurrentActor: vi.fn(async (): Promise<{ userId: string } | null> => null),
  ensureCertificateFile: vi.fn(async (_id: string): Promise<string | null> => null),
}));

class AuthenticationError extends Error {}
class AuthorizationError extends Error {}

vi.mock("@/server/permissions", () => ({
  AuthenticationError,
  AuthorizationError,
}));

vi.mock("@/server/services/certificate-service", () => ({
  certificateService: { get: h.certificateGet },
  getOwnCertificateForDownload: h.getOwnCertificateForDownload,
}));

vi.mock("@/server/services/certificate-file-service", () => ({
  ensureCertificateFile: h.ensureCertificateFile,
}));

vi.mock("@/server/services/storage-service", () => ({
  presignCertificateObjectUrl: h.presignCertificateObjectUrl,
}));

vi.mock("@/server/auth/current-actor", () => ({
  getCurrentActor: h.getCurrentActor,
}));

const { GET } = await import("@/app/api/certificates/[id]/download/route");

const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) });

const activeCertificate = {
  id: "cert-1",
  enrolmentId: "enrolment-1",
  userId: "learner-1",
  scope: "COURSE" as const,
  courseId: "course-1",
  programmeId: null,
  awardTitle: "Course One",
  learnerName: "Learner One",
  issuedAt: new Date("2026-09-01T00:00:00.000Z"),
  status: "ACTIVE" as const,
  storageKey: "certificates/cert-1.pdf",
  verificationRef: "VERIF-REF-1",
  revokedAt: null,
  revokedById: null,
  revocationReason: null,
  supersedesId: null,
  reviewFlaggedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.presignCertificateObjectUrl.mockResolvedValue("https://s3.example/o?X-Amz-Expires=60");
  h.ensureCertificateFile.mockResolvedValue(null);
});

describe("GET /api/certificates/[id]/download", () => {
  it("302s the owner to a presigned URL with private, no-store", async () => {
    h.certificateGet.mockRejectedValueOnce(new AuthorizationError("certificates.view"));
    h.getCurrentActor.mockResolvedValueOnce({ userId: "learner-1" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce(activeCertificate);

    const response = await GET(new Request("http://localhost/d"), routeCtx("cert-1"));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://s3.example/o?X-Amz-Expires=60");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(h.presignCertificateObjectUrl).toHaveBeenCalledWith({ key: "certificates/cert-1.pdf" });
  });

  it("302s a staff actor with certificates.view in matching scope, never consulting the learner path", async () => {
    h.certificateGet.mockResolvedValueOnce(activeCertificate);

    const response = await GET(new Request("http://localhost/d"), routeCtx("cert-1"));

    expect(response.status).toBe(302);
    expect(h.getCurrentActor).not.toHaveBeenCalled();
    expect(h.getOwnCertificateForDownload).not.toHaveBeenCalled();
    // Normal path: the file already exists, so no on-demand production.
    expect(h.ensureCertificateFile).not.toHaveBeenCalled();
  });

  it("returns empty 404 for a signed-in learner who does not own the certificate", async () => {
    h.certificateGet.mockRejectedValueOnce(new AuthorizationError("certificates.view"));
    h.getCurrentActor.mockResolvedValueOnce({ userId: "someone-else" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce(null);

    const response = await GET(new Request("http://localhost/d"), routeCtx("cert-1"));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(h.ensureCertificateFile).not.toHaveBeenCalled();
  });

  it("returns empty 404 for an anonymous request", async () => {
    h.certificateGet.mockRejectedValueOnce(new AuthenticationError());
    h.getCurrentActor.mockResolvedValueOnce(null);

    const response = await GET(new Request("http://localhost/d"), routeCtx("cert-1"));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(h.getOwnCertificateForDownload).not.toHaveBeenCalled();
    expect(h.ensureCertificateFile).not.toHaveBeenCalled();
  });

  it("returns a 404 for an unknown certificate id byte-identical to the not-yours response", async () => {
    // not-yours
    h.certificateGet.mockRejectedValueOnce(new AuthorizationError("certificates.view"));
    h.getCurrentActor.mockResolvedValueOnce({ userId: "someone-else" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce(null);
    const notYours = await GET(new Request("http://localhost/d"), routeCtx("cert-1"));

    // does-not-exist
    h.certificateGet.mockRejectedValueOnce(new AuthorizationError("certificates.view"));
    h.getCurrentActor.mockResolvedValueOnce({ userId: "someone-else" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce(null);
    const notFound = await GET(new Request("http://localhost/d"), routeCtx("unknown-id"));

    expect(notFound.status).toBe(notYours.status);
    expect(await notFound.text()).toBe(await notYours.text());
    expect(h.ensureCertificateFile).not.toHaveBeenCalled();
    expect([...notFound.headers.keys()].sort()).toEqual([...notYours.headers.keys()].sort());
  });

  it("returns empty 404 when the owner requests a REVOKED certificate", async () => {
    h.certificateGet.mockRejectedValueOnce(new AuthorizationError("certificates.view"));
    h.getCurrentActor.mockResolvedValueOnce({ userId: "learner-1" });
    // getOwnCertificateForDownload itself returns null for REVOKED (T-11-60) —
    // exercised here as the route's observable behavior.
    h.getOwnCertificateForDownload.mockResolvedValueOnce(null);

    const response = await GET(new Request("http://localhost/d"), routeCtx("cert-1"));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(h.ensureCertificateFile).not.toHaveBeenCalled();
  });

  it("succeeds for a flagged-but-ACTIVE certificate owned by the caller", async () => {
    h.certificateGet.mockRejectedValueOnce(new AuthorizationError("certificates.view"));
    h.getCurrentActor.mockResolvedValueOnce({ userId: "learner-1" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce({
      ...activeCertificate,
      reviewFlaggedAt: new Date("2026-09-10T00:00:00.000Z"),
    });

    const response = await GET(new Request("http://localhost/d"), routeCtx("cert-1"));

    expect(response.status).toBe(302);
  });

  it("returns 404 rather than 500 when the certificate row has no storageKey", async () => {
    h.certificateGet.mockRejectedValueOnce(new AuthorizationError("certificates.view"));
    h.getCurrentActor.mockResolvedValueOnce({ userId: "learner-1" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce({ ...activeCertificate, storageKey: null });

    const response = await GET(new Request("http://localhost/d"), routeCtx("cert-1"));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(h.presignCertificateObjectUrl).not.toHaveBeenCalled();
  });

  it("produces a missing file on demand for the authorized owner, then presigns THAT key (plan 11-31)", async () => {
    h.certificateGet.mockRejectedValueOnce(new AuthorizationError("certificates.view"));
    h.getCurrentActor.mockResolvedValueOnce({ userId: "learner-1" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce({ ...activeCertificate, storageKey: null });
    h.ensureCertificateFile.mockResolvedValueOnce("certificates/cert-1/fresh.pdf");

    const response = await GET(new Request("http://localhost/d"), routeCtx("cert-1"));

    expect(h.ensureCertificateFile).toHaveBeenCalledTimes(1);
    expect(h.ensureCertificateFile).toHaveBeenCalledWith("cert-1");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://s3.example/o?X-Amz-Expires=60");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(h.presignCertificateObjectUrl).toHaveBeenCalledWith({ key: "certificates/cert-1/fresh.pdf" });
  });

  it("produces a missing file on demand for an authorized staff actor too", async () => {
    h.certificateGet.mockResolvedValueOnce({ ...activeCertificate, storageKey: null });
    h.ensureCertificateFile.mockResolvedValueOnce("certificates/cert-1/fresh.pdf");

    const response = await GET(new Request("http://localhost/d"), routeCtx("cert-1"));

    expect(h.ensureCertificateFile).toHaveBeenCalledWith("cert-1");
    expect(response.status).toBe(302);
    expect(h.presignCertificateObjectUrl).toHaveBeenCalledWith({ key: "certificates/cert-1/fresh.pdf" });
  });

  it("answers the same empty 404 as any denial when the file cannot be produced (ensure returns null)", async () => {
    // A denial for reference.
    h.certificateGet.mockRejectedValueOnce(new AuthorizationError("certificates.view"));
    h.getCurrentActor.mockResolvedValueOnce({ userId: "someone-else" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce(null);
    const denied = await GET(new Request("http://localhost/d"), routeCtx("cert-1"));

    h.certificateGet.mockRejectedValueOnce(new AuthorizationError("certificates.view"));
    h.getCurrentActor.mockResolvedValueOnce({ userId: "learner-1" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce({ ...activeCertificate, storageKey: null });
    h.ensureCertificateFile.mockResolvedValueOnce(null);
    const unproducible = await GET(new Request("http://localhost/d"), routeCtx("cert-1"));

    expect(h.ensureCertificateFile).toHaveBeenCalledTimes(1);
    expect(unproducible.status).toBe(404);
    expect(await unproducible.text()).toBe("");
    expect(unproducible.status).toBe(denied.status);
    expect([...unproducible.headers.keys()].sort()).toEqual([...denied.headers.keys()].sort());
    expect(h.presignCertificateObjectUrl).not.toHaveBeenCalled();
  });

  it("only responds after the on-demand production finished (no fire-and-forget)", async () => {
    h.certificateGet.mockRejectedValueOnce(new AuthorizationError("certificates.view"));
    h.getCurrentActor.mockResolvedValueOnce({ userId: "learner-1" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce({ ...activeCertificate, storageKey: null });
    let release: (key: string) => void = () => undefined;
    h.ensureCertificateFile.mockImplementationOnce(
      () => new Promise<string | null>((resolve) => (release = resolve)),
    );

    let settled = false;
    const pending = GET(new Request("http://localhost/d"), routeCtx("cert-1")).then((r) => {
      settled = true;
      return r;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    expect(h.presignCertificateObjectUrl).not.toHaveBeenCalled();

    release("certificates/cert-1/late.pdf");
    const response = await pending;
    expect(response.status).toBe(302);
    expect(h.presignCertificateObjectUrl).toHaveBeenCalledWith({ key: "certificates/cert-1/late.pdf" });
  });

  it("never leaks a certificate id, storage key, learner name, or error message in the response body", async () => {
    h.certificateGet.mockRejectedValueOnce(new AuthorizationError("certificates.view"));
    h.getCurrentActor.mockResolvedValueOnce({ userId: "someone-else" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce(null);

    const response = await GET(new Request("http://localhost/d"), routeCtx("cert-1"));
    const body = await response.text();

    expect(body).toBe("");
    expect(body).not.toContain("cert-1");
    expect(body).not.toContain("certificates/cert-1.pdf");
    expect(body).not.toContain("Learner One");
  });
});
