/**
 * Plan 11-13 Task 2 — `deriveCertificateColumn` (pure, UI-SPEC §7.6's five
 * branches) plus the wiring inside `createEnrolmentDashboardService` that
 * replaces the old `CERTIFICATE_DEFERRED` constant: a batched, non-N+1
 * lookup keyed by `${enrolmentId}:${scope}`, scoped to the requesting
 * learner's own enrolments only (T-11-61), with `tickets` left untouched
 * (Phase 12's own named gap).
 */

import { describe, expect, it } from "vitest";
import {
  createEnrolmentDashboardService,
  deriveCertificateColumn,
  type EnrolmentDashboardStore,
  type DashboardCertificateStoreRow,
  type DashboardCompletionRecordStoreRow,
  type EnrolmentDashboardLearnerAccess,
  type EnrolmentDashboardLearnerResults,
} from "@/server/services/enrolment-dashboard-service";
import type { Actor } from "@/server/permissions/with-permission";
import type { OwnEnrolmentSnapshot } from "@/server/services/learner-access";

// ---------------------------------------------------------------------------
// deriveCertificateColumn — the five branches, unit-tested with no store.
// ---------------------------------------------------------------------------

function certRow(overrides: Partial<DashboardCertificateStoreRow> = {}): DashboardCertificateStoreRow {
  return {
    enrolmentId: "enrolment-1",
    scope: "COURSE",
    id: "cert-1",
    status: "ACTIVE",
    reviewFlaggedAt: null,
    verificationRef: "VERIF-REF-1",
    issuedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("deriveCertificateColumn", () => {
  it("yields not-complete when there is no unsuperseded completion record", () => {
    expect(deriveCertificateColumn({ hasCompletionRecord: false, certificate: certRow() })).toEqual({
      kind: "not-complete",
    });
  });

  it("yields pending-issuance when a completion record exists with no certificate", () => {
    expect(deriveCertificateColumn({ hasCompletionRecord: true, certificate: null })).toEqual({
      kind: "pending-issuance",
    });
  });

  it("yields issued for an ACTIVE, unflagged certificate", () => {
    expect(deriveCertificateColumn({ hasCompletionRecord: true, certificate: certRow() })).toEqual({
      kind: "issued",
      certificateId: "cert-1",
      verificationRef: "VERIF-REF-1",
      issuedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
  });

  it("yields flagged (still carrying the certificate id) for an ACTIVE but flagged certificate", () => {
    const result = deriveCertificateColumn({
      hasCompletionRecord: true,
      certificate: certRow({ reviewFlaggedAt: new Date("2026-09-10T00:00:00.000Z") }),
    });
    expect(result).toEqual({
      kind: "flagged",
      certificateId: "cert-1",
      verificationRef: "VERIF-REF-1",
      issuedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
  });

  it("yields revoked with NO certificateId key at all for a REVOKED certificate", () => {
    const result = deriveCertificateColumn({
      hasCompletionRecord: true,
      certificate: certRow({ status: "REVOKED" }),
    });
    expect(result).toEqual({ kind: "revoked" });
    expect("certificateId" in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Wiring — createEnrolmentDashboardService, minimal unpinned-cohort fixtures
// so the certificate column can be exercised without full course-structure
// plumbing (buildCardContext's unpinned branch never calls loadLearnerPath /
// loadPinnedCompletionRuleSource / learnerResults, so throwing stubs for
// those prove they are genuinely unreached).
// ---------------------------------------------------------------------------

const NOW = new Date("2026-09-18T12:00:00.000Z");

function snapshot(overrides: Partial<OwnEnrolmentSnapshot> = {}): OwnEnrolmentSnapshot {
  return {
    id: "enrolment-1",
    cohortId: "cohort-1",
    status: "ACTIVE",
    activatedAt: new Date("2026-01-01T00:00:00.000Z"),
    accessStartsAt: new Date("2026-01-01T00:00:00.000Z"),
    accessEndsAt: null,
    cohort: {
      id: "cohort-1",
      title: "Cohort One",
      deliveryMode: "INSTRUCTOR_LED",
      timezone: "Africa/Lagos",
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      endsAt: new Date("2026-12-31T00:00:00.000Z"),
      attendanceThresholdPct: null,
      courseId: "course-1",
      programmeId: null,
    },
    accessWindow: { kind: "cohort-dates", readOnly: false, endsAt: new Date("2026-12-31T00:00:00.000Z") },
    ...overrides,
  };
}

function neverCalled(name: string) {
  return () => {
    throw new Error(`${name} must not be called for an unpinned-structure card`);
  };
}

function makeLearnerAccess(opts: {
  enrolmentsByActor: Record<string, OwnEnrolmentSnapshot[]>;
}): EnrolmentDashboardLearnerAccess {
  return {
    listOwnDashboardEnrolments: async (actor: Actor) => opts.enrolmentsByActor[actor.userId] ?? [],
    loadLearnerCourseStructure: async () => ({ kind: "unpinned" }) as never,
    loadLearnerPath: neverCalled("loadLearnerPath") as never,
    loadPinnedCompletionRuleSource: neverCalled("loadPinnedCompletionRuleSource") as never,
    assertLessonOpenable: neverCalled("assertLessonOpenable") as never,
  };
}

function makeLearnerResults(): EnrolmentDashboardLearnerResults {
  return {
    getOwnAssessmentObligations: neverCalled("getOwnAssessmentObligations") as never,
    getOwnResults: neverCalled("getOwnResults") as never,
  };
}

/** A realistic fake store: `findMany` genuinely filters by the `in` clause
 *  and the exact `where` predicates the real Prisma calls use, so a query
 *  that forgot to scope by enrolment id would be caught here too. */
function makeDashboardStore(opts: {
  completionRecords?: DashboardCompletionRecordStoreRow[];
  certificates?: DashboardCertificateStoreRow[];
}) {
  const completionRecords = opts.completionRecords ?? [];
  const certificates = opts.certificates ?? [];
  const calls = { completionRecord: 0, certificate: 0 };

  const store: EnrolmentDashboardStore = {
    scheduledSession: { findMany: async () => [] },
    attendanceRecord: { findMany: async () => [] },
    completionRecord: {
      findMany: async ({ where }) => {
        calls.completionRecord += 1;
        return completionRecords.filter(
          (r) => where.enrolmentId.in.includes(r.enrolmentId) && where.supersededAt === null,
        );
      },
    },
    certificate: {
      findMany: async ({ where }) => {
        calls.certificate += 1;
        return certificates.filter(
          (c) => where.enrolmentId.in.includes(c.enrolmentId) && c.status !== "SUPERSEDED",
        );
      },
    },
  };

  return { store, calls };
}

function makeService(opts: {
  enrolmentsByActor: Record<string, OwnEnrolmentSnapshot[]>;
  completionRecords?: DashboardCompletionRecordStoreRow[];
  certificates?: DashboardCertificateStoreRow[];
}) {
  const { store, calls } = makeDashboardStore(opts);
  const svc = createEnrolmentDashboardService({
    store,
    learnerAccess: makeLearnerAccess(opts),
    learnerResults: makeLearnerResults(),
    now: () => NOW,
  });
  return { svc, calls };
}

describe("createEnrolmentDashboardService — certificate column wiring", () => {
  it("keeps tickets deferred at phase 12, untouched by this plan", async () => {
    const { svc } = makeService({ enrolmentsByActor: { "user-a": [snapshot()] } });
    const [card] = (await svc.loadLearnerDashboard({ userId: "user-a" } as Actor)).cards;
    expect(card.tickets).toEqual({ kind: "deferred", phase: 12 });
  });

  it("never surfaces another learner's certificate on this learner's card (T-11-61)", async () => {
    const { svc } = makeService({
      enrolmentsByActor: {
        "user-a": [snapshot({ id: "enrolment-a" })],
      },
      completionRecords: [
        { enrolmentId: "enrolment-a", scope: "COURSE" },
        { enrolmentId: "enrolment-b", scope: "COURSE" },
      ],
      certificates: [
        certRow({ enrolmentId: "enrolment-a", id: "cert-a", verificationRef: "REF-A" }),
        certRow({ enrolmentId: "enrolment-b", id: "cert-b", verificationRef: "REF-B" }),
      ],
    });

    const [card] = (await svc.loadLearnerDashboard({ userId: "user-a" } as Actor)).cards;
    expect(card.certificate).toEqual({
      kind: "issued",
      certificateId: "cert-a",
      verificationRef: "REF-A",
      issuedAt: certRow().issuedAt,
    });
  });

  it("issues exactly one completionRecord and one certificate query regardless of enrolment count (no N+1)", async () => {
    const enrolments = [
      snapshot({ id: "enrolment-1" }),
      snapshot({ id: "enrolment-2", cohortId: "cohort-1" }),
      snapshot({ id: "enrolment-3", cohortId: "cohort-1" }),
    ];
    const { svc, calls } = makeService({
      enrolmentsByActor: { "user-a": enrolments },
      completionRecords: [
        { enrolmentId: "enrolment-1", scope: "COURSE" },
        { enrolmentId: "enrolment-2", scope: "COURSE" },
        { enrolmentId: "enrolment-3", scope: "COURSE" },
      ],
      certificates: [],
    });

    const dashboard = await svc.loadLearnerDashboard({ userId: "user-a" } as Actor);
    expect(dashboard.cards).toHaveLength(3);
    expect(calls.completionRecord).toBe(1);
    expect(calls.certificate).toBe(1);
    expect(dashboard.cards.every((c) => c.certificate.kind === "pending-issuance")).toBe(true);
  });

  it("yields not-complete when no unsuperseded completion record exists for the enrolment's own scope", async () => {
    const { svc } = makeService({ enrolmentsByActor: { "user-a": [snapshot()] } });
    const [card] = (await svc.loadLearnerDashboard({ userId: "user-a" } as Actor)).cards;
    expect(card.certificate).toEqual({ kind: "not-complete" });
  });

  it("does not use a member-course COURSE-scope completion record for a PROGRAMME-cohort enrolment (D-01)", async () => {
    const { svc } = makeService({
      enrolmentsByActor: {
        "user-a": [
          snapshot({
            id: "enrolment-1",
            cohort: {
              id: "cohort-1",
              title: "Programme Cohort",
              deliveryMode: "INSTRUCTOR_LED",
              timezone: "Africa/Lagos",
              startsAt: new Date("2026-01-01T00:00:00.000Z"),
              endsAt: new Date("2026-12-31T00:00:00.000Z"),
              attendanceThresholdPct: null,
              courseId: null,
              programmeId: "programme-1",
            },
          }),
        ],
      },
      // Internal per-member-course COURSE-scope record — must NOT count.
      completionRecords: [{ enrolmentId: "enrolment-1", scope: "COURSE" }],
    });

    const [card] = (await svc.loadLearnerDashboard({ userId: "user-a" } as Actor)).cards;
    expect(card.certificate).toEqual({ kind: "not-complete" });
  });
});
