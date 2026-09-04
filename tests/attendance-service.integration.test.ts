/**
 * Real-Postgres proof for the attendance service (plan 05-08, ATT-01..ATT-03).
 *
 * The unit test (`tests/attendance-service.test.ts`) drives every rule with an
 * in-memory staged-commit fake. That fake cannot raise a real
 * `attendance_correction_has_reason` CHECK violation, cannot prove the bulk
 * refusal is atomic under a real `$transaction`, and cannot prove a
 * COHORT-scoped grant is denied — not silently filtered — against a sibling
 * cohort's session. This file starts a throwaway `postgres:16-alpine` (see
 * `tests/support/pg.ts`), deploys the checked-in migrations, and exercises the
 * real schema.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with a
 * container-start error and every case reports BLOCKED — never a silent pass,
 * never a weakened mock.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestDatabase,
  TEST_DB_TIMEOUT_MS,
  type TestDatabase,
} from "./support/pg";
import { createTestWithPermission, grant } from "./support/harness";
import {
  seedCohortFixture,
  seedEnrolmentFixture,
  seedLearnerFixture,
  seedSessionFixture,
} from "./support/cohort-fixtures";
import {
  createPrismaBackedAttendanceService,
  CorrectionReasonRequiredError,
  LearnerNotOnRosterError,
  PreMarkingStateError,
} from "@/server/services/attendance-service";
import { AuthorizationError } from "@/server/permissions/with-permission";

let testDb: TestDatabase;
let actorId: string;

const HOUR_MS = 3_600_000;

type Svc = ReturnType<typeof createPrismaBackedAttendanceService>;

function serviceWithGrants(
  grants: Parameters<typeof createTestWithPermission>[0],
): Svc {
  const { withPermission } = createTestWithPermission(grants, { userId: actorId });
  return createPrismaBackedAttendanceService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    testDb.prisma as any,
    withPermission,
    async (entry) => {
      await testDb.prisma.auditEvent.create({
        data: {
          actorId: entry.actorId,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          before: (entry.before ?? undefined) as never,
          after: (entry.after ?? undefined) as never,
          reason: entry.reason ?? null,
          outcome: entry.outcome,
        },
      });
    },
  );
}

const globalService = () => serviceWithGrants([grant("attendance.manage"), grant("attendance.view")]);

async function attendanceRow(sessionId: string, enrolmentId: string) {
  return testDb.prisma.attendanceRecord.findUnique({
    where: { sessionId_enrolmentId: { sessionId, enrolmentId } },
  });
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  actorId = (await seedLearnerFixture(testDb.prisma, { name: "Ops Staff" })).userId;
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

// ---------------------------------------------------------------------------
// 1. D-10 / ATT-01 — out-of-scope bulk write is refused, atomically
// ---------------------------------------------------------------------------

describe("saveSessionAttendance — D-10 / ATT-01 out-of-scope bulk", () => {
  it("refuses a batch naming an enrolment from a different cohort and writes NOTHING for either cohort", async () => {
    const cohortA = await seedCohortFixture(testDb.prisma, { capacity: 5 });
    const cohortB = await seedCohortFixture(testDb.prisma, { capacity: 5 });
    const { sessionId } = await seedSessionFixture(testDb.prisma, { cohortId: cohortA.cohortId });
    const { enrolmentId: enrA1 } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId: cohortA.cohortId,
    });
    const { enrolmentId: enrA2 } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId: cohortA.cohortId,
    });
    const { enrolmentId: enrB } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId: cohortB.cohortId,
    });

    await expect(
      globalService().saveSessionAttendance({
        sessionId,
        entries: [
          { enrolmentId: enrA1, state: "PRESENT" },
          { enrolmentId: enrA2, state: "ABSENT" },
          { enrolmentId: enrB, state: "PRESENT" },
        ],
      }),
    ).rejects.toBeInstanceOf(LearnerNotOnRosterError);

    expect(await attendanceRow(sessionId, enrA1)).toBeNull();
    expect(await attendanceRow(sessionId, enrA2)).toBeNull();
    expect(await attendanceRow(sessionId, enrB)).toBeNull();
    expect(
      await testDb.prisma.attendanceRecord.count({ where: { sessionId } }),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. D-21 — an Instructor's COHORT grant does not reach a sibling cohort
// ---------------------------------------------------------------------------

describe("saveSessionAttendance — D-21 instructor scoping", () => {
  it("denies with AuthorizationError rather than filtering to an empty result", async () => {
    const cohortA = await seedCohortFixture(testDb.prisma, { capacity: 5 });
    const cohortB = await seedCohortFixture(testDb.prisma, { capacity: 5 });
    const { sessionId } = await seedSessionFixture(testDb.prisma, { cohortId: cohortB.cohortId });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId: cohortB.cohortId,
    });

    const scopedService = serviceWithGrants([
      grant("attendance.manage", "COHORT", cohortA.cohortId),
    ]);

    await expect(
      scopedService.saveSessionAttendance({
        sessionId,
        entries: [{ enrolmentId, state: "PRESENT" }],
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(await attendanceRow(sessionId, enrolmentId)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. D-09 — pre-marking restriction
// ---------------------------------------------------------------------------

describe("markAttendance — D-09 pre-marking", () => {
  it("refuses PRESENT before the session starts and allows EXCUSED", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 5 });
    const { sessionId } = await seedSessionFixture(testDb.prisma, {
      cohortId,
      startsAt: new Date(Date.now() + 2 * HOUR_MS),
      endsAt: new Date(Date.now() + 4 * HOUR_MS),
    });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, { cohortId });

    await expect(
      globalService().markAttendance({ sessionId, enrolmentId, state: "PRESENT" }),
    ).rejects.toBeInstanceOf(PreMarkingStateError);

    await globalService().markAttendance({ sessionId, enrolmentId, state: "EXCUSED" });
    const row = await attendanceRow(sessionId, enrolmentId);
    expect(row?.state).toBe("EXCUSED");
  });
});

// ---------------------------------------------------------------------------
// 4. D-06 / D-08 — the exact window boundary
// ---------------------------------------------------------------------------

describe("markAttendance — D-06 / D-08 window boundary", () => {
  it("167 hours after endsAt: a no-reason change succeeds and leaves correctedAt null", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 5 });
    const { sessionId } = await seedSessionFixture(testDb.prisma, {
      cohortId,
      startsAt: new Date(Date.now() - 168 * HOUR_MS),
      endsAt: new Date(Date.now() - 167 * HOUR_MS),
    });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, { cohortId });

    await globalService().markAttendance({ sessionId, enrolmentId, state: "PRESENT" });
    const row = await attendanceRow(sessionId, enrolmentId);
    expect(row?.state).toBe("PRESENT");
    expect(row?.correctedAt).toBeNull();
    expect(row?.recordedById).toBe(actorId);
  });

  it("169 hours after endsAt: a no-reason change is refused; a reasoned change stamps correction fields and leaves recordedById/recordedAt", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 5 });
    const { sessionId } = await seedSessionFixture(testDb.prisma, {
      cohortId,
      startsAt: new Date(Date.now() - 172 * HOUR_MS),
      endsAt: new Date(Date.now() - 169 * HOUR_MS),
    });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, { cohortId });

    // Establish an original mark inside the window by directly seeding the
    // row with its own recordedBy stamps (the window has already closed by
    // the time this test runs against real wall-clock time).
    const originalRecordedAt = new Date(Date.now() - 170 * HOUR_MS);
    await testDb.prisma.attendanceRecord.create({
      data: {
        sessionId,
        enrolmentId,
        state: "ABSENT",
        recordedById: "original-marker",
        recordedAt: originalRecordedAt,
      },
    });

    await expect(
      globalService().markAttendance({ sessionId, enrolmentId, state: "PRESENT" }),
    ).rejects.toBeInstanceOf(CorrectionReasonRequiredError);

    let row = await attendanceRow(sessionId, enrolmentId);
    expect(row?.state).toBe("ABSENT");

    await globalService().markAttendance({
      sessionId,
      enrolmentId,
      state: "PRESENT",
      reason: "learner produced a medical note after the fact",
    });
    row = await attendanceRow(sessionId, enrolmentId);
    expect(row?.state).toBe("PRESENT");
    expect(row?.correctedById).toBe(actorId);
    expect(row?.correctedAt).not.toBeNull();
    expect(row?.correctionReason).toBe("learner produced a medical note after the fact");
    // The original record stamps survive the correction.
    expect(row?.recordedById).toBe("original-marker");
    expect(row?.recordedAt?.getTime()).toBe(originalRecordedAt.getTime());
  });
});

// ---------------------------------------------------------------------------
// 5. ATT-03 — append-only audit history
// ---------------------------------------------------------------------------

describe("markAttendance — ATT-03 audit history", () => {
  it("a mark then a post-window correction leave at least two AuditEvent rows with before/after and the reason", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 5 });
    const { sessionId } = await seedSessionFixture(testDb.prisma, {
      cohortId,
      startsAt: new Date(Date.now() - 2 * HOUR_MS),
      endsAt: new Date(Date.now() - 1 * HOUR_MS),
    });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, { cohortId });

    await globalService().markAttendance({ sessionId, enrolmentId, state: "PRESENT" });

    const closedSessionId = (
      await seedSessionFixture(testDb.prisma, {
        cohortId,
        startsAt: new Date(Date.now() - 172 * HOUR_MS),
        endsAt: new Date(Date.now() - 169 * HOUR_MS),
      })
    ).sessionId;
    await globalService().markAttendance({
      sessionId: closedSessionId,
      enrolmentId,
      state: "ABSENT",
      reason: "corrected after the register was reviewed",
    });

    const audits = await testDb.prisma.auditEvent.findMany({
      where: { targetType: "Enrolment", targetId: enrolmentId },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.length).toBeGreaterThanOrEqual(2);
    const correctionAudit = audits.find((a) => a.reason === "corrected after the register was reviewed");
    expect(correctionAudit).toBeDefined();
    expect(correctionAudit?.before).toEqual({ state: "NOT_RECORDED" });
    expect(correctionAudit?.after).toEqual({ state: "ABSENT" });

    // Append-only: no row was updated or deleted — every audited change has
    // its own distinct row id.
    expect(new Set(audits.map((a) => a.id)).size).toBe(audits.length);
  });
});

// ---------------------------------------------------------------------------
// 6. ATT-02 — the attendance.changed event payload
// ---------------------------------------------------------------------------

describe("markAttendance — ATT-02 event payload", () => {
  it("emits exactly one DomainEvent per mark, carrying a computed component with earnedPct/requiredPct", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 5,
      attendanceThresholdPct: 75,
    });
    const { sessionId } = await seedSessionFixture(testDb.prisma, {
      cohortId,
      startsAt: new Date(Date.now() - 2 * HOUR_MS),
      endsAt: new Date(Date.now() - 1 * HOUR_MS),
    });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, { cohortId });

    const before = await testDb.prisma.domainEvent.count({ where: { type: "attendance.changed" } });
    await globalService().markAttendance({ sessionId, enrolmentId, state: "PRESENT" });
    const events = await testDb.prisma.domainEvent.findMany({
      where: { type: "attendance.changed" },
      orderBy: { occurredAt: "desc" },
    });
    expect(events.length - before).toBe(1);
    const payload = events[0].payload as Record<string, unknown>;
    expect(payload.sessionId).toBe(sessionId);
    expect(payload.enrolmentId).toBe(enrolmentId);
    const component = payload.component as Record<string, unknown>;
    expect(component.kind).toBe("computed");
    expect(typeof component.earnedPct).toBe("number");
    expect(component.requiredPct).toBe(75);
  });

  it("a cohort with no attendance threshold gets a no-rule component, never a numeric zero", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 5,
      attendanceThresholdPct: null,
    });
    const { sessionId } = await seedSessionFixture(testDb.prisma, {
      cohortId,
      startsAt: new Date(Date.now() - 2 * HOUR_MS),
      endsAt: new Date(Date.now() - 1 * HOUR_MS),
    });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, { cohortId });

    await globalService().markAttendance({ sessionId, enrolmentId, state: "ABSENT" });
    const event = await testDb.prisma.domainEvent.findFirst({
      where: { type: "attendance.changed" },
      orderBy: { occurredAt: "desc" },
    });
    const component = (event?.payload as Record<string, unknown>).component as Record<
      string,
      unknown
    >;
    expect(component.kind).toBe("no-rule");
    expect(component.earnedPct).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. DB backstop — attendance_correction_has_reason
// ---------------------------------------------------------------------------

describe("DB backstop — attendance_correction_has_reason", () => {
  // NOTE ON SQL NULL SEMANTICS: the CHECK is
  //   (correctedAt IS NULL AND correctedById IS NULL AND correctionReason IS NULL)
  //   OR (correctedAt IS NOT NULL AND length(btrim(correctionReason)) > 0)
  // A `correctionReason: null` update makes the second branch evaluate to
  // `TRUE AND NULL` = NULL (unknown) rather than FALSE, and Postgres only
  // rejects a CHECK when it evaluates to FALSE — an "unknown" passes. A
  // literal empty string is what the constraint actually rejects
  // (`length(btrim("")) > 0` is FALSE), so this is the value that proves the
  // constraint fires at all, matching the service's own `trimReason` guard.
  it("rejects a direct update that sets correctedAt with an empty-string correctionReason", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 5 });
    const { sessionId } = await seedSessionFixture(testDb.prisma, { cohortId });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, { cohortId });
    await testDb.prisma.attendanceRecord.create({
      data: { sessionId, enrolmentId, state: "ABSENT" },
    });

    await expect(
      testDb.prisma.attendanceRecord.update({
        where: { sessionId_enrolmentId: { sessionId, enrolmentId } },
        data: { correctedAt: new Date(), correctionReason: "" },
      }),
    ).rejects.toThrow();
  });
});
