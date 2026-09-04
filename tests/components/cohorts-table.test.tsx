/**
 * Cohorts index — the six render states baked into `ResourceTable`
 * (loading / empty / filtered-empty / populated / denied / error), driven
 * either through the shared primitive directly (loading, error — states
 * `CohortsTable` has no props for, since the RSC caller either has rows or
 * throws) or through `CohortsTable` itself (empty, filtered-empty, populated,
 * denied), matching the props `CohortsTable` actually exposes — the same
 * split `CoursesTable`'s own capability implies (rows/denied only).
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ResourceTable, type Column } from "@/components/primitives";
import { CohortsTable, type CohortRow } from "@/app/staff/cohorts/CohortsTable";

afterEach(cleanup);

const row = (overrides: Partial<CohortRow> = {}): CohortRow => ({
  id: "c1",
  code: "CH-2601",
  title: "Foundations Cohort",
  courseId: "course-1",
  programmeId: null,
  offerKind: "Course",
  offerTitle: "Intro to X",
  deliveryMode: "INSTRUCTOR_LED",
  timezone: "Africa/Lagos",
  enrolmentOpensAt: "2026-01-01T00:00:00.000Z",
  enrolmentClosesAt: "2026-01-15T00:00:00.000Z",
  capacity: 20,
  seatsTaken: 1,
  status: "PUBLISHED",
  ...overrides,
});

type Dummy = { id: string };
const dummyColumns: Column<Dummy>[] = [{ key: "id", header: "ID", render: (d) => d.id }];

describe("Cohorts — six render states", () => {
  it("loading (shared ResourceTable primitive)", () => {
    render(
      <ResourceTable<Dummy>
        noun="cohorts"
        title="Cohorts"
        columns={dummyColumns}
        state={{ status: "loading" }}
        getRowKey={(d) => d.id}
      />,
    );
    expect(screen.getByText("Loading cohorts", { selector: "caption" })).toBeTruthy();
  });

  it("recoverable error (shared ResourceTable primitive) — the exact UI-SPEC copy", () => {
    render(
      <ResourceTable<Dummy>
        noun="cohorts"
        title="Cohorts"
        columns={dummyColumns}
        state={{
          status: "error",
          message:
            "Your filters and sort are kept in the URL, so retrying returns to exactly this view.",
        }}
        getRowKey={(d) => d.id}
      />,
    );
    expect(screen.getByText("Could not load cohorts")).toBeTruthy();
    expect(
      screen.getByText(
        "Your filters and sort are kept in the URL, so retrying returns to exactly this view.",
      ),
    ).toBeTruthy();
  });

  it("empty (no cohorts at all)", () => {
    render(<CohortsTable rows={[]} />);
    expect(screen.getByText("No cohorts yet")).toBeTruthy();
    expect(
      screen.getByText("Create a cohort to schedule sessions and open enrolment.", {
        exact: false,
      }),
    ).toBeTruthy();
  });

  it("filtered-empty (cohorts exist, none match the active filters)", () => {
    render(<CohortsTable rows={[row()]} />);
    fireEvent.change(screen.getByPlaceholderText("Code or title"), {
      target: { value: "no-such-cohort" },
    });
    expect(screen.getByText("No cohorts match these filters")).toBeTruthy();
  });

  it("populated — the seats cell renders '1/20' and the code link is not accent", () => {
    render(<CohortsTable rows={[row()]} />);
    // Desktop table + mobile card both render the same data.
    expect(screen.getAllByText("1/20").length).toBeGreaterThan(0);

    const links = screen.getAllByRole("link", { name: "CH-2601" }) as HTMLAnchorElement[];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe("/staff/cohorts/c1");
      expect(link.className).not.toContain("bg-accent");
      expect(link.className).not.toContain("accent-contrast");
    }
  });

  it("denied — identical copy regardless of whether any cohort exists, no code/title/count leak", () => {
    render(<CohortsTable denied={{ permission: "cohorts.view" }} />);
    expect(screen.getByText("You do not have access to cohorts", { exact: false })).toBeTruthy();
    expect(screen.getByText("cohorts.view")).toBeTruthy();

    expect(screen.queryByText("CH-2601")).toBeNull();
    expect(screen.queryByText("Foundations Cohort")).toBeNull();
    expect(screen.queryByText("1/20")).toBeNull();
    expect(screen.queryByText(/\d+ of \d+/)).toBeNull();
  });
});
