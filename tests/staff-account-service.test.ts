import { describe, expect, it, vi } from "vitest";
import { createWithPermission, type RawGrant } from "@/server/permissions/with-permission";
import { ContinuityError } from "@/server/services/continuity-service";
import { buildAuditRow } from "@/server/services/audit-service";
import {
  createStaffAccountService,
  userScope,
  DuplicateStaffEmailError,
  StaffAccountReasonRequiredError,
  type StaffUserRow,
  type StaffAccountStore,
} from "@/server/services/staff-account-service";

const grant = (
  permission: string,
  scopeType: RawGrant["scopeType"] = "GLOBAL",
  scopeId: string | null = null,
): RawGrant => ({
  permission: permission as RawGrant["permission"],
  scopeType,
  scopeId,
  active: true,
  revokedAt: null,
  startsAt: null,
  endsAt: null,
});

const ROLE_PLAIN = { id: "role-plain", active: true, permissions: ["courses.view"] };
const ROLE_LICENCE = { id: "role-licence", active: true, permissions: ["licence.activate"] };
const ROLE_MANAGE = { id: "role-manage", active: true, permissions: ["roles.manage"] };

function harness(options: {
  grants: RawGrant[];
  users?: StaffUserRow[];
  roles?: typeof ROLE_PLAIN[];
  createShouldThrowUniqueViolation?: boolean;
  assignmentCount?: number;
  signOutAllReturn?: number;
}) {
  const users: StaffUserRow[] = options.users ?? [];
  const roles = options.roles ?? [ROLE_PLAIN, ROLE_LICENCE, ROLE_MANAGE];
  const assignmentCreates: unknown[] = [];
  const audits: unknown[] = [];
  const signOutAllCalls: string[] = [];

  const store: StaffAccountStore = {
    $queryRaw: async <T,>() => [] as T,
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) => {
        if (where.id) return users.find((u) => u.id === where.id) ?? null;
        if (where.email) return users.find((u) => u.email === where.email) ?? null;
        return null;
      }),
      findMany: vi.fn(async () => users),
      create: vi.fn(async ({ data }) => {
        if (options.createShouldThrowUniqueViolation) {
          throw { code: "P2002" };
        }
        const created = {
          id: "u-new",
          isStaff: true,
          passwordHash: "hash",
          createdAt: new Date(),
          deactivatedAt: null,
          deactivatedById: null,
          ...data,
        } as StaffUserRow;
        users.push(created);
        return created;
      }),
      update: vi.fn(async ({ where, data }) => {
        const index = users.findIndex((u) => u.id === where.id);
        users[index] = { ...users[index], ...data };
        return users[index];
      }),
    },
    assignment: {
      create: vi.fn(async ({ data }) => {
        assignmentCreates.push(data);
        return data;
      }),
      count: vi.fn(async () => options.assignmentCount ?? 5),
    },
    role: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return roles.find((r) => r.id === where.id) ?? null;
      }),
    },
    $transaction: async (fn) => fn(store),
  };

  const withPermission = createWithPermission({
    getActor: async () => ({ userId: "actor-1" }),
    loadGrants: async () => options.grants,
    audit: async () => {},
  });

  const service = createStaffAccountService({
    store,
    withPermission,
    audit: async (entry) => {
      audits.push(entry);
    },
    // Deliberately does NOT embed the plaintext as a substring — a real
    // scrypt hash never does, and a fake that did would make the
    // no-plaintext-in-audit test below pass or fail for the wrong reason.
    hash: async (plaintext) => `fake-hash-${plaintext.length}-${plaintext.split("").reverse().join("")}`,
    signOutAll: async (userId) => {
      signOutAllCalls.push(userId);
      return 1;
    },
  });

  return { service, store, users, assignmentCreates, audits, signOutAllCalls };
}

describe("staff account service", () => {
  it("userScope returns an empty resource", () => {
    expect(userScope()).toEqual({});
  });

  describe("staff typeahead search", () => {
    it("refuses without a users.view grant", async () => {
      const { service, store } = harness({ grants: [grant("users.manage")] });
      await expect(service.search("ada")).rejects.toThrow();
      expect(store.user.findMany).not.toHaveBeenCalled();
    });

    it("refuses when the only users.view grant is Programme-scoped", async () => {
      const { service } = harness({ grants: [grant("users.view", "PROGRAMME", "p1")] });
      await expect(service.search("ada")).rejects.toThrow();
    });

    it("caps at 10 rows and returns only the four permitted fields", async () => {
      const { service, store } = harness({ grants: [grant("users.view")] });
      await service.search("ada");
      expect(store.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );

      const someUser: StaffUserRow = {
        id: "u1",
        name: "Ada",
        email: "ada@kqnexus.test",
        status: "ACTIVE",
        isStaff: true,
        passwordHash: "hash",
        createdAt: new Date(),
        deactivatedAt: null,
        deactivatedById: null,
      };
      const { service: service2 } = harness({
        grants: [grant("users.view")],
        users: [someUser],
      });
      const [row] = await service2.search("ada");
      expect(Object.keys(row).sort()).toEqual(["email", "id", "name", "status"]);
    });
  });

  describe("staff account creation", () => {
    it.each([
      [grant("users.manage")],
      [grant("users.manage"), grant("roles.manage", "COHORT", "other")],
      [grant("roles.manage")],
    ])("requires both account and target role permissions: %j", async (...grants) => {
      const { service, store, assignmentCreates, audits } = harness({ grants });
      await expect(service.create({
        name: "New Staff", email: "new@kqnexus.test", roleId: "role-plain",
        scopeType: "COHORT", scopeId: "target",
      })).rejects.toThrow();
      expect(store.user.create).not.toHaveBeenCalled();
      expect(assignmentCreates).toHaveLength(0);
      expect(audits).toHaveLength(0);
    });

    it("allows a role manager for the exact initial assignment scope", async () => {
      const { service, assignmentCreates } = harness({
        grants: [grant("users.manage"), grant("roles.manage", "COHORT", "target")],
      });
      await service.create({
        name: "New Staff", email: "new@kqnexus.test", roleId: "role-plain",
        scopeType: "COHORT", scopeId: "target",
      });
      expect(assignmentCreates).toHaveLength(1);
    });

    it("does not let a scoped role manager grant global administration", async () => {
      const { service, users, assignmentCreates } = harness({
        grants: [grant("users.manage"), grant("roles.manage", "COHORT", "target")],
      });
      await expect(service.create({
        name: "New Staff", email: "new@kqnexus.test", roleId: "role-manage",
        scopeType: "GLOBAL", scopeId: null,
      })).rejects.toThrow();
      expect(users).toHaveLength(0);
      expect(assignmentCreates).toHaveLength(0);
    });

    it("refuses without users.manage", async () => {
      const { service, store } = harness({ grants: [grant("users.view")] });
      await expect(
        service.create({
          name: "New Staff",
          email: "new@kqnexus.test",
          roleId: "role-plain",
          scopeType: "GLOBAL",
          scopeId: null,
        }),
      ).rejects.toThrow();
      expect(store.user.create).not.toHaveBeenCalled();
    });

    it("writes the User and the Assignment through the same transaction", async () => {
      const { service, store, assignmentCreates } = harness({ grants: [grant("users.manage"), grant("roles.manage")] });
      await service.create({
        name: "New Staff",
        email: "new@kqnexus.test",
        roleId: "role-plain",
        scopeType: "GLOBAL",
        scopeId: null,
      });
      expect(store.user.create).toHaveBeenCalledTimes(1);
      expect(assignmentCreates).toHaveLength(1);
      expect(assignmentCreates[0]).toMatchObject({ roleId: "role-plain" });
    });

    it("lower-cases and trims the email before storing", async () => {
      const { service, store } = harness({ grants: [grant("users.manage"), grant("roles.manage")] });
      await service.create({
        name: "New Staff",
        email: "  New@KQNexus.test  ",
        roleId: "role-plain",
        scopeType: "GLOBAL",
        scopeId: null,
      });
      expect(store.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: "new@kqnexus.test" }) }),
      );
    });

    it("throws DuplicateStaffEmailError on a unique-constraint violation and leaves zero assignments written", async () => {
      const { service, assignmentCreates } = harness({
        grants: [grant("users.manage"), grant("roles.manage")],
        createShouldThrowUniqueViolation: true,
      });
      await expect(
        service.create({
          name: "New Staff",
          email: "dup@kqnexus.test",
          roleId: "role-plain",
          scopeType: "GLOBAL",
          scopeId: null,
        }),
      ).rejects.toThrow(DuplicateStaffEmailError);
      expect(assignmentCreates).toHaveLength(0);
    });

    it("rejects a role carrying a global-only permission at COURSE scope before either insert", async () => {
      const { service, store, assignmentCreates } = harness({ grants: [grant("users.manage"), grant("roles.manage")] });
      await expect(
        service.create({
          name: "New Staff",
          email: "new@kqnexus.test",
          roleId: "role-licence",
          scopeType: "COURSE",
          scopeId: "c1",
        }),
      ).rejects.toThrow();
      expect(store.user.create).not.toHaveBeenCalled();
      expect(assignmentCreates).toHaveLength(0);
    });

    it("returns a non-empty temporaryPassword not present in either audit entry", async () => {
      const { service, audits } = harness({ grants: [grant("users.manage"), grant("roles.manage")] });
      const result = await service.create({
        name: "New Staff",
        email: "new@kqnexus.test",
        roleId: "role-plain",
        scopeType: "GLOBAL",
        scopeId: null,
      });
      expect(result.temporaryPassword.length).toBeGreaterThan(0);

      const serialized = JSON.stringify(audits);
      expect(serialized).not.toContain(result.temporaryPassword);
    });
  });

  describe("deactivate and reactivate", () => {
    function activeUser(overrides: Partial<StaffUserRow> = {}): StaffUserRow {
      return {
        id: "u1",
        name: "Staff Member",
        email: "staff@kqnexus.test",
        status: "ACTIVE",
        isStaff: true,
        passwordHash: "hash",
        createdAt: new Date(),
        deactivatedAt: null,
        deactivatedById: null,
        ...overrides,
      };
    }

    it("refuses without users.manage", async () => {
      const { service } = harness({ grants: [grant("users.view")], users: [activeUser()] });
      await expect(
        service.deactivate({ userId: "u1", reason: "Leaving the organisation" }),
      ).rejects.toThrow();
    });

    it("throws StaffAccountReasonRequiredError with no reason, performing no write and no session sweep", async () => {
      const { service, store, signOutAllCalls } = harness({
        grants: [grant("users.manage")],
        users: [activeUser()],
      });
      await expect(service.deactivate({ userId: "u1", reason: "" })).rejects.toThrow(
        StaffAccountReasonRequiredError,
      );
      expect(store.user.update).not.toHaveBeenCalled();
      expect(signOutAllCalls).toHaveLength(0);
    });

    it("throws with a reason shorter than 10 characters", async () => {
      const { service } = harness({ grants: [grant("users.manage")], users: [activeUser()] });
      await expect(service.deactivate({ userId: "u1", reason: "short" })).rejects.toThrow(
        StaffAccountReasonRequiredError,
      );
    });

    it("updates status to DEACTIVATED and sets both deactivation fields with a valid reason", async () => {
      const { service, users } = harness({ grants: [grant("users.manage")], users: [activeUser()] });
      await service.deactivate({ userId: "u1", reason: "Leaving the organisation" });
      expect(users[0].status).toBe("DEACTIVATED");
      expect(users[0].deactivatedAt).not.toBeNull();
      expect(users[0].deactivatedById).toBe("actor-1");
    });

    it("invokes signOutAll exactly once with the deactivated user's id, after the transaction", async () => {
      const { service, signOutAllCalls } = harness({
        grants: [grant("users.manage")],
        users: [activeUser()],
      });
      await service.deactivate({ userId: "u1", reason: "Leaving the organisation" });
      expect(signOutAllCalls).toEqual(["u1"]);
    });

    it("records zero writes against the assignment store", async () => {
      const { service, store } = harness({ grants: [grant("users.manage")], users: [activeUser()] });
      await service.deactivate({ userId: "u1", reason: "Leaving the organisation" });
      expect(store.assignment.create).not.toHaveBeenCalled();
    });

    it("invokes the continuity check on every deactivation, including a user holding no roles.manage grant", async () => {
      const { service, store } = harness({ grants: [grant("users.manage")], users: [activeUser()] });
      await service.deactivate({ userId: "u1", reason: "Leaving the organisation" });
      expect(store.assignment.count).toHaveBeenCalled();
    });

    it("throws ContinuityError and performs no write or session sweep when the count returns zero", async () => {
      const { service, store, signOutAllCalls } = harness({
        grants: [grant("users.manage")],
        users: [activeUser()],
        assignmentCount: 0,
      });
      await expect(
        service.deactivate({ userId: "u1", reason: "Leaving the organisation" }),
      ).rejects.toThrow(ContinuityError);
      expect(store.user.update).not.toHaveBeenCalled();
      expect(signOutAllCalls).toHaveLength(0);
    });

    it("writes nothing and sweeps no sessions when deactivating an already-DEACTIVATED user", async () => {
      const { service, store, signOutAllCalls } = harness({
        grants: [grant("users.manage")],
        users: [activeUser({ status: "DEACTIVATED" })],
      });
      await expect(
        service.deactivate({ userId: "u1", reason: "Leaving the organisation" }),
      ).resolves.toBeDefined();
      expect(store.user.update).not.toHaveBeenCalled();
      expect(signOutAllCalls).toHaveLength(0);
    });

    it("sets status ACTIVE and clears both deactivation fields on reactivate", async () => {
      const { service, users } = harness({
        grants: [grant("users.manage")],
        users: [activeUser({ status: "DEACTIVATED", deactivatedAt: new Date(), deactivatedById: "someone" })],
      });
      await service.reactivate({ userId: "u1" });
      expect(users[0].status).toBe("ACTIVE");
      expect(users[0].deactivatedAt).toBeNull();
      expect(users[0].deactivatedById).toBeNull();
    });

    it("records zero writes against the assignment store on reactivate", async () => {
      const { service, store } = harness({
        grants: [grant("users.manage")],
        users: [activeUser({ status: "DEACTIVATED" })],
      });
      await service.reactivate({ userId: "u1" });
      expect(store.assignment.create).not.toHaveBeenCalled();
    });

    it("writes nothing when reactivating an already-ACTIVE user", async () => {
      const { service, store } = harness({ grants: [grant("users.manage")], users: [activeUser()] });
      await service.reactivate({ userId: "u1" });
      expect(store.user.update).not.toHaveBeenCalled();
    });

    it("succeeds reactivating with no reason argument", async () => {
      const { service } = harness({
        grants: [grant("users.manage")],
        users: [activeUser({ status: "DEACTIVATED" })],
      });
      await expect(service.reactivate({ userId: "u1" })).resolves.toBeDefined();
    });

    it("performs a full deactivate-then-reactivate cycle with zero assignment writes throughout", async () => {
      const { service, store } = harness({ grants: [grant("users.manage")], users: [activeUser()] });
      await service.deactivate({ userId: "u1", reason: "Leaving the organisation" });
      await service.reactivate({ userId: "u1" });
      expect(store.assignment.create).not.toHaveBeenCalled();
      expect(store.assignment.count).toHaveBeenCalledTimes(1); // only on deactivate, never on reactivate
    });

    it("emits a deactivation audit entry whose before payload contains no password hash value once passed through the real audit sink's row builder", async () => {
      const { service, audits } = harness({
        grants: [grant("users.manage")],
        users: [activeUser({ passwordHash: "super-secret-hash-value" })],
      });
      await service.deactivate({ userId: "u1", reason: "Leaving the organisation" });
      const entry = audits.find(
        (a) => (a as { action: string }).action === "user.deactivated",
      ) as Parameters<typeof buildAuditRow>[0];

      // This harness's fake audit sink captures the raw BusinessAuditEvent
      // (it does not itself redact) — running it through the real
      // buildAuditRow proves what the production recordAudit() would
      // actually persist, which is the real guarantee this test protects.
      const row = buildAuditRow(entry);
      expect(JSON.stringify(row.before)).not.toContain("super-secret-hash-value");
    });
  });
});
