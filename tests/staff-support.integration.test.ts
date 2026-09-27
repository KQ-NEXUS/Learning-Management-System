import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AuthorizationError, createWithPermission } from "@/server/permissions/with-permission";
import { createPrismaBackedTicketService } from "@/server/services/ticket-service";
import { createTicketStaffQueueService, parseQueueParams } from "@/server/services/ticket-staff-queue-service";
import type { grant } from "./support/harness";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";

/**
 * Real-PostgreSQL proof for the staff support workspace (12-07): the
 * QUEUE_CHANGED migration, the eligible-owner SQL, queue tab counts, the
 * tickets.view / tickets.manage split and name resolution for the chronology.
 */
let database: TestDatabase;
let counter = 0;
const unique = (prefix: string) => `${prefix}-${(counter += 1)}`;

beforeAll(async () => {
  const localUrl = process.env.PLAN_12_02_DATABASE_URL;
  if (localUrl) {
    const prisma = new PrismaClient({ datasources: { db: { url: localUrl } } });
    database = { prisma, url: localUrl, stop: () => prisma.$disconnect() };
  } else {
    database = await startTestDatabase();
  }
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await database?.stop();
}, TEST_DB_TIMEOUT_MS);

afterEach(async () => {
  const db = database.prisma;
  await db.domainEvent.deleteMany({});
  await db.auditEvent.deleteMany({});
  await db.ticketAttachment.deleteMany({});
  await db.ticketMessage.deleteMany({});
  await db.ticketEvent.deleteMany({});
  await db.ticket.deleteMany({});
  await db.assignment.deleteMany({});
  await db.role.deleteMany({});
  await db.user.deleteMany({});
});

async function makeUser(name: string, isStaff: boolean) {
  return database.prisma.user.create({
    data: { email: `${unique("u")}@example.test`, name, passwordHash: "hash", isStaff, status: "ACTIVE" },
  });
}

async function makeStaff(name: string, permissions: string[]) {
  const user = await makeUser(name, true);
  const role = await database.prisma.role.create({ data: { name: unique("Role"), permissions } });
  await database.prisma.assignment.create({ data: { userId: user.id, roleId: role.id, scopeType: "GLOBAL", active: true } });
  return user;
}

async function loadDbGrants(userId: string) {
  const assignments = await database.prisma.assignment.findMany({ where: { userId }, include: { role: true } });
  return assignments.flatMap((assignment) =>
    assignment.role.permissions.map((permission) => ({
      permission: permission as ReturnType<typeof grant>["permission"],
      scopeType: assignment.scopeType,
      scopeId: assignment.scopeId,
      active: assignment.active,
      revokedAt: assignment.revokedAt,
      startsAt: assignment.startsAt,
      endsAt: assignment.endsAt,
    })),
  );
}

function build() {
  let actor: { userId: string; isStaff: boolean } = { userId: "nobody", isStaff: false };
  const withPermission = createWithPermission({ getActor: async () => actor, loadGrants: loadDbGrants, audit: async () => undefined });
  const tickets = createPrismaBackedTicketService(database.prisma, {
    getActor: async () => actor,
    withPermission,
    generateReference: () => `KQT-20260925-${String(1000 + (counter += 1))}`,
  });
  const queue = createTicketStaffQueueService({
    client: database.prisma,
    withPermission,
    getStaffTicketByReference: tickets.getStaffTicketByReference,
  });
  return { tickets, queue, as: (userId: string, isStaff: boolean) => { actor = { userId, isStaff }; } };
}

describe("staff support workspace on PostgreSQL", () => {
  it("persists QUEUE_CHANGED, exposes attributed names and keeps counts consistent", async () => {
    const learner = await makeUser("Ada Learner", false);
    const agent = await makeStaff("Sam Agent", ["tickets.view", "tickets.manage"]);
    const { tickets, queue, as } = build();

    as(learner.id, false);
    const a = await tickets.createOwnTicket({ category: "OTHER", subject: "First", body: "Help one" });
    const b = await tickets.createOwnTicket({ category: "PAYMENT_ORDER", subject: "Second", body: "Help two" });

    as(agent.id, true);
    await tickets.claimTicket({ reference: a.reference, expectedVersion: 1 });
    await tickets.moveQueue({ reference: a.reference, expectedVersion: 2, queue: "FINANCE", reason: "Payment question" });
    await tickets.escalateTicket({ reference: b.reference, expectedVersion: 1, queue: "TECHNICAL", assigneeId: agent.id, reason: "Needs engineer" });

    const view = await queue.getStaffQueue(parseQueueParams({}));
    expect(view.tabCounts).toEqual({ "my-work": 2, unassigned: 0, open: 2, escalated: 1, resolved: 0 });
    expect(view.rows.map((row) => row.reference)).toEqual([a.reference, b.reference]);
    expect(view.rows[0]).toMatchObject({ learnerName: "Ada Learner", assigneeName: "Sam Agent", queue: "FINANCE" });

    const escalated = await queue.getStaffQueue(parseQueueParams({ tab: "escalated" }));
    expect(escalated.rows[0]).toMatchObject({ reference: b.reference, status: "ESCALATED", queue: "TECHNICAL", assigneeId: agent.id });

    const workspace = await queue.getStaffTicketWorkspace(a.reference);
    expect(workspace.learner).toMatchObject({ name: "Ada Learner" });
    const moved = workspace.timeline.find((entry) => entry.kind === "EVENT" && entry.event.type === "QUEUE_CHANGED");
    expect(moved).toBeTruthy();
    expect(moved && moved.kind === "EVENT" && moved.event).toMatchObject({ actorId: agent.id, reason: "Payment question", queueBefore: "GENERAL_SUPPORT", queueAfter: "FINANCE" });
    expect(workspace.names[agent.id]).toBe("Sam Agent");
  });

  it("lists only active staff whose role grants tickets.manage globally as eligible owners", async () => {
    const manager = await makeStaff("Kim Manager", ["tickets.view", "tickets.manage"]);
    const viewer = await makeStaff("Val Viewer", ["tickets.view"]);
    await makeStaff("Other Ops", ["payments.view"]);
    const { queue, as } = build();
    as(viewer.id, true);
    const options = await queue.listTicketAssignees();
    expect(options).toEqual([{ id: manager.id, name: "Kim Manager" }]);
  });

  it("lets tickets.view read the queue but denies every mutation server-side", async () => {
    const learner = await makeUser("Ada Learner", false);
    const agent = await makeStaff("Sam Agent", ["tickets.view", "tickets.manage"]);
    const viewer = await makeStaff("Val Viewer", ["tickets.view"]);
    const nobody = await makeStaff("Ops Only", ["payments.view"]);
    const { tickets, queue, as } = build();
    as(learner.id, false);
    const created = await tickets.createOwnTicket({ category: "OTHER", subject: "Question", body: "Help" });

    as(viewer.id, true);
    await expect(queue.getStaffQueue(parseQueueParams({ tab: "open" }))).resolves.toMatchObject({ total: 1 });
    await expect(tickets.moveQueue({ reference: created.reference, expectedVersion: 1, queue: "ACCOUNTS", reason: "x" })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(tickets.claimTicket({ reference: created.reference, expectedVersion: 1 })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(tickets.addInternalNote({ reference: created.reference, expectedVersion: 1, body: "n" })).rejects.toBeInstanceOf(AuthorizationError);

    as(nobody.id, true);
    await expect(queue.getStaffQueue(parseQueueParams({}))).rejects.toBeInstanceOf(AuthorizationError);
    await expect(queue.getStaffTicketWorkspace(created.reference)).rejects.toBeInstanceOf(AuthorizationError);

    as(agent.id, true);
    const untouched = await database.prisma.ticket.findUniqueOrThrow({ where: { reference: created.reference } });
    expect(untouched).toMatchObject({ version: 1, queue: "GENERAL_SUPPORT", assigneeId: null });
  });
});
