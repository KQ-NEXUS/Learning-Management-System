import { describe, expect, it, vi } from "vitest";
import { AuthorizationError, createWithPermission } from "@/server/permissions/with-permission";
import { grant } from "./support/harness";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll } from "vitest";
import { createPrismaBackedTicketService } from "@/server/services/ticket-service";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";

let database: TestDatabase;
let counter = 0;

function unique(prefix: string) {
  counter += 1;
  return `${prefix}-${counter}`;
}

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
  await database.prisma.domainEvent.deleteMany({});
  await database.prisma.auditEvent.deleteMany({});
  await database.prisma.ticketAttachment.deleteMany({});
  await database.prisma.ticketMessage.deleteMany({});
  await database.prisma.ticketEvent.deleteMany({});
  await database.prisma.ticket.deleteMany({});
  await database.prisma.assignment.deleteMany({});
  await database.prisma.role.deleteMany({});
  await database.prisma.user.deleteMany({});
});

async function createUser(isStaff: boolean) {
  return database.prisma.user.create({
    data: {
      email: `${unique(isStaff ? "staff" : "learner")}@example.test`,
      name: isStaff ? "Support Agent" : "Learner User",
      passwordHash: "hash",
      isStaff,
      status: "ACTIVE",
    },
  });
}

async function loadDbGrants(userId: string) {
  const assignments = await database.prisma.assignment.findMany({
    where: { userId },
    include: { role: true },
  });
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

describe("support ticket RBAC isolation", () => {
  it("lets a support-only global role manage tickets while denying unrelated domains", async () => {
    const grants = [grant("tickets.view"), grant("tickets.manage")];
    const withPermission = createWithPermission({
      getActor: async () => ({ userId: "support-agent", isStaff: true }),
      loadGrants: async () => grants,
      audit: async () => undefined,
    });

    await expect(withPermission("tickets.view", () => ({}))(vi.fn(async () => "view"))({})).resolves.toBe("view");
    await expect(withPermission("tickets.manage", () => ({}))(vi.fn(async () => "manage"))({})).resolves.toBe("manage");

    for (const permission of [
      "users.view",
      "users.manage",
      "roles.manage",
      "payments.view",
      "payments.confirm",
      "refunds.manage",
      "submissions.view",
      "grades.manage",
    ] as const) {
      await expect(withPermission(permission, () => ({}))(vi.fn(async () => "denied"))({})).rejects.toBeInstanceOf(
        AuthorizationError,
      );
    }
  });

  it("requires GLOBAL ticket grants for support queues", async () => {
    const withPermission = createWithPermission({
      getActor: async () => ({ userId: "scoped-agent", isStaff: true }),
      loadGrants: async () => [grant("tickets.view", "COURSE", "course-1")],
      audit: async () => undefined,
    });

    await expect(withPermission("tickets.view", () => ({}))(vi.fn(async () => "nope"))({})).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("uses real Postgres role assignments for support-agent ticket access without unrelated permissions", async () => {
    const learner = await createUser(false);
    const supportAgent = await createUser(true);
    const role = await database.prisma.role.create({
      data: {
        name: unique("Support Agent"),
        permissions: ["tickets.view", "tickets.manage"],
      },
    });
    await database.prisma.assignment.create({
      data: {
        userId: supportAgent.id,
        roleId: role.id,
        scopeType: "GLOBAL",
        active: true,
      },
    });

    let actor = { userId: learner.id, isStaff: false };
    const withPermission = createWithPermission({
      getActor: async () => actor,
      loadGrants: loadDbGrants,
      audit: async () => undefined,
    });
    const service = createPrismaBackedTicketService(database.prisma, {
      getActor: async () => actor,
      withPermission,
      generateReference: () => "KQT-20260921-RBAC0001",
    });

    const created = await service.createOwnTicket({
      category: "OTHER",
      subject: "Need support",
      body: "Please help with my account.",
    });

    actor = { userId: supportAgent.id, isStaff: true };
    await expect(service.listStaffTickets({})).resolves.toEqual([
      expect.objectContaining({ reference: created.reference, status: "NEW" }),
    ]);
    await expect(service.claimTicket({ reference: created.reference, expectedVersion: 1 })).resolves.toEqual(
      expect.objectContaining({ status: "ASSIGNED", assigneeId: supportAgent.id }),
    );

    await expect(
      withPermission("users.view", () => ({}))(vi.fn(async () => "denied"))({}),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      withPermission("payments.view", () => ({}))(vi.fn(async () => "denied"))({}),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      withPermission("grades.manage", () => ({}))(vi.fn(async () => "denied"))({}),
    ).rejects.toBeInstanceOf(AuthorizationError);
  }, TEST_DB_TIMEOUT_MS);
});
