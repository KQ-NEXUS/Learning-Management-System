/**
 * WR-06 (04.1 gap closure) — an assignment revoke or an account status change
 * that REJECTS (network drop, action runtime error) must recover with the
 * staff member's intent intact: the ConfirmModal stays open with the typed
 * reason, busy clears in `finally`, the failure never reads as success, and
 * there is no automatic mutation retry. A later user-triggered confirm
 * succeeds.
 *
 * `./actions` is a real Server Actions file ("use server"); it is mocked here,
 * the same reasoning `cohort-detail-actions.test.tsx` documents for its own
 * actions module. Bound assignment / account ids and the service
 * authorization are unchanged by this repair.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AssignmentRow } from "@/app/staff/users/AssignmentsPanel";

vi.mock("@/app/staff/users/actions", () => ({
  revokeAssignmentAction: vi.fn(),
  deactivateStaffAccountAction: vi.fn(),
  reactivateStaffAccountAction: vi.fn(),
  // Consumed by the AssignmentDrawer that AssignmentsPanel renders.
  createAssignmentAction: vi.fn(async () => ({ errors: [], success: false })),
  searchScopeTargetsAction: vi.fn(async () => []),
  searchStaffUsersAction: vi.fn(async () => []),
}));

import {
  revokeAssignmentAction,
  deactivateStaffAccountAction,
} from "@/app/staff/users/actions";
import { AssignmentsPanel, AccountStatusControl } from "@/app/staff/users/AssignmentsPanel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const assignment: AssignmentRow = {
  id: "a1",
  role: { id: "r1", name: "Instructor", active: true },
  scopeType: "GLOBAL",
  scopeId: null,
  scopeLabel: null,
  startsAt: "2026-01-01T00:00:00.000Z",
  endsAt: null,
  active: true,
  revokedAt: null,
  reason: null,
};

function renderPanel() {
  return render(
    <AssignmentsPanel
      userId="u1"
      userName="Dana Lee"
      userEmail="dana@example.com"
      assignments={[assignment]}
      roles={[{ id: "r1", name: "Instructor" }]}
      minReasonLength={10}
    />,
  );
}

describe("AssignmentsPanel — a rejected revoke recovers with intent intact", () => {
  it("keeps the modal open with the typed reason and no silent success when revokeAssignmentAction rejects, then succeeds on retry", async () => {
    vi.mocked(revokeAssignmentAction)
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce({ error: null });

    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    const dialog = screen.getByRole("dialog");
    const textarea = within(dialog).getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "left the programme" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke assignment" }));

    expect(
      await within(dialog).findByText("Action not applied", {}, { timeout: 10000 }),
    ).toBeTruthy();
    expect(within(dialog).getByText(/The assignment was not revoked/i)).toBeTruthy();

    // No silent success: the dialog is still open with the reason retained.
    expect((within(dialog).getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "left the programme",
    );
    const confirm = within(dialog).getByRole("button", { name: "Revoke assignment" });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);

    // No automatic retry happened.
    expect(revokeAssignmentAction).toHaveBeenCalledTimes(1);

    // User retries; success closes the dialog.
    fireEvent.click(confirm);
    await vi.waitFor(
      () => {
        expect(screen.queryByRole("dialog")).toBeNull();
      },
      { timeout: 10000 },
    );
    expect(revokeAssignmentAction).toHaveBeenCalledTimes(2);
    expect(revokeAssignmentAction).toHaveBeenLastCalledWith("a1", "left the programme");
  });
});

describe("AccountStatusControl — a rejected deactivation clears busy and keeps the reason", () => {
  it("shows generic feedback and keeps the dialog open when deactivateStaffAccountAction rejects, then closes on a later success", async () => {
    vi.mocked(deactivateStaffAccountAction)
      .mockRejectedValueOnce(new Error("gateway timeout"))
      .mockResolvedValueOnce({ error: null });

    render(
      <AccountStatusControl
        userId="u1"
        userName="Dana Lee"
        status="ACTIVE"
        minReasonLength={10}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "offboarding today" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate account" }));

    expect(
      await within(dialog).findByText("Action not applied", {}, { timeout: 10000 }),
    ).toBeTruthy();
    expect(within(dialog).getByText(/The account status was not changed/i)).toBeTruthy();
    expect((within(dialog).getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "offboarding today",
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate account" }));
    await vi.waitFor(
      () => {
        expect(screen.queryByRole("dialog")).toBeNull();
      },
      { timeout: 10000 },
    );
    expect(deactivateStaffAccountAction).toHaveBeenCalledTimes(2);
    expect(deactivateStaffAccountAction).toHaveBeenLastCalledWith("u1", "offboarding today");
  });
});
