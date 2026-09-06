/**
 * WR-06 (04.1 gap closure) — a role mutation that REJECTS (network drop, action
 * runtime error) must not strand its control in a busy state or erase the
 * staff member's retry context. Each imperative call is wrapped so busy always
 * clears in `finally`, the entered reason and dialog stay put, and the failure
 * surfaces as generic feedback (never a raw exception), followed by a
 * user-triggered success.
 *
 * `./actions` is a real Server Actions file ("use server"); it is mocked here,
 * the same reasoning `cohort-detail-actions.test.tsx` documents for its own
 * actions module. The last-administrator / version / permission-catalogue
 * guards live in that action and are unchanged by this repair.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { RoleRecord } from "@/server/services/role-service";

vi.mock("@/app/staff/roles/actions", () => ({
  // `createRoleAction` is consumed by RoleForm's `useActionState`; the edit
  // panel never invokes it but the module must still expose it.
  createRoleAction: vi.fn(async () => ({ errors: [] })),
  updateRoleAction: vi.fn(),
  setRoleActiveAction: vi.fn(),
}));

import { updateRoleAction, setRoleActiveAction } from "@/app/staff/roles/actions";
import { RolePermissionsPanel, RoleActivationControl } from "@/app/staff/roles/RoleDetailPanels";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const role: RoleRecord = {
  id: "r1",
  name: "Coordinator",
  description: null,
  active: true,
  isDefault: false,
  version: 3,
  permissions: ["courses.view"],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("RolePermissionsPanel — a rejected save cannot strand the submit button", () => {
  // The full RoleForm (PermissionPicker over every permission group) is a heavy
  // mount; under a full-suite parallel run the default 5s ceiling is tight, so
  // this one test raises it. The queries still resolve the moment the node
  // exists — see tests/components/setup.ts for the same reasoning on editors.
  it(
    "clears pending and shows generic feedback when updateRoleAction rejects, then succeeds on retry",
    async () => {
      vi.mocked(updateRoleAction)
        .mockRejectedValueOnce(new Error("connection reset"))
        .mockResolvedValueOnce({ errors: [] });

      render(<RolePermissionsPanel role={role} minReasonLength={10} assignmentCount={0} />);

      // Addition-only edit (no permission removed) submits directly — no modal.
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

      const alert = await screen.findByRole("alert", {}, { timeout: 15000 });
      expect(alert.textContent).toMatch(/Something went wrong saving this role/i);
      expect(alert.textContent).not.toMatch(/connection reset/);

      // Not stranded in the pending label.
      expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Saving…" })).toBeNull();

      // User retries; the error clears.
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      await vi.waitFor(
        () => {
          expect(screen.queryByText(/Something went wrong saving this role/i)).toBeNull();
        },
        { timeout: 15000 },
      );
      expect(updateRoleAction).toHaveBeenCalledTimes(2);
    },
    20000,
  );
});

describe("RoleActivationControl — a rejected status change keeps the dialog and reason", () => {
  it("clears busy and keeps the modal open with an error when setRoleActiveAction rejects, then closes on a later success", async () => {
    vi.mocked(setRoleActiveAction)
      .mockRejectedValueOnce(new Error("gateway timeout"))
      .mockResolvedValueOnce({ error: null });

    render(<RoleActivationControl role={role} minReasonLength={10} assignmentCount={2} />);

    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    const dialog = screen.getByRole("dialog");

    const textarea = within(dialog).getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "no longer coordinating" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate role" }));

    expect(
      await within(dialog).findByText("Action not applied", {}, { timeout: 10000 }),
    ).toBeTruthy();
    expect(within(dialog).getByText(/The role's status was not changed/i)).toBeTruthy();

    // Reason retained, dialog still open, confirm no longer busy.
    expect((within(dialog).getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "no longer coordinating",
    );
    const confirm = within(dialog).getByRole("button", { name: "Deactivate role" });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);

    // Retry succeeds and the dialog closes.
    fireEvent.click(confirm);
    await vi.waitFor(
      () => {
        expect(screen.queryByRole("dialog")).toBeNull();
      },
      { timeout: 10000 },
    );
    expect(setRoleActiveAction).toHaveBeenCalledTimes(2);
    expect(setRoleActiveAction).toHaveBeenLastCalledWith("r1", false, "no longer coordinating");
  });
});
