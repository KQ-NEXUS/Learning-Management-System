import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CoursesTable, type CourseRow } from "@/app/staff/courses/CoursesTable";

afterEach(cleanup);

const rows: CourseRow[] = [
  { id: "c1", title: "Diagnostics", slug: "diagnostics", summary: null, status: "DRAFT", durationHours: 3, certificateEnabled: false },
  { id: "c2", title: "Bedside", slug: "bedside", summary: null, status: "PUBLISHED", durationHours: 1, certificateEnabled: true },
];

describe("CoursesTable", () => {
  it("links to the course create screen while keeping unfinished bulk/export affordances disabled", () => {
    render(<CoursesTable rows={rows} />);
    const cards = within(screen.getByRole("list"));
    fireEvent.click(cards.getByRole("checkbox", { name: "Select diagnostics" }));
    for (const name of ["Publish", "Archive…", "Export CSV"]) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      const description = document.getElementById(button.getAttribute("aria-describedby") ?? "");
      expect(description?.textContent).toBe("Not available on this screen");
      expect(description?.closest('[hidden], [aria-hidden="true"], .sr-only')).toBeNull();
      fireEvent.click(button);
    }
    expect(screen.getByRole("link", { name: "New course" }).getAttribute("href")).toBe("/staff/courses/new");
    expect(cards.getByRole("link", { name: "Diagnostics" }).getAttribute("href")).toBe("/staff/courses/c1");
    expect((cards.getByRole("checkbox", { name: "Select diagnostics" }) as HTMLInputElement).checked).toBe(true);
  });

  it("retains named search, segmented status filtering and sortable rows", () => {
    render(<CoursesTable rows={rows} />);
    const table = within(screen.getByRole("table"));
    fireEvent.click(table.getByRole("button", { name: "Title" }));
    expect(table.getAllByRole("link")[0].textContent).toBe("Diagnostics");
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "diagnostics" } });
    expect(table.queryByRole("link", { name: "Bedside" })).toBeNull();
    fireEvent.click(within(screen.getByRole("group", { name: "Status" })).getByRole("button", { name: "Published" }));
    expect(screen.getByText("No courses match these filters")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("keeps denied output independent of records and excludes actions and selection", () => {
    const { container, rerender } = render(<CoursesTable rows={rows} denied={{ permission: "courses.manage" }} />);
    const denied = container.innerHTML;
    rerender(<CoursesTable rows={[]} denied={{ permission: "courses.manage" }} />);
    expect(container.innerHTML).toBe(denied);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "New course" })).toBeNull();
  });
});
