/**
 * Plan 11-11 Task 1: certificate-service.ts's read surface — scoped
 * list/get, the D-04 pending-issuance evaluator, the learner ownership
 * predicate, and the UI-SPEC §5 status-tone helper.
 *
 * Driven entirely by fake delegates/stores plus a harness-built
 * `withPermission` (`createTestWithPermission`) — no real Postgres. The
 * mutation surface (Task 2/3: issue/revoke/reissue) is covered separately by
 * `tests/certificate-revocation.test.ts`.
 */

import { describe, expect, it, vi } from "vitest";
import { createTestWithPermission, grant } from "./support/harness";
import { AuthorizationError } from "@/server/permissions/with-permission";
import {
  createCertificateService,
  certificateDisplayStatus,
  type CertificateRow,
  type CertificateServiceDeps,
  type PendingIssuanceCompletionRecordRow,
  type PendingIssuanceStore,
} from "@/server/services/certificate-service";
import type { Delegate } from "@/server/services/resource-service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function cert(over: Partial<CertificateRow & { cohortId: string }> = {}): CertificateRow & { cohortId: string } {
  return {
    id: over.id ?? "cert-1",
    enrolmentId: over.enrolmentId ?? "enr-1",
    userId: over.userId ?? "user-1",
    scope: over.scope ?? "COURSE",
    courseId: over.courseId ?? "course-1",
    programmeId: over.programmeId ?? null,
    awardTitle: over.awardTitle ?? "Intro to Testing",
    learnerName: over.learnerName ?? "Jane Learner",
    issuedAt: over.issuedAt ?? new Date("2026-09-01T00:00:00.000Z"),
    status: over.status ?? "ACTIVE",
    storageKey: over.storageKey ?? "certificates/cert-1",
    verificationRef: over.verificationRef ?? "VERIF-1",
    revokedAt: over.revokedAt ?? null,
    revokedById: over.revokedById ?? null,
    revocationReason: over.revocationReason ?? null,
    supersedesId: over.supersedesId ?? null,
    reviewFlaggedAt: over.reviewFlaggedAt ?? null,
    cohortId: over.cohortId ?? "cohort-1",
  };
}

/** A no-op stub for the mutation-only deps this Task-1 test file never exercises. */
function unusedRunInTransaction(): CertificateServiceDeps["runInTransaction"] {
  return (async (fn) => fn({} as never)) as CertificateServiceDeps["runInTransaction"];
}

type AuditRowFixture = {
  targetId: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  createdAt: Date;
};

function harness(opts?: {
  certs?: Array<CertificateRow & { cohortId: string }>;
  grants?: ReturnType<typeof grant>[];
  pendingRecords?: Array<PendingIssuanceCompletionRecordRow & { supersededAt: Date | null }>;
  activeCertificates?: Array<{
    enrolmentId: string;
    scope: "COURSE" | "PROGRAMME";
    /** Defaults to ACTIVE; the fake honours the query's `status` filter as Prisma would. */
    status?: "ACTIVE" | "REVOKED" | "SUPERSEDED";
  }>;
  cohortByEnrolment?: Record<string, string>;
  auditRows?: AuditRowFixture[];
}) {
  const certs = opts?.certs ?? [cert()];
  const cohortByEnrolment = opts?.cohortByEnrolment ?? { "enr-1": "cohort-1" };

  const findManyMock = vi.fn(async ({ where }: { where?: { cohortId?: string } }) =>
    certs.filter((c) => !where?.cohortId || c.cohortId === where.cohortId),
  );
  const findUniqueMock = vi.fn(async ({ where }: { where: { id: string } }) => {
    const found = certs.find((c) => c.id === where.id);
    return found ? { ...found } : null;
  });

  const delegate: Delegate<CertificateRow> = {
    findMany: findManyMock as unknown as Delegate<CertificateRow>["findMany"],
    findUnique: findUniqueMock as unknown as Delegate<CertificateRow>["findUnique"],
    create: vi.fn() as unknown as Delegate<CertificateRow>["create"],
    update: vi.fn() as unknown as Delegate<CertificateRow>["update"],
  };

  const pendingRecordsFixture = opts?.pendingRecords ?? [];
  const activeCertificates = opts?.activeCertificates ?? [];

  const completionRecordFindMany = vi.fn(
    async ({ where }: { where: { supersededAt: null } }) =>
      pendingRecordsFixture
        .filter((r) => r.supersededAt === where.supersededAt)
        .map((r) => r as unknown as PendingIssuanceCompletionRecordRow),
  );
  const certificateFindManyForPending = vi.fn(
    async ({ where }: { where: { status?: string | { in: string[] } } }) => {
      const wanted =
        typeof where.status === "string"
          ? [where.status]
          : where.status && "in" in where.status
            ? where.status.in
            : null;
      return activeCertificates
        .filter((c) => wanted === null || wanted.includes(c.status ?? "ACTIVE"))
        .map((c) => ({ enrolmentId: c.enrolmentId, scope: c.scope }));
    },
  );

  const pendingStore: PendingIssuanceStore = {
    completionRecord: { findMany: completionRecordFindMany as unknown as PendingIssuanceStore["completionRecord"]["findMany"] },
    certificate: { findMany: certificateFindManyForPending as unknown as PendingIssuanceStore["certificate"]["findMany"] },
  };

  const auditRows = opts?.auditRows ?? [];
  const auditFindManyWheres: Array<Record<string, unknown>> = [];
  const auditFindMany = vi.fn(
    async (args: { where: Record<string, unknown>; orderBy?: Record<string, unknown> }) => {
      auditFindManyWheres.push(args.where);
      const where = args.where as {
        targetType?: string;
        targetId?: { in: string[] };
        action?: { in: string[] };
      };
      const matched = auditRows.filter(
        (r) =>
          where.targetType === "Certificate" &&
          (where.targetId?.in ?? []).includes(r.targetId) &&
          (where.action?.in ?? []).includes(r.action),
      );
      // Honour orderBy createdAt desc, as Prisma would.
      matched.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return matched.map((r) => ({
        targetId: r.targetId,
        actorId: r.actorId,
        action: r.action,
        actor: r.actorName === null ? null : { name: r.actorName },
      }));
    },
  );

  const { withPermission } = createTestWithPermission(opts?.grants ?? [grant("certificates.view", "GLOBAL")]);

  const service = createCertificateService({
    delegate,
    withPermission,
    audit: vi.fn(async () => {}),
    enrolmentScope: async (enrolmentId: string) => ({ cohortId: cohortByEnrolment[enrolmentId] }),
    pendingStore,
    auditStore: { auditEvent: { findFirst: async () => null, findMany: auditFindMany } },
    runInTransaction: unusedRunInTransaction(),
    issuanceDeps: {} as never,
    writeEvent: (async () => {}) as never,
  });

  return { service, findManyMock, findUniqueMock, completionRecordFindMany, auditFindMany, auditFindManyWheres };
}

// ---------------------------------------------------------------------------
// list/get scoping
// ---------------------------------------------------------------------------

describe("certificateService.list/get scoping", () => {
  it("returns only certificates within the caller's scope — a sibling cohort's certificate is absent", async () => {
    const h = harness({
      certs: [
        cert({ id: "cert-1", cohortId: "cohort-1" }),
        cert({ id: "cert-2", cohortId: "cohort-2" }),
      ],
      grants: [grant("certificates.view", "COHORT", "cohort-1")],
    });

    const rows = await h.service.certificateService.list({
      where: { cohortId: "cohort-1" },
      scope: { cohortId: "cohort-1" },
    });

    expect(rows.map((r) => r.id)).toEqual(["cert-1"]);
    expect(rows.some((r) => r.id === "cert-2")).toBe(false);
  });

  it("denies list for a caller without certificates.view", async () => {
    const h = harness({ grants: [] });
    await expect(h.service.certificateService.list({})).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("denies get for a caller without certificates.view", async () => {
    const h = harness({ grants: [] });
    await expect(h.service.certificateService.get("cert-1")).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("does not export a generic create/update/archive", () => {
    // Structural proof, not just the file-level grep gate: the returned
    // object literal is exactly {list, get}.
    const h = harness();
    expect(Object.keys(h.service.certificateService).sort()).toEqual(["get", "list"]);
  });
});

// ---------------------------------------------------------------------------
// listPendingIssuance (D-04)
// ---------------------------------------------------------------------------

type PendingEnrolment = PendingIssuanceCompletionRecordRow["enrolment"];

function pendingRecord(
  over: Partial<Omit<PendingIssuanceCompletionRecordRow, "enrolment"> & { supersededAt: Date | null }> & {
    /** Enrolment status; defaults to ACTIVE (certificate-eligible). */
    status?: string;
    enrolment?: Omit<PendingEnrolment, "status"> & { status?: string };
  } = {},
): PendingIssuanceCompletionRecordRow & { supersededAt: Date | null } {
  return {
    enrolmentId: over.enrolmentId ?? "enr-1",
    scope: over.scope ?? "COURSE",
    completedAt: over.completedAt ?? new Date("2026-09-01T00:00:00.000Z"),
    supersededAt: over.supersededAt ?? null,
    enrolment: {
      status: over.status ?? "ACTIVE",
      ...(over.enrolment ?? {
        userId: "user-1",
        user: { name: "Jane Learner" },
        cohort: {
          courseId: "course-1",
          programmeId: null,
          course: {
            id: "course-1",
            title: "Intro to Testing",
            certificateEnabled: true,
            certificateIssuanceMode: "MANUAL" as const,
          },
          programme: null,
        },
      }),
    },
  };
}

describe("listPendingIssuance", () => {
  it("returns an eligible enrolment: unsuperseded record, MANUAL mode, certificateEnabled, no existing certificate", async () => {
    const h = harness({ pendingRecords: [pendingRecord()] });
    const rows = await h.service.listPendingIssuance();
    expect(rows).toEqual([
      {
        enrolmentId: "enr-1",
        learnerName: "Jane Learner",
        awardTitle: "Intro to Testing",
        awardType: "Course",
        eligibleSince: new Date("2026-09-01T00:00:00.000Z"),
        scope: "COURSE",
      },
    ]);
  });

  it("excludes an enrolment once a certificate already exists for it", async () => {
    const h = harness({
      pendingRecords: [pendingRecord()],
      activeCertificates: [{ enrolmentId: "enr-1", scope: "COURSE" }],
    });
    const rows = await h.service.listPendingIssuance();
    expect(rows).toEqual([]);
  });

  it("excludes an AUTOMATIC-mode enrolment", async () => {
    const h = harness({
      pendingRecords: [
        pendingRecord({
          enrolment: {
            userId: "user-1",
            user: { name: "Jane Learner" },
            cohort: {
              courseId: "course-1",
              programmeId: null,
              course: {
                id: "course-1",
                title: "Intro to Testing",
                certificateEnabled: true,
                certificateIssuanceMode: "AUTOMATIC",
              },
              programme: null,
            },
          },
        }),
      ],
    });
    const rows = await h.service.listPendingIssuance();
    expect(rows).toEqual([]);
  });

  it("excludes an enrolment whose CompletionRecord has been superseded", async () => {
    const h = harness({
      pendingRecords: [pendingRecord({ supersededAt: new Date("2026-09-05T00:00:00.000Z") })],
    });
    const rows = await h.service.listPendingIssuance();
    expect(rows).toEqual([]);
    // The exclusion happens via the query's where clause, not in-memory —
    // prove the fake was actually asked for supersededAt: null.
    expect(h.completionRecordFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ supersededAt: null }) }),
    );
  });

  it.each(["WITHDRAWN", "PENDING_PAYMENT", "TRANSFERRED", "CANCELLED"])(
    "omits a completed MANUAL enrolment whose status is %s (CR-03: Issue would always fail for it)",
    async (status) => {
      const h = harness({ pendingRecords: [pendingRecord({ status })] });
      expect(await h.service.listPendingIssuance()).toEqual([]);
    },
  );

  it.each(["ACTIVE", "COMPLETED"])("still lists a completed MANUAL enrolment whose status is %s", async (status) => {
    const h = harness({ pendingRecords: [pendingRecord({ status })] });
    const rows = await h.service.listPendingIssuance();
    expect(rows).toHaveLength(1);
  });

  it("yields exactly one row for a Programme cohort — the PROGRAMME-scope entry, never one per member course", async () => {
    const programmeCohort = {
      courseId: null,
      programmeId: "programme-1",
      course: null,
      programme: {
        id: "programme-1",
        title: "Full Stack Programme",
        certificateEnabled: true,
        certificateIssuanceMode: "MANUAL" as const,
      },
    };
    const h = harness({
      pendingRecords: [
        pendingRecord({
          scope: "COURSE",
          enrolment: { userId: "user-1", user: { name: "Jane Learner" }, cohort: programmeCohort },
        }),
        pendingRecord({
          scope: "PROGRAMME",
          enrolment: { userId: "user-1", user: { name: "Jane Learner" }, cohort: programmeCohort },
        }),
      ],
    });
    const rows = await h.service.listPendingIssuance();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ scope: "PROGRAMME", awardType: "Programme", awardTitle: "Full Stack Programme" });
  });
});

// ---------------------------------------------------------------------------
// getOwnCertificateForDownload
// ---------------------------------------------------------------------------

describe("getOwnCertificateForDownload", () => {
  it("returns the certificate for its owning actor", async () => {
    const h = harness({ certs: [cert({ id: "cert-1", userId: "user-1" })] });
    const result = await h.service.getOwnCertificateForDownload({ userId: "user-1" }, "cert-1");
    expect(result?.id).toBe("cert-1");
  });

  it("returns null for a non-owning actor, including staff without certificates.view", async () => {
    const h = harness({ certs: [cert({ id: "cert-1", userId: "user-1" })] });
    expect(await h.service.getOwnCertificateForDownload({ userId: "user-2" }, "cert-1")).toBeNull();
  });

  it("returns null for an unknown certificate id", async () => {
    const h = harness({ certs: [cert({ id: "cert-1", userId: "user-1" })] });
    expect(await h.service.getOwnCertificateForDownload({ userId: "user-1" }, "does-not-exist")).toBeNull();
  });

  it("returns null for a REVOKED certificate", async () => {
    const h = harness({ certs: [cert({ id: "cert-1", userId: "user-1", status: "REVOKED" })] });
    expect(await h.service.getOwnCertificateForDownload({ userId: "user-1" }, "cert-1")).toBeNull();
  });

  it("returns the certificate for a flagged-but-ACTIVE one", async () => {
    const h = harness({
      certs: [cert({ id: "cert-1", userId: "user-1", status: "ACTIVE", reviewFlaggedAt: new Date() })],
    });
    const result = await h.service.getOwnCertificateForDownload({ userId: "user-1" }, "cert-1");
    expect(result?.id).toBe("cert-1");
  });
});

// ---------------------------------------------------------------------------
// certificateDisplayStatus (UI-SPEC §5)
// ---------------------------------------------------------------------------

describe("certificateDisplayStatus", () => {
  it("REVOKED takes precedence over everything", () => {
    expect(certificateDisplayStatus({ status: "REVOKED", reviewFlaggedAt: new Date() })).toBe("revoked");
  });

  it("a flagged-but-ACTIVE certificate reads as flagged, never active", () => {
    expect(certificateDisplayStatus({ status: "ACTIVE", reviewFlaggedAt: new Date() })).toBe("flagged");
  });

  it("SUPERSEDED reads as superseded when unflagged", () => {
    expect(certificateDisplayStatus({ status: "SUPERSEDED", reviewFlaggedAt: null })).toBe("superseded");
  });

  it("an unflagged ACTIVE certificate reads as active", () => {
    expect(certificateDisplayStatus({ status: "ACTIVE", reviewFlaggedAt: null })).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// listCertificateIssuanceSources (plan 11-22, UAT test 8)
// ---------------------------------------------------------------------------

describe("listCertificateIssuanceSources", () => {
  const auto: AuditRowFixture = {
    targetId: "a",
    action: "certificate.issued_auto",
    actorId: null,
    actorName: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
  };
  const staff: AuditRowFixture = {
    targetId: "b",
    action: "certificate.issued",
    actorId: "u1",
    actorName: "Ngozi Eze",
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
  };

  it("maps automatic / staff / not-recorded per certificate", async () => {
    const h = harness({ auditRows: [auto, staff] });
    const result = await h.service.listCertificateIssuanceSources({ certificateIds: ["a", "b", "c"] });
    expect(result).toEqual({
      a: { kind: "automatic" },
      b: { kind: "staff", actorName: "Ngozi Eze" },
      c: { kind: "not-recorded" },
    });
  });

  it("yields staff with a null name when the actor no longer resolves", async () => {
    const h = harness({ auditRows: [{ ...staff, actorName: null }] });
    const result = await h.service.listCertificateIssuanceSources({ certificateIds: ["b"] });
    expect(result).toEqual({ b: { kind: "staff", actorName: null } });
  });

  it("the most recent issuance row wins", async () => {
    const h = harness({
      auditRows: [
        { ...auto, targetId: "a", createdAt: new Date("2026-09-01T00:00:00.000Z") },
        {
          targetId: "a",
          action: "certificate.issued",
          actorId: "u2",
          actorName: "Later Staff",
          createdAt: new Date("2026-09-02T00:00:00.000Z"),
        },
      ],
    });
    const result = await h.service.listCertificateIssuanceSources({ certificateIds: ["a"] });
    expect(result).toEqual({ a: { kind: "staff", actorName: "Later Staff" } });
  });

  it("returns {} for an empty id list without querying the audit store", async () => {
    const h = harness();
    const result = await h.service.listCertificateIssuanceSources({ certificateIds: [] });
    expect(result).toEqual({});
    expect(h.auditFindMany).not.toHaveBeenCalled();
  });

  it("queries exactly the Certificate target, the requested ids and the two issuance actions", async () => {
    const h = harness({ auditRows: [auto] });
    await h.service.listCertificateIssuanceSources({ certificateIds: ["a", "b"] });
    expect(h.auditFindMany).toHaveBeenCalledTimes(1);
    expect(h.auditFindManyWheres[0]).toEqual({
      targetType: "Certificate",
      targetId: { in: ["a", "b"] },
      action: { in: ["certificate.issued", "certificate.issued_auto"] },
    });
  });

  it("ignores audit actions other than the two issuance actions (guard)", async () => {
    const h = harness({
      auditRows: [{ ...staff, targetId: "a", action: "certificate.revoked" }],
    });
    const result = await h.service.listCertificateIssuanceSources({ certificateIds: ["a"] });
    expect(result).toEqual({ a: { kind: "not-recorded" } });
  });

  it("never leaks an actor id into the returned shape", async () => {
    const h = harness({ auditRows: [auto, staff] });
    const result = await h.service.listCertificateIssuanceSources({ certificateIds: ["a", "b", "c"] });
    for (const value of Object.values(result)) {
      expect(Object.keys(value)).not.toContain("actorId");
    }
    expect(JSON.stringify(result)).not.toContain("u1");
  });

  it("denies a caller without certificates.view", async () => {
    const h = harness({ grants: [], auditRows: [auto] });
    await expect(
      h.service.listCertificateIssuanceSources({ certificateIds: ["a"] }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(h.auditFindMany).not.toHaveBeenCalled();
  });

  it("denies a cohort-scoped grant (the list itself needs a global grant)", async () => {
    const h = harness({ grants: [grant("certificates.view", "COHORT", "cohort-1")], auditRows: [auto] });
    await expect(
      h.service.listCertificateIssuanceSources({ certificateIds: ["a"] }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
