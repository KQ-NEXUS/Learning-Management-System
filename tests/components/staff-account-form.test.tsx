import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StaffAccountForm } from "@/app/staff/users/StaffAccountForm";
import { searchScopeTargetsAction } from "@/app/staff/users/actions";
import type { ScopeTarget } from "@/server/services/scope-lookup-service";
vi.mock("@/app/staff/users/actions", () => ({ createStaffAccountAction: vi.fn(), searchScopeTargetsAction: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("explains scope failure and retries successfully", async () => {
  vi.mocked(searchScopeTargetsAction).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([{ id: "c1", label: "Recovered course", identifier: "recovered-course" }]);
  render(<StaffAccountForm roles={[]} />);
  fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "COURSE" } });
  expect((await screen.findByRole("alert")).textContent).toContain("Search failed");
  fireEvent.click(screen.getByRole("button", { name: "Retry scope search" }));
  expect(await screen.findByRole("option", { name: "Recovered course" })).toBeTruthy();
});
it("does not expose superseded query choices", async () => {
  let finish!: (value: ScopeTarget[]) => void;
  vi.mocked(searchScopeTargetsAction).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce([{ id: "new", label: "New target", identifier: "new-target" }]);
  render(<StaffAccountForm roles={[]} />);
  fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "COURSE" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Search scope targets" }), { target: { value: "new" } });
  await screen.findByRole("option", { name: "New target" });
  await act(async () => finish([{ id: "old", label: "Old target", identifier: "old-target" }]));
  expect(screen.queryByText("Old target")).toBeNull();
});
