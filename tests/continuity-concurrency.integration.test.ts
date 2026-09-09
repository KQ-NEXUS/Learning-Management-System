import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedLearnerFixture } from "./support/cohort-fixtures";
import { createTestWithPermission, grant } from "./support/harness";
import { createAssignmentService, type AssignmentStore } from "@/server/services/assignment-service";
import { createRoleService, RoleVersionConflictError, type RoleStore } from "@/server/services/role-service";
import { createStaffAccountService, type StaffAccountStore } from "@/server/services/staff-account-service";
import { ContinuityError } from "@/server/services/continuity-service";

let db: TestDatabase;
let sequence = 0;
beforeAll(async () => { db = await startTestDatabase(); }, TEST_DB_TIMEOUT_MS);
afterAll(async () => { await db?.stop(); }, TEST_DB_TIMEOUT_MS);
beforeEach(async () => { await db.prisma.assignment.deleteMany(); });

async function admin() {
  const { userId } = await seedLearnerFixture(db.prisma, { isStaff: true });
  const role = await db.prisma.role.create({
    data: { name: `Continuity ${++sequence}`, permissions: ["roles.manage"], active: true },
  });
  const assignment = await db.prisma.assignment.create({
    data: { userId, roleId: role.id, scopeType: "GLOBAL", active: true },
  });
  return { userId, role, assignment };
}

// Both requests start together. With the old implementation both counts read
// before either write. With serialization the peer instead waits on the DB lock.
function competingClient() {
  let transactions = 0;
  let counts = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return new Proxy(db.prisma, {
    get(target, key) {
      if (key !== "$transaction") return Reflect.get(target, key);
      return (fn: (tx: unknown) => Promise<unknown>) => target.$transaction(async (tx) => {
        if (++transactions === 2) release();
        await ready;
        return fn(new Proxy(tx, {
          get(t, k) {
            if (k !== "assignment") return Reflect.get(t, k);
            return new Proxy(t.assignment, {
              get(delegate, method) {
                if (method !== "count") return Reflect.get(delegate, method);
                return async (args: Parameters<typeof delegate.count>[0]) => {
                  const count = await delegate.count(args);
                  counts += 1;
                  await expect.poll(async () => {
                    if (counts >= 2) return true;
                    const [row] = await db.prisma.$queryRaw<{ waiting: boolean }[]>`
                      SELECT EXISTS (
                        SELECT 1 FROM pg_stat_activity
                        WHERE datname = current_database() AND wait_event = 'advisory'
                      ) AS waiting
                    `;
                    return row.waiting;
                  }, { timeout: 2000, interval: 10 }).toBe(true);
                  return count;
                };
              },
            });
          },
        }));
      }, { timeout: 10000 });
    },
  });
}

const kinds = ["revoke", "removePermission", "deactivateRole", "deactivateUser"] as const;
type Kind = typeof kinds[number];
const pairs = kinds.flatMap((a, i) => kinds.slice(i).map((b) => [a, b] as const));

describe("administrator continuity across concurrent removal paths", () => {
  it("allows both concurrent removals when a third administrator remains", async () => {
    const admins = [await admin(), await admin(), await admin()];
    const { withPermission } = createTestWithPermission([grant("roles.manage")], { userId: admins[2].userId });
    const service = createAssignmentService({
      store: competingClient() as unknown as AssignmentStore, withPermission, audit: async () => {},
    });
    await Promise.all(admins.slice(0, 2).map((target) => service.revoke({
      assignmentId: target.assignment.id, reason: "Administrator access removed",
    })));
    expect(await db.prisma.assignment.count({ where: { active: true } })).toBe(1);
    expect((await db.prisma.assignment.findUniqueOrThrow({ where: { id: admins[2].assignment.id } })).active).toBe(true);
  });

  it.each(["update", "deactivate", "revoke"] as const)("rechecks state after waiting: stale %s cannot remove newly granted last-admin access", async (kind) => {
    const first = await admin();
    const second = await admin();
    await db.prisma.role.update({ where: { id: second.role.id }, data: { permissions: [] } });
    const { withPermission } = createTestWithPermission([grant("roles.manage")], { userId: first.userId });
    let enter!: () => void;
    let resume!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const released = new Promise<void>((resolve) => { resume = resolve; });
    const paused = new Proxy(db.prisma, {
      get(target, key) {
        if (key !== "$transaction") return Reflect.get(target, key);
        return async (fn: Parameters<typeof target.$transaction>[0]) => {
          enter();
          await released;
          return target.$transaction(fn);
        };
      },
    });
    const audit = async () => {};
    const staleRoles = createRoleService({ store: paused as unknown as RoleStore, withPermission, audit });
    const staleAssignments = createAssignmentService({ store: paused as unknown as AssignmentStore, withPermission, audit });
    const normalRoles = createRoleService({ store: db.prisma as unknown as RoleStore, withPermission, audit });
    const normalAssignments = createAssignmentService({ store: db.prisma as unknown as AssignmentStore, withPermission, audit });
    const reason = "Administrator access removed";
    const pending = kind === "update"
      ? staleRoles.update({ id: second.role.id, name: second.role.name, expectedVersion: 1, permissions: [], reason })
      : kind === "deactivate"
        ? staleRoles.setActive({ id: second.role.id, active: false, reason })
        : staleAssignments.revoke({ assignmentId: second.assignment.id, reason });
    const outcome = pending.then(() => null, (error: unknown) => error);
    try {
      await entered;
      await normalRoles.update({ id: second.role.id, name: second.role.name, expectedVersion: 1, permissions: ["roles.manage"] });
      await normalAssignments.revoke({ assignmentId: first.assignment.id, reason });
    } finally { resume(); }
    expect(await outcome).toBeInstanceOf(kind === "update" ? RoleVersionConflictError : ContinuityError);
    const remaining = await db.prisma.role.findUniqueOrThrow({ where: { id: second.role.id } });
    expect(remaining.permissions).toEqual(["roles.manage"]);
    expect(remaining.active).toBe(true);
    expect((await db.prisma.assignment.findUniqueOrThrow({ where: { id: second.assignment.id } })).active).toBe(true);
  });

  it.each(pairs)("%s racing %s leaves one administrator", async (firstKind, secondKind) => {
    const admins = [await admin(), await admin()];
    const client = competingClient();
    const audits: unknown[] = [];
    const signOuts: string[] = [];
    const audit = async (entry: unknown) => { audits.push(entry); };
    const { withPermission } = createTestWithPermission([
      grant("roles.manage"), grant("users.manage"),
    ], { userId: admins[0].userId });
    const assignments = createAssignmentService({ store: client as unknown as AssignmentStore, withPermission, audit });
    const roles = createRoleService({ store: client as unknown as RoleStore, withPermission, audit });
    const staff = createStaffAccountService({
      store: client as unknown as StaffAccountStore, withPermission, audit,
      hash: async () => { throw new Error("Not a creation test"); },
      signOutAll: async (id) => { signOuts.push(id); return 1; },
    });
    function remove(kind: Kind, target: typeof admins[number]) {
      const reason = "Administrator access removed";
      if (kind === "revoke") return assignments.revoke({ assignmentId: target.assignment.id, reason });
      if (kind === "deactivateUser") return staff.deactivate({ userId: target.userId, reason });
      if (kind === "deactivateRole") return roles.setActive({ id: target.role.id, active: false, reason });
      return roles.update({ id: target.role.id, name: target.role.name, expectedVersion: target.role.version, permissions: [], reason });
    }
    const results = await Promise.allSettled([
      remove(firstKind, admins[0]), remove(secondKind, admins[1]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(ContinuityError);
    expect(await db.prisma.assignment.count({ where: {
      active: true, revokedAt: null, scopeType: "GLOBAL",
      user: { status: "ACTIVE" }, role: { active: true, permissions: { has: "roles.manage" } },
    } })).toBe(1);
    expect(audits).toHaveLength(1);
    const loser = results.findIndex((r) => r.status === "rejected");
    expect(signOuts).not.toContain(admins[loser].userId);
    expect(await db.prisma.roleVersion.count({ where: { roleId: admins[loser].role.id } })).toBe(0);
  });
});
