/**
 * Real-Postgres proof for the enrolment-session mapper group (D-07, D-11,
 * D-12, T-13-03, T-13-39, T-13-40) — properties a JS fake cannot prove: the
 * real `FOR UPDATE SKIP LOCKED` claim order between several pending
 * `session.updated` events (D-12's "collapse to the latest" behaviour
 * depends on the drain's own oldest-first claim order), the raw-SQL
 * supersession/coalescing queries actually comparing JSONB payload text and
 * timestamp windows inside Postgres (including the 60-second boundary,
 * Pitfall 4), `createMany({ skipDuplicates: true })` dedup, and a run of the
 * REAL `cancelCohort` service producing genuine event shapes.
 *
 * PREREQUISITE: Docker must be running (`tests/support/pg.ts` starts the
 * container). If it is not, `beforeAll` fails with a container-start error —
 * every case reports BLOCKED, never a silent pass.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { startDrainHarness, seedVerifiedLearner, writeEvent } from "./support/drain-harness";
import { seedCohortFixture, seedEnrolmentFixture, seedSessionFixture } from "./support/cohort-fixtures";
import { createTestWithPermission, grant } from "./support/harness";
import {
  createCohortService,
  type CohortRecord,
  type CohortAggregateDelegate,
  type CohortGuardEnrolmentDelegate,
  type CohortPublishTx,
} from "@/server/services/cohort-service";
import { createCohortScopeResolvers } from "@/server/services/cohort-scope";
import { type Delegate } from "@/server/services/resource-service";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestDatabase();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

/** The drain's Pass 2 (`sendQueued`) runs in the same `drain()` call as Pass
 * 1 and immediately sends every row it just queued through the harness's
 * stub `send` — a successfully delivered row is `SENT`, not `QUEUED`, by the
 * time `drain()` resolves. Every "this mail actually goes out" assertion in
 * this file accepts either, since both mean "not skipped". */
function expectDelivered(status: string): void {
  expect(["QUEUED", "SENT"]).toContain(status);
}

afterEach(async () => {
  await testDb.prisma.notification.deleteMany();
  await testDb.prisma.emailPreference.deleteMany();
  await testDb.prisma.emailDispatch.deleteMany();
  await testDb.prisma.domainEvent.deleteMany();
  await testDb.prisma.auditEvent.deleteMany({});
  await testDb.prisma.attendanceRecord.deleteMany();
  await testDb.prisma.scheduledSession.deleteMany();
  await testDb.prisma.enrolment.deleteMany({});
  await testDb.prisma.cohort.deleteMany({});
  await testDb.prisma.course.deleteMany({});
  await testDb.prisma.user.deleteMany({ where: { email: { contains: "@drain-harness.test" } } });
  await testDb.prisma.user.deleteMany({ where: { email: { contains: "@fixture.test" } } });
});

/** Seeds an ACTIVE enrolment in `cohortId` and marks its learner's email
 * verified — every template this file exercises is ALWAYS or
 * ENROLMENT_STATUS/SESSION_CHANGES category, none of which is AUTH, so an
 * unverified address would be silently SKIPPED (`email_unverified`) and mask
 * the behaviour actually under test. */
async function seedActiveVerifiedEnrolment(cohortId: string, overrides: Record<string, unknown> = {}) {
  const enrolment = await seedEnrolmentFixture(testDb.prisma, { cohortId, status: "ACTIVE", ...overrides });
  await testDb.prisma.user.update({ where: { id: enrolment.userId }, data: { emailVerified: new Date() } });
  return enrolment;
}

/** A cohort with exactly one ACTIVE, verified learner — the shape both
 * `enrolment.withdrawn` and `enrolment.cancelled` tests seed. */
async function seedSingleActiveEnrolment(cohortTitle: string) {
  const { cohortId } = await seedCohortFixture(testDb.prisma, { title: cohortTitle });
  const learner = await seedVerifiedLearner(testDb.prisma);
  const enrolment = await testDb.prisma.enrolment.create({
    data: { userId: learner.id, cohortId, status: "ACTIVE", activatedAt: new Date() },
    select: { id: true },
  });
  return { cohortId, userId: learner.id, enrolmentId: enrolment.id };
}

/**
 * Builds `cancelCohort` (and its siblings) against the real, checked-in
 * schema — mirrors `tests/cohort-cancel.integration.test.ts`'s own wiring so
 * this file proves the mapper against GENUINE `cancelCohort` event shapes,
 * not a hand-simulated approximation of them.
 */
function buildCohortServiceForCancel(actorId: string) {
  const { withPermission } = createTestWithPermission([grant("cohorts.manage")], { userId: actorId });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = testDb.prisma as any;
  const { cohortResourceScope } = createCohortScopeResolvers({
    cohort: p.cohort,
    session: p.scheduledSession,
    enrolment: p.enrolment,
  });

  return createCohortService({
    delegate: p.cohort as Delegate<CohortRecord>,
    enrolment: p.enrolment as CohortGuardEnrolmentDelegate,
    aggregate: p.cohort as CohortAggregateDelegate,
    instructor: p.cohortInstructor,
    user: p.user,
    db: {
      $transaction: (fn) => p.$transaction((tx: unknown) => fn(tx as CohortPublishTx)),
    },
    toScope: cohortResourceScope,
    withPermission,
    audit: async (entry) => {
      await testDb.prisma.auditEvent.create({
        data: {
          actorId: entry.actorId as string,
          action: entry.action as string,
          targetType: entry.targetType as string,
          targetId: entry.targetId as string | null,
          before: (entry.before ?? undefined) as never,
          after: (entry.after ?? undefined) as never,
          reason: (entry.reason ?? null) as string | null,
          outcome: entry.outcome as string,
        },
      });
    },
    runInTransaction: (fn) => p.$transaction(fn),
    enabledRails: () => ({ ngn: true, usd: true }),
  });
}

// ---------------------------------------------------------------------------
// Task 1 — enrolment.withdrawn / enrolment.cancelled
// ---------------------------------------------------------------------------

describe("enrolment.withdrawn / enrolment.cancelled drain (D-07, T-13-03)", () => {
  it("a withdrawal mails the learner exactly once and never persists the staff reason", async () => {
    const harness = startDrainHarness(testDb.prisma);
    const { cohortId, enrolmentId } = await seedSingleActiveEnrolment("Withdrawn Drain Cohort");

    const event = await writeEvent(testDb.prisma, "enrolment.withdrawn", {
      enrolmentId,
      cohortId,
      actorId: "staff-1",
      reason: "SECRET-REASON",
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({});
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.template).toBe("enrolment-withdrawn");
    expectDelivered(dispatches[0]!.status);
    expect(dispatches[0]!.correlationId).toBe(event.id);
    expect(dispatches[0]!.templateParams).toEqual({ cohortTitle: "Withdrawn Drain Cohort" });

    const notifications = await testDb.prisma.notification.findMany({});
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe("enrolment.withdrawn");
    expect(notifications[0]!.targetType).toBe("LEARNER_DASHBOARD");
    expect(notifications[0]!.targetId).toBe(enrolmentId);

    const raw = JSON.stringify(dispatches) + JSON.stringify(notifications);
    expect(raw).not.toContain("SECRET-REASON");
  });

  it("a cancellation yields the enrolment-cancelled template and notification type", async () => {
    const harness = startDrainHarness(testDb.prisma);
    const { cohortId, enrolmentId } = await seedSingleActiveEnrolment("Cancelled Drain Cohort");

    await writeEvent(testDb.prisma, "enrolment.cancelled", {
      enrolmentId,
      cohortId,
      actorId: "staff-2",
      reason: "administrative void",
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({});
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.template).toBe("enrolment-cancelled");

    const notifications = await testDb.prisma.notification.findMany({});
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe("enrolment.cancelled");
  });

  it("a recipient who muted ENROLMENT_STATUS still gets a SKIPPED dispatch and exactly 1 notification", async () => {
    const harness = startDrainHarness(testDb.prisma);
    const { cohortId, userId, enrolmentId } = await seedSingleActiveEnrolment("Muted Drain Cohort");
    await testDb.prisma.emailPreference.create({
      data: { userId, category: "ENROLMENT_STATUS", muted: true },
    });

    await writeEvent(testDb.prisma, "enrolment.withdrawn", {
      enrolmentId,
      cohortId,
      actorId: "staff-3",
      reason: "n/a",
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({});
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.status).toBe("SKIPPED");
    expect(dispatches[0]!.skipReason).toBe("muted_by_recipient");

    const notifications = await testDb.prisma.notification.findMany({});
    expect(notifications).toHaveLength(1);
  });

  it("returns no rows when the enrolment no longer exists (edge)", async () => {
    const harness = startDrainHarness(testDb.prisma);
    await writeEvent(testDb.prisma, "enrolment.withdrawn", {
      enrolmentId: "does-not-exist",
      cohortId: "cohort-does-not-exist",
      actorId: "staff-1",
      reason: "n/a",
    });
    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);
    expect(await testDb.prisma.emailDispatch.count()).toBe(0);
    expect(await testDb.prisma.notification.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Task 2 — enrolment.transferred, session.cancelled, session.updated
// ---------------------------------------------------------------------------

describe("enrolment.transferred drain (D-07)", () => {
  it("mails the source learner exactly once with both cohort titles and the target enrolment path", async () => {
    const { cohortId: sourceCohortId } = await seedCohortFixture(testDb.prisma, { title: "Source Cohort" });
    const { cohortId: targetCohortId } = await seedCohortFixture(testDb.prisma, { title: "Target Cohort" });
    const source = await seedActiveVerifiedEnrolment(sourceCohortId, { status: "TRANSFERRED" });
    const target = await seedEnrolmentFixture(testDb.prisma, {
      cohortId: targetCohortId,
      userId: source.userId,
      status: "ACTIVE",
      transferredFromId: source.enrolmentId,
    });

    const harness = startDrainHarness(testDb.prisma);
    const event = await writeEvent(testDb.prisma, "enrolment.transferred", {
      sourceEnrolmentId: source.enrolmentId,
      targetEnrolmentId: target.enrolmentId,
      sourceCohortId,
      targetCohortId,
      actorId: "staff-4",
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({ where: { correlationId: event.id } });
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.template).toBe("enrolment-transferred");
    expect(dispatches[0]!.templateParams).toEqual({
      fromCohortTitle: "Source Cohort",
      toCohortTitle: "Target Cohort",
      enrolmentPath: `/learn/${target.enrolmentId}`,
    });

    const notifications = await testDb.prisma.notification.findMany({});
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe("enrolment.transferred");
    expect(notifications[0]!.targetId).toBe(target.enrolmentId);
  });
});

describe("session.cancelled drain (D-11)", () => {
  it("mails every ACTIVE learner exactly once and nobody else", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { title: "Session Cancel Cohort" });
    const active1 = await seedActiveVerifiedEnrolment(cohortId);
    const active2 = await seedActiveVerifiedEnrolment(cohortId);
    const active3 = await seedActiveVerifiedEnrolment(cohortId);
    const withdrawn = await seedActiveVerifiedEnrolment(cohortId, { status: "WITHDRAWN" });
    const session = await seedSessionFixture(testDb.prisma, { cohortId, title: "Live Q&A" });

    const harness = startDrainHarness(testDb.prisma);
    await writeEvent(testDb.prisma, "session.cancelled", {
      sessionId: session.sessionId,
      cohortId,
      actorId: "staff-5",
      reason: "SECRET-CANCEL-REASON",
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({ where: { template: "session-cancelled" } });
    expect(dispatches).toHaveLength(3);
    expect(dispatches.every((d) => d.status === "QUEUED" || d.status === "SENT")).toBe(true);
    const recipients = dispatches.map((d) => d.userId).sort();
    expect(recipients).toEqual([active1.userId, active2.userId, active3.userId].sort());
    expect(recipients).not.toContain(withdrawn.userId);

    const notifications = await testDb.prisma.notification.findMany({ where: { type: "session.cancelled" } });
    expect(notifications).toHaveLength(3);

    const raw = JSON.stringify(dispatches) + JSON.stringify(notifications);
    expect(raw).not.toContain("SECRET-CANCEL-REASON");
  });
});

describe("session.updated coalescing drain (D-12, A-01 — synthetic events, no producer)", () => {
  it("three pending updates for one session, drained together, yield one QUEUED mail per ACTIVE learner and two SKIPPED coalesced rows each", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { title: "Coalesce Cohort" });
    const learner1 = await seedActiveVerifiedEnrolment(cohortId);
    const learner2 = await seedActiveVerifiedEnrolment(cohortId);
    const session = await seedSessionFixture(testDb.prisma, { cohortId, title: "Original title" });

    const harness = startDrainHarness(testDb.prisma);
    const base = new Date("2026-04-01T00:00:00.000Z");
    await writeEvent(testDb.prisma, "session.updated", { sessionId: session.sessionId }, base);
    await writeEvent(testDb.prisma, "session.updated", { sessionId: session.sessionId }, new Date(base.getTime() + 1_000));
    // The session's OWN row is what the mapper reads at drain time (Pitfall
    // 5), never the payload — mutate it directly here since session.updated
    // has no real producer to have done this for us (A-01).
    await testDb.prisma.scheduledSession.update({
      where: { id: session.sessionId },
      data: { title: "Latest title" },
    });
    await writeEvent(testDb.prisma, "session.updated", { sessionId: session.sessionId }, new Date(base.getTime() + 2_000));

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(3);

    const dispatches = await testDb.prisma.emailDispatch.findMany({ where: { template: "session-updated" } });
    expect(dispatches).toHaveLength(6); // 3 events * 2 learners

    const queued = dispatches.filter((d) => d.status === "QUEUED" || d.status === "SENT");
    const skipped = dispatches.filter((d) => d.status === "SKIPPED");
    expect(queued).toHaveLength(2);
    expect(skipped).toHaveLength(4);
    expect(skipped.every((d) => d.skipReason === "coalesced_into_later_update")).toBe(true);
    for (const d of queued) {
      expect((d.templateParams as Record<string, unknown>).sessionTitle).toBe("Latest title");
    }
    const queuedRecipients = queued.map((d) => d.userId).sort();
    expect(queuedRecipients).toEqual([learner1.userId, learner2.userId].sort());

    const notifications = await testDb.prisma.notification.findMany({ where: { type: "session.updated" } });
    expect(notifications).toHaveLength(2);
  });

  it("a session.updated superseded by a session.cancelled for the same session leaves SKIPPED update rows and a normal cancellation mail", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { title: "Superseded By Cancel Cohort" });
    const learner = await seedActiveVerifiedEnrolment(cohortId);
    const session = await seedSessionFixture(testDb.prisma, { cohortId, title: "Doomed session" });

    const harness = startDrainHarness(testDb.prisma);
    const base = new Date("2026-05-01T00:00:00.000Z");
    await writeEvent(testDb.prisma, "session.updated", { sessionId: session.sessionId }, base);
    // Mirrors cancelSession's own real write (scheduled-session-service.ts):
    // the session row's cancelledAt PLUS a session.cancelled event, atomically
    // in production — sequenced here since session.updated has no producer.
    await testDb.prisma.scheduledSession.update({
      where: { id: session.sessionId },
      data: { cancelledAt: new Date(base.getTime() + 500), cancellationReason: "SECRET-CANCEL" },
    });
    await writeEvent(
      testDb.prisma,
      "session.cancelled",
      { sessionId: session.sessionId, cohortId, actorId: "staff-6", reason: "SECRET-CANCEL" },
      new Date(base.getTime() + 1_000),
    );

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(2);

    const updateDispatch = await testDb.prisma.emailDispatch.findFirstOrThrow({
      where: { template: "session-updated" },
    });
    expect(updateDispatch.status).toBe("SKIPPED");
    expect(updateDispatch.skipReason).toBe("superseded_by_session_cancellation");

    const cancelDispatch = await testDb.prisma.emailDispatch.findFirstOrThrow({
      where: { template: "session-cancelled" },
    });
    expectDelivered(cancelDispatch.status);
    expect(cancelDispatch.userId).toBe(learner.userId);

    const raw = JSON.stringify(updateDispatch) + JSON.stringify(cancelDispatch);
    expect(raw).not.toContain("SECRET-CANCEL");
  });

  it("returns no rows for a cohort with no ACTIVE enrolments (D-11)", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { title: "No Active Learners Cohort" });
    await seedActiveVerifiedEnrolment(cohortId, { status: "WITHDRAWN" });
    const session = await seedSessionFixture(testDb.prisma, { cohortId });

    const harness = startDrainHarness(testDb.prisma);
    await writeEvent(testDb.prisma, "session.updated", { sessionId: session.sessionId });
    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);
    expect(await testDb.prisma.emailDispatch.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Task 3 — cohort.cancelled precedence and the real cancelCohort service
// ---------------------------------------------------------------------------

describe("cohort-cancellation precedence window (Pitfall 4, 60-second boundary)", () => {
  it("a withdrawal 59 seconds before a matching cohort.cancelled is superseded, and the cohort mail finds that learner", async () => {
    const { cohortId, userId, enrolmentId } = await seedSingleActiveEnrolment("Boundary Cohort 59s");
    const harness = startDrainHarness(testDb.prisma);
    const base = new Date("2026-06-01T00:00:00.000Z");

    await writeEvent(
      testDb.prisma,
      "enrolment.withdrawn",
      { enrolmentId, cohortId, actorId: "staff-7", reason: "cohort shutting down" },
      base,
    );
    await writeEvent(
      testDb.prisma,
      "cohort.cancelled",
      { cohortId, actorId: "staff-7", reason: "cohort shutting down" },
      new Date(base.getTime() + 59_000),
    );

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(2);

    const withdrawnDispatch = await testDb.prisma.emailDispatch.findFirstOrThrow({
      where: { template: "enrolment-withdrawn" },
    });
    expect(withdrawnDispatch.status).toBe("SKIPPED");
    expect(withdrawnDispatch.skipReason).toBe("superseded_by_cohort_cancellation");

    const cohortDispatch = await testDb.prisma.emailDispatch.findFirstOrThrow({
      where: { template: "cohort-cancelled" },
    });
    expect(cohortDispatch.userId).toBe(userId);
    expectDelivered(cohortDispatch.status);
  });

  it("a withdrawal 61 seconds before a matching cohort.cancelled is mailed normally, and the cohort mail finds nobody", async () => {
    const { cohortId, enrolmentId } = await seedSingleActiveEnrolment("Boundary Cohort 61s");
    const harness = startDrainHarness(testDb.prisma);
    const base = new Date("2026-06-02T00:00:00.000Z");

    await writeEvent(
      testDb.prisma,
      "enrolment.withdrawn",
      { enrolmentId, cohortId, actorId: "staff-8", reason: "cohort shutting down" },
      base,
    );
    await writeEvent(
      testDb.prisma,
      "cohort.cancelled",
      { cohortId, actorId: "staff-8", reason: "cohort shutting down" },
      new Date(base.getTime() + 61_000),
    );

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(2);

    const withdrawnDispatch = await testDb.prisma.emailDispatch.findFirstOrThrow({
      where: { template: "enrolment-withdrawn" },
    });
    expectDelivered(withdrawnDispatch.status);

    expect(await testDb.prisma.emailDispatch.count({ where: { template: "cohort-cancelled" } })).toBe(0);
  });

  it("a different actor within the window is neither superseded nor swept into the cohort mail", async () => {
    const { cohortId, enrolmentId } = await seedSingleActiveEnrolment("Boundary Different Actor");
    const harness = startDrainHarness(testDb.prisma);
    const base = new Date("2026-06-03T00:00:00.000Z");

    await writeEvent(
      testDb.prisma,
      "enrolment.withdrawn",
      { enrolmentId, cohortId, actorId: "staff-9", reason: "same reason" },
      base,
    );
    await writeEvent(
      testDb.prisma,
      "cohort.cancelled",
      { cohortId, actorId: "staff-DIFFERENT", reason: "same reason" },
      new Date(base.getTime() + 10_000),
    );

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(2);

    const withdrawnDispatch = await testDb.prisma.emailDispatch.findFirstOrThrow({
      where: { template: "enrolment-withdrawn" },
    });
    expectDelivered(withdrawnDispatch.status);
    expect(await testDb.prisma.emailDispatch.count({ where: { template: "cohort-cancelled" } })).toBe(0);
  });

  it("a different reason within the window is neither superseded nor swept into the cohort mail", async () => {
    const { cohortId, enrolmentId } = await seedSingleActiveEnrolment("Boundary Different Reason");
    const harness = startDrainHarness(testDb.prisma);
    const base = new Date("2026-06-04T00:00:00.000Z");

    await writeEvent(
      testDb.prisma,
      "enrolment.withdrawn",
      { enrolmentId, cohortId, actorId: "staff-10", reason: "reason A" },
      base,
    );
    await writeEvent(
      testDb.prisma,
      "cohort.cancelled",
      { cohortId, actorId: "staff-10", reason: "reason B" },
      new Date(base.getTime() + 10_000),
    );

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(2);

    const withdrawnDispatch = await testDb.prisma.emailDispatch.findFirstOrThrow({
      where: { template: "enrolment-withdrawn" },
    });
    expectDelivered(withdrawnDispatch.status);
    expect(await testDb.prisma.emailDispatch.count({ where: { template: "cohort-cancelled" } })).toBe(0);
  });
});

describe("cohort.cancelled via the real cancelCohort service (D-07, Pitfall 4, T-13-39)", () => {
  it("cancelling a cohort with 2 ACTIVE and 1 PENDING_PAYMENT enrolments, plus a learner who withdrew two days earlier, mails only the 3 affected learners once each and a second drain adds nothing", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      title: "Real Cancel Cohort",
      capacity: 5,
      seatsTaken: 3,
    });
    const active1 = await seedActiveVerifiedEnrolment(cohortId);
    const active2 = await seedActiveVerifiedEnrolment(cohortId);
    const pending = await seedActiveVerifiedEnrolment(cohortId, {
      status: "PENDING_PAYMENT",
      holdExpiresAt: new Date(Date.now() + 20 * 60_000),
    });
    const earlier = await seedActiveVerifiedEnrolment(cohortId, {
      status: "WITHDRAWN",
      reason: "left before this cancellation",
      withdrawnAt: new Date(Date.now() - 2 * 86_400_000),
    });

    // AuditEvent.actorId is a real FK — the staff actor must exist as a User.
    const actor = await seedVerifiedLearner(testDb.prisma, { name: "Ops Staff" });
    const cohortBefore = await testDb.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } });
    const svc = buildCohortServiceForCancel(actor.id);
    await svc.cancelCohort({
      cohortId,
      reason: "Cohort cancelled — venue lost",
      expectedUpdatedAt: cohortBefore.updatedAt,
    });

    const harness = startDrainHarness(testDb.prisma);
    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    // 2 enrolment.withdrawn (active1, active2) + 1 enrolment.cancelled (pending) + 1 cohort.cancelled.
    expect(result.processed).toBe(4);

    const cohortCancelledDispatches = await testDb.prisma.emailDispatch.findMany({
      where: { template: "cohort-cancelled" },
    });
    expect(cohortCancelledDispatches).toHaveLength(3);
    const affectedRecipients = cohortCancelledDispatches.map((d) => d.userId).sort();
    expect(affectedRecipients).toEqual([active1.userId, active2.userId, pending.userId].sort());
    expect(affectedRecipients).not.toContain(earlier.userId);
    expect(cohortCancelledDispatches.every((d) => d.status === "QUEUED" || d.status === "SENT")).toBe(true);

    const cohortCancelledNotifications = await testDb.prisma.notification.findMany({
      where: { type: "cohort.cancelled" },
    });
    expect(cohortCancelledNotifications).toHaveLength(3);

    const perEnrolmentDispatches = await testDb.prisma.emailDispatch.findMany({
      where: { template: { in: ["enrolment-withdrawn", "enrolment-cancelled"] } },
    });
    expect(perEnrolmentDispatches).toHaveLength(3);
    for (const d of perEnrolmentDispatches) {
      expect(d.status).toBe("SKIPPED");
      expect(d.skipReason).toBe("superseded_by_cohort_cancellation");
    }
    const perEnrolmentQueuedOrSent = perEnrolmentDispatches.filter(
      (d) => d.status === "QUEUED" || d.status === "SENT",
    );
    expect(perEnrolmentQueuedOrSent).toHaveLength(0);

    // The learner withdrawn two days earlier is neither superseded (different
    // occurrence, out of window) nor mailed by the cohort cancellation.
    expect(
      await testDb.prisma.emailDispatch.count({ where: { toEmail: (await testDb.prisma.user.findUniqueOrThrow({ where: { id: earlier.userId } })).email } }),
    ).toBe(0);

    const raw = JSON.stringify(cohortCancelledDispatches) + JSON.stringify(perEnrolmentDispatches);
    expect(raw).not.toContain("Cohort cancelled — venue lost");

    // A second drain of the (now-empty) queue adds nothing new.
    const dispatchCountBefore = await testDb.prisma.emailDispatch.count();
    const notificationCountBefore = await testDb.prisma.notification.count();
    const secondResult = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(secondResult.processed).toBe(0);
    expect(await testDb.prisma.emailDispatch.count()).toBe(dispatchCountBefore);
    expect(await testDb.prisma.notification.count()).toBe(notificationCountBefore);
  });

  it("a single staff withdrawal with no cohort cancellation is mailed normally (D-07 edge)", async () => {
    const { cohortId, enrolmentId, userId } = await seedSingleActiveEnrolment("Solo Withdrawal Cohort");
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(testDb.prisma, "enrolment.withdrawn", {
      enrolmentId,
      cohortId,
      actorId: "staff-11",
      reason: "individual withdrawal",
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatch = await testDb.prisma.emailDispatch.findFirstOrThrow({
      where: { template: "enrolment-withdrawn" },
    });
    expectDelivered(dispatch.status);
    expect(dispatch.userId).toBe(userId);
    expect(await testDb.prisma.emailDispatch.count({ where: { template: "cohort-cancelled" } })).toBe(0);
  });
});
