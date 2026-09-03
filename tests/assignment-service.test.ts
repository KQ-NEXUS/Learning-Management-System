import { describe, expect, it, vi } from "vitest";
import { createWithPermission, type RawGrant } from "@/server/permissions/with-permission";
import { ScopeError } from "@/server/permissions";
import { ContinuityError } from "@/server/services/continuity-service";
import {
  assignmentTargetScope,
  createAssignmentService,
  AssignmentReasonRequiredError,
  type AssignmentRecord,
  type AssignmentStore,
} from "@/server/services/assignment-service";

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

type RoleRow = { id: string; active: boolean; permissions: string[] };

function harness(
  grants: RawGrant[],
  roles: RoleRow[],
  assignments: (AssignmentRecord & { role: RoleRow })[],
  assignmentCount = 1,
) {
  const store: AssignmentStore = {
    assignment: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const a = assignments.find((x) => x.id === where.id);
        return a ?? null;
      }),
      findMany: vi.fn(async ({ where }: { where?: { userId?: string } }) => {
        if (where?.userId) {
          return assignments.filter((a) => a.userId === where.userId) as never;
        }
        return assignments as never;
      }),
      create: vi.fn(async ({ data }) => {
        const created = {
          id: "a-new",
          active: true,
          startsAt: new Date(),
          endsAt: null,
          reason: null,
          createdById: null,
          createdAt: new Date(),
          revokedAt: null,
          revokedById: null,
          ...data,
        } as AssignmentRecord;
        assignments.push({ ...created, role: roles.find((r) => r.id === created.roleId)! });
        return created;
      }),
      update: vi.fn(async ({ where, data }) => {
        const index = assignments.findIndex((a) => a.id === where.id);
        assignments[index] = { ...assignments[index], ...data };
        return assignments[index];
      }),
      count: vi.fn(async () => assignmentCount),
    },
    role: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return roles.find((r) => r.id === where.id) ?? null;
      }),
    },
    $transaction: async (fn) => fn(store),
  };

  const audits: unknown[] = [];
  const withPermission = createWithPermission({
    getActor: async () => ({ userId: "user-1" }),
    loadGrants: async () => grants,
    audit: async () => {},
  });

  const service = createAssignmentService({
    store,
    withPermission,
    audit: async (entry) => {
      audits.push(entry);
    },
  });

  return { service, store, audits, assignments };
}

describe("assignmentTargetScope", () => {
  it("maps GLOBAL to an empty resource", () => {
    expect(assignmentTargetScope("GLOBAL", null)).toEqual({});
  });

  it("maps PROGRAMME to a programmeId", () => {
    expect(assignmentTargetScope("PROGRAMME", "p1")).toEqual({ programmeId: "p1" });
  });

  it("maps COURSE to a single-element courseIds array", () => {
    expect(assignmentTargetScope("COURSE", "c1")).toEqual({ courseIds: ["c1"] });
  });

  it("maps COHORT to a cohortId", () => {
    expect(assignmentTargetScope("COHORT", "ch1")).toEqual({ cohortId: "ch1" });
  });

  it("throws ScopeError for a non-GLOBAL type with a null scopeId", () => {
    expect(() => assignmentTargetScope("COURSE", null)).toThrow(ScopeError);
  });
});

describe("assignment service", () => {
  const roles: RoleRow[] = [
    { id: "role-plain", active: true, permissions: ["courses.view"] },
    { id: "role-manage", active: true, permissions: ["roles.manage"] },
    { id: "role-licence", active: true, permissions: ["licence.activate"] },
  ];

  it("refuses to create without a roles.manage grant", async () => {
    const { service, store } = harness([grant("roles.view")], roles, []);
    await expect(
      service.create({ userId: "u1", roleId: "role-plain", scopeType: "GLOBAL", scopeId: null }),
    ).rejects.toThrow();
    expect(store.assignment.create).not.toHaveBeenCalled();
  });

  it("refuses a GLOBAL target when the only grant is Course-scoped", async () => {
    const { service, store } = harness(
      [grant("roles.manage", "COURSE", "c1")],
      roles,
      [],
    );
    await expect(
      service.create({ userId: "u1", roleId: "role-plain", scopeType: "GLOBAL", scopeId: null }),
    ).rejects.toThrow();
    expect(store.assignment.create).not.toHaveBeenCalled();
  });

  it("succeeds for a Course-scoped grant targeting that same course", async () => {
    const { service } = harness(
      [grant("roles.manage", "COURSE", "c1")],
      roles,
      [],
    );
    await expect(
      service.create({ userId: "u1", roleId: "role-plain", scopeType: "COURSE", scopeId: "c1" }),
    ).resolves.toMatchObject({ id: "a-new" });
  });

  it("rejects a role carrying licence.activate at COURSE scope with ScopeError and performs no write", async () => {
    const { service, store } = harness([grant("roles.manage")], roles, []);
    await expect(
      service.create({ userId: "u1", roleId: "role-licence", scopeType: "COURSE", scopeId: "c1" }),
    ).rejects.toThrow(ScopeError);
    expect(store.assignment.create).not.toHaveBeenCalled();
  });

  it("sets startsAt to a non-null value regardless of caller input", async () => {
    const { service, store } = harness([grant("roles.manage")], roles, []);
    await service.create({ userId: "u1", roleId: "role-plain", scopeType: "GLOBAL", scopeId: null });
    expect(store.assignment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ startsAt: expect.any(Date) }) }),
    );
  });

  it("emits one audit entry whose scopeType and scopeId equal the assignment's own", async () => {
    const { service, audits } = harness([grant("roles.manage")], roles, []);
    await service.create({ userId: "u1", roleId: "role-plain", scopeType: "COHORT", scopeId: "ch1" });
    expect(audits[0]).toMatchObject({ scopeType: "COHORT", scopeId: "ch1" });
  });

  describe("assignment scope resolution and continuity", () => {
    function assignmentRow(
      overrides: Partial<AssignmentRecord & { role: RoleRow }>,
    ): AssignmentRecord & { role: RoleRow } {
      return {
        id: "a1",
        userId: "u1",
        roleId: "role-manage",
        scopeType: "GLOBAL",
        scopeId: null,
        active: true,
        startsAt: new Date(),
        endsAt: null,
        reason: null,
        createdById: null,
        createdAt: new Date(),
        revokedAt: null,
        revokedById: null,
        role: roles[1],
        ...overrides,
      };
    }

    it("throws AssignmentReasonRequiredError without a reason and performs no write", async () => {
      const rows = [assignmentRow({})];
      const { service, store } = harness([grant("roles.manage")], roles, rows);
      await expect(
        service.revoke({ assignmentId: "a1", reason: "" }),
      ).rejects.toThrow(AssignmentReasonRequiredError);
      expect(store.assignment.update).not.toHaveBeenCalled();
    });

    it("updates exactly one row, identified by id, with a 10-character reason", async () => {
      const rows = [assignmentRow({})];
      const { service, store } = harness([grant("roles.manage")], roles, rows, 5);
      await service.revoke({ assignmentId: "a1", reason: "Role change" });
      expect(store.assignment.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "a1" } }),
      );
      expect(store.assignment.update).toHaveBeenCalledTimes(1);
    });

    it("leaves a user's other assignments untouched when revoking one of three", async () => {
      const rows = [
        assignmentRow({ id: "a1", roleId: "role-plain", role: roles[0] }),
        assignmentRow({ id: "a2", roleId: "role-plain", role: roles[0] }),
        assignmentRow({ id: "a3", roleId: "role-plain", role: roles[0] }),
      ];
      const before2 = { ...rows[1] };
      const before3 = { ...rows[2] };
      const { service } = harness([grant("roles.manage")], roles, rows, 5);

      await service.revoke({ assignmentId: "a1", reason: "Cleaning up access" });

      expect(rows[1]).toEqual(before2);
      expect(rows[2]).toEqual(before3);
    });

    it("invokes the continuity check for a GLOBAL roles.manage assignment and throws ContinuityError with zero remaining", async () => {
      const rows = [assignmentRow({})];
      const { service, store } = harness([grant("roles.manage")], roles, rows, 0);
      await expect(
        service.revoke({ assignmentId: "a1", reason: "Revoking last admin grant" }),
      ).rejects.toThrow(ContinuityError);
      expect(store.assignment.update).not.toHaveBeenCalled();
    });

    it("does not invoke the continuity check for a COURSE-scoped assignment of the same role", async () => {
      const rows = [
        assignmentRow({ scopeType: "COURSE", scopeId: "c1" }),
      ];
      const { service, store } = harness([grant("roles.manage", "COURSE", "c1")], roles, rows, 0);
      await expect(
        service.revoke({ assignmentId: "a1", reason: "Revoking course-scoped grant" }),
      ).resolves.toBeDefined();
      expect(store.assignment.count).not.toHaveBeenCalled();
    });

    it("writes nothing when revoking an already-revoked assignment", async () => {
      const rows = [assignmentRow({ revokedAt: new Date(), active: false })];
      const { service, store } = harness([grant("roles.manage")], roles, rows, 5);
      await service.revoke({ assignmentId: "a1", reason: "Trying again" });
      expect(store.assignment.update).not.toHaveBeenCalled();
    });
  });
});
