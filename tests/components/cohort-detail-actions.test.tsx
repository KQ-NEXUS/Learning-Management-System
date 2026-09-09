/**
 * The cohort detail action bar's load-bearing contracts (COH-04, COH-05, D-31):
 *
 *   1. A blocking FAIL readiness item disables Publish and names the
 *      failure count once the dialog is open.
 *   2. With every item PASS, Publish is enabled.
 *   3. The cancel modal requires a 10-character reason before its confirm
 *      button enables, and its description states the active-enrolment
 *      count.
 *   4. A failed action renders through the modal's error slot as
 *      "action not applied".
 *
 * `publish-actions.ts` is a real Server Actions file ("use server"); it is
 * mocked here rather than exercised for real, the same reasoning
 * `attendance-mark.test.tsx` / `cohort-roster.test.tsx` document for their
 * own actions modules.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReadinessItem } from "@/server/services/readiness-service";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/app/staff/cohorts/[id]/publish-actions", () => ({
  publishCohortAction: vi.fn(),
  cancelCohortAction: vi.fn(),
}));

import { publishCohortAction, cancelCohortAction } from "@/app/staff/cohorts/[id]/publish-actions";
import { CohortDetailActions } from "@/components/catalogue/CohortDetailActions";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const item = (over: Partial<ReadinessItem> & Pick<ReadinessItem, "id">): ReadinessItem => ({
  category: "Catalogue",
  label: "An item",
  state: "PASS",
  blocking: true,
  ...over,
});

const readyItems = (): ReadinessItem[] => [
  item({ id: "catalogue", label: "Pinned to a published Course or Programme", state: "PASS" }),
  item({ id: "schedule", category: "Schedule", label: "Schedule set", state: "PASS" }),
  item({ id: "capacity", category: "Capacity", label: "Capacity set and not oversold", state: "PASS" }),
];

const blockedItems = (): ReadinessItem[] => [
  item({ id: "catalogue", label: "Pinned to a published Course or Programme", state: "PASS" }),
  item({ id: "schedule", category: "Schedule", label: "Schedule set", state: "FAIL" }),
  item({ id: "instructors", category: "Instructors", label: "At least one instructor assigned", state: "FAIL" }),
];

function renderActions(overrides: Partial<Parameters<typeof CohortDetailActions>[0]> = {}) {
  return render(
    <CohortDetailActions
      cohortId="c1"
      code="SLP-2026-01"
      status="DRAFT"
      expectedUpdatedAt="2026-01-01T00:00:00.000Z"
      readinessItems={readyItems()}
      activeEnrolmentCount={3}
      canPublish
      canManage
      {...overrides}
    />,
  );
}

describe("CohortDetailActions", () => {
  it("disables Publish with a blocking FAIL item and names the failure count", () => {
    renderActions({ readinessItems: blockedItems() });
    fireEvent.click(screen.getByRole("button", { name: "Publish cohort" }));

    const dialog = screen.getByRole("dialog");
    const publishButton = within(dialog).getByRole("button", { name: /Publish$/ });
    expect((publishButton as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByText(/2 blocking items must be cleared first/)).toBeTruthy();
  });

  it("enables Publish once every readiness item is PASS", () => {
    renderActions({ readinessItems: readyItems() });
    fireEvent.click(screen.getByRole("button", { name: "Publish cohort" }));

    const dialog = screen.getByRole("dialog");
    const publishButton = within(dialog).getByRole("button", { name: /Publish$/ });
    expect((publishButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("requires a 10-character reason before the cancel confirm button enables, and states the active-enrolment count", () => {
    renderActions({ activeEnrolmentCount: 4 });
    fireEvent.click(screen.getByRole("button", { name: "Cancel cohort" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Withdraws all 4 active enrolments/)).toBeTruthy();

    const confirmButton = within(dialog).getByRole("button", { name: "Cancel cohort" });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);

    const textarea = within(dialog).getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "short" } });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: "closing this cohort down" } });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("renders a failed cancel action through the modal's error slot as action not applied", async () => {
    vi.mocked(cancelCohortAction).mockResolvedValue({
      ok: false,
      reason: "STALE",
      message: "Someone else changed this cohort while you had it open. Reload to see their version, then reapply your changes.",
    });

    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Cancel cohort" }));

    const dialog = screen.getByRole("dialog");
    const textarea = within(dialog).getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "closing this cohort down" } });

    const confirmButton = within(dialog).getByRole("button", { name: "Cancel cohort" });
    fireEvent.click(confirmButton);

    expect(await within(dialog).findByText("Action not applied")).toBeTruthy();
    expect(await within(dialog).findByText(/Someone else changed this cohort/)).toBeTruthy();
  });

  it("calls publishCohortAction with the cohort id and expected timestamp when confirmed", async () => {
    vi.mocked(publishCohortAction).mockResolvedValue({
      ok: true,
      status: "PUBLISHED",
      publicationId: "pub1",
    });

    renderActions({ readinessItems: readyItems() });
    fireEvent.click(screen.getByRole("button", { name: "Publish cohort" }));

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Publish$/ }));

    await screen.findByText("Cohort published.");
    expect(publishCohortAction).toHaveBeenCalledWith({
      cohortId: "c1",
      expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
    });
  });
});
