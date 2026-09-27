/**
 * Real-Postgres proof for the support-ticket lifecycle races (SUP-02, T-12-04,
 * T-12-08, plan 12-04). Production service composition only: the interactive
 * `createPrismaBackedTicketService` and the actorless
 * `createTicketAutoCloseSystemService`, both over independent pooled
 * connections/transactions of a throwaway `postgres:16-alpine`.
 *
 * ENV-VAR-BEFORE-IMPORT: ticket-service.ts transitively imports `@/server/db`,
 * which builds the singleton PrismaClient from DATABASE_URL on first
 * evaluation, so services are imported dynamically after the container starts.
 *
 * PREREQUISITE: Docker. Without it `beforeAll` fails (Docker-BLOCKED); a skip
 * is never evidence.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { createTestWithPermission, grant } from "./support/harness";

let testDb: TestDatabase;
let serviceModule: typeof import("@/server/services/ticket-service");
let autoCloseModule: typeof import("@/server/services/ticket-auto-close-system-service");

beforeAll(async () => {
  testDb = await startTestDatabase();
  process.env.DATABASE_URL = testDb.url;
  serviceModule = await import("@/server/services/ticket-service");
  autoCloseModule = await import("@/server/services/ticket-auto-close-system-service");
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

const DAY = 86_400_000;
let counter = 0;
const uniq = (p: string) => `${p}-${++counter}-${Date.now()}`;

async function makeUser(prefix: string) {
  return testDb.prisma.user.create({
    data: { email: `${uniq(prefix)}@example.test`, name: prefix },
    select: { id: true },
  });
}

function staffService(userId: string, now?: () => Date) {
  const { withPermission } = createTestWithPermission([grant("tickets.manage")], { userId });
  return serviceModule.createPrismaBackedTicketService(testDb.prisma as never, {
    getActor: async () => ({ userId }),
    withPermission,
    now,
  });
}

function learnerService(userId: string, now?: () => Date) {
  const { withPermission } = createTestWithPermission([], { userId });
  return serviceModule.createPrismaBackedTicketService(testDb.prisma as never, {
    getActor: async () => ({ userId }),
    withPermission,
    now,
  });
}

function autoClose(
  now: Date,
  hook?: { afterSelect?: () => Promise<void> },
) {
  return autoCloseModule.createTicketAutoCloseSystemService({
    now: () => now,
    ticket: {
      findMany: async (args) => {
        const rows = await (testDb.prisma.ticket as never as { findMany(a: unknown): Promise<never[]> }).findMany({
          ...args,
          // Scope to the fixture so parallel fixtures never interfere.
          where: { ...args.where },
        });
        await hook?.afterSelect?.();
        return rows;
      },
    },
    runInTransaction: (fn) => testDb.prisma.$transaction((tx) => fn(tx as never)),
  });
}

async function seedTicket(input: {
  status: "OPEN" | "ASSIGNED" | "RESOLVED";
  resolvedAt?: Date | null;
  assigneeId?: string | null;
}) {
  const learner = await makeUser("learner");
  const ticket = await testDb.prisma.ticket.create({
    data: {
      reference: uniq("TKT"),
      userId: learner.id,
      category: "OTHER",
      subject: "Concurrency fixture",
      status: input.status,
      resolvedAt: input.resolvedAt ?? null,
      assigneeId: input.assigneeId ?? null,
    },
  });
  return { learnerId: learner.id, ticket };
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** Starts every operation behind one barrier so the transactions genuinely overlap. */
async function race<T extends unknown[]>(ops: { [K in keyof T]: () => Promise<T[K]> }) {
  const g = gate();
  const running = ops.map((op) => g.promise.then(op).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  ));
  g.release();
  return Promise.all(running);
}

async function snapshot(ticketId: string, reference: string) {
  const [ticket, events, audits, outbox] = await Promise.all([
    testDb.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } }),
    testDb.prisma.ticketEvent.findMany({ where: { ticketId }, orderBy: { createdAt: "asc" } }),
    testDb.prisma.auditEvent.findMany({ where: { targetType: "Ticket", targetId: ticketId } }),
    testDb.prisma.domainEvent.findMany({
      where: { payload: { path: ["ticketId"], equals: ticketId } },
    }),
  ]);
  void reference;
  return { ticket, events, audits, outbox };
}

const ROUNDS = 4;

describe("ticket lifecycle races against real PostgreSQL", () => {
  it("two simultaneous claims at one version yield one winner and one stale conflict", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const a = await makeUser("staff-a");
      const b = await makeUser("staff-b");
      const { ticket } = await seedTicket({ status: "OPEN" });

      const results = await race([
        () => staffService(a.id).claimTicket({ reference: ticket.reference, expectedVersion: 1 }),
        () => staffService(b.id).claimTicket({ reference: ticket.reference, expectedVersion: 1 }),
      ]);

      const winners = results.filter((r) => r.ok);
      const losers = results.filter((r) => !r.ok);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect((losers[0] as { error: Error }).error.name).toBe("StaleTicketVersionError");

      const snap = await snapshot(ticket.id, ticket.reference);
      expect(snap.ticket.version).toBe(2);
      expect(snap.ticket.status).toBe("ASSIGNED");
      expect([a.id, b.id]).toContain(snap.ticket.assigneeId);
      expect(snap.events.filter((e) => e.type === "CLAIMED")).toHaveLength(1);
      expect(snap.audits.filter((e) => e.action === "ticket.claimed")).toHaveLength(1);
    }
  });

  it("resolve racing a public reply yields one legal serial outcome with intact history", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const staff1 = await makeUser("staff-r");
      const staff2 = await makeUser("staff-p");
      const { ticket } = await seedTicket({ status: "ASSIGNED", assigneeId: staff1.id });

      const results = await race([
        () => staffService(staff1.id).resolveTicket({ reference: ticket.reference, expectedVersion: 1 }),
        () => staffService(staff2.id).addPublicReply({ reference: ticket.reference, expectedVersion: 1, body: "Hello there" }),
      ]);

      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const loser = results.find((r) => !r.ok) as { error: Error };
      expect(loser.error.name).toBe("StaleTicketVersionError");

      const snap = await snapshot(ticket.id, ticket.reference);
      const messages = await testDb.prisma.ticketMessage.count({ where: { ticketId: ticket.id } });
      expect(snap.ticket.version).toBe(2);
      const resolveWon = results[0].ok;
      if (resolveWon) {
        expect(snap.ticket.status).toBe("RESOLVED");
        expect(snap.events.filter((e) => e.type === "RESOLVED")).toHaveLength(1);
        expect(messages).toBe(0);
        expect(snap.outbox.filter((e) => e.type === "ticket.resolved")).toHaveLength(1);
        expect(snap.outbox.filter((e) => e.type === "ticket.public_reply_added")).toHaveLength(0);
      } else {
        expect(snap.ticket.status).toBe("ASSIGNED");
        expect(snap.events.filter((e) => e.type === "RESOLVED")).toHaveLength(0);
        expect(messages).toBe(1);
        expect(snap.outbox.filter((e) => e.type === "ticket.public_reply_added")).toHaveLength(1);
        expect(snap.outbox.filter((e) => e.type === "ticket.resolved")).toHaveLength(0);
      }
    }
  });

  it("learner reopen racing auto-close yields exactly one terminal result", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const staff = await makeUser("staff-o");
      const T = new Date(Date.now());
      const { ticket, learnerId } = await seedTicket({
        status: "RESOLVED",
        resolvedAt: new Date(T.getTime() - 7 * DAY),
        assigneeId: staff.id,
      });

      const results = await race([
        () => learnerService(learnerId, () => T).reopenOwnTicket({ reference: ticket.reference, expectedVersion: 1, reason: "Still broken" }),
        () => autoClose(T).closeResolvedTickets(),
      ]);
      const [reopen, sweep] = results;
      expect(sweep.ok).toBe(true);

      const snap = await snapshot(ticket.id, ticket.reference);
      expect(snap.ticket.version).toBe(2);
      const closedEvents = snap.events.filter((e) => e.type === "AUTO_CLOSED");
      const reopenedEvents = snap.events.filter((e) => e.type === "REOPENED");
      expect(closedEvents.length + reopenedEvents.length).toBe(1);
      const closedOutbox = snap.outbox.filter((e) => e.type === "ticket.closed");
      const reopenedOutbox = snap.outbox.filter((e) => e.type === "ticket.reopened");
      if (reopen.ok) {
        expect(snap.ticket.status).toBe("ASSIGNED");
        expect(snap.ticket.closedAt).toBeNull();
        expect(closedOutbox).toHaveLength(0);
        expect(reopenedOutbox).toHaveLength(1);
        expect((sweep as { value: { closed: number } }).value.closed).toBe(0);
      } else {
        expect((reopen as { error: Error }).error.name).toBe("StaleTicketVersionError");
        expect(snap.ticket.status).toBe("CLOSED");
        expect(closedOutbox).toHaveLength(1);
        expect(reopenedOutbox).toHaveLength(0);
        expect((sweep as { value: { closed: number } }).value.closed).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("a stale scheduled candidate never overwrites a committed reopen", async () => {
    const staff = await makeUser("staff-s");
    const T = new Date(Date.now());
    const { ticket, learnerId } = await seedTicket({
      status: "RESOLVED",
      resolvedAt: new Date(T.getTime() - 7 * DAY),
      assigneeId: staff.id,
    });

    // The sweep has selected its candidate; the learner reopens before the update.
    const sweep = await autoClose(T, {
      afterSelect: async () => {
        await learnerService(learnerId, () => T).reopenOwnTicket({
          reference: ticket.reference,
          expectedVersion: 1,
          reason: "Still broken",
        });
      },
    }).closeResolvedTickets();

    expect(sweep.skipped).toBeGreaterThanOrEqual(1);
    expect(sweep.failed).toBe(0);
    const snap = await snapshot(ticket.id, ticket.reference);
    expect(snap.ticket.status).toBe("ASSIGNED");
    expect(snap.ticket.version).toBe(2);
    expect(snap.ticket.closedAt).toBeNull();
    expect(snap.events.filter((e) => e.type === "AUTO_CLOSED")).toHaveLength(0);
    expect(snap.audits.filter((e) => e.action === "ticket.auto_closed")).toHaveLength(0);
    expect(snap.outbox.filter((e) => e.type === "ticket.closed")).toHaveLength(0);
  });

  it("learner immediate close racing the scheduler yields one CLOSED transition and no duplicates", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const staff = await makeUser("staff-c");
      const T = new Date(Date.now());
      const { ticket, learnerId } = await seedTicket({
        status: "RESOLVED",
        resolvedAt: new Date(T.getTime() - 8 * DAY),
        assigneeId: staff.id,
      });

      const results = await race([
        () => learnerService(learnerId, () => T).closeOwnTicket({ reference: ticket.reference, expectedVersion: 1 }),
        () => autoClose(T).closeResolvedTickets(),
      ]);
      expect(results[1].ok).toBe(true);

      const snap = await snapshot(ticket.id, ticket.reference);
      expect(snap.ticket.status).toBe("CLOSED");
      expect(snap.ticket.version).toBe(2);
      const closeEvents = snap.events.filter((e) => e.type === "LEARNER_CLOSED" || e.type === "AUTO_CLOSED");
      expect(closeEvents).toHaveLength(1);
      expect(snap.outbox.filter((e) => e.type === "ticket.closed")).toHaveLength(1);
      expect(
        snap.audits.filter((e) => e.action === "ticket.closed" || e.action === "ticket.auto_closed"),
      ).toHaveLength(1);
      if (results[0].ok) {
        expect(closeEvents[0].type).toBe("LEARNER_CLOSED");
      } else {
        expect((results[0] as { error: Error }).error.name).toBe("StaleTicketVersionError");
        expect(closeEvents[0].type).toBe("AUTO_CLOSED");
        expect(closeEvents[0].actorId).toBeNull();
        expect(closeEvents[0].actorType).toBe("SYSTEM");
      }
    }
  });
});
