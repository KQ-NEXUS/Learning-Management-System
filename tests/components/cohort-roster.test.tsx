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
  listEnrolmentCandidatesAction: vi.fn(),
  approveEnrolmentAction: vi.fn(),
  transferEnrolmentAction: vi.fn(),
  withdrawEnrolmentAction: vi.fn(),
  cancelEnrolmentAction: vi.fn(),
}));

import { addEnrolmentAction, listEnrolmentCandidatesAction } from "@/app/staff/cohorts/[id]/enrolment-actions";
import { RosterTab, type RosterRowView } from "@/app/staff/cohorts/[id]/RosterTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const row = (overrides: Partial<RosterRowView> = {}): RosterRowView => ({
  learnerId: "u1",
  learnerName: "Ada Lovelace",
  learnerEmail: "ada@example.com",
  learnerNumber: null,
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
  it("no longer draws the Assessment and Completion columns, whose Phase 10/11 placeholders had shipped", () => {
    render(<RosterTab cohortId="c1" rows={[row()]} />);

    expect(screen.queryByText(/not tracked yet · Phase 10/)).toBeNull();
    expect(screen.queryByText(/not tracked yet · Phase 11/)).toBeNull();
    expect(screen.queryByText("Assessment")).toBeNull();
    expect(screen.queryByText("Completion")).toBeNull();
    expect(screen.queryByText("0%")).toBeNull();
  });

  it("renders a no-rule attendance component with the third-state glyph, never 0%", () => {
    render(<RosterTab cohortId="c1" rows={[row({ attendance: { kind: "no-rule" } })]} />);

    expect(screen.getAllByText("No attendance rule").length).toBeGreaterThan(0);
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.queryByText(/0% \/ /)).toBeNull();
  });

  it("renders a computed attendance component as the earned percent", () => {
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
    expect(screen.getAllByText("80%").length).toBeGreaterThan(0);
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

  describe("Add enrolment: choose a learner, then give the reason", () => {
    const candidates = [
      { id: "u2", name: "Alan Turing", email: "alan@example.com", learnerNumber: "KQL-000007", unverified: false, enrolledStatus: null },
      { id: "u3", name: "Alan Turing", email: "alan.t@example.com", learnerNumber: "KQL-000012", unverified: false, enrolledStatus: null },
      { id: "u1", name: "Ada Lovelace", email: "ada@example.com", learnerNumber: null, unverified: false, enrolledStatus: "ACTIVE" },
    ];
    const mockList = listEnrolmentCandidatesAction as unknown as ReturnType<typeof vi.fn>;
    const mockAdd = addEnrolmentAction as unknown as ReturnType<typeof vi.fn>;

    async function openPicker(total = candidates.length) {
      mockList.mockResolvedValue({ ok: true, people: candidates, total });
      render(<RosterTab cohortId="c1" rows={[row()]} />);
      fireEvent.click(screen.getByRole("button", { name: "Add enrolment" }));
      const picker = screen.getByRole("dialog", { name: "Choose a learner" });
      await within(picker).findAllByRole("radio");
      return picker;
    }

    it("opens a list of learners, never a box for a learner id", async () => {
      const picker = await openPicker();

      expect(mockList).toHaveBeenCalledWith({ cohortId: "c1", query: "" });
      expect(within(picker).getByLabelText("Search by name, email or learner number")).toBeTruthy();
      expect(screen.queryByPlaceholderText("Learner id")).toBeNull();
    });

    it("tells two learners with the same name apart by their learner number", async () => {
      const picker = await openPicker();
      const sameName = within(picker).getAllByRole("radio", { name: /Alan Turing/ });

      expect(sameName).toHaveLength(2);
      expect(sameName[0]!.textContent).toContain("KQL-000007");
      expect(sameName[1]!.textContent).toContain("KQL-000012");
    });

    it("shows someone already enrolled here, but they cannot be chosen", async () => {
      const picker = await openPicker();
      const enrolled = within(picker).getByRole("radio", { name: /Ada Lovelace/ }) as HTMLButtonElement;

      expect(enrolled.disabled).toBe(true);
      expect(enrolled.textContent).toContain("Already enrolled here");
    });

    it("says when the list was cut short", async () => {
      const picker = await openPicker(312);
      expect(within(picker).getByText("Showing the first 3 of 312 learners. Search to narrow the list.")).toBeTruthy();
    });

    it("carries the chosen learner into the reason step and enrols that learner", async () => {
      mockAdd.mockResolvedValue({ ok: true, enrolmentId: "e9" });
      const picker = await openPicker();
      fireEvent.click(within(picker).getAllByRole("radio", { name: /Alan Turing/ })[1]!);
      fireEvent.click(within(picker).getByRole("button", { name: "Continue" }));

      const dialog = screen.getByRole("dialog", { name: "Add Alan Turing to this cohort?" });
      expect(within(dialog).getByText("KQL-000012", { exact: false })).toBeTruthy();
      fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: "Corporate seat for a partner org" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Add enrolment" }));

      await vi.waitFor(() =>
        expect(mockAdd).toHaveBeenCalledWith({
          cohortId: "c1",
          userId: "u3",
          target: "ACTIVE",
          reason: "Corporate seat for a partner org",
        }),
      );
    });

    it("Change goes back to the list with the learner still chosen", async () => {
      const picker = await openPicker();
      fireEvent.click(within(picker).getAllByRole("radio", { name: /Alan Turing/ })[0]!);
      fireEvent.click(within(picker).getByRole("button", { name: "Continue" }));
      fireEvent.click(screen.getByRole("button", { name: "Change" }));

      const again = screen.getByRole("dialog", { name: "Choose a learner" });
      const radios = await within(again).findAllByRole("radio", { name: /Alan Turing/ });
      expect(radios[0]!.getAttribute("aria-checked")).toBe("true");
    });

    it("closing the list before choosing anyone abandons the add", async () => {
      const picker = await openPicker();
      fireEvent.click(within(picker).getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(mockAdd).not.toHaveBeenCalled();
    });
  });

  it("renders a CapacityExceededError result inside the Add-enrolment modal's error slot", async () => {
    const mockAdd = addEnrolmentAction as unknown as ReturnType<typeof vi.fn>;
    const mockList = listEnrolmentCandidatesAction as unknown as ReturnType<typeof vi.fn>;
    mockList.mockResolvedValue({
      ok: true,
      people: [{ id: "u2", name: "Alan Turing", email: "alan@example.com", learnerNumber: null, unverified: false, enrolledStatus: null }],
      total: 1,
    });
    mockAdd.mockResolvedValue({
      ok: false,
      message:
        "This cohort is full. It reached capacity while you were working. Raise capacity or withdraw an enrolment, then try again.",
    });

    render(<RosterTab cohortId="c1" rows={[row()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Add enrolment" }));
    fireEvent.click(await screen.findByRole("radio", { name: /Alan Turing/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const dialog = screen.getByRole("dialog");
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
