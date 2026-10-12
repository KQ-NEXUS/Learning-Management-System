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
  /** True when the caller owns the certificate the owner path refused (it is revoked or superseded). */
  ownerOfWithdrawn: vi.fn((): boolean => false),
  canAnywhere: vi.fn(async (_permission: string): Promise<boolean> => false),
  presignCertificateObjectUrl: vi.fn(async () => "https://s3.example/o?X-Amz-Expires=60"),
  getCurrentActor: vi.fn(async (): Promise<{ userId: string } | null> => null),
  ensureCertificateFile: vi.fn(async (_id: string): Promise<string | null> => null),
}));

class AuthenticationError extends Error {}
class AuthorizationError extends Error {}

vi.mock("@/server/permissions", () => ({
  AuthenticationError,
  AuthorizationError,
  canAnywhere: h.canAnywhere,
}));

vi.mock("@/server/services/certificate-service", () => ({
  certificateService: { get: h.certificateGet },
  // The route asks one question with three answers. The cases below keep saying what the
  // owner lookup found (`getOwnCertificateForDownload`) and, when it found nothing, whether
  // the caller is nevertheless the owner (`ownerOfWithdrawn`).
  resolveOwnCertificateForDownload: async (actor: { userId: string }, id: string) => {
    const certificate = await h.getOwnCertificateForDownload(actor, id);
    if (certificate) return { kind: "served", certificate };
    return h.ownerOfWithdrawn() ? { kind: "owner-refused" } : { kind: "not-owner" };
  },
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
  // resetAllMocks, not clearAllMocks: a queued "once" answer that a case did
  // not use must not leak into the next case.
  vi.resetAllMocks();
  h.getCurrentActor.mockResolvedValue(null);
  h.presignCertificateObjectUrl.mockResolvedValue("https://s3.example/o?X-Amz-Expires=60");
  h.ensureCertificateFile.mockResolvedValue(null);
});

describe("GET /api/certificates/[id]/download", () => {
  it("302s the owner to a presigned URL with private, no-store", async () => {
    h.getCurrentActor.mockResolvedValueOnce({ userId: "learner-1" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce(activeCertificate);

    const response = await GET(new Request("http://localhost/d"), routeCtx("cert-1"));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://s3.example/o?X-Amz-Expires=60");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(h.presignCertificateObjectUrl).toHaveBeenCalledWith({ key: "certificates/cert-1.pdf" });
  });

  // W-15: the staff check records an "authorization.denied" audit row when it
  // refuses. An owner fetching their own certificate is not a denial, so the
  // staff permission is not asked for them at all.
  it("serves the owner without ever asking for the staff permission (no denial row to write)", async () => {
    h.getCurrentActor.mockResolvedValueOnce({ userId: "learner-1" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce(activeCertificate);

    const response = await GET(new Request("http://localhost/d"), routeCtx("cert-1"));

    expect(response.status).toBe(302);
    expect(h.getOwnCertificateForDownload).toHaveBeenCalledWith({ userId: "learner-1" }, "cert-1");
    expect(h.certificateGet).not.toHaveBeenCalled();
  });

  it("still asks for the staff permission, and so still records the denial, for anyone the owner path refuses", async () => {
    // A signed-in person who does not own it, and a visitor. Neither is ever excused from the
    // audited check, whatever permission they hold.
    const refusedByOwnerPath: Array<{ userId: string } | null> = [{ userId: "someone-else" }, null];
    for (const actor of refusedByOwnerPath) {
      h.certificateGet.mockReset();
      h.certificateGet.mockRejectedValueOnce(actor ? new AuthorizationError("certificates.view") : new AuthenticationError());
      h.getCurrentActor.mockResolvedValueOnce(actor);
      h.getOwnCertificateForDownload.mockResolvedValueOnce(null);

      const response = await GET(new Request("http://localhost/d"), routeCtx("cert-1"));

      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
      expect(h.certificateGet).toHaveBeenCalledTimes(1);
      expect(h.certificateGet).toHaveBeenCalledWith("cert-1");
      expect(h.canAnywhere).not.toHaveBeenCalled();
    }
  });

  // W-15, the remaining case: a learner asking for their OWN certificate after it was revoked
  // is refused by the certificate's state, not by a missing permission. The audited staff
  // check is not run for them, so no "authorization.denied" row is written.
  it("refuses the owner of a revoked certificate without running the audited staff check", async () => {
    h.getCurrentActor.mockResolvedValueOnce({ userId: "learner-1" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce(null);
    h.ownerOfWithdrawn.mockReturnValueOnce(true);
    h.canAnywhere.mockResolvedValueOnce(false);

    const response = await GET(new Request("http://localhost/d"), routeCtx("cert-1"));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(h.canAnywhere).toHaveBeenCalledWith("certificates.view");
    expect(h.certificateGet).not.toHaveBeenCalled();
    expect(h.ensureCertificateFile).not.toHaveBeenCalled();
  });

  it("answers the owner of a revoked certificate exactly as it answers a stranger", async () => {
    h.getCurrentActor.mockResolvedValueOnce({ userId: "learner-1" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce(null);
    h.ownerOfWithdrawn.mockReturnValueOnce(true);
    const owner = await GET(new Request("http://localhost/d"), routeCtx("cert-1"));

    h.getCurrentActor.mockResolvedValueOnce({ userId: "someone-else" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce(null);
    h.certificateGet.mockRejectedValueOnce(new AuthorizationError("certificates.view"));
    const stranger = await GET(new Request("http://localhost/d"), routeCtx("cert-1"));

    expect(owner.status).toBe(stranger.status);
    expect(await owner.text()).toBe(await stranger.text());
    expect([...owner.headers.keys()].sort()).toEqual([...stranger.headers.keys()].sort());
  });

  it("still runs the audited staff check for an owner who holds certificates.view somewhere", async () => {
    // Served when their scope covers it: staff may open a revoked certificate, their own included.
    h.getCurrentActor.mockResolvedValueOnce({ userId: "staff-owner" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce(null);
    h.ownerOfWithdrawn.mockReturnValueOnce(true);
    h.canAnywhere.mockResolvedValueOnce(true);
    h.certificateGet.mockResolvedValueOnce({ ...activeCertificate, status: "REVOKED" as const });
    expect((await GET(new Request("http://localhost/d"), routeCtx("cert-1"))).status).toBe(302);

    // Refused, and recorded by the check, when their scope does not cover it.
    h.getCurrentActor.mockResolvedValueOnce({ userId: "staff-owner" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce(null);
    h.ownerOfWithdrawn.mockReturnValueOnce(true);
    h.canAnywhere.mockResolvedValueOnce(true);
    h.certificateGet.mockRejectedValueOnce(new AuthorizationError("certificates.view"));
    expect((await GET(new Request("http://localhost/d"), routeCtx("cert-1"))).status).toBe(404);
    expect(h.certificateGet).toHaveBeenCalledTimes(2);
  });

  it("302s a staff actor with certificates.view in matching scope who is not the owner", async () => {
    h.getCurrentActor.mockResolvedValueOnce({ userId: "staff-1" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce(null);
    h.certificateGet.mockResolvedValueOnce(activeCertificate);

    const response = await GET(new Request("http://localhost/d"), routeCtx("cert-1"));

    expect(response.status).toBe(302);
    expect(h.certificateGet).toHaveBeenCalledWith("cert-1");
    // Normal path: the file already exists, so no on-demand production.
    expect(h.ensureCertificateFile).not.toHaveBeenCalled();
  });

  it("lets staff with certificates.view open a certificate the owner path refuses (a revoked one)", async () => {
    h.getCurrentActor.mockResolvedValueOnce({ userId: "staff-1" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce(null);
    h.certificateGet.mockResolvedValueOnce({ ...activeCertificate, status: "REVOKED" as const });

    const response = await GET(new Request("http://localhost/d"), routeCtx("cert-1"));

    expect(response.status).toBe(302);
  });

  it("rethrows an unexpected error from the staff check instead of hiding it as a refusal", async () => {
    h.getCurrentActor.mockResolvedValueOnce({ userId: "someone-else" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce(null);
    h.certificateGet.mockRejectedValueOnce(new Error("database is down"));

    await expect(GET(new Request("http://localhost/d"), routeCtx("cert-1"))).rejects.toThrow("database is down");
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
    h.getCurrentActor.mockResolvedValueOnce({ userId: "learner-1" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce({
      ...activeCertificate,
      reviewFlaggedAt: new Date("2026-09-10T00:00:00.000Z"),
    });

    const response = await GET(new Request("http://localhost/d"), routeCtx("cert-1"));

    expect(response.status).toBe(302);
  });

  it("returns 404 rather than 500 when the certificate row has no storageKey", async () => {
    h.getCurrentActor.mockResolvedValueOnce({ userId: "learner-1" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce({ ...activeCertificate, storageKey: null });

    const response = await GET(new Request("http://localhost/d"), routeCtx("cert-1"));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(h.presignCertificateObjectUrl).not.toHaveBeenCalled();
  });

  it("produces a missing file on demand for the authorized owner, then presigns THAT key (plan 11-31)", async () => {
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
    h.getCurrentActor.mockResolvedValueOnce({ userId: "staff-1" });
    h.getOwnCertificateForDownload.mockResolvedValueOnce(null);
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
