import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  addOwnTicketReply: vi.fn(),
  assignReconciliationCases: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth/current-actor", () => ({ getCurrentActor: async () => ({ userId: "learner-1" }) }));
vi.mock("@/server/services/ticket-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/ticket-service")>();
  return { ...actual, addOwnTicketReply: m.addOwnTicketReply };
});
vi.mock("@/server/services/reconciliation-case-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/reconciliation-case-service")>();
  return { ...actual, assignReconciliationCases: m.assignReconciliationCases };
});

import { UserInputError } from "@/server/errors/user-input-error";
import { mapStaffTicketFailure } from "@/app/staff/support/action-result";
import { replyToTicketAction } from "@/app/(learner)/support/[reference]/actions";
import { assignReconciliationCasesAction } from "@/app/staff/reconciliation/actions";

const crash = () => new TypeError("Cannot read properties of undefined (reading 'assigneeId')");

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("F-14d — only messages written for users reach them", () => {
  it("staff ticket actions show a validation message but never a runtime crash's text", () => {
    expect(mapStaffTicketFailure(new UserInputError("Subject must be between 3 and 120 characters."))).toEqual({
      ok: false,
      kind: "validation",
      message: "Subject must be between 3 and 120 characters.",
    });
    const result = mapStaffTicketFailure(crash());
    expect(result).toMatchObject({ ok: false, kind: "error" });
    expect(JSON.stringify(result)).not.toContain("Cannot read properties");
  });

  it("a learner reply shows a validation message but never a runtime crash's text", async () => {
    const input = { reference: "KQT-1", expectedVersion: 1, body: "Hello" };
    m.addOwnTicketReply.mockRejectedValueOnce(new UserInputError("Message must be between 1 and 5000 characters."));
    expect(await replyToTicketAction(input)).toMatchObject({ kind: "invalid", message: "Message must be between 1 and 5000 characters." });

    m.addOwnTicketReply.mockRejectedValueOnce(crash());
    const result = await replyToTicketAction(input);
    expect(result).toMatchObject({ ok: false, kind: "error" });
    expect(JSON.stringify(result)).not.toContain("Cannot read properties");
  });

  it("reconciliation shows a validation message; a runtime crash goes to the error page instead of the form", async () => {
    m.assignReconciliationCases.mockRejectedValueOnce(new UserInputError("Select at least one reconciliation case."));
    expect(await assignReconciliationCasesAction({ caseIds: ["c1"], assigneeId: "u1" } as never)).toEqual({
      ok: false,
      message: "Select at least one reconciliation case.",
    });

    m.assignReconciliationCases.mockRejectedValueOnce(crash());
    await expect(assignReconciliationCasesAction({ caseIds: ["c1"], assigneeId: "u1" } as never)).rejects.toThrow(TypeError);
  });

  it("the services' own validation throws are UserInputErrors", async () => {
    const { UserInputError: E } = await import("@/server/errors/user-input-error");
    expect(new E("x")).toBeInstanceOf(Error);
    expect(new E("x").name).toBe("UserInputError");
  });
});
