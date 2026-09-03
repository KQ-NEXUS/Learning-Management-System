import { describe, expect, it, vi } from "vitest";
import { createWithPermission, type RawGrant } from "@/server/permissions/with-permission";
import { ContinuityError } from "@/server/services/continuity-service";
import {
  createRoleService,
  roleScope,
  validateRolePermissionSet,
  InvalidPermissionSetError,
  RoleVersionConflictError,
  ReasonRequiredError,
  type RoleRecord,
  type RoleStore,
} from "@/server/services/role-service";

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

function harness(
  grants: RawGrant[],
  extraRoles: RoleRecord[] = [],
  assignmentCount = 0,
) {
  const roles: RoleRecord[] = [
    {
      id: "r1",
      name: "Administrator",
      description: null,
      active: true,
      isDefault: true,
      version: 1,
      permissions: [],
      createdAt: new Date(),
    },
    ...extraRoles,
  ];
  const roleVersionCreates: unknown[] = [];

  const store: RoleStore = {
    role: {
      findMany: vi.fn(async () => roles),
      findUnique: vi.fn(async ({ where }) => roles.find((r) => r.id === where.id) ?? null),
      create: vi.fn(async ({ data }) => {
        const created = {
          id: "r-new",
          description: null,
          active: true,
          isDefault: false,
          version: 1,
          permissions: [],
          createdAt: new Date(),
          ...data,
        } as RoleRecord;
        roles.push(created);
        return created;
      }),
      update: vi.fn(async ({ where, data }) => {
        const index = roles.findIndex((r) => r.id === where.id);
        roles[index] = { ...roles[index], ...data } as RoleRecord;
        return roles[index];
      }),
    },
    roleVersion: {
      create: vi.fn(async ({ data }) => {
        roleVersionCreates.push(data);
        return data;
      }),
      findMany: vi.fn(async () => []),
    },
    assignment: {
      count: vi.fn(async () => assignmentCount),
    },
    $transaction: async (fn) => fn(store),
  };

  const audits: unknown[] = [];
  const withPermission = createWithPermission({
    getActor: async () => ({ userId: "user-1" }),
    loadGrants: async () => grants,
    audit: async () => {},
  });

  const service = createRoleService({
    store,
    withPermission,
    audit: async (entry) => {
      audits.push(entry);
    },
  });

  return { service, store, audits, roleVersionCreates, roles };
}

describe("role service", () => {
  it("roleScope returns an empty resource, reachable only by a GLOBAL grant", () => {
    expect(roleScope()).toEqual({});
  });

  describe("permission set validation", () => {
    it("accepts an empty permission set", () => {
      expect(validateRolePermissionSet([])).toEqual([]);
    });

    it("accepts a valid catalogue subset", () => {
      expect(validateRolePermissionSet(["courses.view", "courses.edit"])).toEqual([
        "courses.view",
        "courses.edit",
      ]);
    });

    it("throws on an identifier absent from the catalogue", () => {
      expect(() => validateRolePermissionSet(["not.a.real.permission"])).toThrow(
        InvalidPermissionSetError,
      );
    });

    it("throws on a duplicated identifier", () => {
      expect(() => validateRolePermissionSet(["courses.view", "courses.view"])).toThrow(
        InvalidPermissionSetError,
      );
    });
  });

  it("refuses to create without a roles.manage grant", async () => {
    const { service, store } = harness([grant("roles.view")]);
    await expect(
      service.create({ name: "Custom", permissions: [] }),
    ).rejects.toThrow();
    expect(store.role.create).not.toHaveBeenCalled();
  });

  it("refuses to create when the only grant is Course-scoped", async () => {
    const { service, store } = harness([grant("roles.manage", "COURSE", "c1")]);
    await expect(
      service.create({ name: "Custom", permissions: [] }),
    ).rejects.toThrow();
    expect(store.role.create).not.toHaveBeenCalled();
  });

  it("creates a role, writes a version-1 RoleVersion row, and captures exactly one audit entry", async () => {
    const { service, roleVersionCreates, audits } = harness([grant("roles.manage")]);

    const created = await service.create({
      name: "Custom Role",
      permissions: ["courses.view"],
    });

    expect(created).toMatchObject({ id: "r-new" });
    expect(roleVersionCreates).toHaveLength(1);
    expect(roleVersionCreates[0]).toMatchObject({ version: 1, roleId: "r-new" });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "role.created",
      targetType: "Role",
      targetId: "r-new",
      outcome: "SUCCESS",
    });
  });

  it("refuses to list without a roles.view grant", async () => {
    const { service, store } = harness([grant("roles.manage")]);
    await expect(service.list()).rejects.toThrow();
    expect(store.role.findMany).not.toHaveBeenCalled();
  });

  it("lists when the caller holds a GLOBAL roles.view grant", async () => {
    const { service } = harness([grant("roles.view")]);
    await expect(service.list()).resolves.toHaveLength(1);
  });

  describe("role versioning", () => {
    const r2 = (): RoleRecord => ({
      id: "r2",
      name: "Custom",
      description: null,
      active: true,
      isDefault: false,
      version: 1,
      permissions: ["courses.view", "courses.edit"],
      createdAt: new Date(),
    });

    const r3WithRolesManage = (): RoleRecord => ({
      id: "r3",
      name: "Admin-like",
      description: null,
      active: true,
      isDefault: false,
      version: 1,
      permissions: ["roles.manage"],
      createdAt: new Date(),
    });

    it("writes a RoleVersion at stored version plus one on an addition-only edit", async () => {
      const { service, store, roleVersionCreates } = harness([grant("roles.manage")], [r2()]);

      await service.update({
        id: "r2",
        expectedVersion: 1,
        name: "Custom",
        description: null,
        permissions: ["courses.view", "courses.edit", "courses.publish"],
      });

      expect(store.role.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ version: 2 }) }),
      );
      expect(roleVersionCreates).toHaveLength(1);
      expect(roleVersionCreates[0]).toMatchObject({ roleId: "r2", version: 2 });
    });

    it("still writes a new version row on an identical resubmission (edge RBAC-02/idempotency)", async () => {
      const { service, roleVersionCreates } = harness([grant("roles.manage")], [r2()]);

      await service.update({
        id: "r2",
        expectedVersion: 1,
        name: "Custom",
        description: null,
        permissions: ["courses.view", "courses.edit"],
      });

      expect(roleVersionCreates).toHaveLength(1);
      expect(roleVersionCreates[0]).toMatchObject({ version: 2 });
    });

    it("throws RoleVersionConflictError on a stale expectedVersion and performs no write at all", async () => {
      const { service, store } = harness([grant("roles.manage")], [r2()]);

      await expect(
        service.update({
          id: "r2",
          expectedVersion: 99,
          name: "Custom",
          description: null,
          permissions: ["courses.view", "courses.edit"],
        }),
      ).rejects.toThrow(RoleVersionConflictError);
      expect(store.role.update).not.toHaveBeenCalled();
    });

    it("throws ReasonRequiredError when removing a permission with no reason", async () => {
      const { service } = harness([grant("roles.manage")], [r2()]);

      await expect(
        service.update({
          id: "r2",
          expectedVersion: 1,
          name: "Custom",
          description: null,
          permissions: ["courses.view"],
        }),
      ).rejects.toThrow(ReasonRequiredError);
    });

    it("throws ReasonRequiredError when the reason is shorter than 10 characters", async () => {
      const { service } = harness([grant("roles.manage")], [r2()]);

      await expect(
        service.update({
          id: "r2",
          expectedVersion: 1,
          name: "Custom",
          description: null,
          permissions: ["courses.view"],
          reason: "too short",
        }),
      ).rejects.toThrow(ReasonRequiredError);
    });

    it("removes several permissions with one sufficient reason, and the audit before/after carry the full permission arrays", async () => {
      const { service, audits } = harness(
        [grant("roles.manage")],
        [{ ...r2(), permissions: ["courses.view", "courses.edit", "courses.publish"] }],
      );

      await service.update({
        id: "r2",
        expectedVersion: 1,
        name: "Custom",
        description: null,
        permissions: ["courses.view"],
        reason: "Scoping this role down to read-only access.",
      });

      const entry = audits[0] as { before: RoleRecord; after: RoleRecord };
      expect(entry.before.permissions).toEqual(["courses.view", "courses.edit", "courses.publish"]);
      expect(entry.after.permissions).toEqual(["courses.view"]);
    });

    it("succeeds adding a permission with no reason", async () => {
      const { service } = harness([grant("roles.manage")], [r2()]);

      await expect(
        service.update({
          id: "r2",
          expectedVersion: 1,
          name: "Custom",
          description: null,
          permissions: ["courses.view", "courses.edit", "courses.publish"],
        }),
      ).resolves.toBeDefined();
    });

    it("rejects an unknown permission identifier before the version is bumped", async () => {
      const { service, store } = harness([grant("roles.manage")], [r2()]);

      await expect(
        service.update({
          id: "r2",
          expectedVersion: 1,
          name: "Custom",
          description: null,
          permissions: ["not.a.real.permission"],
        }),
      ).rejects.toThrow(InvalidPermissionSetError);
      expect(store.role.update).not.toHaveBeenCalled();
    });

    it("invokes the continuity check with a role exclusion when removing roles.manage, and throws ContinuityError with zero remaining", async () => {
      const { service, store } = harness([grant("roles.manage")], [r3WithRolesManage()], 0);

      await expect(
        service.update({
          id: "r3",
          expectedVersion: 1,
          name: "Admin-like",
          description: null,
          permissions: [],
          reason: "Removing administrative capability from this role.",
        }),
      ).rejects.toThrow(ContinuityError);
      expect(store.role.update).not.toHaveBeenCalled();
      expect(store.assignment.count).toHaveBeenCalled();
    });

    it("throws ContinuityError when deactivating a roles.manage-bearing role with zero remaining", async () => {
      const { service, store } = harness([grant("roles.manage")], [r3WithRolesManage()], 0);

      await expect(
        service.setActive({
          id: "r3",
          active: false,
          reason: "Deactivating this administrative role.",
        }),
      ).rejects.toThrow(ContinuityError);
      expect(store.role.update).not.toHaveBeenCalled();
    });

    it("throws ReasonRequiredError deactivating without a reason", async () => {
      const { service } = harness([grant("roles.manage")], [r2()]);
      await expect(service.setActive({ id: "r2", active: false })).rejects.toThrow(
        ReasonRequiredError,
      );
    });

    it("succeeds reactivating without a reason", async () => {
      const { service } = harness([grant("roles.manage")], [r2()]);
      await expect(service.setActive({ id: "r2", active: true })).resolves.toBeDefined();
    });

    it("subjects a seeded default role (isDefault true) to exactly the same reason gate as a custom role", async () => {
      const defaultWithPermissions: RoleRecord = {
        id: "r5",
        name: "Programme Manager",
        description: null,
        active: true,
        isDefault: true,
        version: 1,
        permissions: ["courses.view"],
        createdAt: new Date(),
      };
      const { service } = harness([grant("roles.manage")], [defaultWithPermissions]);

      await expect(
        service.update({
          id: "r5",
          expectedVersion: 1,
          name: "Programme Manager",
          description: null,
          permissions: [],
        }),
      ).rejects.toThrow(ReasonRequiredError);
    });

    it("emits an audit entry carrying scopeType GLOBAL", async () => {
      const { service, audits } = harness([grant("roles.manage")], [r2()]);

      await service.update({
        id: "r2",
        expectedVersion: 1,
        name: "Custom",
        description: null,
        permissions: ["courses.view", "courses.edit", "courses.publish"],
      });

      expect(audits[0]).toMatchObject({ scopeType: "GLOBAL" });
    });
  });
});
