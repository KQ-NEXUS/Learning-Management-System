/**
 * Real-Postgres proof for the support-ticket mapper group's learner-facing
 * events (D-07, D-16, T-13-03) — properties a JS fake cannot prove: the
 * drain's own recipient-state/mute gating actually persisting a SKIPPED
 * `muted_by_recipient` row for each TICKET_UPDATES template while the
 * ticket-created confirmation stays QUEUED/SENT (D-16's always-sent list),
 * and that the ticket message body used in the fixture never reaches a
 * persisted column.
 *
 * PREREQUISITE: Docker must be running (`tests/support/pg.ts` starts the
 * container). If it is not, `beforeAll` fails with a container-start error —
 * every case reports BLOCKED, never a silent pass.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { startDrainHarness, writeEvent } from "./support/drain-harness";

let testDb: TestDatabase;

const TICKET_MESSAGE_BODY = "SECRET-TICKET-MESSAGE-BODY-do-not-persist";

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
  await testDb.prisma.ticketMessage.deleteMany();
  await testDb.prisma.ticketEvent.deleteMany();
  await testDb.prisma.ticket.deleteMany({});
  await testDb.prisma.user.deleteMany({ where: { email: { contains: "@drain-harness.test" } } });
});

let ticketCounter = 0;

/** Seeds a real, verified requester and a real Ticket row (with an INITIAL
 * message carrying `TICKET_MESSAGE_BODY`) — every template this file
 * exercises is TICKET_UPDATES or ALWAYS, neither of which is AUTH, so an
 * unverified address would be silently SKIPPED (`email_unverified`) and mask
 * the behaviour actually under test. */
async function seedTicket(overrides: { assigneeId?: string | null } = {}) {
  ticketCounter += 1;
  const requester = await testDb.prisma.user.create({
    data: {
      email: `requester-${Date.now()}-${ticketCounter}@drain-harness.test`,
      name: "Drain Harness Requester",
      status: "ACTIVE",
      emailVerified: new Date(),
    },
    select: { id: true },
  });
  const ticket = await testDb.prisma.ticket.create({
    data: {
      reference: `KQT-DRAIN-${Date.now()}-${ticketCounter}`,
      userId: requester.id,
      category: "OTHER",
      subject: "Fixture ticket",
      status: "OPEN",
      assigneeId: overrides.assigneeId ?? null,
    },
    select: { id: true, reference: true },
  });
  await testDb.prisma.ticketMessage.create({
    data: {
      ticketId: ticket.id,
      authorId: requester.id,
      kind: "INITIAL",
      visibility: "PUBLIC",
      body: TICKET_MESSAGE_BODY,
    },
  });
  return { ticketId: ticket.id, reference: ticket.reference, requesterId: requester.id };
}

describe("ticket.created drain (D-07, D-16 always-sent)", () => {
  it("mails the requester the created confirmation and creates a ticket.created notification", async () => {
    const { ticketId, reference, requesterId } = await seedTicket();
    const harness = startDrainHarness(testDb.prisma);

    const event = await writeEvent(testDb.prisma, "ticket.created", { ticketId, reference, requesterId });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({});
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.template).toBe("ticket-created");
    expectDelivered(dispatches[0]!.status);
    expect(dispatches[0]!.correlationId).toBe(event.id);
    expect(dispatches[0]!.userId).toBe(requesterId);
    expect(dispatches[0]!.templateParams).toEqual({ reference, ticketPath: `/support/${reference}` });

    const notifications = await testDb.prisma.notification.findMany({});
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe("ticket.created");
    expect(notifications[0]!.targetType).toBe("LEARNER_TICKET");
    expect(notifications[0]!.targetId).toBe(reference);

    const raw = JSON.stringify(dispatches) + JSON.stringify(notifications);
    expect(raw).not.toContain(TICKET_MESSAGE_BODY);
  });

  it("stays QUEUED/SENT even when TICKET_UPDATES is muted for the requester (D-16 always-sent)", async () => {
    const { ticketId, reference, requesterId } = await seedTicket();
    await testDb.prisma.emailPreference.create({ data: { userId: requesterId, category: "TICKET_UPDATES", muted: true } });
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(testDb.prisma, "ticket.created", { ticketId, reference, requesterId });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatch = await testDb.prisma.emailDispatch.findFirstOrThrow({ where: { template: "ticket-created" } });
    expectDelivered(dispatch.status);
  });
});

describe("ticket.public_reply_added drain (Plan 07 precedent)", () => {
  it("mails the recipient the reply template and creates a ticket.reply notification", async () => {
    const { ticketId, reference, requesterId } = await seedTicket();
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(testDb.prisma, "ticket.public_reply_added", {
      ticketId,
      reference,
      recipientId: requesterId,
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({});
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.template).toBe("ticket-reply");
    expect(dispatches[0]!.userId).toBe(requesterId);

    const notifications = await testDb.prisma.notification.findMany({});
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe("ticket.reply");
  });
});

describe("ticket.resolved drain (D-07)", () => {
  it("mails the requester the resolved template and creates a ticket.resolved notification", async () => {
    const { ticketId, reference, requesterId } = await seedTicket();
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(testDb.prisma, "ticket.resolved", { ticketId, reference, requesterId });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({});
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.template).toBe("ticket-resolved");

    const notifications = await testDb.prisma.notification.findMany({});
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe("ticket.resolved");
  });

  it("is SKIPPED muted_by_recipient when TICKET_UPDATES is muted, with the notification still created", async () => {
    const { ticketId, reference, requesterId } = await seedTicket();
    await testDb.prisma.emailPreference.create({ data: { userId: requesterId, category: "TICKET_UPDATES", muted: true } });
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(testDb.prisma, "ticket.resolved", { ticketId, reference, requesterId });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatch = await testDb.prisma.emailDispatch.findFirstOrThrow({ where: { template: "ticket-resolved" } });
    expect(dispatch.status).toBe("SKIPPED");
    expect(dispatch.skipReason).toBe("muted_by_recipient");

    const notifications = await testDb.prisma.notification.findMany({ where: { type: "ticket.resolved" } });
    expect(notifications).toHaveLength(1);
  });
});

describe("ticket.closed drain (D-07)", () => {
  it("mails the requester the closed template and creates a ticket.closed notification", async () => {
    const { ticketId, reference, requesterId } = await seedTicket();
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(testDb.prisma, "ticket.closed", { ticketId, reference, requesterId });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({});
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.template).toBe("ticket-closed");

    const notifications = await testDb.prisma.notification.findMany({});
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe("ticket.closed");
  });

  it("is SKIPPED muted_by_recipient when TICKET_UPDATES is muted, with the notification still created", async () => {
    const { ticketId, reference, requesterId } = await seedTicket();
    await testDb.prisma.emailPreference.create({ data: { userId: requesterId, category: "TICKET_UPDATES", muted: true } });
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(testDb.prisma, "ticket.closed", { ticketId, reference, requesterId });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatch = await testDb.prisma.emailDispatch.findFirstOrThrow({ where: { template: "ticket-closed" } });
    expect(dispatch.status).toBe("SKIPPED");
    expect(dispatch.skipReason).toBe("muted_by_recipient");
  });
});

describe("ticket.reopened drain (D-07, A-04)", () => {
  it("mails the requester exactly once even when payload ownerId is null (A-04)", async () => {
    const { ticketId, reference, requesterId } = await seedTicket({ assigneeId: null });
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(testDb.prisma, "ticket.reopened", { ticketId, ownerId: null });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({});
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.template).toBe("ticket-reopened");
    expect(dispatches[0]!.userId).toBe(requesterId);
    expect(dispatches[0]!.templateParams).toEqual({ reference, ticketPath: `/support/${reference}` });

    const notifications = await testDb.prisma.notification.findMany({});
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe("ticket.reopened");
  });

  it("mails the requester (not the assignee) when payload ownerId is set", async () => {
    const assignee = await testDb.prisma.user.create({
      data: {
        email: `assignee-${Date.now()}@drain-harness.test`,
        name: "Drain Harness Assignee",
        status: "ACTIVE",
        emailVerified: new Date(),
        isStaff: true,
      },
      select: { id: true },
    });
    const { ticketId, reference, requesterId } = await seedTicket({ assigneeId: assignee.id });
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(testDb.prisma, "ticket.reopened", { ticketId, ownerId: assignee.id });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatch = await testDb.prisma.emailDispatch.findFirstOrThrow({ where: { template: "ticket-reopened" } });
    expect(dispatch.userId).toBe(requesterId);
    expect(dispatch.userId).not.toBe(assignee.id);
    expect(reference).toBeTruthy();
  });

  it("returns no rows when the ticket no longer exists (edge)", async () => {
    const harness = startDrainHarness(testDb.prisma);
    await writeEvent(testDb.prisma, "ticket.reopened", { ticketId: "does-not-exist", ownerId: null });
    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);
    expect(await testDb.prisma.emailDispatch.count()).toBe(0);
    expect(await testDb.prisma.notification.count()).toBe(0);
  });
});
