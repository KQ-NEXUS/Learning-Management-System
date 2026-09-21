import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CoursesTable, type CourseRow } from "@/app/staff/courses/CoursesTable";

afterEach(cleanup);

const rows: CourseRow[] = [
  { id: "c1", title: "Diagnostics", slug: "diagnostics", summary: null, status: "DRAFT", durationHours: 3, certificateEnabled: false },
  { id: "c2", title: "Bedside", slug: "bedside", summary: null, status: "PUBLISHED", durationHours: 1, certificateEnabled: true },
];

describe("CoursesTable", () => {
  it("links to the course create screen and offers no unfinished bulk or export controls", () => {
    render(<CoursesTable rows={rows} />);
    const cards = within(screen.getByRole("list"));
    expect(screen.getByRole("link", { name: "New course" }).getAttribute("href")).toBe("/staff/courses/new");
    expect(cards.getByRole("link", { name: "Diagnostics" }).getAttribute("href")).toBe("/staff/courses/c1");
    // Unfinished affordances are not rendered at all (they used to show as permanently disabled).
    expect(screen.queryByRole("checkbox")).toBeNull();
    for (const name of ["Publish", "Archive…", "Export CSV"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("hides the create button for staff who cannot create courses", () => {
    render(<CoursesTable rows={rows} canCreate={false} />);
    expect(screen.queryByRole("link", { name: "New course" })).toBeNull();
    expect(screen.getByRole("table")).toBeTruthy();
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
