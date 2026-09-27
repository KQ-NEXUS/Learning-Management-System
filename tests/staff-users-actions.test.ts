import { beforeEach, describe, expect, it, vi } from "vitest";

const { assignmentCreate, staffCreate, revalidatePath } = vi.hoisted(() => ({
  assignmentCreate: vi.fn(),
  staffCreate: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/server/services/assignment-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/assignment-service")>();
  return { ...actual, assignmentService: { create: assignmentCreate } };
});
vi.mock("@/server/services/staff-account-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/staff-account-service")>();
  return { ...actual, staffAccountService: { create: staffCreate } };
});
vi.mock("@/server/services/scope-lookup-service", () => ({ scopeLookupService: {} }));

import { createAssignmentAction, createStaffAccountAction } from "@/app/staff/users/actions";
import { GrantCeilingError, SelfAssignmentError } from "@/server/services/assignment-service";

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

beforeEach(() => vi.resetAllMocks());

describe("F-07 — role assignment refusals reach the form, not the error page", () => {
  it("a role above the actor's own permissions is a role-field error naming what is missing", async () => {
    assignmentCreate.mockRejectedValue(new GrantCeilingError(["refunds.manage"]));
    const result = await createAssignmentAction(
      { errors: [], success: false },
      form({ userId: "u2", roleId: "role-finance", scopeType: "COURSE", scopeId: "c1" }),
    );
    expect(result.success).toBe(false);
    expect(result.errors).toEqual([{ name: "roleId", message: expect.stringContaining("refunds.manage") }]);
  });

  it("assigning a role to yourself is a form error", async () => {
    assignmentCreate.mockRejectedValue(new SelfAssignmentError());
    const result = await createAssignmentAction(
      { errors: [], success: false },
      form({ userId: "me", roleId: "role-plain", scopeType: "GLOBAL" }),
    );
    expect(result.errors).toEqual([{ name: "form", message: "You cannot assign a role to yourself. Ask another administrator." }]);
  });

  it("creating an account with a role above the actor's permissions is a role-field error", async () => {
    staffCreate.mockRejectedValue(new GrantCeilingError(["payments.confirm"]));
    const result = await createStaffAccountAction(
      { errors: [], created: null },
      form({ name: "New", email: "new@kqnexus.test", roleId: "role-finance", scopeType: "GLOBAL" }),
    );
    expect(result.created).toBeNull();
    expect(result.errors).toEqual([{ name: "roleId", message: expect.stringContaining("payments.confirm") }]);
  });
});
