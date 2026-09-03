import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  ReadinessPanel,
  ReadinessSummary,
} from "@/components/catalogue/ReadinessPanel";
import type { ReadinessItem } from "@/server/services/readiness-service";

afterEach(cleanup);

const item = (over: Partial<ReadinessItem> & Pick<ReadinessItem, "id">): ReadinessItem => ({
  category: "Content",
  label: "An item",
  state: "PASS",
  blocking: false,
  ...over,
});

/** One item in every state, plus a deferred one, plus a blocking failure. */
const allStates = (): ReadinessItem[] => [
  item({ id: "title", category: "Content", label: "Title", state: "PASS" }),
  item({
    id: "summary",
    category: "Content",
    label: "Summary",
    state: "FAIL",
    blocking: true,
    detail: "Add a course summary before listing.",
  }),
  item({
    id: "outcomes",
    category: "Content",
    label: "Learning outcomes",
    state: "WARN",
    detail: "Recommended before publishing.",
  }),
  item({
    id: "schedule",
    category: "Schedule",
    label: "Schedule set",
    state: "NOT_YET_CHECKED",
    deferredTo: "Phase 5",
  }),
];

describe("ReadinessPanel", () => {
  it("renders a distinct data-state for each of the four readiness states", () => {
    const { container } = render(<ReadinessPanel items={allStates()} />);
    const states = new Set(
      [...container.querySelectorAll("[data-state]")].map((el) => el.getAttribute("data-state")),
    );
    expect(states).toEqual(new Set(["PASS", "FAIL", "WARN", "NOT_YET_CHECKED"]));
  });

  it("renders a NOT_YET_CHECKED item with its Phase 5 deferral text and no tick or cross", () => {
    render(<ReadinessPanel items={allStates()} />);
    const row = screen.getByTestId("readiness-item-schedule");
    expect(row.getAttribute("data-state")).toBe("NOT_YET_CHECKED");
    expect(within(row).getByText(/Phase 5/)).toBeTruthy();
    expect(within(row).queryByText("✓")).toBeNull();
    expect(within(row).queryByText("✗")).toBeNull();
  });

  it("shows every PXR category heading in the fixed order, even when a category is empty", () => {
    render(<ReadinessPanel items={[item({ id: "title", label: "Title", state: "PASS" })]} />);
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "Content",
      "Schedule",
      "Price",
      "Capacity",
      "Instructors",
      "Completion",
    ]);
  });

  it("keeps every category heading present when all items are NOT_YET_CHECKED", () => {
    const deferred: ReadinessItem[] = (
      ["Schedule", "Price", "Capacity", "Instructors"] as const
    ).map((category) =>
      item({ id: category.toLowerCase(), category, label: `${category} check`, state: "NOT_YET_CHECKED", deferredTo: "Phase 5" }),
    );
    render(<ReadinessPanel items={deferred} />);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(6);
  });

  it("names a blocking failure as blocking in its accessible text", () => {
    render(<ReadinessPanel items={allStates()} />);
    const row = screen.getByTestId("readiness-item-summary");
    expect(row.textContent).toMatch(/blocks public listing/i);
  });

  it("does not mark a non-blocking failure as blocking", () => {
    render(
      <ReadinessPanel
        items={[item({ id: "x", label: "Advisory check", state: "FAIL", blocking: false })]}
      />,
    );
    expect(screen.getByTestId("readiness-item-x").textContent).not.toMatch(/blocks public listing/i);
  });

  it("conveys each state with text, not colour alone", () => {
    render(<ReadinessPanel items={allStates()} />);
    expect(screen.getByTestId("readiness-item-title").textContent).toMatch(/ready/i);
    expect(screen.getByTestId("readiness-item-summary").textContent).toMatch(/not ready|blocking/i);
    expect(screen.getByTestId("readiness-item-outcomes").textContent).toMatch(/warning/i);
    expect(screen.getByTestId("readiness-item-schedule").textContent).toMatch(/not yet checked/i);
  });

  it("exposes the panel as a section with an accessible name", () => {
    render(<ReadinessPanel items={allStates()} />);
    expect(screen.getByRole("region", { name: /readiness/i })).toBeTruthy();
  });

  it("summarises the counts in one line", () => {
    const items: ReadinessItem[] = [
      ...allStates(),
      item({ id: "modules", category: "Content", label: "Modules", state: "FAIL", blocking: true }),
      item({ id: "cap", category: "Capacity", label: "Capacity", state: "NOT_YET_CHECKED", deferredTo: "Phase 5" }),
      item({ id: "price", category: "Price", label: "Price", state: "NOT_YET_CHECKED", deferredTo: "Phase 5" }),
    ];
    render(<ReadinessSummary items={items} />);
    expect(screen.getByText(/2 blocking, 1 warning, 3 not yet checked/i)).toBeTruthy();
  });
});
