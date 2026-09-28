/**
 * Real-Postgres proof for the staff mapper group (D-08, D-20, T-13-13,
 * A-03): the drain resolves staff audiences through the SQL resolver (never
 * the request-scoped permission layer), alerts exactly the entitled staff,
 * and never mails anyone about a new ticket, a new submission, or an
 * assignee-less escalation beyond the notification-only fan-out.
 *
 * PREREQUISITE: Docker must be running (`tests/support/pg.ts` starts the
 * container). If it is not, `beforeAll` fails with a container-start error —
 * every case reports BLOCKED, never a silent pass.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { startDrainHarness, seedVerifiedLearner, seedStaffUser, writeEvent } from "./support/drain-harness";
import { seedCohortFixture, seedEnrolmentFixture } from "./support/cohort-fixtures";

let testDb: TestDatabase;
let orderCounter = 0;

function uniqueOrderReference(): string {
  orderCounter += 1;
  return `KQO-STAFF-${Date.now()}-${orderCounter}`;
}

beforeAll(async () => {
  testDb = await startTestDatabase();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

afterEach(async () => {
  await testDb.prisma.notification.deleteMany();
  await testDb.prisma.emailPreference.deleteMany();
  await testDb.prisma.emailDispatch.deleteMany();
  await testDb.prisma.domainEvent.deleteMany();
  await testDb.prisma.submission.deleteMany({});
  await testDb.prisma.assessment.deleteMany({});
  await testDb.prisma.ticketMessage.deleteMany();
  await testDb.prisma.ticketEvent.deleteMany();
  await testDb.prisma.ticket.deleteMany({});
  await testDb.prisma.enrolment.deleteMany({});
  await testDb.prisma.order.deleteMany({});
  await testDb.prisma.cohort.deleteMany({});
  await testDb.prisma.course.deleteMany({});
  await testDb.prisma.assignment.deleteMany({});
  await testDb.prisma.role.deleteMany({});
  await testDb.prisma.user.deleteMany({ where: { email: { contains: "@drain-harness.test" } } });
});

/** A staff holder that is NOT active — proves the deactivated-staff exclusion
 * (D-11, D-20). `seedStaffUser` always creates an ACTIVE user, so this
 * mirrors it directly with `status: "DEACTIVATED"`. */
async function seedDeactivatedStaffHolder(grants: string[]) {
  const user = await testDb.prisma.user.create({
    data: {
      email: `deactivated-staff-${Date.now()}-${Math.random().toString(36).slice(2)}@drain-harness.test`,
      name: "Deactivated Staff",
      status: "DEACTIVATED",
      emailVerified: new Date(),
      isStaff: true,
    },
  });
  const role = await testDb.prisma.role.create({
    data: { name: `DeactivatedHolderRole-${Date.now()}-${Math.random().toString(36).slice(2)}`, permissions: grants },
  });
  await testDb.prisma.assignment.create({
    data: { userId: user.id, roleId: role.id, scopeType: "GLOBAL", active: true },
  });
  return user;
}

/** A staff holder scoped to one specific cohort (COHORT scope), rather than
 * `seedStaffUser`'s GLOBAL-only shape — needed for the cohort-scoped
 * submission/payment audiences. */
async function seedCohortScopedStaffUser(grants: string[], cohortId: string) {
  const user = await testDb.prisma.user.create({
    data: {
      email: `cohort-staff-${Date.now()}-${Math.random().toString(36).slice(2)}@drain-harness.test`,
      name: "Cohort-Scoped Staff",
      status: "ACTIVE",
      emailVerified: new Date(),
      isStaff: true,
    },
  });
  const role = await testDb.prisma.role.create({
    data: { name: `CohortScopedRole-${Date.now()}-${Math.random().toString(36).slice(2)}`, permissions: grants },
  });
  await testDb.prisma.assignment.create({
    data: { userId: user.id, roleId: role.id, scopeType: "COHORT", scopeId: cohortId, active: true },
  });
  return user;
}

function staffTemplates(dispatches: { template: string }[]): string[] {
  return dispatches.filter((d) => d.template.startsWith("staff-")).map((d) => d.template);
}

async function seedOrderInCohort(cohortId: string, userId: string, overrides: Record<string, unknown> = {}) {
  const reference = uniqueOrderReference();
  return testDb.prisma.order.create({
    data: {
      reference,
      userId,
      cohortId,
      amountMinor: 100_000,
      currency: "NGN",
      status: "EXCEPTION",
      idempotencyKey: `idem-${reference}`,
      ...overrides,
    },
  });
}

describe("ticket.created staff alert (D-08, Task 1 tracer)", () => {
  it("notifies every global tickets.manage holder except the requester, with no email", async () => {
    const requester = await seedStaffUser(testDb.prisma, ["tickets.manage"]);
    const otherHolder = await seedStaffUser(testDb.prisma, ["tickets.manage"]);
    const deactivatedHolder = await seedDeactivatedStaffHolder(["tickets.manage"]);
    const nonHolderStaff = await seedStaffUser(testDb.prisma, []);
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(testDb.prisma, "ticket.created", {
      ticketId: "fixture-ticket-id",
      reference: "KQT-STAFF-1",
      requesterId: requester.id,
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const staffNotifications = await testDb.prisma.notification.findMany({
      where: { type: "staff.ticket_new" },
    });
    expect(staffNotifications).toHaveLength(1);
    expect(staffNotifications[0]!.recipientId).toBe(otherHolder.id);
    expect(staffNotifications.some((n) => n.recipientId === requester.id)).toBe(false);
    expect(staffNotifications.some((n) => n.recipientId === deactivatedHolder.id)).toBe(false);
    expect(staffNotifications.some((n) => n.recipientId === nonHolderStaff.id)).toBe(false);

    const dispatches = await testDb.prisma.emailDispatch.findMany({});
    expect(staffTemplates(dispatches)).toHaveLength(0);
  });
});

describe("ticket.assigned staff mail (D-08)", () => {
  it("mails and notifies the assignee named on the payload", async () => {
    const assignee = await seedStaffUser(testDb.prisma, ["tickets.manage"]);
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(testDb.prisma, "ticket.assigned", {
      ticketId: "fixture-ticket-id",
      reference: "KQT-STAFF-2",
      assigneeId: assignee.id,
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatch = await testDb.prisma.emailDispatch.findFirstOrThrow({
      where: { template: "staff-ticket-assigned" },
    });
    expect(dispatch.userId).toBe(assignee.id);
    expect(dispatch.templateParams).toEqual({ reference: "KQT-STAFF-2", ticketPath: "/staff/support/KQT-STAFF-2" });

    const notification = await testDb.prisma.notification.findFirstOrThrow({
      where: { type: "staff.ticket_assigned" },
    });
    expect(notification.recipientId).toBe(assignee.id);
  });
});

describe("ticket.escalated staff alert (D-08, A-03)", () => {
  async function seedTicketRow(overrides: { assigneeId?: string | null } = {}) {
    const requester = await seedVerifiedLearner(testDb.prisma);
    const ticket = await testDb.prisma.ticket.create({
      data: {
        reference: `KQT-ESC-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        userId: requester.id,
        category: "OTHER",
        subject: "Fixture ticket",
        status: "ESCALATED",
        queue: "FINANCE",
        assigneeId: overrides.assigneeId ?? null,
      },
      select: { id: true, reference: true },
    });
    return ticket;
  }

  it("mails and notifies only the assignee when one is set on the Ticket row", async () => {
    const assignee = await seedStaffUser(testDb.prisma, ["tickets.manage"]);
    const otherHolder = await seedStaffUser(testDb.prisma, ["tickets.manage"]);
    const ticket = await seedTicketRow({ assigneeId: assignee.id });
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(testDb.prisma, "ticket.escalated", {
      ticketId: ticket.id,
      reference: ticket.reference,
      queue: "FINANCE",
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({ where: { template: "staff-ticket-escalated" } });
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.userId).toBe(assignee.id);
    expect(dispatches[0]!.templateParams).toEqual({
      reference: ticket.reference,
      queueLabel: "Finance",
      ticketPath: `/staff/support/${ticket.reference}`,
    });

    const notifications = await testDb.prisma.notification.findMany({ where: { type: "staff.ticket_escalated" } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.recipientId).toBe(assignee.id);
    expect(notifications.some((n) => n.recipientId === otherHolder.id)).toBe(false);
  });

  it("notifies every global tickets.manage holder with no email when no assignee is set", async () => {
    const holderA = await seedStaffUser(testDb.prisma, ["tickets.manage"]);
    const holderB = await seedStaffUser(testDb.prisma, ["tickets.manage"]);
    const ticket = await seedTicketRow({ assigneeId: null });
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(testDb.prisma, "ticket.escalated", {
      ticketId: ticket.id,
      reference: ticket.reference,
      queue: "FINANCE",
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({ where: { template: "staff-ticket-escalated" } });
    expect(dispatches).toHaveLength(0);

    const notifications = await testDb.prisma.notification.findMany({ where: { type: "staff.ticket_escalated" } });
    const recipientIds = notifications.map((n) => n.recipientId).sort();
    expect(recipientIds).toEqual([holderA.id, holderB.id].sort());
  });
});

describe("order.exception staff mail (D-08, T-13-03)", () => {
  it("emails and notifies only payments.view holders whose scope reaches the order's cohort", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { title: "Staff Order Exception Cohort" });
    const learner = await seedVerifiedLearner(testDb.prisma);
    const order = await seedOrderInCohort(cohortId, learner.id);
    const cohortHolder = await seedCohortScopedStaffUser(["payments.view"], cohortId);
    const otherCohortHolder = await seedCohortScopedStaffUser(["payments.view"], "some-other-cohort");
    const nonHolder = await seedStaffUser(testDb.prisma, []);
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(testDb.prisma, "order.exception", {
      orderId: order.id,
      reason: "amount_or_currency_mismatch",
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({ where: { template: "staff-order-exception" } });
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.userId).toBe(cohortHolder.id);
    expect(dispatches[0]!.templateParams).toEqual({
      orderReference: order.reference,
      reasonLabel: "Amount or currency mismatch",
      paymentPath: `/staff/payments/${order.id}`,
    });

    const notifications = await testDb.prisma.notification.findMany({ where: { type: "staff.order_exception" } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.recipientId).toBe(cohortHolder.id);
    expect(notifications.some((n) => n.recipientId === otherCohortHolder.id)).toBe(false);
    expect(notifications.some((n) => n.recipientId === nonHolder.id)).toBe(false);
  });

  it("renders the generic label for an unknown reason code (edge)", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { title: "Staff Order Exception Unknown Reason" });
    const learner = await seedVerifiedLearner(testDb.prisma);
    const order = await seedOrderInCohort(cohortId, learner.id);
    await seedCohortScopedStaffUser(["payments.view"], cohortId);
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(testDb.prisma, "order.exception", {
      orderId: order.id,
      reason: "SECRET-UNMAPPED-REASON-do-not-leak",
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatch = await testDb.prisma.emailDispatch.findFirstOrThrow({ where: { template: "staff-order-exception" } });
    expect(dispatch.templateParams).toMatchObject({ reasonLabel: "Payment needs review" });
    expect(JSON.stringify(dispatch.templateParams)).not.toContain("SECRET-UNMAPPED-REASON-do-not-leak");
  });
});

describe("payment.reconciliation_exception staff mail (D-08, T-13-03)", () => {
  it("emails and notifies payments.view holders scoped to the order's cohort, never the exceptionNote", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { title: "Staff Reconciliation Exception Cohort" });
    const learner = await seedVerifiedLearner(testDb.prisma);
    const order = await seedOrderInCohort(cohortId, learner.id, { status: "PAID", paidAt: new Date() });
    const cohortHolder = await seedCohortScopedStaffUser(["payments.view"], cohortId);
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(testDb.prisma, "payment.reconciliation_exception", {
      orderId: order.id,
      paymentAttemptId: "fixture-attempt-id",
      provider: "STRIPE",
      exceptionNote: "SECRET-RECONCILIATION-NOTE-do-not-leak",
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatch = await testDb.prisma.emailDispatch.findFirstOrThrow({
      where: { template: "staff-reconciliation-exception" },
    });
    expect(dispatch.userId).toBe(cohortHolder.id);
    expect(dispatch.templateParams).toEqual({
      orderReference: order.reference,
      paymentPath: `/staff/payments/${order.id}`,
    });
    expect(JSON.stringify(dispatch.templateParams)).not.toContain("SECRET-RECONCILIATION-NOTE-do-not-leak");

    const notification = await testDb.prisma.notification.findFirstOrThrow({
      where: { type: "staff.reconciliation_exception" },
    });
    expect(JSON.stringify(notification.params)).not.toContain("SECRET-RECONCILIATION-NOTE-do-not-leak");
  });
});

describe("submission.created staff alert (D-08, D-20)", () => {
  it("alerts only the cohort-scoped grader, never a grader scoped to another cohort or a non-holder", async () => {
    const { cohortId: cohortAId, courseId } = await seedCohortFixture(testDb.prisma, {
      title: "Staff Submission Cohort A",
    });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, { cohortId: cohortAId });
    const assessment = await testDb.prisma.assessment.create({
      data: { courseId, type: "ASSIGNMENT", title: "Fixture Assessment" },
      select: { id: true },
    });
    const submission = await testDb.prisma.submission.create({
      data: {
        assessmentId: assessment.id,
        enrolmentId,
        versionUsed: 1,
        storageKey: "fixture-key",
        filename: "fixture.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        uploadStatus: "READY",
      },
      select: { id: true },
    });
    const cohortAGrader = await seedCohortScopedStaffUser(["submissions.view"], cohortAId);
    const cohortBGrader = await seedCohortScopedStaffUser(["submissions.view"], "some-other-cohort");
    const nonHolder = await seedStaffUser(testDb.prisma, []);
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(testDb.prisma, "submission.created", {
      submissionId: submission.id,
      assessmentId: assessment.id,
      enrolmentId,
      attemptNumber: 1,
      isLate: false,
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({});
    expect(staffTemplates(dispatches)).toHaveLength(0);

    const notifications = await testDb.prisma.notification.findMany({ where: { type: "staff.submission_new" } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.recipientId).toBe(cohortAGrader.id);
    expect(notifications[0]!.params).toEqual({ cohortId: cohortAId, assessmentId: assessment.id });
    expect(notifications.some((n) => n.recipientId === cohortBGrader.id)).toBe(false);
    expect(notifications.some((n) => n.recipientId === nonHolder.id)).toBe(false);
  });
});
