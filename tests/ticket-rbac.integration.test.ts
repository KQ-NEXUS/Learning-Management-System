import { describe, expect, it, vi } from "vitest";
import { AuthorizationError, createWithPermission } from "@/server/permissions/with-permission";
import { grant } from "./support/harness";

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
});
