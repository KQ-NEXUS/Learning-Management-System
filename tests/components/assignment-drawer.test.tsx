import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { ScopeTarget } from "@/server/services/scope-lookup-service";
import { AssignmentDrawer } from "@/app/staff/users/AssignmentDrawer";
import { createAssignmentAction, searchScopeTargetsAction, searchStaffUsersAction } from "@/app/staff/users/actions";

vi.mock("@/app/staff/users/actions", () => ({ createAssignmentAction: vi.fn(), searchScopeTargetsAction: vi.fn(), searchStaffUsersAction: vi.fn() }));
const roles = [{ id: "teacher", name: "Teacher" }];
const user = { id: "u1", name: "Ada", email: "ada@example.test", status: "ACTIVE" };
beforeEach(() => { vi.mocked(searchScopeTargetsAction).mockResolvedValue([]); vi.mocked(searchStaffUsersAction).mockResolvedValue([]); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function Harness() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open assignment</button><AssignmentDrawer open={open} onClose={() => setOpen(false)} roles={roles} preselectedUser={user} /></>;
}
function openDrawer() {
  render(<Harness />);
  const opener = screen.getByText("Open assignment"); opener.focus(); fireEvent.click(opener);
  return opener;
}
it("traps both Tab directions, inerts only background and restores focus/inert on close", () => {
  const opener = openDrawer();
  const first = screen.getByRole("button", { name: "Close" });
  const last = screen.getByRole("button", { name: "Cancel" });
  expect(document.activeElement).toBe(first);
  expect(opener.hasAttribute("inert")).toBe(true);
  expect(screen.getByRole("dialog").closest("[inert]")).toBeNull();
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true }); expect(document.activeElement).toBe(last);
  fireEvent.keyDown(document, { key: "Tab" }); expect(document.activeElement).toBe(first);
  fireEvent.click(last); expect(document.activeElement).toBe(opener); expect(opener.hasAttribute("inert")).toBe(false);
});
it("suppresses pending dismissal and returns focus after successful save", async () => {
  let finish!: (value: { errors: []; success: boolean }) => void;
  vi.mocked(createAssignmentAction).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const opener = openDrawer();
  fireEvent.change(screen.getByLabelText("Role"), { target: { value: "teacher" } });
  fireEvent.submit(screen.getByRole("button", { name: "Assign role" }).closest("form")!);
  await waitFor(() => expect(createAssignmentAction).toHaveBeenCalled());
  fireEvent.keyDown(document, { key: "Escape" }); fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  await act(async () => finish({ errors: [], success: true }));
  expect(screen.queryByRole("dialog")).toBeNull(); expect(document.activeElement).toBe(opener);
});
it("shows returned authorization and field errors without losing selections", async () => {
  vi.mocked(createAssignmentAction).mockResolvedValue({ errors: [{ name: "form", message: "Permission denied" }, { name: "roleId", message: "Role unavailable" }], success: false });
  openDrawer(); fireEvent.change(screen.getByLabelText("Role"), { target: { value: "teacher" } });
  expect((screen.getByLabelText("Role") as HTMLSelectElement).value).toBe("teacher");
  fireEvent.submit(screen.getByRole("button", { name: "Assign role" }).closest("form")!);
  expect((await screen.findByRole("alert")).textContent).toContain("Permission denied");
  expect((screen.getByLabelText("Role") as HTMLSelectElement).value).toBe("teacher");
  expect(screen.getByText("Ada")).toBeTruthy();
  const errorId = screen.getByLabelText("Role").getAttribute("aria-describedby");
  expect(document.getElementById(errorId!)?.textContent).toContain("Role unavailable");
});
it("recovers rejected scope search through retry without stale choices", async () => {
  vi.mocked(searchScopeTargetsAction).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([{ id: "c1", label: "Current course", identifier: "current-course" }]);
  openDrawer(); fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "COURSE" } });
  expect((await screen.findByRole("alert")).textContent).toContain("Search failed");
  fireEvent.click(screen.getByRole("button", { name: "Retry scope search" }));
  expect(await screen.findByRole("option", { name: "Current course" })).toBeTruthy();
});
it("ignores late scope results after the scope changes", async () => {
  let finish!: (value: ScopeTarget[]) => void;
  vi.mocked(searchScopeTargetsAction).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce([{ id: "p1", label: "Current programme", identifier: "current-programme" }]);
  openDrawer(); fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "COURSE" } });
  fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "PROGRAMME" } });
  await screen.findByRole("option", { name: "Current programme" });
  await act(async () => finish([{ id: "old", label: "Stale course", identifier: "stale-course" }]));
  expect(screen.queryByText("Stale course")).toBeNull();
});
it("ignores superseded user responses and offers retry after rejection", async () => {
  let finish!: (value: typeof user[]) => void;
  vi.mocked(searchStaffUsersAction).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([{ ...user, name: "Current user" }]);
  render(<AssignmentDrawer open onClose={() => {}} roles={roles} />);
  const input = screen.getByPlaceholderText("Start typing a name or email");
  fireEvent.change(input, { target: { value: "old" } });
  await waitFor(() => expect(searchStaffUsersAction).toHaveBeenCalledTimes(1));
  fireEvent.change(input, { target: { value: "new" } });
  await screen.findByRole("button", { name: "Retry user search" });
  await act(async () => finish([{ ...user, name: "Stale user" }]));
  expect(screen.queryByText("Stale user")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry user search" }));
  expect(await screen.findByText("Current user")).toBeTruthy();
});
