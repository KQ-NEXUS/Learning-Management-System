import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import StaffNotFound from "@/app/staff/not-found";
import { SessionEnded } from "@/components/shell/SessionEnded";

afterEach(cleanup);

describe("UX batch B — staff dead ends", () => {
  it("the staff 404 stays in the console and leads back to Overview, naming no record", () => {
    render(<StaffNotFound />);
    expect(screen.getByRole("heading", { name: "We can't find that page" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to Overview" }).getAttribute("href")).toBe("/staff");
    expect(document.body.textContent).not.toMatch(/catalogue|course or programme/i);
  });

  it("a session that ended offers a way back to sign in", () => {
    render(<SessionEnded />);
    expect(screen.getByRole("alert").textContent).toMatch(/session has ended/i);
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/signin");
  });
});
