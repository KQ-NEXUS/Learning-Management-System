/**
 * Plan 11-07: certificate-issuance-service.ts (CRD-01, CRD-02, CRD-06 —
 * attendance/lesson half).
 *
 * Driven by an in-memory staged-commit fake `tx` (mirroring
 * `tests/attendance-service.test.ts`'s `makeTx`/`runInTransaction` shape) so
 * a thrown error mid-function proves nothing committed — the same guarantee
 * a real Postgres transaction rollback gives in production. No Postgres;
 * `tests/certificate-concurrency.integration.test.ts` (11-16) proves the
 * real partial-unique-index race.
 */

import { describe, expect, it } from "vitest";
import {
  issueCertificateForEnrolment,
  reactToCompletionResults,
  recalculateCompletionAndIssue,
  flagCertificateForReview,
  flagCertificatesForGradeCorrection,
  type CertificateIssuanceTxClient,
  type IssueCertificateDeps,
  type IssueCertificateActor,
} from "@/server/services/certificate-issuance-service";
import type { CompletionScopeResult, CompletionRecalculationResult } from "@/server/services/completion-service";
import type { LessonProgressServiceDeps } from "@/server/services/lesson-progress-service";
import type { AttendanceServiceDeps } from "@/server/services/attendance-service";
import { EMPTY_LAYOUT_V1 } from "@/server/services/certificate-template-layout";
import { SYSTEM_ACTOR_TYPE } from "@/server/services/checkout-webhook-system-service";

// ---------------------------------------------------------------------------
// Compile-time assignability — a signature drift here fails `tsc`, not a
// later runtime call (11-07 Task 2 acceptance criteria).
// ---------------------------------------------------------------------------

const _asLessonProgressDep: LessonProgressServiceDeps["recalculateCompletion"] =
  recalculateCompletionAndIssue;
const _asAttendanceDep: AttendanceServiceDeps["recalculateCompletion"] =
  recalculateCompletionAndIssue;
void _asLessonProgressDep;
void _asAttendanceDep;

// ---------------------------------------------------------------------------
// Fixtures
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
type CertRow = {
  id: string;
  enrolmentId: string;
  userId: string;
  scope: "COURSE" | "PROGRAMME";
  courseId: string | null;
  programmeId: string | null;
  awardTitle: string;
  learnerName: string;
  issuedAt: Date;
  status: "ACTIVE" | "REVOKED" | "SUPERSEDED";
  verificationRef: string;
  storageKey: string | null;
  reviewFlaggedAt: Date | null;
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

function programmeCohort(over: Partial<CohortRow> = {}): CohortRow {
  return { id: over.id ?? "cohort-programme", courseId: null, programmeId: over.programmeId ?? "programme-1" };
}

function award(over: Partial<AwardRow> = {}): AwardRow {
  return {
    id: over.id ?? "course-1",
    title: over.title ?? "Intro to Testing",
    certificateEnabled: over.certificateEnabled ?? true,
    certificateIssuanceMode: over.certificateIssuanceMode ?? "AUTOMATIC",
    certificateTemplateId: over.certificateTemplateId ?? null,
  };
}

function template(over: Partial<TemplateRow> = {}): TemplateRow {
  return {
    id: over.id ?? "tmpl-default",
    layout: over.layout ?? EMPTY_LAYOUT_V1,
    isDefault: over.isDefault ?? true,
  };
}

function user(over: Partial<UserRow> = {}): UserRow {
  return { id: over.id ?? "user-1", name: over.name ?? "Jane Learner" };
}

// ---------------------------------------------------------------------------
// Staged-commit fake tx + harness
// ---------------------------------------------------------------------------

function harness(opts?: {
  enrolments?: EnrolmentRow[];
  cohorts?: CohortRow[];
  courses?: AwardRow[];
  programmes?: AwardRow[];
  templates?: TemplateRow[];
  users?: UserRow[];
  certificates?: CertRow[];
}) {
  const enrolments = new Map((opts?.enrolments ?? [enr()]).map((e) => [e.id, { ...e }]));
  const cohorts = new Map((opts?.cohorts ?? [courseCohort()]).map((c) => [c.id, { ...c }]));
  const courses = new Map((opts?.courses ?? [award()]).map((c) => [c.id, { ...c }]));
  const programmes = new Map((opts?.programmes ?? []).map((p) => [p.id, { ...p }]));
  const templates = new Map((opts?.templates ?? [template()]).map((t) => [t.id, { ...t }]));
  const users = new Map((opts?.users ?? [user()]).map((u) => [u.id, { ...u }]));
  const certificates = new Map((opts?.certificates ?? []).map((c) => [c.id, { ...c }]));
  const events: Array<Record<string, unknown>> = [];
  let certSeq = 0;

  function makeTx(
    certStaged: Map<string, CertRow>,
    enrStaged: Map<string, EnrolmentRow>,
    evStaged: Array<Record<string, unknown>>,
  ): CertificateIssuanceTxClient {
    return {
      certificate: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          const rows = [...certStaged.values()].filter(
            (c) =>
              (where.enrolmentId === undefined || c.enrolmentId === where.enrolmentId) &&
              (where.scope === undefined || c.scope === where.scope) &&
              (where.status === undefined || c.status === where.status),
          );
          return rows[0] ? { ...rows[0] } : null;
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          certSeq += 1;
          const id = `cert-${certSeq}`;
          certStaged.set(id, { ...(data as unknown as CertRow), id, reviewFlaggedAt: null });
          return { id };
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = certStaged.get(where.id);
          if (!existing) throw new Error(`No staged certificate ${where.id}`);
          const next = { ...existing, ...data } as CertRow;
          certStaged.set(where.id, next);
          return { ...next };
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
        findUnique: async ({ where }: { where: { id: string } }) => {
          const p = programmes.get(where.id);
          return p ? { ...p } : null;
        },
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
        findFirst: async () => null,
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

  const runInTransaction = async <R>(fn: (tx: CertificateIssuanceTxClient) => Promise<R>): Promise<R> => {
    const certStaged = new Map([...certificates].map(([k, v]) => [k, { ...v }]));
    const enrStaged = new Map([...enrolments].map(([k, v]) => [k, { ...v }]));
    const evStaged: Array<Record<string, unknown>> = [];
    const tx = makeTx(certStaged, enrStaged, evStaged);
    const result = await fn(tx);
    // Commit only on success — mirrors a real Postgres transaction's
    // all-or-nothing guarantee for this test suite.
    certificates.clear();
    for (const [k, v] of certStaged) certificates.set(k, v);
    enrolments.clear();
    for (const [k, v] of enrStaged) enrolments.set(k, v);
    events.push(...evStaged);
    return result;
  };

  return { certificates, enrolments, cohorts, courses, programmes, templates, users, events, runInTransaction };
}

// ---------------------------------------------------------------------------
// Deps fake
// ---------------------------------------------------------------------------

function makeDeps(overrides?: Partial<IssueCertificateDeps>) {
  const renderCalls: unknown[] = [];
  const putObjectCalls: Array<{ key: string; body: Uint8Array; contentType: string }> = [];
  const auditCalls: Array<Record<string, unknown>> = [];
  const writeEventCalls: Array<{ tx: unknown; event: Record<string, unknown> }> = [];
  let refSeq = 0;

  const deps: IssueCertificateDeps = {
    renderPdf: overrides?.renderPdf ?? (async (input) => {
      renderCalls.push(input);
      return new Uint8Array([1, 2, 3]);
    }),
    putObject: overrides?.putObject ?? (async (input) => {
      putObjectCalls.push(input);
    }),
    buildKey: overrides?.buildKey ?? (({ certificateId }) => `certificates/${certificateId}/key`),
    generateRef: overrides?.generateRef ?? (() => `CERT-${(refSeq += 1)}`),
    audit: overrides?.audit ?? (async (event) => {
      auditCalls.push(event as unknown as Record<string, unknown>);
    }),
    writeEvent: overrides?.writeEvent ?? (async (tx, event) => {
      writeEventCalls.push({ tx, event: event as unknown as Record<string, unknown> });
      await (tx as CertificateIssuanceTxClient).domainEvent.create({ data: event as unknown as Record<string, unknown> });
    }),
    resolveTemplateAsset: overrides?.resolveTemplateAsset ?? (async () => new Uint8Array()),
  };

  return { deps, renderCalls, putObjectCalls, auditCalls, writeEventCalls };
}

// ---------------------------------------------------------------------------
// Task 1 — issueCertificateForEnrolment
// ---------------------------------------------------------------------------

describe("issueCertificateForEnrolment", () => {
  it("issues a certificate, renders and stores its PDF, and completes the enrolment", async () => {
    const h = harness();
    const { deps, renderCalls, putObjectCalls } = makeDeps();

    const outcome = await h.runInTransaction((tx) =>
      issueCertificateForEnrolment(tx, { enrolmentId: "enr-1", scope: "COURSE", now: NOW, actor: null }, deps),
    );

    expect(outcome.kind).toBe("issued");
    expect(renderCalls).toHaveLength(1);
    expect(putObjectCalls).toHaveLength(1);

    const cert = [...h.certificates.values()][0];
    expect(cert).toBeDefined();
    expect(cert.status).toBe("ACTIVE");
    expect(cert.storageKey).toBe(`certificates/${cert.id}/key`);
    expect(cert.verificationRef).toBe("CERT-1");
    expect(cert.awardTitle).toBe("Intro to Testing");
    expect(cert.learnerName).toBe("Jane Learner");

    expect(h.enrolments.get("enr-1")?.status).toBe("COMPLETED");
  });

  it("falls back to the isDefault template when certificateTemplateId is null (D-10)", async () => {
    const h = harness({
      courses: [award({ certificateTemplateId: null })],
      templates: [template({ id: "tmpl-default", isDefault: true })],
    });
    const { deps } = makeDeps();

    const outcome = await h.runInTransaction((tx) =>
      issueCertificateForEnrolment(tx, { enrolmentId: "enr-1", scope: "COURSE", now: NOW, actor: null }, deps),
    );

    expect(outcome.kind).toBe("issued");
  });

  it("returns no-template and issues nothing when neither a selected nor a default template resolves", async () => {
    const h = harness({ templates: [] });
    const { deps, renderCalls } = makeDeps();

    const outcome = await h.runInTransaction((tx) =>
      issueCertificateForEnrolment(tx, { enrolmentId: "enr-1", scope: "COURSE", now: NOW, actor: null }, deps),
    );

    expect(outcome).toEqual({ kind: "no-template" });
    expect(h.certificates.size).toBe(0);
    expect(renderCalls).toHaveLength(0);
  });

  it("refuses to complete an enrolment whose status cannot legally reach COMPLETED (D-05 via assertTransition)", async () => {
    const h = harness({ enrolments: [enr({ status: "WITHDRAWN" })] });
    const { deps } = makeDeps();

    await expect(
      h.runInTransaction((tx) =>
        issueCertificateForEnrolment(tx, { enrolmentId: "enr-1", scope: "COURSE", now: NOW, actor: null }, deps),
      ),
    ).rejects.toThrow(/cannot move from WITHDRAWN to COMPLETED/);

    // Nothing committed — the staged transaction never resolved successfully.
    expect(h.certificates.size).toBe(0);
    expect(h.enrolments.get("enr-1")?.status).toBe("WITHDRAWN");
  });

  it("is a no-op returning not-enabled when the Course has certificateEnabled: false (CRD-01)", async () => {
    const h = harness({ courses: [award({ certificateEnabled: false })] });
    const { deps, renderCalls } = makeDeps();

    const outcome = await h.runInTransaction((tx) =>
      issueCertificateForEnrolment(tx, { enrolmentId: "enr-1", scope: "COURSE", now: NOW, actor: null }, deps),
    );

    expect(outcome).toEqual({ kind: "not-enabled" });
    expect(h.certificates.size).toBe(0);
    expect(h.enrolments.get("enr-1")?.status).toBe("ACTIVE");
    expect(renderCalls).toHaveLength(0);
  });

  it("idempotent: a second issue call for the same enrolment/scope returns already-issued and creates no second row", async () => {
    const h = harness();
    const { deps } = makeDeps();

    const first = await h.runInTransaction((tx) =>
      issueCertificateForEnrolment(tx, { enrolmentId: "enr-1", scope: "COURSE", now: NOW, actor: null }, deps),
    );
    expect(first.kind).toBe("issued");
    expect(h.certificates.size).toBe(1);

    const second = await h.runInTransaction((tx) =>
      issueCertificateForEnrolment(tx, { enrolmentId: "enr-1", scope: "COURSE", now: NOW, actor: null }, deps),
    );

    expect(second.kind).toBe("already-issued");
    if (second.kind === "already-issued") {
      expect(second.certificateId).toBe(first.kind === "issued" ? first.certificateId : undefined);
    }
    expect(h.certificates.size).toBe(1);
  });

  it("treats a P2002 unique-constraint violation on create as already-issued, not a thrown error", async () => {
    // Models the race directly: the pre-check (`findFirst` call #1) sees
    // nothing — exactly like the real race window, where no ACTIVE row
    // exists yet from this transaction's point of view — `create` then
    // throws P2002 (a concurrent transaction won first), and the catch
    // handler's own re-lookup (`findFirst` call #2) finds the row that
    // concurrent transaction just committed.
    const winner = {
      id: "cert-winner",
      enrolmentId: "enr-1",
      userId: "user-1",
      scope: "COURSE" as const,
      courseId: "course-1",
      programmeId: null,
      awardTitle: "Intro to Testing",
      learnerName: "Jane Learner",
      issuedAt: NOW,
      status: "ACTIVE" as const,
      verificationRef: "CERT-WINNER",
      storageKey: "certificates/cert-winner/key",
      reviewFlaggedAt: null,
    };
    let findFirstCalls = 0;
    const tx: CertificateIssuanceTxClient = {
      certificate: {
        findFirst: async () => {
          findFirstCalls += 1;
          return findFirstCalls === 1 ? null : { ...winner };
        },
        create: async () => {
          throw { code: "P2002" };
        },
        update: async () => {
          throw new Error("must not update after a lost race");
        },
      },
      enrolment: {
        findUnique: async () => enr(),
        update: async () => {
          throw new Error("must not touch the enrolment after a lost race");
        },
      },
      cohort: { findUnique: async () => courseCohort() },
      course: { findUnique: async () => award() },
      programme: { findUnique: async () => null },
      certificateTemplate: { findUnique: async () => template(), findFirst: async () => template() },
      completionRecord: { findFirst: async () => null },
      user: { findUnique: async () => user() },
      domainEvent: { create: async () => ({}) },
    };
    const { deps, renderCalls, putObjectCalls } = makeDeps();

    const outcome = await issueCertificateForEnrolment(
      tx,
      { enrolmentId: "enr-1", scope: "COURSE", now: NOW, actor: null },
      deps,
    );

    expect(outcome).toEqual({ kind: "already-issued", certificateId: "cert-winner" });
    expect(renderCalls).toHaveLength(0);
    expect(putObjectCalls).toHaveLength(0);
  });

  it("stamps actorId: null, actorType: SYSTEM on the audit row for a system-triggered issuance", async () => {
    const h = harness();
    const { deps, auditCalls } = makeDeps();

    await h.runInTransaction((tx) =>
      issueCertificateForEnrolment(tx, { enrolmentId: "enr-1", scope: "COURSE", now: NOW, actor: null }, deps),
    );

    const issuedAudit = auditCalls.find((a) => a.targetType === "Certificate");
    expect(issuedAudit?.actorId).toBeNull();
    expect(issuedAudit?.actorType).toBe(SYSTEM_ACTOR_TYPE);
  });

  it("stamps the staff actor's id on the audit row for a staff-triggered issuance", async () => {
    const h = harness();
    const { deps, auditCalls } = makeDeps();
    const actor: IssueCertificateActor = { userId: "staff-9" };

    await h.runInTransaction((tx) =>
      issueCertificateForEnrolment(tx, { enrolmentId: "enr-1", scope: "COURSE", now: NOW, actor }, deps),
    );

    const issuedAudit = auditCalls.find((a) => a.targetType === "Certificate");
    expect(issuedAudit?.actorId).toBe("staff-9");
    expect(issuedAudit?.actorType).toBeUndefined();
  });

  it("writes a certificate.issued domain event carrying certificateId, enrolmentId, scope and verificationRef — and no PDF bytes", async () => {
    const h = harness();
    const { deps } = makeDeps();

    await h.runInTransaction((tx) =>
      issueCertificateForEnrolment(tx, { enrolmentId: "enr-1", scope: "COURSE", now: NOW, actor: null }, deps),
    );

    const issuedEvent = h.events.find((e) => e.type === "certificate.issued");
    expect(issuedEvent).toBeDefined();
    const payload = issuedEvent?.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["certificateId", "enrolmentId", "scope", "verificationRef"].sort());
    expect(payload.scope).toBe("COURSE");
  });

  it("rolls back the Certificate row and the COMPLETED status when PDF rendering throws", async () => {
    const h = harness();
    const { deps, putObjectCalls } = makeDeps({
      renderPdf: async () => {
        throw new Error("render exploded");
      },
    });

    await expect(
      h.runInTransaction((tx) =>
        issueCertificateForEnrolment(tx, { enrolmentId: "enr-1", scope: "COURSE", now: NOW, actor: null }, deps),
      ),
    ).rejects.toThrow("render exploded");

    expect(h.certificates.size).toBe(0);
    expect(h.enrolments.get("enr-1")?.status).toBe("ACTIVE");
    expect(putObjectCalls).toHaveLength(0);
  });

  it("refuses scope COURSE for a Programme cohort — D-01's structural guard", async () => {
    const h = harness({
      enrolments: [enr({ cohortId: "cohort-programme" })],
      cohorts: [programmeCohort()],
      programmes: [award({ id: "programme-1", title: "Full Stack" })],
    });
    const { deps, renderCalls } = makeDeps();

    const outcome = await h.runInTransaction((tx) =>
      issueCertificateForEnrolment(tx, { enrolmentId: "enr-1", scope: "COURSE", now: NOW, actor: null }, deps),
    );

    expect(outcome).toEqual({ kind: "not-enabled" });
    expect(renderCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Task 2 — reactToCompletionResults / recalculateCompletionAndIssue
// ---------------------------------------------------------------------------

function scopeResult(over: Partial<CompletionScopeResult> = {}): CompletionScopeResult {
  return {
    scope: over.scope ?? "COURSE",
    courseId: over.courseId ?? "course-1",
    verdict: over.verdict ?? { items: [], satisfied: true },
    action: over.action ?? "created",
  };
}

describe("reactToCompletionResults", () => {
  it("issues a Course certificate when action is created, scope COURSE, mode AUTOMATIC, and issuance is enabled", async () => {
    const h = harness();
    const { deps, renderCalls } = makeDeps();

    await h.runInTransaction((tx) =>
      reactToCompletionResults(tx, { enrolmentId: "enr-1", now: NOW, results: [scopeResult({ action: "created" })] }, deps),
    );

    expect(renderCalls).toHaveLength(1);
    expect(h.certificates.size).toBe(1);
    expect(h.enrolments.get("enr-1")?.status).toBe("COMPLETED");
  });

  it("programme-cohort COURSE-scope results are skipped entirely (D-01), zero issuance calls", async () => {
    const h = harness({
      enrolments: [enr({ cohortId: "cohort-programme" })],
      cohorts: [programmeCohort()],
      programmes: [award({ id: "programme-1", title: "Full Stack" })],
    });
    const { deps, renderCalls, putObjectCalls } = makeDeps();

    await h.runInTransaction((tx) =>
      reactToCompletionResults(
        tx,
        {
          enrolmentId: "enr-1",
          now: NOW,
          results: [scopeResult({ scope: "COURSE", courseId: "course-a", action: "created" })],
        },
        deps,
      ),
    );

    expect(renderCalls).toHaveLength(0);
    expect(putObjectCalls).toHaveLength(0);
    expect(h.certificates.size).toBe(0);
    expect(h.enrolments.get("enr-1")?.status).toBe("ACTIVE");
  });

  it("programme completion issues exactly one Programme certificate, never a Course certificate", async () => {
    const h = harness({
      enrolments: [enr({ cohortId: "cohort-programme" })],
      cohorts: [programmeCohort()],
      programmes: [award({ id: "programme-1", title: "Full Stack" })],
    });
    const { deps, renderCalls } = makeDeps();

    await h.runInTransaction((tx) =>
      reactToCompletionResults(
        tx,
        {
          enrolmentId: "enr-1",
          now: NOW,
          results: [
            scopeResult({ scope: "COURSE", courseId: "course-a", action: "created" }),
            scopeResult({ scope: "COURSE", courseId: "course-b", action: "created" }),
            scopeResult({ scope: "PROGRAMME", courseId: null, action: "created" }),
          ],
        },
        deps,
      ),
    );

    expect(renderCalls).toHaveLength(1);
    expect(h.certificates.size).toBe(1);
    const cert = [...h.certificates.values()][0];
    expect(cert.scope).toBe("PROGRAMME");
    expect(h.enrolments.get("enr-1")?.status).toBe("COMPLETED");
  });

  it("MANUAL issuance mode leaves the completion eligible but unissued (D-04)", async () => {
    const h = harness({ courses: [award({ certificateIssuanceMode: "MANUAL" })] });
    const { deps, renderCalls } = makeDeps();

    await h.runInTransaction((tx) =>
      reactToCompletionResults(tx, { enrolmentId: "enr-1", now: NOW, results: [scopeResult({ action: "created" })] }, deps),
    );

    expect(renderCalls).toHaveLength(0);
    expect(h.certificates.size).toBe(0);
    expect(h.enrolments.get("enr-1")?.status).toBe("ACTIVE");
  });

  it("no certificate issues when certificateEnabled is false regardless of issuance mode", async () => {
    const h = harness({ courses: [award({ certificateEnabled: false, certificateIssuanceMode: "AUTOMATIC" })] });
    const { deps, renderCalls } = makeDeps();

    await h.runInTransaction((tx) =>
      reactToCompletionResults(tx, { enrolmentId: "enr-1", now: NOW, results: [scopeResult({ action: "created" })] }, deps),
    );

    expect(renderCalls).toHaveLength(0);
    expect(h.certificates.size).toBe(0);
  });

  it("unchanged completion results write nothing", async () => {
    const h = harness();
    const { deps, renderCalls, auditCalls, writeEventCalls } = makeDeps();

    await h.runInTransaction((tx) =>
      reactToCompletionResults(tx, { enrolmentId: "enr-1", now: NOW, results: [scopeResult({ action: "unchanged" })] }, deps),
    );

    expect(renderCalls).toHaveLength(0);
    expect(auditCalls).toHaveLength(0);
    expect(writeEventCalls).toHaveLength(0);
    expect(h.certificates.size).toBe(0);
  });

  it("superseded completion flags the certificate for review and reverts the enrolment to ACTIVE", async () => {
    const existing: CertRow = {
      id: "cert-1",
      enrolmentId: "enr-1",
      userId: "user-1",
      scope: "COURSE",
      courseId: "course-1",
      programmeId: null,
      awardTitle: "Intro to Testing",
      learnerName: "Jane Learner",
      issuedAt: NOW,
      status: "ACTIVE",
      verificationRef: "CERT-ORIGINAL",
      storageKey: "certificates/cert-1/key",
      reviewFlaggedAt: null,
    };
    const h = harness({
      enrolments: [enr({ status: "COMPLETED" })],
      certificates: [existing],
    });
    const { deps } = makeDeps();

    await h.runInTransaction((tx) =>
      reactToCompletionResults(tx, { enrolmentId: "enr-1", now: NOW, results: [scopeResult({ action: "superseded" })] }, deps),
    );

    const cert = h.certificates.get("cert-1");
    expect(cert?.reviewFlaggedAt).toEqual(NOW);
    expect(cert?.status).toBe("ACTIVE");
    expect(cert?.verificationRef).toBe("CERT-ORIGINAL");
    expect(cert?.storageKey).toBe("certificates/cert-1/key");
    expect(h.enrolments.get("enr-1")?.status).toBe("ACTIVE");
  });

  it("superseded with no existing certificate leaves the enrolment alone and raises no error", async () => {
    const h = harness({ enrolments: [enr({ status: "ACTIVE" })] });
    const { deps } = makeDeps();

    await expect(
      h.runInTransaction((tx) =>
        reactToCompletionResults(tx, { enrolmentId: "enr-1", now: NOW, results: [scopeResult({ action: "superseded" })] }, deps),
      ),
    ).resolves.toBeUndefined();

    expect(h.enrolments.get("enr-1")?.status).toBe("ACTIVE");
  });
});

describe("recalculateCompletionAndIssue", () => {
  it("passes through a not-evaluable result unchanged and reacts to nothing", async () => {
    const notEvaluable: CompletionRecalculationResult = { kind: "not-evaluable", reason: "unpinned" };
    const tx = {
      enrolment: { findUnique: async () => null },
      cohort: { findUnique: async () => null },
      cohortCourse: { findMany: async () => [] },
      coursePublication: { findUnique: async () => null },
      programmePublication: { findUnique: async () => null },
      module: { findMany: async () => [] },
      lesson: { findMany: async () => [] },
      lessonProgress: { findMany: async () => [] },
      scheduledSession: { findMany: async () => [] },
      attendanceRecord: { findMany: async () => [] },
      completionRecord: {
        findFirst: async () => null,
        create: async () => ({}),
        update: async () => ({}),
      },
      domainEvent: { create: async () => ({}) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await recalculateCompletionAndIssue(tx, { enrolmentId: "enr-missing", now: NOW });

    expect(result).toEqual(notEvaluable);
  });
});

// ---------------------------------------------------------------------------
// flagCertificateForReview — the shared helper both this plan's superseded
// branch and plan 11-10's grade-correction hook reuse.
// ---------------------------------------------------------------------------

describe("flagCertificateForReview", () => {
  it("is a no-op when the enrolment already holds a REVOKED certificate (nothing ACTIVE to flag)", async () => {
    const revoked: CertRow = {
      id: "cert-1",
      enrolmentId: "enr-1",
      userId: "user-1",
      scope: "COURSE",
      courseId: "course-1",
      programmeId: null,
      awardTitle: "Intro to Testing",
      learnerName: "Jane Learner",
      issuedAt: NOW,
      status: "REVOKED",
      verificationRef: "CERT-REVOKED",
      storageKey: "certificates/cert-1/key",
      reviewFlaggedAt: null,
    };
    const h = harness({ certificates: [revoked] });
    const { deps, auditCalls } = makeDeps();

    await h.runInTransaction((tx) =>
      flagCertificateForReview(tx, { enrolmentId: "enr-1", now: NOW, reason: "grade corrected", actorId: "staff-1" }, deps),
    );

    expect(h.certificates.get("cert-1")?.reviewFlaggedAt).toBeNull();
    expect(auditCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// flagCertificatesForGradeCorrection — CRD-06's grade half (plan 11-10).
// Reuses flagCertificateForReview; never calls recalculateCompletion (grades
// carry no completionRule v1 key, so there is no verdict to re-derive).
// ---------------------------------------------------------------------------

function activeCert(over: Partial<CertRow> = {}): CertRow {
  return {
    id: over.id ?? "cert-1",
    enrolmentId: over.enrolmentId ?? "enr-1",
    userId: over.userId ?? "user-1",
    scope: over.scope ?? "COURSE",
    courseId: over.courseId ?? "course-1",
    programmeId: over.programmeId ?? null,
    awardTitle: over.awardTitle ?? "Intro to Testing",
    learnerName: over.learnerName ?? "Jane Learner",
    issuedAt: over.issuedAt ?? NOW,
    status: over.status ?? "ACTIVE",
    verificationRef: over.verificationRef ?? "CERT-ORIGINAL",
    storageKey: over.storageKey ?? "certificates/cert-1/key",
    reviewFlaggedAt: over.reviewFlaggedAt ?? null,
  };
}

describe("grade correction", () => {
  it("1. sets reviewFlaggedAt on the enrolment's ACTIVE certificate", async () => {
    const h = harness({ certificates: [activeCert()] });
    const { deps } = makeDeps();

    await h.runInTransaction((tx) =>
      flagCertificatesForGradeCorrection(
        tx,
        { enrolmentId: "enr-1", assessmentId: "a1", passedChanged: true, now: NOW, actorId: "staff-1" },
        deps,
      ),
    );

    expect(h.certificates.get("cert-1")?.reviewFlaggedAt).toEqual(NOW);
  });

  it("2. leaves status, verificationRef, issuedAt and storageKey unchanged", async () => {
    const h = harness({ certificates: [activeCert()] });
    const { deps } = makeDeps();

    await h.runInTransaction((tx) =>
      flagCertificatesForGradeCorrection(
        tx,
        { enrolmentId: "enr-1", assessmentId: "a1", passedChanged: false, now: NOW, actorId: "staff-1" },
        deps,
      ),
    );

    const cert = h.certificates.get("cert-1");
    expect(cert?.status).toBe("ACTIVE");
    expect(cert?.verificationRef).toBe("CERT-ORIGINAL");
    expect(cert?.issuedAt).toEqual(NOW);
    expect(cert?.storageKey).toBe("certificates/cert-1/key");
  });

  it("3. reverts a COMPLETED enrolment to ACTIVE via assertTransition", async () => {
    const h = harness({
      enrolments: [enr({ status: "COMPLETED" })],
      certificates: [activeCert()],
    });
    const { deps } = makeDeps();

    await h.runInTransaction((tx) =>
      flagCertificatesForGradeCorrection(
        tx,
        { enrolmentId: "enr-1", assessmentId: "a1", passedChanged: true, now: NOW, actorId: "staff-1" },
        deps,
      ),
    );

    expect(h.enrolments.get("enr-1")?.status).toBe("ACTIVE");
  });

  it("3b. leaves a WITHDRAWN enrolment's status untouched and throws nothing", async () => {
    const h = harness({
      enrolments: [enr({ status: "WITHDRAWN" })],
      certificates: [activeCert()],
    });
    const { deps } = makeDeps();

    await expect(
      h.runInTransaction((tx) =>
        flagCertificatesForGradeCorrection(
          tx,
          { enrolmentId: "enr-1", assessmentId: "a1", passedChanged: true, now: NOW, actorId: "staff-1" },
          deps,
        ),
      ),
    ).resolves.toBeUndefined();

    expect(h.enrolments.get("enr-1")?.status).toBe("WITHDRAWN");
  });

  it("4. the certificate is not revoked and stays publicly verifiable as active while flagged", async () => {
    const h = harness({ certificates: [activeCert()] });
    const { deps } = makeDeps();

    await h.runInTransaction((tx) =>
      flagCertificatesForGradeCorrection(
        tx,
        { enrolmentId: "enr-1", assessmentId: "a1", passedChanged: true, now: NOW, actorId: "staff-1" },
        deps,
      ),
    );

    const cert = h.certificates.get("cert-1");
    expect(cert?.status).toBe("ACTIVE");
    expect(cert?.reviewFlaggedAt).toEqual(NOW);
  });

  it("5. no CompletionRecord is created or superseded by this path", async () => {
    let completionRecordTouched = false;
    const tx: CertificateIssuanceTxClient = {
      certificate: {
        findFirst: async () => ({ ...activeCert() }),
        create: async () => {
          throw new Error("must not create a certificate");
        },
        update: async ({ data }) => data,
      },
      enrolment: {
        findUnique: async () => enr({ status: "ACTIVE" }),
        update: async () => {
          throw new Error("must not touch a non-COMPLETED enrolment");
        },
      },
      cohort: { findUnique: async () => courseCohort() },
      course: { findUnique: async () => award() },
      programme: { findUnique: async () => null },
      certificateTemplate: { findUnique: async () => template(), findFirst: async () => template() },
      completionRecord: {
        findFirst: async () => {
          completionRecordTouched = true;
          return null;
        },
      },
      user: { findUnique: async () => user() },
      domainEvent: { create: async () => ({}) },
    };
    const { deps } = makeDeps();

    await flagCertificatesForGradeCorrection(
      tx,
      { enrolmentId: "enr-1", assessmentId: "a1", passedChanged: true, now: NOW, actorId: "staff-1" },
      deps,
    );

    expect(completionRecordTouched).toBe(false);
  });

  it("6. an enrolment with no certificate is a no-op that does not throw", async () => {
    const h = harness({ certificates: [] });
    const { deps, auditCalls } = makeDeps();

    await expect(
      h.runInTransaction((tx) =>
        flagCertificatesForGradeCorrection(
          tx,
          { enrolmentId: "enr-1", assessmentId: "a1", passedChanged: true, now: NOW, actorId: "staff-1" },
          deps,
        ),
      ),
    ).resolves.toBeUndefined();

    expect(auditCalls).toHaveLength(0);
  });

  it("7. an enrolment whose certificate is already REVOKED is not flagged", async () => {
    const h = harness({ certificates: [activeCert({ status: "REVOKED", reviewFlaggedAt: null })] });
    const { deps, auditCalls } = makeDeps();

    await h.runInTransaction((tx) =>
      flagCertificatesForGradeCorrection(
        tx,
        { enrolmentId: "enr-1", assessmentId: "a1", passedChanged: true, now: NOW, actorId: "staff-1" },
        deps,
      ),
    );

    expect(h.certificates.get("cert-1")?.reviewFlaggedAt).toBeNull();
    expect(auditCalls).toHaveLength(0);
  });

  it("8. writes a certificate.review_flagged event and audit row carrying reason 'grade corrected' and the overriding actor's id, not SYSTEM", async () => {
    const h = harness({ certificates: [activeCert()] });
    const { deps, auditCalls } = makeDeps();

    await h.runInTransaction((tx) =>
      flagCertificatesForGradeCorrection(
        tx,
        { enrolmentId: "enr-1", assessmentId: "a1", passedChanged: true, now: NOW, actorId: "staff-1" },
        deps,
      ),
    );

    const flagEvent = h.events.find((e) => e.type === "certificate.review_flagged");
    expect(flagEvent).toBeDefined();
    const flagAudit = auditCalls.find((a) => a.action === "certificate.review_flagged");
    expect(flagAudit?.reason).toBe("grade corrected");
    expect(flagAudit?.actorId).toBe("staff-1");
    expect(flagAudit?.actorType).toBeUndefined();
  });

  it("9. the flag write rolls back with the rest of the transaction on failure", async () => {
    const h = harness({ certificates: [activeCert()] });
    const { deps } = makeDeps({
      audit: async () => {
        throw new Error("audit sink unavailable");
      },
    });

    await expect(
      h.runInTransaction((tx) =>
        flagCertificatesForGradeCorrection(
          tx,
          { enrolmentId: "enr-1", assessmentId: "a1", passedChanged: true, now: NOW, actorId: "staff-1" },
          deps,
        ),
      ),
    ).rejects.toThrow("audit sink unavailable");

    expect(h.certificates.get("cert-1")?.reviewFlaggedAt).toBeNull();
  });
});
