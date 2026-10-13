/**
 * Real-Postgres proof of the outbox drain's spine (D-01, D-02, D-04, D-05,
 * D-11, D-16, D-19, COM-01, COM-02) — a `FOR UPDATE SKIP LOCKED` claim,
 * `createMany({ skipDuplicates: true })` dedup, and poison-event bookkeeping
 * cannot be trusted to a JS fake; this exercises them against a real,
 * throwaway `postgres:16-alpine` (see `tests/support/pg.ts`).
 *
 * PREREQUISITE: Docker must be running (tests/support/pg.ts starts the
 * container). If it is not, `beforeAll` fails with a container-start error —
 * every case reports BLOCKED, never a silent pass.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import {
  startDrainHarness,
  seedVerifiedLearner,
  seedStaffUser,
  writeEvent,
} from "./support/drain-harness";
import {
  createDomainEventDrainService,
  type DrainAuditEvent,
} from "@/server/services/domain-event-drain-service";
import {
  buildMapperTable,
  EVENT_MAPPER_GROUPS,
  type EventMapper,
} from "@/server/services/event-intent-mappers";
import {
  createEmailDispatchService,
  createPrismaEmailDispatchStore,
} from "@/server/services/email-dispatch-service";
import { renderEmail } from "@/server/email/templates/registry";
import { createEmailFailureAlertService } from "@/server/services/email-failure-alert-service";

let testDb: TestDatabase;

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
  await testDb.prisma.auditEvent.deleteMany({ where: { action: "domain_event.poisoned" } });
  await testDb.prisma.assignment.deleteMany({});
  await testDb.prisma.role.deleteMany({ where: { name: { contains: "DrainHarnessRole" } } });
  await testDb.prisma.user.deleteMany({ where: { email: { contains: "@drain-harness.test" } } });
});

/** A fresh drain service bound to an OVERRIDDEN mapper table — used by the
 * poison-event and unknown-type cases below, which must exercise a mapper
 * that throws without touching the real (never-throwing) support mapper. */
function buildDrainServiceWithTable(overrides: Partial<ReturnType<typeof buildMapperTable>> = {}) {
  const table = { ...buildMapperTable(EVENT_MAPPER_GROUPS), ...overrides };
  const auditSpy = vi.fn(async (event: DrainAuditEvent) => {
    void event;
  });
  const store = createPrismaEmailDispatchStore(testDb.prisma);
  const dispatchService = createEmailDispatchService({
    store,
    send: async () => ({ providerMessageId: "stub" }),
    describeFailure: () => "described failure",
    classifyFailure: () => "transient",
    render: renderEmail,
  });
  const drainService = createDomainEventDrainService({
    db: testDb.prisma,
    mapperTable: table,
    sendQueued: (params) => dispatchService.sendQueued(params),
    audit: auditSpy,
  });
  return { drainService, auditSpy };
}

describe("domain-event-drain-service — tracer: ticket.public_reply_added (D-02, D-05, COM-01, COM-02)", () => {
  it("drains a real ticket-reply event into exactly one QUEUED-then-SENT EmailDispatch and one Notification", async () => {
    const harness = startDrainHarness(testDb.prisma);
    const learner = await seedVerifiedLearner(testDb.prisma);
    const event = await writeEvent(testDb.prisma, "ticket.public_reply_added", {
      ticketId: "ticket-internal-1",
      reference: "KQT-TRACER-0001",
      recipientId: learner.id,
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });

    expect(result.processed).toBe(1);
    expect(result.sent).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({ where: { correlationId: event.id } });
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].status).toBe("SENT");
    expect(dispatches[0].toEmail).toBe(learner.email);
    expect(dispatches[0].templateParams).toEqual({
      reference: "KQT-TRACER-0001",
      ticketPath: "/support/KQT-TRACER-0001",
    });

    const notifications = await testDb.prisma.notification.findMany({ where: { sourceEventId: event.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe("ticket.reply");
    expect(notifications[0].targetType).toBe("LEARNER_TICKET");
    expect(notifications[0].targetId).toBe("KQT-TRACER-0001");
    expect(notifications[0].params).toEqual({ reference: "KQT-TRACER-0001" });
    // No other payload key (ticketId, recipientId) ever reaches a persisted row.
    expect(JSON.stringify(dispatches[0].templateParams)).not.toContain("ticket-internal-1");
    expect(JSON.stringify(notifications[0].params)).not.toContain("ticket-internal-1");

    const updatedEvent = await testDb.prisma.domainEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(updatedEvent.processedAt).not.toBeNull();
  });

  it("draining the already-processed event again produces no new rows and no second send", async () => {
    const harness = startDrainHarness(testDb.prisma);
    const learner = await seedVerifiedLearner(testDb.prisma);
    const event = await writeEvent(testDb.prisma, "ticket.public_reply_added", {
      ticketId: "ticket-internal-2",
      reference: "KQT-TRACER-0002",
      recipientId: learner.id,
    });

    await harness.drainService.drain({ events: 25, sends: 25 });
    const second = await harness.drainService.drain({ events: 25, sends: 25 });

    expect(second.processed).toBe(0);
    expect(harness.sendCalls).toHaveLength(1);
    const dispatches = await testDb.prisma.emailDispatch.findMany({ where: { correlationId: event.id } });
    expect(dispatches).toHaveLength(1);
    const notifications = await testDb.prisma.notification.findMany({ where: { sourceEventId: event.id } });
    expect(notifications).toHaveLength(1);
  });

  it("stamps the notification with the time the event happened, not the time it was drained (U-14)", async () => {
    const harness = startDrainHarness(testDb.prisma);
    const learner = await seedVerifiedLearner(testDb.prisma);
    const event = await writeEvent(testDb.prisma, "ticket.public_reply_added", {
      ticketId: "ticket-internal-u14",
      reference: "KQT-U14-0001",
      recipientId: learner.id,
    });
    const happenedAt = new Date(Date.now() - 6 * 60 * 60_000);
    await testDb.prisma.domainEvent.update({ where: { id: event.id }, data: { occurredAt: happenedAt } });

    await harness.drainService.drain({ events: 25, sends: 25 });

    const [notification] = await testDb.prisma.notification.findMany({ where: { sourceEventId: event.id } });
    expect(notification.createdAt.getTime()).toBe(happenedAt.getTime());
  });

  it("resetting processedAt to null and draining again still leaves exactly one dispatch, one notification, and no second send", async () => {
    const harness = startDrainHarness(testDb.prisma);
    const learner = await seedVerifiedLearner(testDb.prisma);
    const event = await writeEvent(testDb.prisma, "ticket.public_reply_added", {
      ticketId: "ticket-internal-3",
      reference: "KQT-TRACER-0003",
      recipientId: learner.id,
    });

    await harness.drainService.drain({ events: 25, sends: 25 });
    await testDb.prisma.domainEvent.update({ where: { id: event.id }, data: { processedAt: null } });
    await harness.drainService.drain({ events: 25, sends: 25 });

    const dispatches = await testDb.prisma.emailDispatch.findMany({ where: { correlationId: event.id } });
    expect(dispatches).toHaveLength(1);
    const notifications = await testDb.prisma.notification.findMany({ where: { sourceEventId: event.id } });
    expect(notifications).toHaveLength(1);
    expect(harness.sendCalls).toHaveLength(1);
  });

  it("two concurrent drain calls over ten unprocessed events leave exactly one dispatch and one notification per event", async () => {
    const harness = startDrainHarness(testDb.prisma);
    const base = Date.now();
    const learners = await Promise.all(
      Array.from({ length: 10 }, (_, i) => seedVerifiedLearner(testDb.prisma, { email: `concurrent-${base}-${i}@drain-harness.test` })),
    );
    const events = await Promise.all(
      learners.map((learner, i) =>
        writeEvent(
          testDb.prisma,
          "ticket.public_reply_added",
          { ticketId: `ticket-conc-${i}`, reference: `KQT-CONC-${base}-${i}`, recipientId: learner.id },
          new Date(base + i),
        ),
      ),
    );

    const [a, b] = await Promise.all([
      harness.drainService.drain({ events: 25, sends: 25 }),
      harness.drainService.drain({ events: 25, sends: 25 }),
    ]);

    expect(a.processed + b.processed).toBe(10);

    for (const event of events) {
      const dispatches = await testDb.prisma.emailDispatch.findMany({ where: { correlationId: event.id } });
      expect(dispatches).toHaveLength(1);
      const notifications = await testDb.prisma.notification.findMany({ where: { sourceEventId: event.id } });
      expect(notifications).toHaveLength(1);
      const updated = await testDb.prisma.domainEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect(updated.processedAt).not.toBeNull();
    }
  });
});

describe("domain-event-drain-service — poison events (D-04)", () => {
  it("marks processed-with-error after 3 failed attempts, audits exactly once, leaves the 4th run untouched, and never stalls a good event in the same run", async () => {
    const poisonMapper: EventMapper = async () => {
      throw new Error("simulated mapper failure");
    };
    const { drainService, auditSpy } = buildDrainServiceWithTable({ "order.created": [poisonMapper] });

    const poisonEvent = await writeEvent(testDb.prisma, "order.created", { orderId: "order-poison-1" });
    const learner = await seedVerifiedLearner(testDb.prisma);
    const goodEvent = await writeEvent(
      testDb.prisma,
      "ticket.public_reply_added",
      { ticketId: "ticket-good-1", reference: "KQT-GOOD-0001", recipientId: learner.id },
      new Date(Date.now() + 1),
    );

    // Run 1 — both events are claimable in the same call; the poison event
    // fails (attempts 1) but does not stop the good event from committing.
    await drainService.processEvents(25);
    let poisonRow = await testDb.prisma.domainEvent.findUniqueOrThrow({ where: { id: poisonEvent.id } });
    expect(poisonRow.attempts).toBe(1);
    expect(poisonRow.processedAt).toBeNull();
    expect(poisonRow.lastError).toBe("Error");
    const goodRow = await testDb.prisma.domainEvent.findUniqueOrThrow({ where: { id: goodEvent.id } });
    expect(goodRow.processedAt).not.toBeNull();
    expect(auditSpy).not.toHaveBeenCalled();

    // Run 2 — attempts 2, still not processed, still no audit.
    await drainService.processEvents(25);
    poisonRow = await testDb.prisma.domainEvent.findUniqueOrThrow({ where: { id: poisonEvent.id } });
    expect(poisonRow.attempts).toBe(2);
    expect(poisonRow.processedAt).toBeNull();
    expect(auditSpy).not.toHaveBeenCalled();

    // Run 3 — the third failure exhausts MAX_EVENT_ATTEMPTS: processed with
    // error, exactly one SYSTEM audit entry, no payload content.
    await drainService.processEvents(25);
    poisonRow = await testDb.prisma.domainEvent.findUniqueOrThrow({ where: { id: poisonEvent.id } });
    expect(poisonRow.attempts).toBe(3);
    expect(poisonRow.processedAt).not.toBeNull();
    expect(poisonRow.lastError).toBe("Error");
    expect(auditSpy).toHaveBeenCalledTimes(1);
    const auditArg = auditSpy.mock.calls[0][0];
    expect(auditArg).toMatchObject({
      actorId: null,
      actorType: "SYSTEM",
      action: "domain_event.poisoned",
      targetType: "DomainEvent",
      targetId: poisonEvent.id,
      outcome: "FAILED",
    });
    expect(auditArg.after).toEqual({ type: "order.created", attempts: 3 });

    // Run 4 — a poisoned (processed) event is never touched again.
    await drainService.processEvents(25);
    poisonRow = await testDb.prisma.domainEvent.findUniqueOrThrow({ where: { id: poisonEvent.id } });
    expect(poisonRow.attempts).toBe(3);
    expect(auditSpy).toHaveBeenCalledTimes(1);
  });

  it("an event whose type is outside DOMAIN_EVENT_TYPE_LIST follows the same poison path", async () => {
    const bogus = await testDb.prisma.domainEvent.create({
      data: { type: "bogus.unknown.type", payload: {}, occurredAt: new Date() },
    });
    const { drainService, auditSpy } = buildDrainServiceWithTable();

    for (let i = 0; i < 3; i++) {
      await drainService.processEvents(25);
    }

    const row = await testDb.prisma.domainEvent.findUniqueOrThrow({ where: { id: bogus.id } });
    expect(row.attempts).toBe(3);
    expect(row.processedAt).not.toBeNull();
    expect(auditSpy).toHaveBeenCalledTimes(1);
  });
});

describe("domain-event-drain-service — recipient state and mute gating (D-11, D-16, D-19)", () => {
  it("a DEACTIVATED recipient gets a SKIPPED dispatch (no templateParams) and no Notification", async () => {
    const harness = startDrainHarness(testDb.prisma);
    const user = await testDb.prisma.user.create({
      data: {
        email: `deactivated-${Date.now()}@drain-harness.test`,
        name: "Deactivated Learner",
        status: "DEACTIVATED",
        emailVerified: new Date(),
      },
    });
    const event = await writeEvent(testDb.prisma, "ticket.public_reply_added", {
      ticketId: "ticket-deact-1",
      reference: "KQT-DEACT-0001",
      recipientId: user.id,
    });

    await harness.drainService.processEvents(25);

    const dispatches = await testDb.prisma.emailDispatch.findMany({ where: { correlationId: event.id } });
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].status).toBe("SKIPPED");
    expect(dispatches[0].skipReason).toBe("recipient_deactivated");
    expect(dispatches[0].templateParams).toBeNull();
    expect(dispatches[0].toEmail).toBe(user.email);

    const notifications = await testDb.prisma.notification.findMany({ where: { sourceEventId: event.id } });
    expect(notifications).toHaveLength(0);
  });

  it("a PENDING_VERIFICATION recipient with no emailVerified gets SKIPPED email_unverified and no Notification", async () => {
    const harness = startDrainHarness(testDb.prisma);
    const user = await testDb.prisma.user.create({
      data: {
        email: `unverified-${Date.now()}@drain-harness.test`,
        name: "Unverified Learner",
        status: "PENDING_VERIFICATION",
        emailVerified: null,
      },
    });
    const event = await writeEvent(testDb.prisma, "ticket.public_reply_added", {
      ticketId: "ticket-unver-1",
      reference: "KQT-UNVER-0001",
      recipientId: user.id,
    });

    await harness.drainService.processEvents(25);

    const dispatches = await testDb.prisma.emailDispatch.findMany({ where: { correlationId: event.id } });
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].status).toBe("SKIPPED");
    expect(dispatches[0].skipReason).toBe("email_unverified");

    const notifications = await testDb.prisma.notification.findMany({ where: { sourceEventId: event.id } });
    expect(notifications).toHaveLength(0);
  });

  it("a missing recipient yields no rows at all, and the event is still processed", async () => {
    const harness = startDrainHarness(testDb.prisma);
    const event = await writeEvent(testDb.prisma, "ticket.public_reply_added", {
      ticketId: "ticket-missing-1",
      reference: "KQT-MISSING-0001",
      recipientId: "nonexistent-user-id-does-not-exist",
    });

    await harness.drainService.processEvents(25);

    const dispatches = await testDb.prisma.emailDispatch.findMany({ where: { correlationId: event.id } });
    expect(dispatches).toHaveLength(0);
    const notifications = await testDb.prisma.notification.findMany({ where: { sourceEventId: event.id } });
    expect(notifications).toHaveLength(0);

    const updated = await testDb.prisma.domainEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(updated.processedAt).not.toBeNull();
  });

  it("a recipient who muted TICKET_UPDATES gets a SKIPPED muted_by_recipient dispatch but still gets the Notification", async () => {
    const harness = startDrainHarness(testDb.prisma);
    const learner = await seedVerifiedLearner(testDb.prisma);
    await testDb.prisma.emailPreference.create({
      data: { userId: learner.id, category: "TICKET_UPDATES", muted: true },
    });
    const event = await writeEvent(testDb.prisma, "ticket.public_reply_added", {
      ticketId: "ticket-muted-1",
      reference: "KQT-MUTED-0001",
      recipientId: learner.id,
    });

    await harness.drainService.processEvents(25);

    const dispatches = await testDb.prisma.emailDispatch.findMany({ where: { correlationId: event.id } });
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].status).toBe("SKIPPED");
    expect(dispatches[0].skipReason).toBe("muted_by_recipient");
    expect(dispatches[0].templateParams).toBeNull();

    const notifications = await testDb.prisma.notification.findMany({ where: { sourceEventId: event.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe("ticket.reply");
  });
});

describe("domain-event-drain-service — administrator alert on a permanently FAILED dispatch (D-08, T-13-11, T-13-45)", () => {
  /** A drain service bound to a `send` that always throws and a
   * `classifyFailure` that always reports "permanent" — every claimed row
   * fails immediately to FAILED, never retried, and `onEmailFailed` is bound
   * to a REAL `emailFailureAlertService` (not a spy) so this proves the
   * actual wiring `domain-event-drain-service.ts`'s singleton uses. */
  function buildFailingDrainService() {
    const store = createPrismaEmailDispatchStore(testDb.prisma);
    const dispatchService = createEmailDispatchService({
      store,
      send: async () => {
        throw new Error("simulated permanent provider failure");
      },
      describeFailure: () => "described permanent failure",
      classifyFailure: () => "permanent",
      render: renderEmail,
    });
    const alertService = createEmailFailureAlertService({ db: testDb.prisma });
    const drainService = createDomainEventDrainService({
      db: testDb.prisma,
      mapperTable: buildMapperTable(EVENT_MAPPER_GROUPS),
      sendQueued: (params) => dispatchService.sendQueued(params),
      onEmailFailed: (failure) => alertService.notifyFailed(failure),
    });
    return drainService;
  }

  async function seedQueuedDispatch(learnerId: string) {
    return testDb.prisma.emailDispatch.create({
      data: {
        template: "staff-order-exception",
        toEmail: `queued-${Date.now()}-${Math.random().toString(36).slice(2)}@drain-harness.test`,
        userId: learnerId,
        correlationId: `corr-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        status: "QUEUED",
        templateParams: {
          orderReference: "KQO-FAIL-1",
          reasonLabel: "Amount or currency mismatch",
          paymentPath: "/staff/payments/order-fail-1",
        },
      },
    });
  }

  it("after a permanently failing send, the row is FAILED and each global audit.view holder has exactly one staff.email_failed notification; a holder without audit.view has none", async () => {
    const learner = await seedVerifiedLearner(testDb.prisma);
    const auditHolder = await seedStaffUser(testDb.prisma, ["audit.view"]);
    const nonHolder = await seedStaffUser(testDb.prisma, []);
    const dispatch = await seedQueuedDispatch(learner.id);
    const drainService = buildFailingDrainService();

    const result = await drainService.drain({ events: 0, sends: 25 });
    expect(result.failed).toBe(1);

    const updated = await testDb.prisma.emailDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
    expect(updated.status).toBe("FAILED");

    const alerts = await testDb.prisma.notification.findMany({ where: { type: "staff.email_failed" } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.recipientId).toBe(auditHolder.id);
    expect(alerts[0]!.targetType).toBe("STAFF_EMAIL_LOG");
    expect(alerts[0]!.targetId).toBe(dispatch.id);
    expect(alerts[0]!.sourceEventId).toBe(dispatch.id);
    expect(alerts[0]!.params).toEqual({
      template: "staff-order-exception",
      dispatchRef: dispatch.id.slice(-8),
    });
    expect(alerts.some((a) => a.recipientId === nonHolder.id)).toBe(false);
    // No persisted alert row carries the recipient email address used above.
    const serialized = JSON.stringify(alerts);
    expect(serialized).not.toContain(dispatch.toEmail);

    // The number of EmailDispatch rows before/after the alert is unchanged —
    // the alert itself created no mail.
    const dispatchCount = await testDb.prisma.emailDispatch.count();
    expect(dispatchCount).toBe(1);
  });

  it("a second drain over the same FAILED state adds no additional notifications", async () => {
    const learner = await seedVerifiedLearner(testDb.prisma);
    const auditHolder = await seedStaffUser(testDb.prisma, ["audit.view"]);
    await seedQueuedDispatch(learner.id);
    const drainService = buildFailingDrainService();

    await drainService.drain({ events: 0, sends: 25 });
    const before = await testDb.prisma.notification.findMany({ where: { type: "staff.email_failed" } });
    expect(before).toHaveLength(1);
    expect(before[0]!.recipientId).toBe(auditHolder.id);

    // The row is already FAILED, so a second `sendQueued` claims nothing —
    // but exercise the drain again to prove idempotency at the drain level.
    const second = await drainService.drain({ events: 0, sends: 25 });
    expect(second.failed).toBe(0);

    const after = await testDb.prisma.notification.findMany({ where: { type: "staff.email_failed" } });
    expect(after).toHaveLength(1);
  });

  it("a run with no failures calls the alert service zero times", async () => {
    const learner = await seedVerifiedLearner(testDb.prisma);
    await seedStaffUser(testDb.prisma, ["audit.view"]);

    const store = createPrismaEmailDispatchStore(testDb.prisma);
    const dispatchService = createEmailDispatchService({
      store,
      send: async () => ({ providerMessageId: "stub-success" }),
      describeFailure: () => "unreachable",
      classifyFailure: () => "permanent",
      render: renderEmail,
    });
    const alertService = createEmailFailureAlertService({ db: testDb.prisma });
    const notifySpy = vi.spyOn(alertService, "notifyFailed");
    const drainService = createDomainEventDrainService({
      db: testDb.prisma,
      mapperTable: buildMapperTable(EVENT_MAPPER_GROUPS),
      sendQueued: (params) => dispatchService.sendQueued(params),
      onEmailFailed: (failure) => alertService.notifyFailed(failure),
    });

    await writeEvent(testDb.prisma, "ticket.public_reply_added", {
      ticketId: "ticket-no-fail-1",
      reference: "KQT-NOFAIL-0001",
      recipientId: learner.id,
    });

    const result = await drainService.drain({ events: 25, sends: 25 });
    expect(result.failed).toBe(0);
    expect(notifySpy).not.toHaveBeenCalled();

    const alerts = await testDb.prisma.notification.findMany({ where: { type: "staff.email_failed" } });
    expect(alerts).toHaveLength(0);
  });

  it("two permanently failing dispatches in one run raise an alert for both (drain calls the service twice)", async () => {
    const learnerA = await seedVerifiedLearner(testDb.prisma);
    const learnerB = await seedVerifiedLearner(testDb.prisma);
    await seedStaffUser(testDb.prisma, ["audit.view"]);
    await seedQueuedDispatch(learnerA.id);
    await seedQueuedDispatch(learnerB.id);

    const store = createPrismaEmailDispatchStore(testDb.prisma);
    const dispatchService = createEmailDispatchService({
      store,
      send: async () => {
        throw new Error("simulated permanent provider failure");
      },
      describeFailure: () => "described permanent failure",
      classifyFailure: () => "permanent",
      render: renderEmail,
    });
    const alertService = createEmailFailureAlertService({ db: testDb.prisma });
    const notifySpy = vi.spyOn(alertService, "notifyFailed");
    const drainService = createDomainEventDrainService({
      db: testDb.prisma,
      mapperTable: buildMapperTable(EVENT_MAPPER_GROUPS),
      sendQueued: (params) => dispatchService.sendQueued(params),
      onEmailFailed: (failure) => alertService.notifyFailed(failure),
    });

    const result = await drainService.drain({ events: 0, sends: 25 });
    expect(result.failed).toBe(2);
    expect(notifySpy).toHaveBeenCalledTimes(2);
  });
});
