/**
 * The attendance-marking screen's four load-bearing interaction contracts
 * (ATT-01, ATT-03, D-09):
 *
 *   1. Before a session starts, the live states (present/absent/late) are
 *      disabled with the D-09 hint; excused/not-recorded stay selectable.
 *   2. Changing several learners then saving commits ONCE, with exactly the
 *      changed entries — never the whole roster.
 *   3. Once the marking window has closed, a single change opens the
 *      mandatory-reason correction modal, gated on the minimum length.
 *   4. Every state control renders a text label alongside its glyph — never
 *      colour alone (NFR-09).
 *
 * `attendance-actions.ts` is a real Server Actions file ("use server"); it
 * imports `next/cache`'s `revalidatePath`, which has no meaning outside a
 * Next.js request. It is mocked here rather than exercised for real — the
 * same reason the actions module itself is thin and delegates everything to
 * `attendance-service.ts`, which already has its own unit/integration tests.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("@/app/staff/cohorts/[id]/attendance-actions", () => ({
  saveAttendanceAction: vi.fn(),
  correctAttendanceAction: vi.fn(),
}));

import {
  saveAttendanceAction,
  correctAttendanceAction,
} from "@/app/staff/cohorts/[id]/attendance-actions";
import {
  AttendanceMarkClient,
  type RegisterRow,
} from "@/app/staff/cohorts/[id]/sessions/[sessionId]/attendance/AttendanceMarkClient";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const roster = (): RegisterRow[] => [
  {
    enrolmentId: "e1",
    learnerName: "Ada Lovelace",
    learnerEmail: "ada@example.com",
    state: "NOT_RECORDED",
    note: null,
    isCorrection: false,
  },
  {
    enrolmentId: "e2",
    learnerName: "Grace Hopper",
    learnerEmail: "grace@example.com",
    state: "NOT_RECORDED",
    note: null,
    isCorrection: false,
  },
  {
    enrolmentId: "e3",
    learnerName: "Alan Turing",
    learnerEmail: "alan@example.com",
    state: "NOT_RECORDED",
    note: null,
    isCorrection: false,
  },
];

const FUTURE_WINDOW = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
const PAST_WINDOW = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();

describe("AttendanceMarkClient", () => {
  it("disables present/absent/late before the session starts, with the D-09 hint, leaving excused/not-recorded selectable", () => {
    render(
      <AttendanceMarkClient
        cohortId="c1"
        sessionId="s1"
        sessionTitle="Kickoff"
        startsAtLabel="2026-03-01 09:00 (Africa/Lagos)"
        endsAtLabel="2026-03-01 10:00 (Africa/Lagos)"
        windowClosesAt={FUTURE_WINDOW}
        canSetLiveStates={false}
        roster={roster()}
      />,
    );

    expect(
      screen.getByText(
        "You can only mark excused or not-recorded before the session starts. " +
          "Present, absent and late need the session to have begun.",
      ),
    ).toBeTruthy();

    const present = screen.getAllByRole("radio", { name: /Present/ }) as HTMLInputElement[];
    const absent = screen.getAllByRole("radio", { name: /Absent/ }) as HTMLInputElement[];
    const late = screen.getAllByRole("radio", { name: /Late/ }) as HTMLInputElement[];
    const excused = screen.getAllByRole("radio", { name: /Excused/ }) as HTMLInputElement[];
    const notRecorded = screen.getAllByRole("radio", { name: /Not recorded/ }) as HTMLInputElement[];

    for (const radio of [...present, ...absent, ...late]) {
      expect(radio.disabled).toBe(true);
    }
    for (const radio of [...excused, ...notRecorded]) {
      expect(radio.disabled).toBe(false);
    }
  });

  it("saves exactly the changed entries in a single bulk commit, never the whole roster", () => {
    const mockSave = saveAttendanceAction as unknown as ReturnType<typeof vi.fn>;
    mockSave.mockResolvedValue({ ok: true });

    render(
      <AttendanceMarkClient
        cohortId="c1"
        sessionId="s1"
        sessionTitle="Kickoff"
        startsAtLabel={null}
        endsAtLabel={null}
        windowClosesAt={FUTURE_WINDOW}
        canSetLiveStates={true}
        roster={roster()}
      />,
    );

    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Attendance for Ada Lovelace" })).getByRole(
        "radio",
        { name: /Present/ },
      ),
    );
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Attendance for Grace Hopper" })).getByRole(
        "radio",
        { name: /Absent/ },
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Save attendance" }));

    expect(mockSave).toHaveBeenCalledTimes(1);
    const call = mockSave.mock.calls[0][0];
    expect(call.sessionId).toBe("s1");
    expect(call.entries).toEqual([
      { enrolmentId: "e1", state: "PRESENT", note: undefined },
      { enrolmentId: "e2", state: "ABSENT", note: undefined },
    ]);
  });

  it("routes a post-window change through the mandatory-reason correction modal", () => {
    render(
      <AttendanceMarkClient
        cohortId="c1"
        sessionId="s1"
        sessionTitle="Kickoff"
        startsAtLabel={null}
        endsAtLabel={null}
        windowClosesAt={PAST_WINDOW}
        canSetLiveStates={true}
        roster={roster()}
      />,
    );

    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Attendance for Ada Lovelace" })).getByRole(
        "radio",
        { name: /Present/ },
      ),
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Save correction" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: "Marked present after reviewing the sign-in sheet" },
    });
    expect(confirm.disabled).toBe(false);

    expect(correctAttendanceAction).not.toHaveBeenCalled();
  });

  it("renders every state as text alongside its glyph — never colour alone", () => {
    render(
      <AttendanceMarkClient
        cohortId="c1"
        sessionId="s1"
        sessionTitle="Kickoff"
        startsAtLabel={null}
        endsAtLabel={null}
        windowClosesAt={FUTURE_WINDOW}
        canSetLiveStates={true}
        roster={roster()}
      />,
    );

    const adaGroup = screen.getByRole("radiogroup", { name: "Attendance for Ada Lovelace" });
    for (const label of ["Present", "Absent", "Late", "Excused", "Not recorded"]) {
      expect(within(adaGroup).getByText(label)).toBeTruthy();
    }
    for (const glyph of ["✓", "✗", "!", "•", "—"]) {
      expect(within(adaGroup).getByText(glyph)).toBeTruthy();
    }
  });
});
