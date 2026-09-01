import { describe, expect, it, vi } from "vitest";
import {
  createWithPermission,
  AuthenticationError,
  AuthorizationError,
  type RawGrant,
  type AuditEntry,
} from "@/server/permissions/with-permission";

const NOW = new Date("2026-09-01T12:00:00Z");

const activeGrant = (
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

type Harness = {
  grants: RawGrant[];
  actor?: { userId: string } | null;
};

function harness({ grants, actor = { userId: "user-1" } }: Harness) {
  const audits: AuditEntry[] = [];
  const withPermission = createWithPermission({
    getActor: async () => actor,
    loadGrants: async () => grants,
    audit: async (entry) => {
      audits.push(entry);
    },
    now: () => NOW,
  });
  return { withPermission, audits };
}

describe("withPermission", () => {
  it("runs the handler when a grant matches", async () => {
    const { withPermission } = harness({ grants: [activeGrant("courses.edit")] });
    const handler = vi.fn(async () => "done");

    const action = withPermission("courses.edit", () => ({ courseIds: ["c1"] }))(handler);

    await expect(action({ courseId: "c1" })).resolves.toBe("done");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("passes the actor and resolved scope to the handler", async () => {
    const { withPermission } = harness({ grants: [activeGrant("courses.edit")] });
    const handler = vi.fn(async () => null);

    await withPermission("courses.edit", () => ({ courseIds: ["c1"] }))(handler)({});

    const [, ctx] = handler.mock.calls[0] as unknown as [unknown, { actor: { userId: string }; resource: { courseIds?: string[] } }];
    expect(ctx.actor.userId).toBe("user-1");
    expect(ctx.resource.courseIds).toEqual(["c1"]);
  });

  it("rejects an anonymous caller without running the handler", async () => {
    const { withPermission } = harness({ grants: [], actor: null });
    const handler = vi.fn(async () => "done");

    const action = withPermission("courses.edit", () => ({}))(handler);

    await expect(action({})).rejects.toBeInstanceOf(AuthenticationError);
    expect(handler).not.toHaveBeenCalled();
  });

  it("denies by default when the user holds no grants", async () => {
    const { withPermission } = harness({ grants: [] });
    const handler = vi.fn(async () => "done");

    const action = withPermission("courses.edit", () => ({}))(handler);

    await expect(action({})).rejects.toBeInstanceOf(AuthorizationError);
    expect(handler).not.toHaveBeenCalled();
  });

  it("denies when the grant is out of scope", async () => {
    const { withPermission } = harness({
      grants: [activeGrant("courses.edit", "COURSE", "other-course")],
    });
    const handler = vi.fn(async () => "done");

    const action = withPermission("courses.edit", () => ({ courseIds: ["c1"] }))(handler);

    await expect(action({})).rejects.toBeInstanceOf(AuthorizationError);
    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores an expired grant", async () => {
    const expired: RawGrant = {
      ...activeGrant("courses.edit"),
      endsAt: new Date("2026-08-01T00:00:00Z"),
    };
    const { withPermission } = harness({ grants: [expired] });

    const action = withPermission("courses.edit", () => ({}))(vi.fn(async () => "done"));

    await expect(action({})).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("ignores a revoked grant", async () => {
    const revoked: RawGrant = {
      ...activeGrant("courses.edit"),
      revokedAt: new Date("2026-08-15T00:00:00Z"),
    };
    const { withPermission } = harness({ grants: [revoked] });

    const action = withPermission("courses.edit", () => ({}))(vi.fn(async () => "done"));

    await expect(action({})).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("audits a denial with permission, actor, and outcome", async () => {
    const { withPermission, audits } = harness({ grants: [] });

    const action = withPermission("payments.confirm", () => ({}))(vi.fn(async () => null));
    await expect(action({})).rejects.toBeInstanceOf(AuthorizationError);

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "authorization.denied",
      outcome: "DENIED",
      actorId: "user-1",
    });
    expect(audits[0].permission).toBe("payments.confirm");
  });

  it("audits an anonymous denial with a null actor", async () => {
    const { withPermission, audits } = harness({ grants: [], actor: null });

    const action = withPermission("payments.confirm", () => ({}))(vi.fn(async () => null));
    await expect(action({})).rejects.toBeInstanceOf(AuthenticationError);

    expect(audits).toHaveLength(1);
    expect(audits[0].actorId).toBeNull();
    expect(audits[0].outcome).toBe("DENIED");
  });

  it("does not audit a successful authorization", async () => {
    const { withPermission, audits } = harness({ grants: [activeGrant("courses.edit")] });

    await withPermission("courses.edit", () => ({}))(vi.fn(async () => null))({});

    expect(audits).toHaveLength(0);
  });

  it("supports an async scope resolver", async () => {
    const { withPermission } = harness({
      grants: [activeGrant("cohorts.manage", "COHORT", "cohort-7")],
    });
    const handler = vi.fn(async () => "ok");

    const action = withPermission("cohorts.manage", async (input: { id: string }) => ({
      cohortId: input.id,
    }))(handler);

    await expect(action({ id: "cohort-7" })).resolves.toBe("ok");
  });

  it("does not run the handler when the scope resolver throws", async () => {
    const { withPermission } = harness({ grants: [activeGrant("courses.edit")] });
    const handler = vi.fn(async () => "done");

    const action = withPermission("courses.edit", () => {
      throw new Error("cohort not found");
    })(handler);

    await expect(action({})).rejects.toThrow("cohort not found");
    expect(handler).not.toHaveBeenCalled();
  });
});
