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
  addEnrolmentsAction: vi.fn(),
  listEnrolmentCandidatesAction: vi.fn(),
  approveEnrolmentAction: vi.fn(),
  transferEnrolmentAction: vi.fn(),
  withdrawEnrolmentAction: vi.fn(),
  cancelEnrolmentAction: vi.fn(),
}));

import { addEnrolmentsAction, listEnrolmentCandidatesAction } from "@/app/staff/cohorts/[id]/enrolment-actions";
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

  describe("Add enrolment: tick the learners, then give one reason", () => {
    const candidates = [
      { id: "u2", name: "Alan Turing", email: "alan@example.com", learnerNumber: "KQL-000007", unverified: false, enrolledStatus: null },
      { id: "u3", name: "Alan Turing", email: "alan.t@example.com", learnerNumber: "KQL-000012", unverified: false, enrolledStatus: null },
      { id: "u4", name: "Grace Hopper", email: "grace@example.com", learnerNumber: "KQL-000020", unverified: false, enrolledStatus: null },
      { id: "u1", name: "Ada Lovelace", email: "ada@example.com", learnerNumber: null, unverified: false, enrolledStatus: "ACTIVE" },
    ];
    const mockList = listEnrolmentCandidatesAction as unknown as ReturnType<typeof vi.fn>;
    const mockAdd = addEnrolmentsAction as unknown as ReturnType<typeof vi.fn>;

    async function openPicker(total = candidates.length) {
      mockList.mockResolvedValue({ ok: true, people: candidates, total });
      render(<RosterTab cohortId="c1" rows={[row()]} />);
      fireEvent.click(screen.getByRole("button", { name: "Add enrolment" }));
      const picker = screen.getByRole("dialog", { name: "Choose learners" });
      await within(picker).findAllByRole("checkbox");
      return picker;
    }
    const tick = (picker: HTMLElement, name: RegExp, index = 0) =>
      fireEvent.click(within(picker).getAllByRole("checkbox", { name })[index]!);

    it("opens a list of learners, never a box for a learner id", async () => {
      const picker = await openPicker();

      expect(mockList).toHaveBeenCalledWith({ cohortId: "c1", query: "" });
      expect(within(picker).getByLabelText("Search by name, email or learner number")).toBeTruthy();
      expect(screen.queryByPlaceholderText("Learner id")).toBeNull();
    });

    it("tells two learners with the same name apart by their learner number", async () => {
      const picker = await openPicker();
      const sameName = within(picker).getAllByRole("checkbox", { name: /Alan Turing/ });

      expect(sameName).toHaveLength(2);
      expect(sameName[0]!.textContent).toContain("KQL-000007");
      expect(sameName[1]!.textContent).toContain("KQL-000012");
    });

    it("shows someone already enrolled here, but they cannot be ticked", async () => {
      const picker = await openPicker();
      const enrolled = within(picker).getByRole("checkbox", { name: /Ada Lovelace/ }) as HTMLButtonElement;

      expect(enrolled.disabled).toBe(true);
      expect(enrolled.textContent).toContain("Already enrolled here");
    });

    it("says when the list was cut short", async () => {
      const picker = await openPicker(312);
      expect(within(picker).getByText("Showing the first 4 of 312 learners. Search to narrow the list.")).toBeTruthy();
    });

    it("cannot continue until someone is ticked, then counts who is chosen", async () => {
      const picker = await openPicker();
      const next = within(picker).getByRole("button", { name: "Continue" }) as HTMLButtonElement;
      expect(next.disabled).toBe(true);
      expect(within(picker).getByText("0 learners chosen")).toBeTruthy();

      tick(picker, /Alan Turing/, 0);
      expect(within(picker).getByText("1 learner chosen")).toBeTruthy();
      tick(picker, /Grace Hopper/);
      expect(within(picker).getByText("2 learners chosen")).toBeTruthy();
      expect(next.disabled).toBe(false);
    });

    it("keeps people ticked when the search changes, and lists them so they can be removed", async () => {
      const picker = await openPicker();
      tick(picker, /Alan Turing/, 1);
      tick(picker, /Grace Hopper/);

      // The next search returns only someone else: the two ticked learners are no longer in the list.
      mockList.mockResolvedValue({ ok: true, people: [candidates[0]], total: 1 });
      fireEvent.change(within(picker).getByLabelText("Search by name, email or learner number"), { target: { value: "KQL-000007" } });
      await vi.waitFor(() => expect(within(picker).getAllByRole("checkbox")).toHaveLength(1));

      const chosen = within(picker).getByRole("list", { name: "Chosen" });
      expect(within(chosen).getByText("KQL-000012")).toBeTruthy();
      expect(within(chosen).getByText("Grace Hopper")).toBeTruthy();

      fireEvent.click(within(chosen).getByRole("button", { name: "Remove Grace Hopper, KQL-000020" }));
      expect(within(picker).getByText("1 learner chosen")).toBeTruthy();
    });

    it("adds one learner exactly as before", async () => {
      mockAdd.mockResolvedValue({ ok: true, added: 1 });
      const picker = await openPicker();
      tick(picker, /Alan Turing/, 1);
      fireEvent.click(within(picker).getByRole("button", { name: "Continue" }));

      const dialog = screen.getByRole("dialog", { name: "Add Alan Turing to this cohort?" });
      expect(within(dialog).getByText("KQL-000012", { exact: false })).toBeTruthy();
      fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: "Corporate seat for a partner org" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Add enrolment" }));

      await vi.waitFor(() =>
        expect(mockAdd).toHaveBeenCalledWith({
          cohortId: "c1",
          userIds: ["u3"],
          target: "ACTIVE",
          reason: "Corporate seat for a partner org",
        }),
      );
    });

    it("adds several learners with one status and one reason, listing them first", async () => {
      mockAdd.mockResolvedValue({ ok: true, added: 3 });
      const picker = await openPicker();
      tick(picker, /Alan Turing/, 0);
      tick(picker, /Alan Turing/, 1);
      tick(picker, /Grace Hopper/);
      fireEvent.click(within(picker).getByRole("button", { name: "Continue" }));

      const dialog = screen.getByRole("dialog", { name: "Add 3 learners to this cohort?" });
      const listed = within(dialog).getByRole("list", { name: "Learners to add" });
      expect(within(listed).getAllByRole("listitem")).toHaveLength(3);
      expect(within(dialog).getByText(/nobody is added/)).toBeTruthy();

      fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: "Partner organisation group booking" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Add 3 enrolments" }));

      await vi.waitFor(() =>
        expect(mockAdd).toHaveBeenCalledWith({
          cohortId: "c1",
          userIds: ["u2", "u3", "u4"],
          target: "ACTIVE",
          reason: "Partner organisation group booking",
        }),
      );
    });

    it("Change goes back to the list with the same learners still ticked", async () => {
      const picker = await openPicker();
      tick(picker, /Alan Turing/, 0);
      tick(picker, /Grace Hopper/);
      fireEvent.click(within(picker).getByRole("button", { name: "Continue" }));
      fireEvent.click(screen.getByRole("button", { name: "Change" }));

      const again = screen.getByRole("dialog", { name: "Choose learners" });
      await within(again).findAllByRole("checkbox");
      expect(within(again).getAllByRole("checkbox", { checked: true })).toHaveLength(2);
      expect(within(again).getByText("2 learners chosen")).toBeTruthy();
    });

    it("a refusal for lack of seats stays in the pop-up as not applied, with the learners kept", async () => {
      mockAdd.mockResolvedValue({
        ok: false,
        message: "Only 1 seat is left in this cohort and 2 learners were chosen, so nobody was added. Remove 1 learner or raise the capacity, then try again.",
      });
      const picker = await openPicker();
      tick(picker, /Alan Turing/, 0);
      tick(picker, /Grace Hopper/);
      fireEvent.click(within(picker).getByRole("button", { name: "Continue" }));

      const dialog = screen.getByRole("dialog", { name: "Add 2 learners to this cohort?" });
      fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: "Partner organisation group booking" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Add 2 enrolments" }));

      expect(await within(dialog).findByText(/Only 1 seat is left/)).toBeTruthy();
      expect(within(dialog).getByText("Action not applied")).toBeTruthy();
      expect(within(within(dialog).getByRole("list", { name: "Learners to add" })).getAllByRole("listitem")).toHaveLength(2);
    });

    it("closing the list before ticking anyone abandons the add", async () => {
      const picker = await openPicker();
      fireEvent.click(within(picker).getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(mockAdd).not.toHaveBeenCalled();
    });
  });
});
