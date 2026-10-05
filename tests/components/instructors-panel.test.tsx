/**
 * Adding an instructor (owner request, 2026-10-04): a pop-up of staff to choose
 * from replaces the field that asked for a user id typed by hand.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  assign: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/staff/cohorts/[id]/instructor-actions", () => ({
  assignInstructorAction: mocks.assign,
  removeInstructorAction: mocks.remove,
  listInstructorCandidatesAction: mocks.list,
}));

import { InstructorsPanel } from "@/app/staff/cohorts/[id]/InstructorsPanel";

const STAFF = [
  { id: "u-ije", name: "Ije Instructor", email: "ije@example.test", roles: ["Instructor"], assigned: true },
  { id: "u-tunde-1", name: "Tunde Bakare", email: "tunde.bakare@example.test", roles: ["Instructor"], assigned: false },
  { id: "u-tunde-2", name: "Tunde Bakare", email: "t.bakare@example.test", roles: ["Programme Manager"], assigned: false },
];

const current = [{ id: "ci-1", userId: "u-ije", userName: "Ije Instructor", userEmail: "ije@example.test" }];
const panel = (canManage = true) => render(<InstructorsPanel cohortId="cohort-1" instructors={current} canManage={canManage} />);
const openPicker = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Add instructor" }));
  const dialog = screen.getByRole("dialog", { name: "Add instructor" });
  await within(dialog).findAllByRole("radio");
  return dialog;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({ ok: true, people: STAFF });
  mocks.assign.mockResolvedValue({ ok: true });
});

afterEach(cleanup);

describe("InstructorsPanel — adding an instructor", () => {
  it("offers a button, not a box to type a user id into", () => {
    panel();
    expect(screen.getByRole("button", { name: "Add instructor" })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/user id/i)).toBeNull();
  });

  it("lists staff with their email and role, so two people with the same name can be told apart", async () => {
    panel();
    const dialog = await openPicker();

    expect(mocks.list).toHaveBeenCalledWith({ cohortId: "cohort-1", query: "" });
    const rows = within(dialog).getAllByRole("radio").map((row) => row.textContent);
    expect(rows[1]).toContain("tunde.bakare@example.test");
    expect(rows[1]).toContain("Instructor");
    expect(rows[2]).toContain("t.bakare@example.test");
    expect(rows[2]).toContain("Programme Manager");
  });

  it("someone already an instructor is shown but cannot be chosen", async () => {
    panel();
    const dialog = await openPicker();

    const ije = within(dialog).getByRole("radio", { name: /Ije Instructor/ }) as HTMLButtonElement;
    expect(ije.disabled).toBe(true);
    expect(ije.textContent).toContain("Already an instructor");
  });

  it("adds the chosen person by their id, confirms it, and closes", async () => {
    panel();
    const dialog = await openPicker();
    const confirm = within(dialog).getByRole("button", { name: "Add instructor" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.click(within(dialog).getByRole("radio", { name: /t\.bakare@example\.test/ }));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith({ cohortId: "cohort-1", userId: "u-tunde-2" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("searching asks the server for matching staff", async () => {
    panel();
    const dialog = await openPicker();
    mocks.list.mockResolvedValue({ ok: true, people: [STAFF[1]] });

    fireEvent.change(within(dialog).getByLabelText("Search by name or email"), { target: { value: "tunde.b" } });

    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith({ cohortId: "cohort-1", query: "tunde.b" }));
    await waitFor(() => expect(within(dialog).getAllByRole("radio")).toHaveLength(1));
  });

  it("a refused add keeps the pop-up open with the reason", async () => {
    mocks.assign.mockResolvedValue({ ok: false, message: "Your role does not permit managing instructors for this cohort." });
    panel();
    const dialog = await openPicker();
    fireEvent.click(within(dialog).getByRole("radio", { name: /tunde\.bakare@example\.test/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add instructor" }));

    expect((await within(dialog).findByRole("alert")).textContent).toContain("does not permit");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("a list that cannot be loaded says so", async () => {
    mocks.list.mockResolvedValue({ ok: false, message: "Your role does not permit managing instructors for this cohort." });
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Add instructor" }));

    expect((await screen.findByRole("alert")).textContent).toContain("does not permit");
  });

  it("without permission to manage, there is no Add instructor button", () => {
    panel(false);
    expect(screen.queryByRole("button", { name: "Add instructor" })).toBeNull();
  });
});
