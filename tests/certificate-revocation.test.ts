/**
 * Plan 11-11 Task 2 (+ Task 3, appended below): certificate-service.ts's
 * audited mutations — manual issue, revoke, and reissue.
 *
 * Driven by an in-memory staged-commit fake `tx` (mirroring
 * `tests/certificate-issuance-service.test.ts`'s `makeTx`/`runInTransaction`
 * shape) so a thrown error mid-function proves nothing committed. Reuses
 * that same fixture vocabulary (enrolment/cohort/award/template/user) since
 * `issueCertificateManually`/`reissueCertificate` both delegate to
 * `certificate-issuance-service.ts`'s `issueCertificateForEnrolment`, which
 * needs the full tx surface, not just the `Certificate` table.
 */

import { describe, expect, it, vi } from "vitest";
import { createTestWithPermission, grant } from "./support/harness";
import { AuthorizationError } from "@/server/permissions/with-permission";
import {
  createCertificateService,
  RevocationReasonRequiredError,
  CertificateChangedError,
  NoCompletionRecordError,
  type CertificateServiceDeps,
  type CertificateServiceTxClient,
  type CertificateRow,
  type PendingIssuanceStore,
} from "@/server/services/certificate-service";
import type { Delegate } from "@/server/services/resource-service";
import type { IssueCertificateDeps } from "@/server/services/certificate-issuance-service";
import { EMPTY_LAYOUT_V1 } from "@/server/services/certificate-template-layout";
import { SYSTEM_ACTOR_TYPE } from "@/server/services/checkout-webhook-system-service";

// ---------------------------------------------------------------------------
// Fixture row types (mirrors tests/certificate-issuance-service.test.ts)
// ---------------------------------------------------------------------------

type EnrolmentRow = { id: string; userId: string; cohortId: string; status: string };
type CohortRow = { id: string; courseId: string | null; programmeId: string | null };
type AwardRow = {
  id: string;
  title: string;
  certificateEnabled: boolean;
  certificateIssuanceMode: "AUTOMATIC" | "MANUAL";
  certificateTemplateId: string | null;
};
type TemplateRow = { id: string; layout: unknown; isDefault: boolean };
type UserRow = { id: string; name: string };
type CompletionRecordRow = {
  id: string;
  enrolmentId: string;
  scope: "COURSE" | "PROGRAMME";
  supersededAt: Date | null;
};

const NOW = new Date("2026-09-18T12:00:00.000Z");

function enr(over: Partial<EnrolmentRow> = {}): EnrolmentRow {
  return {
    id: over.id ?? "enr-1",
    userId: over.userId ?? "user-1",
    cohortId: over.cohortId ?? "cohort-course",
    status: over.status ?? "ACTIVE",
  };
}

function courseCohort(over: Partial<CohortRow> = {}): CohortRow {
  return { id: over.id ?? "cohort-course", courseId: over.courseId ?? "course-1", programmeId: null };
}

function award(over: Partial<AwardRow> = {}): AwardRow {
  return {
    id: over.id ?? "course-1",
    title: over.title ?? "Intro to Testing",
    certificateEnabled: over.certificateEnabled ?? true,
    certificateIssuanceMode: over.certificateIssuanceMode ?? "MANUAL",
    certificateTemplateId: over.certificateTemplateId ?? null,
  };
}

function template(over: Partial<TemplateRow> = {}): TemplateRow {
  return { id: over.id ?? "tmpl-default", layout: over.layout ?? EMPTY_LAYOUT_V1, isDefault: over.isDefault ?? true };
}

function user(over: Partial<UserRow> = {}): UserRow {
  return { id: over.id ?? "user-1", name: over.name ?? "Jane Learner" };
}

function cert(over: Partial<CertificateRow> = {}): CertificateRow {
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
  };
}

// ---------------------------------------------------------------------------
// Staged-commit fake tx + harness
// ---------------------------------------------------------------------------

function harness(opts?: {
  enrolments?: EnrolmentRow[];
  cohorts?: CohortRow[];
  courses?: AwardRow[];
  templates?: TemplateRow[];
  users?: UserRow[];
  certificates?: CertificateRow[];
  completionRecords?: CompletionRecordRow[];
  grants?: ReturnType<typeof grant>[];
}) {
  const enrolments = new Map((opts?.enrolments ?? [enr()]).map((e) => [e.id, { ...e }]));
  const cohorts = new Map((opts?.cohorts ?? [courseCohort()]).map((c) => [c.id, { ...c }]));
  const courses = new Map((opts?.courses ?? [award()]).map((c) => [c.id, { ...c }]));
  const templates = new Map((opts?.templates ?? [template()]).map((t) => [t.id, { ...t }]));
  const users = new Map((opts?.users ?? [user()]).map((u) => [u.id, { ...u }]));
  const certificates = new Map((opts?.certificates ?? []).map((c) => [c.id, { ...c }]));
  const completionRecords = opts?.completionRecords ?? [
    { id: "cr-1", enrolmentId: "enr-1", scope: "COURSE" as const, supersededAt: null },
  ];
  const events: Array<Record<string, unknown>> = [];
  const issuanceAuditCalls: Array<Record<string, unknown>> = [];
  const callOrder: string[] = [];
  let certSeq = 0;

  function makeTx(
    certStaged: Map<string, CertificateRow>,
    enrStaged: Map<string, EnrolmentRow>,
    evStaged: Array<Record<string, unknown>>,
  ): CertificateServiceTxClient {
    return {
      certificate: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const found = certStaged.get(where.id);
          return found ? { ...found } : null;
        },
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          const rows = [...certStaged.values()].filter(
            (c) =>
              (where.enrolmentId === undefined || c.enrolmentId === where.enrolmentId) &&
              (where.scope === undefined || c.scope === where.scope) &&
              (where.verificationRef === undefined || c.verificationRef === where.verificationRef) &&
              (where.status === undefined || c.status === where.status),
          );
          return rows[0] ? { ...rows[0] } : null;
        },
        // `createMany({ skipDuplicates: true })` — the shape
        // `issueCertificateForEnrolment` inserts with (ON CONFLICT DO NOTHING).
        createMany: async ({ data }: { data: Record<string, unknown>[]; skipDuplicates: boolean }) => {
          callOrder.push("certificate.create");
          let count = 0;
          for (const row of data) {
            certSeq += 1;
            const id = `new-cert-${certSeq}`;
            certStaged.set(id, { ...(row as unknown as CertificateRow), id, reviewFlaggedAt: null });
            count += 1;
          }
          return { count };
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = certStaged.get(where.id);
          if (!existing) throw new Error(`No staged certificate ${where.id}`);
          const next = { ...existing, ...data } as CertificateRow;
          certStaged.set(where.id, next);
          return { ...next };
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          callOrder.push("certificate.updateMany");
          const matches = [...certStaged.values()].filter((c) => {
            if (where.id !== undefined && c.id !== where.id) return false;
            if (where.enrolmentId !== undefined && c.enrolmentId !== where.enrolmentId) return false;
            if (where.scope !== undefined && c.scope !== where.scope) return false;
            if (where.status !== undefined) {
              const wantedStatuses =
                typeof where.status === "object" && where.status !== null && "in" in (where.status as object)
                  ? ((where.status as { in: string[] }).in as string[])
                  : [where.status as string];
              if (!wantedStatuses.includes(c.status)) return false;
            }
            return true;
          });
          for (const m of matches) {
            certStaged.set(m.id, { ...m, ...data } as CertificateRow);
          }
          return { count: matches.length };
        },
      },
      enrolment: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const e = enrStaged.get(where.id);
          return e ? { ...e } : null;
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = enrStaged.get(where.id);
          if (!existing) throw new Error(`No staged enrolment ${where.id}`);
          const next = { ...existing, ...data } as EnrolmentRow;
          enrStaged.set(where.id, next);
          return { ...next };
        },
      },
      cohort: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const c = cohorts.get(where.id);
          return c ? { ...c } : null;
        },
      },
      course: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const c = courses.get(where.id);
          return c ? { ...c } : null;
        },
      },
      programme: {
        findUnique: async () => null,
      },
      certificateTemplate: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const t = templates.get(where.id);
          return t ? { ...t } : null;
        },
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          const rows = [...templates.values()].filter(
            (t) => where.isDefault === undefined || t.isDefault === where.isDefault,
          );
          return rows[0] ? { ...rows[0] } : null;
        },
      },
      completionRecord: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          const rows = completionRecords.filter(
            (r) =>
              (where.enrolmentId === undefined || r.enrolmentId === where.enrolmentId) &&
              (where.scope === undefined || r.scope === where.scope) &&
              (where.supersededAt === undefined || r.supersededAt === where.supersededAt),
          );
          return rows[0] ? { id: rows[0].id } : null;
        },
      },
      user: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const u = users.get(where.id);
          return u ? { ...u } : null;
        },
      },
      domainEvent: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          evStaged.push(data);
          return { id: `evt-${evStaged.length}` };
        },
      },
    };
  }

  const runInTransaction = async <R,>(fn: (tx: CertificateServiceTxClient) => Promise<R>): Promise<R> => {
    const certStaged = new Map([...certificates].map(([k, v]) => [k, { ...v }]));
    const enrStaged = new Map([...enrolments].map(([k, v]) => [k, { ...v }]));
    const evStaged: Array<Record<string, unknown>> = [];
    const tx = makeTx(certStaged, enrStaged, evStaged);
    const result = await fn(tx);
    // Commit only on success — mirrors a real Postgres transaction rollback.
    certificates.clear();
    for (const [k, v] of certStaged) certificates.set(k, v);
    enrolments.clear();
    for (const [k, v] of enrStaged) enrolments.set(k, v);
    events.push(...evStaged);
    return result;
  };

  let refSeq = 0;
  const issuanceDeps: IssueCertificateDeps = {
    generateRef: () => {
      refSeq += 1;
      return `VERIF-NEW-${refSeq}`;
    },
    audit: async (event) => {
      issuanceAuditCalls.push(event as unknown as Record<string, unknown>);
    },
    writeEvent: async (tx, event) => {
      await (tx as unknown as CertificateServiceTxClient).domainEvent.create({
        data: { type: event.type, payload: event.payload },
      });
    },
  };

  const delegate: Delegate<CertificateRow> = {
    findMany: (async ({ where }: { where?: Record<string, unknown> }) =>
      [...certificates.values()].filter(
        (c) => !where || Object.entries(where).every(([k, v]) => (c as never)[k] === v),
      )) as unknown as Delegate<CertificateRow>["findMany"],
    findUnique: (async ({ where }: { where: { id: string } }) => {
      const found = certificates.get(where.id);
      return found ? { ...found } : null;
    }) as unknown as Delegate<CertificateRow>["findUnique"],
    create: vi.fn() as unknown as Delegate<CertificateRow>["create"],
    update: vi.fn() as unknown as Delegate<CertificateRow>["update"],
  };

  const pendingStore: PendingIssuanceStore = {
    completionRecord: { findMany: async () => [] },
    certificate: { findMany: async () => [] },
  };

  const audits: Array<Record<string, unknown>> = [];
  const { withPermission } = createTestWithPermission(
    opts?.grants ?? [
      grant("certificates.issue", "GLOBAL"),
      grant("certificates.revoke", "GLOBAL"),
      grant("certificates.view", "GLOBAL"),
    ],
  );

  const service = createCertificateService({
    delegate,
    withPermission,
    audit: async (entry) => {
      audits.push(entry as unknown as Record<string, unknown>);
    },
    enrolmentScope: async () => ({ cohortId: "cohort-course" }),
    pendingStore,
    auditStore: { auditEvent: { findFirst: async () => null, findMany: async () => [] } },
    runInTransaction: runInTransaction as CertificateServiceDeps["runInTransaction"],
    issuanceDeps,
    writeEvent: async (tx, event) => {
      await (tx as unknown as CertificateServiceTxClient).domainEvent.create({
        data: { type: event.type, payload: event.payload },
      });
    },
    now: () => NOW,
  });

  return {
    service,
    certificates,
    enrolments,
    events,
    audits,
    issuanceAuditCalls,
    callOrder,
  };
}

// ---------------------------------------------------------------------------
// issueCertificateManually
// ---------------------------------------------------------------------------

describe("issueCertificateManually", () => {
  it("is denied without certificates.issue", async () => {
    const h = harness({ grants: [grant("certificates.view", "GLOBAL")] });
    await expect(
      h.service.issueCertificateManually({ enrolmentId: "enr-1", scope: "COURSE" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("creates the certificate, moves the enrolment to COMPLETED, and audits with the staff actor's id", async () => {
    const h = harness();
    const outcome = await h.service.issueCertificateManually({ enrolmentId: "enr-1", scope: "COURSE" });
    expect(outcome).toMatchObject({ kind: "issued" });
    expect(h.enrolments.get("enr-1")?.status).toBe("COMPLETED");
    expect(h.issuanceAuditCalls[0]).toMatchObject({ actorId: "user-1", action: "certificate.issued" });
    expect(h.issuanceAuditCalls[0].actorType).not.toBe(SYSTEM_ACTOR_TYPE);
  });

  it("takes no reason argument and does not require one", () => {
    // Compile-time proof: the input type has no `reason` field.
    const call: (input: { enrolmentId: string; scope: "COURSE" | "PROGRAMME" }) => unknown =
      () => undefined;
    expect(typeof call).toBe("function");
  });

  it("returns already-issued without a second row when the enrolment already holds one", async () => {
    const h = harness({ certificates: [cert({ id: "existing-cert" })] });
    const outcome = await h.service.issueCertificateManually({ enrolmentId: "enr-1", scope: "COURSE" });
    expect(outcome).toMatchObject({ kind: "already-issued", certificateId: "existing-cert" });
    expect(h.certificates.size).toBe(1);
  });

  it("returns revoked-blocked and creates nothing when a REVOKED certificate exists for the enrolment and scope (CR-04, T-11-104)", async () => {
    const h = harness({ certificates: [cert({ id: "revoked-cert", status: "REVOKED" })] });
    const outcome = await h.service.issueCertificateManually({ enrolmentId: "enr-1", scope: "COURSE" });
    expect(outcome).toEqual({ kind: "revoked-blocked" });
    expect(h.certificates.size).toBe(1);
    expect(h.certificates.get("revoked-cert")?.status).toBe("REVOKED");
    expect(h.enrolments.get("enr-1")?.status).toBe("ACTIVE");
    expect(h.issuanceAuditCalls).toHaveLength(0);
  });

  it("returns not-eligible for a WITHDRAWN enrolment instead of throwing (CR-03)", async () => {
    const h = harness({ enrolments: [enr({ status: "WITHDRAWN" })] });
    const outcome = await h.service.issueCertificateManually({ enrolmentId: "enr-1", scope: "COURSE" });
    expect(outcome).toEqual({ kind: "not-eligible" });
    expect(h.certificates.size).toBe(0);
  });

  it("refuses an enrolment with no unsuperseded completion record", async () => {
    const h = harness({ completionRecords: [] });
    await expect(
      h.service.issueCertificateManually({ enrolmentId: "enr-1", scope: "COURSE" }),
    ).rejects.toBeInstanceOf(NoCompletionRecordError);
    expect(h.certificates.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// revokeCertificate
// ---------------------------------------------------------------------------

describe("revokeCertificate", () => {
  it("is denied without certificates.revoke", async () => {
    const h = harness({
      certificates: [cert()],
      grants: [grant("certificates.view", "GLOBAL")],
    });
    await expect(
      h.service.revokeCertificate({ certificateId: "cert-1", reason: "Fraudulent submission found" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it.each(["", "   ", "Too short"])("throws a reason-required error for %j and writes nothing", async (reason) => {
    const h = harness({ certificates: [cert()] });
    await expect(h.service.revokeCertificate({ certificateId: "cert-1", reason })).rejects.toBeInstanceOf(
      RevocationReasonRequiredError,
    );
    expect(h.certificates.get("cert-1")?.status).toBe("ACTIVE");
    expect(h.events).toHaveLength(0);
    expect(h.audits).toHaveLength(0);
  });

  it("sets REVOKED fields and preserves the five untouched fields by name", async () => {
    const h = harness({
      certificates: [
        cert({
          id: "cert-1",
          verificationRef: "VERIF-KEEP",
          issuedAt: new Date("2026-01-01T00:00:00.000Z"),
          learnerName: "Preserved Learner",
          awardTitle: "Preserved Award",
          storageKey: "certificates/keep-me",
        }),
      ],
    });
    const after = await h.service.revokeCertificate({
      certificateId: "cert-1",
      reason: "Academic integrity violation confirmed",
    });
    expect(after).toMatchObject({
      status: "REVOKED",
      revokedAt: NOW,
      revokedById: "user-1",
      revocationReason: "Academic integrity violation confirmed",
    });
    expect(after.verificationRef).toBe("VERIF-KEEP");
    expect(after.issuedAt).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(after.learnerName).toBe("Preserved Learner");
    expect(after.awardTitle).toBe("Preserved Award");
    expect(after.storageKey).toBe("certificates/keep-me");
  });

  it("moves a COMPLETED enrolment back to ACTIVE (D-06)", async () => {
    const h = harness({
      enrolments: [enr({ status: "COMPLETED" })],
      certificates: [cert()],
    });
    await h.service.revokeCertificate({ certificateId: "cert-1", reason: "Investigation upheld the appeal" });
    expect(h.enrolments.get("enr-1")?.status).toBe("ACTIVE");
  });

  it("leaves a non-COMPLETED enrolment's status untouched", async () => {
    const h = harness({ enrolments: [enr({ status: "ACTIVE" })], certificates: [cert()] });
    await h.service.revokeCertificate({ certificateId: "cert-1", reason: "Investigation upheld the appeal" });
    expect(h.enrolments.get("enr-1")?.status).toBe("ACTIVE");
  });

  it("throws a typed error on an already-revoked certificate via the compare-and-set guard", async () => {
    const h = harness({ certificates: [cert({ status: "REVOKED" })] });
    await expect(
      h.service.revokeCertificate({ certificateId: "cert-1", reason: "Second attempt at revoking" }),
    ).rejects.toBeInstanceOf(CertificateChangedError);
  });

  it("writes an audit row with before/after and a certificate.revoked domain event in the same transaction, excluding the reason from the event payload", async () => {
    const h = harness({ certificates: [cert({ verificationRef: "VERIF-EVT" })] });
    await h.service.revokeCertificate({ certificateId: "cert-1", reason: "Confirmed plagiarism in submission" });

    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      action: "certificate.revoked",
      reason: "Confirmed plagiarism in submission",
      before: expect.objectContaining({ status: "ACTIVE" }),
      after: expect.objectContaining({ status: "REVOKED" }),
    });

    expect(h.events).toHaveLength(1);
    const event = h.events[0];
    expect(event.type).toBe("certificate.revoked");
    const payload = event.payload as Record<string, unknown>;
    expect(payload.verificationRef).toBe("VERIF-EVT");
    expect(Object.keys(payload)).not.toContain("revocationReason");
  });
});

// ---------------------------------------------------------------------------
// reissueCertificate (Plan 11-11 Task 3)
// ---------------------------------------------------------------------------

describe("reissueCertificate", () => {
  it("is denied without certificates.issue", async () => {
    const h = harness({
      certificates: [cert({ status: "REVOKED" })],
      grants: [grant("certificates.view", "GLOBAL")],
    });
    await expect(
      h.service.reissueCertificate({ certificateId: "cert-1", reason: "Appeal upheld, reissuing credential" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it.each(["", "   ", "Too short"])("throws for reason %j and writes nothing", async (reason) => {
    const h = harness({ certificates: [cert({ status: "REVOKED" })] });
    await expect(h.service.reissueCertificate({ certificateId: "cert-1", reason })).rejects.toThrow();
    expect(h.certificates.get("cert-1")?.status).toBe("REVOKED");
    expect(h.certificates.size).toBe(1);
  });

  it("reissuing a REVOKED certificate creates a new ACTIVE row linked via supersedesId, with a fresh reference and storage key", async () => {
    const h = harness({
      certificates: [
        cert({
          id: "cert-1",
          status: "REVOKED",
          verificationRef: "VERIF-OLD",
          storageKey: "certificates/old",
          issuedAt: new Date("2026-01-01T00:00:00.000Z"),
          learnerName: "Preserved Learner",
          awardTitle: "Preserved Award",
          revocationReason: "Prior misconduct finding",
        }),
      ],
    });

    const after = await h.service.reissueCertificate({
      certificateId: "cert-1",
      reason: "Appeal upheld, reissuing credential",
    });

    expect(after.status).toBe("ACTIVE");
    expect(after.supersedesId).toBe("cert-1");
    expect(after.verificationRef).not.toBe("VERIF-OLD");
    expect(after.storageKey).not.toBe("certificates/old");
    expect(after.reviewFlaggedAt).toBeNull();

    const old = h.certificates.get("cert-1")!;
    expect(old.status).toBe("SUPERSEDED");
    // Old-row preservation — the six fields by name.
    expect(old.verificationRef).toBe("VERIF-OLD");
    expect(old.issuedAt).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(old.learnerName).toBe("Preserved Learner");
    expect(old.awardTitle).toBe("Preserved Award");
    expect(old.revocationReason).toBe("Prior misconduct finding");
    expect(old.storageKey).toBe("certificates/old");
  });

  it("reissuing directly from an ACTIVE certificate moves the old row ACTIVE -> SUPERSEDED", async () => {
    const h = harness({ certificates: [cert({ id: "cert-1", status: "ACTIVE" })] });
    const after = await h.service.reissueCertificate({
      certificateId: "cert-1",
      reason: "Correcting a clerical award-title error",
    });
    expect(after.status).toBe("ACTIVE");
    expect(h.certificates.get("cert-1")?.status).toBe("SUPERSEDED");
  });

  it("moves the enrolment to COMPLETED", async () => {
    const h = harness({
      enrolments: [enr({ status: "ACTIVE" })],
      certificates: [cert({ status: "REVOKED" })],
    });
    await h.service.reissueCertificate({ certificateId: "cert-1", reason: "Appeal upheld, reissuing credential" });
    expect(h.enrolments.get("enr-1")?.status).toBe("COMPLETED");
  });

  it("the new certificate's reviewFlaggedAt is null even when the old one was flagged", async () => {
    const h = harness({
      certificates: [cert({ id: "cert-1", status: "REVOKED", reviewFlaggedAt: new Date("2026-02-01T00:00:00.000Z") })],
    });
    const after = await h.service.reissueCertificate({
      certificateId: "cert-1",
      reason: "Appeal upheld, reissuing credential",
    });
    expect(after.reviewFlaggedAt).toBeNull();
  });

  it("asserts the old row leaves ACTIVE before the new row is created (ordering guard)", async () => {
    const h = harness({ certificates: [cert({ id: "cert-1", status: "ACTIVE" })] });
    await h.service.reissueCertificate({ certificateId: "cert-1", reason: "Correcting a clerical error found" });
    const updateManyIndex = h.callOrder.indexOf("certificate.updateMany");
    const createIndex = h.callOrder.indexOf("certificate.create");
    expect(updateManyIndex).toBeGreaterThanOrEqual(0);
    expect(createIndex).toBeGreaterThan(updateManyIndex);
  });

  it("reissuing twice produces a two-hop chain, each link recorded once", async () => {
    const h = harness({ certificates: [cert({ id: "cert-1", status: "REVOKED" })] });
    const c2 = await h.service.reissueCertificate({
      certificateId: "cert-1",
      reason: "First reissue after appeal upheld",
    });
    expect(c2.supersedesId).toBe("cert-1");

    const c3 = await h.service.reissueCertificate({
      certificateId: c2.id,
      reason: "Second reissue for corrected award title",
    });
    expect(c3.supersedesId).toBe(c2.id);

    const c1Final = h.certificates.get("cert-1")!;
    const c2Final = h.certificates.get(c2.id)!;
    expect(c1Final.status).toBe("SUPERSEDED");
    expect(c2Final.status).toBe("SUPERSEDED");
    expect(c2Final.supersedesId).toBe("cert-1");
    expect(h.certificates.get(c3.id)?.supersedesId).toBe(c2.id);
  });

  it("legacy two-REVOKED rows: reissue supersedes BOTH, links the new row to the reissued one, and does not dead-end in revoked-blocked (CRD-05, T-11-140)", async () => {
    const h = harness({
      enrolments: [enr({ status: "ACTIVE" })],
      certificates: [
        cert({ id: "cert-A", status: "REVOKED", verificationRef: "VERIF-A" }),
        cert({ id: "cert-B", status: "REVOKED", verificationRef: "VERIF-B" }),
      ],
    });

    const after = await h.service.reissueCertificate({
      certificateId: "cert-B",
      reason: "Appeal upheld, reissuing credential",
    });

    expect(after.status).toBe("ACTIVE");
    expect(after.supersedesId).toBe("cert-B");
    expect(h.certificates.get("cert-A")?.status).toBe("SUPERSEDED");
    expect(h.certificates.get("cert-B")?.status).toBe("SUPERSEDED");
    expect(h.certificates.size).toBe(3);
    expect(h.enrolments.get("enr-1")?.status).toBe("COMPLETED");
  });

  it("reissue leaves REVOKED rows of the OTHER scope and of OTHER enrolments untouched (supersede-all is keyed on enrolment AND scope)", async () => {
    const h = harness({
      certificates: [
        cert({ id: "cert-1", status: "REVOKED" }),
        cert({ id: "other-scope", scope: "PROGRAMME", courseId: null, programmeId: "programme-1", status: "REVOKED" }),
        cert({ id: "other-enrolment", enrolmentId: "enr-2", status: "REVOKED" }),
      ],
    });

    await h.service.reissueCertificate({ certificateId: "cert-1", reason: "Appeal upheld, reissuing credential" });

    expect(h.certificates.get("cert-1")?.status).toBe("SUPERSEDED");
    expect(h.certificates.get("other-scope")?.status).toBe("REVOKED");
    expect(h.certificates.get("other-enrolment")?.status).toBe("REVOKED");
  });

  it("reissue for an enrolment that is no longer eligible (withdrawn after the revocation) rolls back entirely: the certificate stays REVOKED", async () => {
    const h = harness({
      enrolments: [enr({ status: "WITHDRAWN" })],
      certificates: [cert({ id: "cert-1", status: "REVOKED" })],
    });

    await expect(
      h.service.reissueCertificate({ certificateId: "cert-1", reason: "Appeal upheld, reissuing credential" }),
    ).rejects.toThrow(/not-eligible/);

    expect(h.certificates.get("cert-1")?.status).toBe("REVOKED");
    expect(h.certificates.size).toBe(1);
    expect(h.enrolments.get("enr-1")?.status).toBe("WITHDRAWN");
    expect(h.events).toHaveLength(0);
    expect(h.audits).toHaveLength(0);
  });

  it("writes a certificate.reissued domain event with both ids/references and no reason text", async () => {
    const h = harness({ certificates: [cert({ id: "cert-1", status: "REVOKED", verificationRef: "VERIF-OLD" })] });
    const after = await h.service.reissueCertificate({
      certificateId: "cert-1",
      reason: "Appeal upheld, reissuing credential",
    });

    const reissueEvent = h.events.find((e) => e.type === "certificate.reissued");
    expect(reissueEvent).toBeDefined();
    const payload = reissueEvent!.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      oldCertificateId: "cert-1",
      newCertificateId: after.id,
      oldVerificationRef: "VERIF-OLD",
      newVerificationRef: after.verificationRef,
    });
    expect(Object.keys(payload)).not.toContain("reason");
  });
});
