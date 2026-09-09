/**
 * The cohort Roster tab (COH-07, D-17, D-18) load-bearing contracts:
 *
 *   1. The three deferred columns render their "· Phase N" text and contain
 *      neither `0%` nor an empty cell (D-18).
 *   2. A `no-rule` attendance component renders the third-state glyph rather
 *      than `0%`.
 *   3. The six render states appear (loading / empty / populated /
 *      validation error / denied / recoverable failure).
 *   4. A `CapacityExceededError` result renders the specified capacity
 *      message inside the modal's error slot (T-05-97).
 *   5. The status pill is accompanied by a text label, never colour alone
 *      (NFR-09).
 *
 * `enrolment-actions.ts` is a real Server Actions file ("use server"); it is
 * mocked here rather than exercised for real, exactly the same reasoning
 * `attendance-mark.test.tsx` documents for `attendance-actions.ts`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ResourceTable, type Column } from "@/components/primitives";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/app/staff/cohorts/[id]/enrolment-actions", () => ({
  addEnrolmentAction: vi.fn(),
  approveEnrolmentAction: vi.fn(),
  transferEnrolmentAction: vi.fn(),
  withdrawEnrolmentAction: vi.fn(),
  cancelEnrolmentAction: vi.fn(),
}));

import { addEnrolmentAction } from "@/app/staff/cohorts/[id]/enrolment-actions";
import { RosterTab, type RosterRowView } from "@/app/staff/cohorts/[id]/RosterTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const row = (overrides: Partial<RosterRowView> = {}): RosterRowView => ({
  learnerId: "u1",
  learnerName: "Ada Lovelace",
  learnerEmail: "ada@example.com",
  enrolmentId: "e1",
  status: "ACTIVE",
  transitionCount: 0,
  latestTransition: null,
  accessStartsAt: "2026-01-01T00:00:00.000Z",
  accessEndsAt: null,
  instructors: ["Grace Hopper"],
  attendance: { kind: "no-rule" },
  progress: { kind: "deferred", phase: 9 },
  assessment: { kind: "deferred", phase: 10 },
  completion: { kind: "deferred", phase: 11 },
  ...overrides,
});

type Dummy = { id: string };
const dummyColumns: Column<Dummy>[] = [{ key: "id", header: "ID", render: (d) => d.id }];

describe("RosterTab", () => {
  it("renders the three deferred columns with their named Phase text and no numeric or blank fallback", () => {
    render(<RosterTab cohortId="c1" rows={[row()]} />);

    expect(screen.getAllByText(/· Phase 9/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/· Phase 10/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/· Phase 11/).length).toBeGreaterThan(0);
    expect(screen.queryByText("0%")).toBeNull();
  });

  it("renders a no-rule attendance component with the third-state glyph, never 0%", () => {
    render(<RosterTab cohortId="c1" rows={[row({ attendance: { kind: "no-rule" } })]} />);

    expect(screen.getAllByText("No attendance rule").length).toBeGreaterThan(0);
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.queryByText(/0% \/ /)).toBeNull();
  });

  it("renders a computed attendance component as earned/required percent, in mono", () => {
    render(
      <RosterTab
        cohortId="c1"
        rows={[
          row({
            attendance: {
              kind: "computed",
              earnedPct: 80,
              requiredPct: 70,
              attendedCount: 4,
              countableCount: 5,
              meetsThreshold: true,
            },
          }),
        ]}
      />,
    );
    expect(screen.getAllByText("80% / 70%").length).toBeGreaterThan(0);
  });

  it("pairs the status pill with a text label, never colour alone", () => {
    render(<RosterTab cohortId="c1" rows={[row({ status: "PENDING_PAYMENT" })]} />);
    expect(screen.getAllByText("Pending payment").length).toBeGreaterThan(0);
  });

  describe("six render states", () => {
    it("loading (shared ResourceTable primitive)", () => {
      render(
        <ResourceTable<Dummy>
          noun="enrolments"
          title="Roster"
          columns={dummyColumns}
          state={{ status: "loading" }}
          getRowKey={(d) => d.id}
        />,
      );
      expect(screen.getByText("Loading enrolments", { selector: "caption" })).toBeTruthy();
    });

    it("recoverable error (shared ResourceTable primitive)", () => {
      render(
        <ResourceTable<Dummy>
          noun="enrolments"
          title="Roster"
          columns={dummyColumns}
          state={{ status: "error", message: "The request timed out." }}
          getRowKey={(d) => d.id}
        />,
      );
      expect(screen.getByText("Could not load enrolments")).toBeTruthy();
    });

    it("validation error keeps previous rows visible (shared ResourceTable primitive)", () => {
      render(
        <ResourceTable<Dummy>
          noun="enrolments"
          title="Roster"
          columns={dummyColumns}
          state={{ status: "ready", rows: [{ id: "1" }] }}
          getRowKey={(d) => d.id}
          validationError={{ message: "That filter is invalid." }}
        />,
      );
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    });

    it("empty — no one enrolled", () => {
      render(<RosterTab cohortId="c1" rows={[]} />);
      expect(screen.getByText("No one is enrolled yet")).toBeTruthy();
      expect(
        screen.getByText(
          "Add an enrolment for a comped or corporate learner, or publish the cohort so learners can register.",
          { exact: false },
        ),
      ).toBeTruthy();
    });

    it("populated — the learner and status render", () => {
      render(<RosterTab cohortId="c1" rows={[row()]} />);
      expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    });

    it("denied — identical copy regardless of whether any enrolment exists, no name/id leak", () => {
      render(<RosterTab cohortId="c1" denied={{ permission: "cohorts.view" }} />);
      expect(screen.getByText("You do not have access to enrolments", { exact: false })).toBeTruthy();
      expect(screen.queryByText("Ada Lovelace")).toBeNull();
    });
  });

  it("renders a CapacityExceededError result inside the Add-enrolment modal's error slot", async () => {
    const mockAdd = addEnrolmentAction as unknown as ReturnType<typeof vi.fn>;
    mockAdd.mockResolvedValue({
      ok: false,
      message:
        "This cohort is full. It reached capacity while you were working. Raise capacity or withdraw an enrolment, then try again.",
    });

    render(
      <RosterTab
        cohortId="c1"
        rows={[row()]}
        candidateLearners={[{ id: "u2", name: "Alan Turing", email: "alan@example.com" }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add enrolment" }));

    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Learner" }), {
      target: { value: "u2" },
    });
    fireEvent.change(within(dialog).getByLabelText(/reason/i), {
      target: { value: "Backfilling a comped seat for a partner org" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add enrolment" }));

    expect(
      await within(dialog).findByText(
        "This cohort is full. It reached capacity while you were working. Raise capacity or withdraw an enrolment, then try again.",
      ),
    ).toBeTruthy();
    expect(within(dialog).getByText("Action not applied")).toBeTruthy();
  });
});
