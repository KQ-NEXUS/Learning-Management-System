/**
 * Phase 13 close-out — one real-Postgres acceptance run of the three ROADMAP
 * success criteria together (13-13, COM-01..04):
 *
 *   1. Every representative lifecycle event yields exactly one templated
 *      email under one sender identity and Reply-To.
 *   2. Replayed, re-drained, overlapped and retried processing never adds a
 *      duplicate EmailDispatch row within a (template, correlationId).
 *   3. Notifications report unread/current state to the right user, open
 *      safely for an owned/ACTIVE target, and fail safely ("unavailable")
 *      for a stale or inaccessible one — plus a permanently failed email
 *      alerts staff exactly once, with no mail-about-a-failed-mail loop.
 *
 * Every earlier plan already proves its own slice in isolation (see
 * tests/domain-event-drain.integration.test.ts, tests/staff-drain.integration
 * .test.ts, tests/notification-access.integration.test.ts, tests/email-
 * delivery-log.integration.test.ts). This file proves the whole promise
 * together, against one real, throwaway Postgres.
 *
 * Criterion 1 wires the REAL `sendTransactionalEmail` (real payload
 * construction, real sender/Reply-To resolution) with only the Brevo SDK's
 * network call itself mocked (`vi.mock("@getbrevo/brevo")`), so "one sender
 * identity" is asserted on actual payload construction, not a test double
 * that reimplements it. Criteria 2 and 3 inject a plain `send` stub (the
 * same convention `tests/domain-event-drain.integration.test.ts` already
 * uses) — payload identity is already proven by criterion 1, so these two
 * only need controllable success/failure timing.
 *
 * PREREQUISITE: Docker must be running (tests/support/pg.ts starts a
 * throwaway postgres:16-alpine container). If it is not, `beforeAll` fails
 * with a container-start error — every case reports BLOCKED, never a silent
 * pass.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedVerifiedLearner, seedStaffUser, writeEvent } from "./support/drain-harness";
import { seedCohortFixture, seedEnrolmentFixture, seedLearnerFixture, seedSessionFixture } from "./support/cohort-fixtures";
import { grant, createTestWithPermission } from "./support/harness";
import {
  createDomainEventDrainService,
  type CreateDomainEventDrainServiceDeps,
} from "@/server/services/domain-event-drain-service";
import { buildMapperTable, EVENT_MAPPER_GROUPS } from "@/server/services/event-intent-mappers";
import {
  createEmailDispatchService,
  createPrismaEmailDispatchStore,
} from "@/server/services/email-dispatch-service";
import { sendTransactionalEmail, describeBrevoFailure, classifyBrevoFailure } from "@/server/email/brevo-client";
import { renderEmail } from "@/server/email/templates/registry";
import { createEmailFailureAlertService } from "@/server/services/email-failure-alert-service";
import { createNotificationService, type NotificationStore } from "@/server/services/notification-service";
import {
  createNotificationAccessService,
  createOwnRecordResolver,
  type NotificationAccessStore,
} from "@/server/services/notification-access-service";
import {
  createEmailDeliveryLogService,
  type EmailDeliveryLogStore,
} from "@/server/services/email-delivery-log-service";
import type { Actor } from "@/server/permissions/with-permission";

// ---------------------------------------------------------------------------
// The Brevo SDK is mocked once for the whole file — only criterion 1's send
// path ever reaches it (criteria 2/3 inject their own `send`, never the real
// `sendTransactionalEmail`).
// ---------------------------------------------------------------------------

const sdk = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@getbrevo/brevo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@getbrevo/brevo")>();
  class FakeBrevoClient {
    transactionalEmails = { sendTransacEmail: sdk.send };
    constructor(_options: unknown) {
      void _options;
    }
  }
  return { ...actual, BrevoClient: FakeBrevoClient };
});

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestDatabase();

  // One real sender identity for the whole file (COM-04, D-14) — every
  // template renders (getBrandName/requireSupportContactEmail) and every
  // link builds (buildAbsoluteUrl) off these.
  process.env.EMAIL_SENDER_NAME = "E2E Acceptance Academy";
  process.env.EMAIL_SENDER_ADDRESS = "no-reply@e2e-acceptance.test";
  process.env.SUPPORT_CONTACT_EMAIL = "help@e2e-acceptance.test";
  process.env.APP_BASE_URL = "https://lms.e2e-acceptance.test";
  // "brevo" (not "stub") so criterion 1's sendTransactionalEmail actually
  // reaches the (mocked) SDK client rather than short-circuiting.
  process.env.EMAIL_TRANSPORT = "brevo";
  process.env.BREVO_API_KEY = "e2e-acceptance-dummy-key-never-sent-over-the-wire";
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

afterEach(async () => {
  // FK-safe order: children before the parents they reference.
  await testDb.prisma.notification.deleteMany();
  await testDb.prisma.emailPreference.deleteMany();
  await testDb.prisma.emailDispatch.deleteMany();
  await testDb.prisma.domainEvent.deleteMany();
  await testDb.prisma.auditEvent.deleteMany({ where: { action: { in: ["domain_event.poisoned", "email.resent"] } } });
  await testDb.prisma.certificate.deleteMany({});
  await testDb.prisma.submission.deleteMany({});
  await testDb.prisma.assessment.deleteMany({});
  await testDb.prisma.refund.deleteMany({});
  await testDb.prisma.paymentAttempt.deleteMany({});
  await testDb.prisma.ticketMessage.deleteMany({});
  await testDb.prisma.ticketEvent.deleteMany({});
  await testDb.prisma.ticket.deleteMany({});
  await testDb.prisma.order.deleteMany({});
  await testDb.prisma.enrolment.deleteMany({});
  await testDb.prisma.scheduledSession.deleteMany({});
  await testDb.prisma.cohort.deleteMany({});
  await testDb.prisma.course.deleteMany({});
  await testDb.prisma.assignment.deleteMany({});
  await testDb.prisma.role.deleteMany({});
  await testDb.prisma.user.deleteMany({
    where: { OR: [{ email: { contains: "@drain-harness.test" } }, { email: { contains: "@fixture.test" } }] },
  });
});

// ---------------------------------------------------------------------------
// Shared wiring helpers
// ---------------------------------------------------------------------------

/** Criterion 1's drain: the REAL send path (real payload construction) with
 * only the Brevo SDK network call mocked. */
function buildRealSendDrain(clockRef: { ms: number }) {
  const store = createPrismaEmailDispatchStore(testDb.prisma);
  const dispatchService = createEmailDispatchService({
    store,
    send: sendTransactionalEmail,
    describeFailure: describeBrevoFailure,
    classifyFailure: classifyBrevoFailure,
    render: renderEmail,
    now: () => new Date(clockRef.ms),
  });
  const alertService = createEmailFailureAlertService({ db: testDb.prisma });
  const drainService = createDomainEventDrainService({
    db: testDb.prisma,
    mapperTable: buildMapperTable(EVENT_MAPPER_GROUPS),
    sendQueued: (params) => dispatchService.sendQueued(params),
    onEmailFailed: (failure) => alertService.notifyFailed(failure),
  });
  return { dispatchService, drainService };
}

/** Criteria 2/3's drain: an injected, fully controllable `send` — no network
 * mock, matching tests/domain-event-drain.integration.test.ts's convention.
 * `classification` defaults to "transient" (criterion 2's retry-then-succeed
 * case); criterion 3's permanently-failing case passes "permanent" so a
 * failure goes straight to FAILED instead of being retried. */
function buildStubSendDrain(
  clockRef: { ms: number },
  send: Parameters<typeof createEmailDispatchService>[0]["send"],
  onEmailFailed?: CreateDomainEventDrainServiceDeps["onEmailFailed"],
  classification: "transient" | "permanent" = "transient",
) {
  const store = createPrismaEmailDispatchStore(testDb.prisma);
  const dispatchService = createEmailDispatchService({
    store,
    send,
    describeFailure: () => "described failure",
    classifyFailure: () => classification,
    render: renderEmail,
    now: () => new Date(clockRef.ms),
  });
  const drainService = createDomainEventDrainService({
    db: testDb.prisma,
    mapperTable: buildMapperTable(EVENT_MAPPER_GROUPS),
    sendQueued: (params) => dispatchService.sendQueued(params),
    onEmailFailed,
  });
  return { dispatchService, drainService };
}

// ---------------------------------------------------------------------------
// Criterion 1
// ---------------------------------------------------------------------------

describe("Phase 13 acceptance — the three ROADMAP success criteria, end to end (real Postgres)", () => {
  it(
    "criterion 1: every representative lifecycle event yields exactly one templated email under one sender identity and Reply-To (COM-01, COM-04)",
    async () => {
      sdk.send.mockReset();
      const captured: Array<{
        sender: { name: string; email: string };
        replyTo?: { email: string };
        htmlContent?: string;
        textContent: string;
        to: { email: string }[];
      }> = [];
      sdk.send.mockImplementation(async (payload: (typeof captured)[number]) => {
        captured.push(payload);
        return { messageId: `brevo-msg-${captured.length}` };
      });

      const clock = { ms: Date.now() };
      const { drainService } = buildRealSendDrain(clock);

      // 1. A ticket reply.
      const replyLearner = await seedVerifiedLearner(testDb.prisma);
      await writeEvent(testDb.prisma, "ticket.public_reply_added", {
        ticketId: "e2e-reply-internal",
        reference: "KQT-E2E-REPLY",
        recipientId: replyLearner.id,
      });

      // 2. An enrolment activation.
      const { cohortId: activationCohortId } = await seedCohortFixture(testDb.prisma);
      const { userId: activationLearnerId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
      const activationEnrolment = await seedEnrolmentFixture(testDb.prisma, {
        cohortId: activationCohortId,
        userId: activationLearnerId,
        status: "ACTIVE",
      });
      await writeEvent(testDb.prisma, "enrolment.activated", { enrolmentId: activationEnrolment.enrolmentId });

      // 3. An enrolment withdrawal.
      const { cohortId: withdrawalCohortId } = await seedCohortFixture(testDb.prisma);
      const { userId: withdrawalLearnerId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
      const withdrawalEnrolment = await seedEnrolmentFixture(testDb.prisma, {
        cohortId: withdrawalCohortId,
        userId: withdrawalLearnerId,
        status: "WITHDRAWN",
      });
      const withdrawalActor = await seedStaffUser(testDb.prisma, []);
      const withdrawalReason = "fixture-withdrawal-reason-must-never-leak";
      await writeEvent(testDb.prisma, "enrolment.withdrawn", {
        enrolmentId: withdrawalEnrolment.enrolmentId,
        cohortId: withdrawalCohortId,
        actorId: withdrawalActor.id,
        reason: withdrawalReason,
      });

      // 4. A session cancellation.
      const { cohortId: sessionCohortId } = await seedCohortFixture(testDb.prisma);
      const { sessionId } = await seedSessionFixture(testDb.prisma, { cohortId: sessionCohortId });
      const { userId: sessionLearnerId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
      // The enrolment id itself is unused below — session.cancelled fans out
      // to every ACTIVE enrolment in the cohort at drain time (D-11), so
      // only the cohort/session ids matter to the seeded event.
      await seedEnrolmentFixture(testDb.prisma, {
        cohortId: sessionCohortId,
        userId: sessionLearnerId,
        status: "ACTIVE",
      });
      await writeEvent(testDb.prisma, "session.cancelled", { sessionId, cohortId: sessionCohortId });

      // 5. A grade release.
      const { cohortId: gradeCohortId, courseId: gradeCourseId } = await seedCohortFixture(testDb.prisma);
      const { userId: gradeLearnerId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
      const gradeEnrolment = await seedEnrolmentFixture(testDb.prisma, {
        cohortId: gradeCohortId,
        userId: gradeLearnerId,
        status: "ACTIVE",
      });
      const assessment = await testDb.prisma.assessment.create({
        data: { courseId: gradeCourseId, type: "QUIZ", title: "E2E Fixture Quiz" },
        select: { id: true },
      });
      await writeEvent(testDb.prisma, "grade.released", {
        enrolmentId: gradeEnrolment.enrolmentId,
        assessmentId: assessment.id,
        score: 97, // must never reach a persisted param or a captured payload (T-13-03)
      });

      // 6. A certificate issue.
      const { cohortId: certCohortId, courseId: certCourseId } = await seedCohortFixture(testDb.prisma);
      const { userId: certLearnerId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
      const certEnrolment = await seedEnrolmentFixture(testDb.prisma, {
        cohortId: certCohortId,
        userId: certLearnerId,
        status: "ACTIVE",
      });
      const certificate = await testDb.prisma.certificate.create({
        data: {
          enrolmentId: certEnrolment.enrolmentId,
          userId: certLearnerId,
          scope: "COURSE",
          courseId: certCourseId,
          awardTitle: "E2E Fixture Award",
          learnerName: "E2E Fixture Learner",
          verificationRef: `VR-E2E-${Date.now()}`,
        },
        select: { id: true },
      });
      await writeEvent(testDb.prisma, "certificate.issued", { certificateId: certificate.id });

      // 7. A payment refund.
      const { cohortId: refundCohortId } = await seedCohortFixture(testDb.prisma, {
        priceNgnMinor: 100_000,
        priceUsdMinor: null,
        currency: "NGN",
      });
      const { userId: refundLearnerId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
      const refundOrder = await testDb.prisma.order.create({
        data: {
          reference: `ORD-E2E-${Date.now()}`,
          userId: refundLearnerId,
          cohortId: refundCohortId,
          amountMinor: 100_000,
          currency: "NGN",
          status: "PAID",
          idempotencyKey: `idem-e2e-${Date.now()}`,
        },
        select: { id: true, reference: true },
      });
      const refundAttempt = await testDb.prisma.paymentAttempt.create({
        data: {
          orderId: refundOrder.id,
          provider: "PAYSTACK",
          providerIntentId: `PSK-E2E-${Date.now()}`,
          amountMinor: 100_000,
          currency: "NGN",
          status: "SUCCEEDED",
          idempotencyKey: `pa-e2e-${Date.now()}`,
          confirmedAt: new Date(),
        },
        select: { id: true },
      });
      const refundReason = "fixture-refund-reason-must-never-leak";
      const refund = await testDb.prisma.refund.create({
        data: {
          orderId: refundOrder.id,
          paymentAttemptId: refundAttempt.id,
          amountMinor: 100_000,
          currency: "NGN",
          provider: "PAYSTACK",
          reason: refundReason,
          accessDecision: "RETAINED",
          status: "COMPLETED",
        },
        select: { id: true },
      });
      await writeEvent(testDb.prisma, "payment.refunded", { refundId: refund.id });

      // 8. A ticket created (fans out to a learner mail AND a staff-only
      // notification — no email — for tickets.manage holders, D-08).
      const requester = await seedVerifiedLearner(testDb.prisma);
      const staffHolder = await seedStaffUser(testDb.prisma, ["tickets.manage"]);
      await writeEvent(testDb.prisma, "ticket.created", {
        ticketId: "e2e-created-internal",
        reference: "KQT-E2E-CREATED",
        requesterId: requester.id,
      });

      const result = await drainService.drain({ events: 25, sends: 25 });
      expect(result.processed).toBe(8);

      // Exactly one templated email per recipient-event pair: 8 events, each
      // producing exactly one learner email (ticket.created's staff fan-out
      // is notification-only, no email, D-08).
      expect(captured).toHaveLength(8);
      const dispatchCount = await testDb.prisma.emailDispatch.count();
      expect(dispatchCount).toBe(8);
      const sentDispatches = await testDb.prisma.emailDispatch.findMany({ where: { status: "SENT" } });
      expect(sentDispatches).toHaveLength(8);

      // One sender identity and one Reply-To across every captured payload.
      const senderKeys = new Set(captured.map((p) => `${p.sender.name}|${p.sender.email}`));
      expect(senderKeys).toEqual(new Set(["E2E Acceptance Academy|no-reply@e2e-acceptance.test"]));
      const replyToKeys = new Set(captured.map((p) => p.replyTo?.email));
      expect(replyToKeys).toEqual(new Set(["help@e2e-acceptance.test"]));

      // Every payload has both an html and a text body.
      expect(
        captured.every((p) => typeof p.htmlContent === "string" && p.htmlContent.length > 0),
      ).toBe(true);
      expect(captured.every((p) => typeof p.textContent === "string" && p.textContent.length > 0)).toBe(true);

      // No fixture reason or message body ever reaches a captured payload.
      // (A bare numeric marker like the fixture "score" is deliberately NOT
      // substring-matched here — cuids and timestamps elsewhere in the same
      // payloads make short digit runs collide by coincidence; the score
      // check below instead asserts structurally that no persisted
      // templateParams object ever carries a "score" key at all.)
      const serialized = JSON.stringify(captured);
      expect(serialized).not.toContain(withdrawalReason);
      expect(serialized).not.toContain(refundReason);
      const dispatchesWithParams = await testDb.prisma.emailDispatch.findMany({
        select: { templateParams: true },
      });
      const serializedParams = JSON.stringify(dispatchesWithParams);
      expect(serializedParams).not.toContain(withdrawalReason);
      expect(serializedParams).not.toContain(refundReason);
      const hasScoreKey = dispatchesWithParams.some(
        (d) => d.templateParams && typeof d.templateParams === "object" && "score" in (d.templateParams as object),
      );
      expect(hasScoreKey).toBe(false);

      // The staff-only ticket.created notification exists, carries no email.
      const staffAlerts = await testDb.prisma.notification.findMany({ where: { type: "staff.ticket_new" } });
      expect(staffAlerts).toHaveLength(1);
      expect(staffAlerts[0]!.recipientId).toBe(staffHolder.id);
    },
    TEST_DB_TIMEOUT_MS,
  );

  // ---------------------------------------------------------------------------
  // Criterion 2
  // ---------------------------------------------------------------------------

  it(
    "criterion 2: replay, overlap and retry never add a duplicate EmailDispatch row within a correlation; a deliberate resend produces exactly one extra send (COM-02)",
    async () => {
      const clock = { ms: Date.now() };
      let sendCount = 0;
      let failNextSend = false;
      const sendCalls: { to: string }[] = [];
      const send = async (params: { to: string }) => {
        sendCalls.push({ to: params.to });
        if (failNextSend) {
          failNextSend = false;
          throw new Error("simulated transient send failure");
        }
        sendCount += 1;
        return { providerMessageId: `stub-msg-${sendCount}` };
      };
      const { dispatchService, drainService } = buildStubSendDrain(clock, send);

      // (a) Replay dedup — resetting processedAt and draining again adds no
      // new row and triggers no second send.
      const learnerA = await seedVerifiedLearner(testDb.prisma);
      const eventA = await writeEvent(testDb.prisma, "ticket.public_reply_added", {
        ticketId: "c2-a",
        reference: "KQT-C2-A",
        recipientId: learnerA.id,
      });
      await drainService.drain({ events: 25, sends: 25 });
      expect(sendCount).toBe(1);
      await testDb.prisma.domainEvent.update({ where: { id: eventA.id }, data: { processedAt: null } });
      await drainService.drain({ events: 25, sends: 25 });
      expect(sendCount).toBe(1);
      const dispatchesA = await testDb.prisma.emailDispatch.findMany({ where: { correlationId: eventA.id } });
      expect(dispatchesA).toHaveLength(1);

      // (b) Overlap dedup — two concurrent drain() calls over the same fresh
      // batch of events never double-process any one of them.
      const overlapBase = Date.now();
      const overlapLearners = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          seedVerifiedLearner(testDb.prisma, { email: `c2-b-${overlapBase}-${i}@drain-harness.test` }),
        ),
      );
      const overlapEvents = await Promise.all(
        overlapLearners.map((learner, i) =>
          writeEvent(
            testDb.prisma,
            "ticket.public_reply_added",
            { ticketId: `c2-b-${i}`, reference: `KQT-C2-B-${overlapBase}-${i}`, recipientId: learner.id },
            new Date(overlapBase + i),
          ),
        ),
      );
      const sendCountBeforeOverlap = sendCount;
      const [overlapResultA, overlapResultB] = await Promise.all([
        drainService.drain({ events: 25, sends: 25 }),
        drainService.drain({ events: 25, sends: 25 }),
      ]);
      expect(overlapResultA.processed + overlapResultB.processed).toBe(5);
      expect(sendCount - sendCountBeforeOverlap).toBe(5);
      for (const event of overlapEvents) {
        const rows = await testDb.prisma.emailDispatch.findMany({ where: { correlationId: event.id } });
        expect(rows).toHaveLength(1);
      }

      // (c) A transient send failure is retried on the SAME row (attempts
      // 2), never a second row, and eventually succeeds.
      const learnerC = await seedVerifiedLearner(testDb.prisma);
      const eventC = await writeEvent(testDb.prisma, "ticket.public_reply_added", {
        ticketId: "c2-c",
        reference: "KQT-C2-C",
        recipientId: learnerC.id,
      });
      failNextSend = true;
      await drainService.drain({ events: 25, sends: 25 });
      let dispatchC = await testDb.prisma.emailDispatch.findFirstOrThrow({ where: { correlationId: eventC.id } });
      expect(dispatchC.status).toBe("QUEUED");
      expect(dispatchC.attempts).toBe(1);
      expect(dispatchC.nextAttemptAt).not.toBeNull();

      clock.ms += 65_000; // past the 60s first-backoff step (D-03)
      await drainService.drain({ events: 0, sends: 25 });
      dispatchC = await testDb.prisma.emailDispatch.findUniqueOrThrow({ where: { id: dispatchC.id } });
      expect(dispatchC.status).toBe("SENT");
      expect(dispatchC.attempts).toBe(2);
      const dispatchesC = await testDb.prisma.emailDispatch.findMany({ where: { correlationId: eventC.id } });
      expect(dispatchesC).toHaveLength(1);

      // (d) A deliberate resend of the already-SENT row from (a) is the ONLY
      // thing that produces a second provider send for that row — never a
      // second EmailDispatch row.
      const actorUser = await seedVerifiedLearner(testDb.prisma);
      const { withPermission: resendWithPermission } = createTestWithPermission(
        [grant("audit.view"), grant("users.manage")],
        { userId: actorUser.id },
      );
      const deliveryLogService = createEmailDeliveryLogService({
        store: testDb.prisma as unknown as EmailDeliveryLogStore,
        withPermission: resendWithPermission,
        resendDispatch: (params) => dispatchService.resend(params),
      });
      const sendCountBeforeResend = sendCount;
      await deliveryLogService.resendDispatch({
        dispatchId: dispatchesA[0]!.id,
        reason: "acceptance test resend verification",
      });
      await drainService.drain({ events: 0, sends: 25 });
      expect(sendCount - sendCountBeforeResend).toBe(1);
      const dispatchesAAfterResend = await testDb.prisma.emailDispatch.findMany({
        where: { correlationId: eventA.id },
      });
      expect(dispatchesAAfterResend).toHaveLength(1);
      expect(dispatchesAAfterResend[0]!.resentCount).toBe(1);

      // The total row count equals the number of distinct (template,
      // correlationId) pairs seeded above: a(1) + b(5) + c(1) = 7. The
      // resend reused (a)'s row; it added none.
      const totalDispatches = await testDb.prisma.emailDispatch.count();
      expect(totalDispatches).toBe(7);
    },
    TEST_DB_TIMEOUT_MS,
  );

  // ---------------------------------------------------------------------------
  // Criterion 3
  // ---------------------------------------------------------------------------

  it(
    "criterion 3: notifications report unread/current state to the right user, open safely or fail safely, and a permanently failed email alerts staff exactly once (COM-03)",
    async () => {
      const notificationService = createNotificationService({ db: testDb.prisma as unknown as NotificationStore });

      // --- Unread count and cursor paging ---
      const learner = await seedVerifiedLearner(testDb.prisma);
      for (let i = 0; i < 3; i++) {
        await testDb.prisma.notification.create({
          data: {
            recipientId: learner.id,
            type: "ticket.reply",
            targetType: "LEARNER_DASHBOARD",
            targetId: `c3-unread-target-${i}`,
            params: {},
            sourceEventId: `c3-unread-${i}-${Date.now()}`,
          },
        });
      }
      await testDb.prisma.notification.create({
        data: {
          recipientId: learner.id,
          type: "ticket.reply",
          targetType: "LEARNER_DASHBOARD",
          targetId: "c3-read-target",
          params: {},
          sourceEventId: `c3-read-${Date.now()}`,
          readAt: new Date(),
        },
      });

      const learnerActor = { userId: learner.id } as Actor;
      expect(await notificationService.unreadCount(learnerActor)).toBe(3);

      const firstPage = await notificationService.list(learnerActor, { limit: 2 });
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.nextCursor).not.toBeNull();
      const secondPage = await notificationService.list(learnerActor, {
        limit: 2,
        cursor: firstPage.nextCursor,
      });
      expect(secondPage.items).toHaveLength(2);
      expect(secondPage.nextCursor).toBeNull();

      // Fetching the list (opening the drawer) marks nothing read.
      expect(await notificationService.unreadCount(learnerActor)).toBe(3);

      // --- ACTIVE vs WITHDRAWN enrolment open outcomes ---
      const { cohortId: activeCohortId } = await seedCohortFixture(testDb.prisma);
      const { cohortId: withdrawnCohortId } = await seedCohortFixture(testDb.prisma);
      const { userId: enrolmentOwnerId } = await seedLearnerFixture(testDb.prisma, { emailVerified: new Date() });
      const activeEnrolment = await seedEnrolmentFixture(testDb.prisma, {
        cohortId: activeCohortId,
        userId: enrolmentOwnerId,
        status: "ACTIVE",
      });
      const withdrawnEnrolment = await seedEnrolmentFixture(testDb.prisma, {
        cohortId: withdrawnCohortId,
        userId: enrolmentOwnerId,
        status: "WITHDRAWN",
      });

      const activeNotification = await testDb.prisma.notification.create({
        data: {
          recipientId: enrolmentOwnerId,
          type: "session.cancelled",
          targetType: "LEARNER_SESSIONS",
          targetId: activeEnrolment.enrolmentId,
          params: {},
          sourceEventId: `c3-active-${Date.now()}`,
        },
      });
      const withdrawnNotification = await testDb.prisma.notification.create({
        data: {
          recipientId: enrolmentOwnerId,
          type: "grade.released",
          targetType: "LEARNER_RESULTS",
          targetId: withdrawnEnrolment.enrolmentId,
          params: {},
          sourceEventId: `c3-withdrawn-${Date.now()}`,
        },
      });

      // Mirrors loadLearnerPath's ownership+ACTIVE-only gate directly against
      // the throwaway database (learner-access.ts's own `prisma` singleton
      // is bound to the app's DATABASE_URL, not this container — see
      // tests/notification-access.integration.test.ts's identical convention).
      const ownActiveOnlyLookup = (actor: Actor, enrolmentId: string) =>
        testDb.prisma.enrolment
          .findUnique({ where: { id: enrolmentId } })
          .then((row) => (row && row.userId === actor.userId && row.status === "ACTIVE" ? row : null));

      const accessService = createNotificationAccessService({
        db: testDb.prisma as unknown as NotificationAccessStore,
        notificationService,
        resolvers: {
          LEARNER_SESSIONS: createOwnRecordResolver(ownActiveOnlyLookup),
          LEARNER_RESULTS: createOwnRecordResolver(ownActiveOnlyLookup),
        },
      });

      const ownerActor = { userId: enrolmentOwnerId } as Actor;
      const activeOutcome = await accessService.resolveOpen(ownerActor, activeNotification.id);
      expect(activeOutcome).toEqual({ status: "ok", href: `/learn/${activeEnrolment.enrolmentId}/sessions` });
      const reloadedActive = await testDb.prisma.notification.findUniqueOrThrow({
        where: { id: activeNotification.id },
      });
      expect(reloadedActive.readAt).not.toBeNull();

      const withdrawnOutcome = await accessService.resolveOpen(ownerActor, withdrawnNotification.id);
      expect(withdrawnOutcome).toEqual({ status: "unavailable" });
      const reloadedWithdrawn = await testDb.prisma.notification.findUniqueOrThrow({
        where: { id: withdrawnNotification.id },
      });
      expect(reloadedWithdrawn.readAt).not.toBeNull();

      // Another user's notification id -> the identical unavailable outcome.
      const stranger = await seedVerifiedLearner(testDb.prisma);
      const strangerNotification = await testDb.prisma.notification.create({
        data: {
          recipientId: stranger.id,
          type: "session.cancelled",
          targetType: "LEARNER_SESSIONS",
          targetId: activeEnrolment.enrolmentId,
          params: {},
          sourceEventId: `c3-stranger-${Date.now()}`,
        },
      });
      const foreignOutcome = await accessService.resolveOpen(ownerActor, strangerNotification.id);
      expect(foreignOutcome).toEqual({ status: "unavailable" });
      expect(foreignOutcome).toEqual(withdrawnOutcome);

      // --- A permanently failed email alerts staff exactly once ---
      const auditHolder = await seedStaffUser(testDb.prisma, ["audit.view"]);
      const nonHolder = await seedStaffUser(testDb.prisma, []);
      const failureRecipient = await seedVerifiedLearner(testDb.prisma);
      const failingDispatch = await testDb.prisma.emailDispatch.create({
        data: {
          template: "staff-order-exception",
          toEmail: `c3-failure-${Date.now()}@drain-harness.test`,
          userId: failureRecipient.id,
          correlationId: `c3-failure-${Date.now()}`,
          status: "QUEUED",
          templateParams: {
            orderReference: "KQO-C3-FAIL",
            reasonLabel: "Amount or currency mismatch",
            paymentPath: "/staff/payments/c3-fail",
          },
        },
      });

      const failClock = { ms: Date.now() };
      const alertService = createEmailFailureAlertService({ db: testDb.prisma });
      const { drainService: failDrainService } = buildStubSendDrain(
        failClock,
        async () => {
          throw new Error("simulated permanent provider failure");
        },
        (failure) => alertService.notifyFailed(failure),
        "permanent",
      );

      const dispatchCountBeforeAlert = await testDb.prisma.emailDispatch.count();
      const failResult = await failDrainService.drain({ events: 0, sends: 25 });
      expect(failResult.failed).toBe(1);

      const updatedFailingDispatch = await testDb.prisma.emailDispatch.findUniqueOrThrow({
        where: { id: failingDispatch.id },
      });
      expect(updatedFailingDispatch.status).toBe("FAILED");

      const alerts = await testDb.prisma.notification.findMany({ where: { type: "staff.email_failed" } });
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.recipientId).toBe(auditHolder.id);
      expect(alerts.some((a) => a.recipientId === nonHolder.id)).toBe(false);

      const dispatchCountAfterAlert = await testDb.prisma.emailDispatch.count();
      expect(dispatchCountAfterAlert).toBe(dispatchCountBeforeAlert);
    },
    TEST_DB_TIMEOUT_MS,
  );
});
