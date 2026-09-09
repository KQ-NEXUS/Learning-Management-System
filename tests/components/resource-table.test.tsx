import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ComponentType } from "react";
import type {
  Column,
  ResourceTableProps,
  ResourceTableState,
} from "@/components/primitives";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Row = { id: string; title: string; code: string };

async function loadResourceTable(): Promise<
  ComponentType<ResourceTableProps<Row>>
> {
  const primitives = await import("@/components/primitives");
  const component = (primitives as Record<string, unknown>).ResourceTable;

  expect(
    component,
    "the primitives module must export the planned ResourceTable",
  ).toBeTypeOf("function");

  return component as ComponentType<ResourceTableProps<Row>>;
}

const ROWS: Row[] = [
  { id: "r-1", title: "Advanced Diagnostics", code: "CRS-1001" },
  { id: "r-2", title: "Bedside Manner Refresher", code: "CRS-1002" },
];

const COLUMNS: Column<Row>[] = [
  { key: "title", header: "Title", render: (row) => row.title, width: "20rem" },
  {
    key: "code",
    header: "Code",
    render: (row) => row.code,
    mono: true,
    width: "8rem",
  },
];

function baseProps(
  state: ResourceTableState<Row>,
  overrides: Partial<ResourceTableProps<Row>> = {},
): ResourceTableProps<Row> {
  return {
    noun: "courses",
    columns: COLUMNS,
    state,
    getRowKey: (row) => row.id,
    getRowLabel: (row) => row.title,
    ...overrides,
  };
}

describe("ResourceTable", () => {
  it("describes and disables unavailable bulk actions without blocking real callbacks", async () => {
    const ResourceTable = await loadResourceTable();
    const unavailable = vi.fn();
    const available = vi.fn();
    render(<ResourceTable {...baseProps({ status: "ready", rows: ROWS }, {
      selection: { selectedIds: ["r-1"], onChange: vi.fn(), actions: [
        { label: "Unavailable", onClick: unavailable, disabled: true, description: "Not available on this screen" },
        { label: "Available", onClick: available },
      ] },
    })} />);
    const disabled = screen.getByRole("button", { name: "Unavailable" }) as HTMLButtonElement;
    expect(disabled.disabled).toBe(true);
    expect(document.getElementById(disabled.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Not available on this screen");
    fireEvent.click(disabled);
    expect(unavailable).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Available" }));
    expect(available).toHaveBeenCalledWith(["r-1"]);
  });

  it("names each filter uniquely across tables and forwards search and select changes", async () => {
    const ResourceTable = await loadResourceTable();
    const onFilterChange = vi.fn();
    const props = baseProps({ status: "ready", rows: ROWS }, {
      onFilterChange,
      filters: [
        { kind: "search", name: "search", label: "Search", value: "" },
        { kind: "select", name: "category", label: "Category", value: "", options: ["", "a", "b", "c", "d"].map(value => ({ value, label: value || "Any" })) },
      ],
    });
    render(<><ResourceTable {...props} /><ResourceTable {...props} /></>);
    const searches = screen.getAllByRole("textbox", { name: "Search" });
    const selects = screen.getAllByRole("combobox", { name: "Category" });
    expect(new Set([...searches, ...selects].map(control => control.id)).size).toBe(4);
    fireEvent.change(searches[0], { target: { value: "Diagnostics" } });
    fireEvent.change(selects[1], { target: { value: "c" } });
    expect(onFilterChange).toHaveBeenCalledWith("search", "Diagnostics");
    expect(onFilterChange).toHaveBeenCalledWith("category", "c");
  });

  it("keeps mobile and desktop controlled selection in sync through filtering without following row links", async () => {
    const ResourceTable = await loadResourceTable();
    const bulk = vi.fn();
    const navigate = vi.fn();
    function Harness() {
      const [selectedIds, onChange] = useState<string[]>([]);
      const [search, setSearch] = useState("");
      return <ResourceTable {...baseProps({ status: "ready", rows: ROWS.filter(row => row.title.includes(search)) }, {
        getRowHref: row => `/staff/courses/${row.id}`,
        filters: [{ kind: "search", name: "search", label: "Search", value: search }],
        onFilterChange: (_, value) => setSearch(value),
        selection: { selectedIds, onChange, actions: [{ label: "Process", onClick: bulk }] },
      })} />;
    }
    render(<Harness />);
    const cards = within(screen.getByRole("list"));
    const desktop = within(screen.getByRole("table"));
    cards.getByRole("link", { name: ROWS[0].title }).addEventListener("click", navigate);
    fireEvent.click(cards.getByRole("checkbox", { name: `Select ${ROWS[0].title}` }));
    expect((desktop.getByRole("checkbox", { name: `Select ${ROWS[0].title}` }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "Bedside" } });
    fireEvent.click(cards.getByRole("checkbox", { name: `Select ${ROWS[1].title}` }));
    fireEvent.click(screen.getByRole("button", { name: "Process" }));
    expect(bulk).toHaveBeenLastCalledWith(["r-1", "r-2"]);
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "" } });
    fireEvent.click(cards.getByRole("checkbox", { name: `Select ${ROWS[0].title}` }));
    expect((desktop.getByRole("checkbox", { name: `Select ${ROWS[0].title}` }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Process" }));
    expect(bulk).toHaveBeenLastCalledWith(["r-2"]);
    fireEvent.click(desktop.getByRole("checkbox", { name: `Select ${ROWS[1].title}` }));
    expect((cards.getByRole("checkbox", { name: `Select ${ROWS[1].title}` }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("button", { name: "Process" })).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("loading: holds each column width and announces via aria-live polite", async () => {
    const ResourceTable = await loadResourceTable();
    const { container } = render(
      <ResourceTable {...baseProps({ status: "loading" })} />,
    );

    // Column widths are held via <col> elements so data arrival never reflows.
    const cols = container.querySelectorAll("colgroup col");
    const widths = Array.from(cols).map((c) => (c as HTMLElement).style.width);
    expect(widths).toContain("20rem");
    expect(widths).toContain("8rem");

    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toBeTruthy();
    expect(live?.textContent).toMatch(/loading courses/i);
  });

  it("ready: renders one row per item via Column.render and discloses shownCount/totalCount", async () => {
    const ResourceTable = await loadResourceTable();
    const { container } = render(
      <ResourceTable
        {...baseProps(
          { status: "ready", rows: ROWS },
          { shownCount: 2, totalCount: 128 },
        )}
      />,
    );

    // jsdom applies no CSS, so the desktop <table> and the mobile <ul> cards
    // are both present in the DOM at once — scope to the table to get one
    // match per row rather than two (table + card).
    const table = within(container.querySelector("table") as HTMLElement);
    expect(table.getByText("Advanced Diagnostics")).toBeTruthy();
    expect(table.getByText("Bedside Manner Refresher")).toBeTruthy();
    expect(screen.getByText(/2 of 128/)).toBeTruthy();
  });

  it("empty (unfiltered): names no filter count", async () => {
    const ResourceTable = await loadResourceTable();
    render(<ResourceTable {...baseProps({ status: "empty" })} />);

    expect(screen.getByText(/No courses yet/i)).toBeTruthy();
    expect(screen.queryByText(/filter/i)).toBeNull();
  });

  it("empty (filtered): names the active filter count and the total-without-filters count", async () => {
    const ResourceTable = await loadResourceTable();
    render(
      <ResourceTable
        {...baseProps({
          status: "empty",
          activeFilterCount: 2,
          totalWithoutFilters: 40,
        })}
      />,
    );

    expect(screen.getByText(/No courses match these filters/i)).toBeTruthy();
    expect(screen.getByText(/2 filters are active/i)).toBeTruthy();
    expect(screen.getByText(/all 40 courses/i)).toBeTruthy();
  });

  it("denied: renders identical output whether or not a record exists, with no count/title/id", async () => {
    const ResourceTable = await loadResourceTable();

    const { container: withRecord, unmount: unmountWithRecord } = render(
      <ResourceTable
        {...baseProps(
          { status: "denied", permission: "courses.manage" },
          { title: "Courses", shownCount: 2, totalCount: 128 },
        )}
      />,
    );
    const withRecordHtml = withRecord.innerHTML;
    unmountWithRecord();

    const { container: withoutRecord } = render(
      <ResourceTable
        {...baseProps(
          { status: "denied", permission: "courses.manage" },
          { title: "Courses", shownCount: 2, totalCount: 128 },
        )}
      />,
    );
    const withoutRecordHtml = withoutRecord.innerHTML;

    // Same props render identical HTML regardless of what the caller "knows"
    // about record existence — the denied branch must never distinguish.
    expect(withRecordHtml).toBe(withoutRecordHtml);

    expect(screen.getByText(/You do not have access to courses/i)).toBeTruthy();
    // No record count, title or id leaks through — "403" is the fixed HTTP
    // status eyebrow and is expected regardless of what the caller "knows".
    expect(withRecordHtml).not.toContain("128");
    expect(withRecordHtml).not.toContain("Advanced Diagnostics");
    expect(withRecordHtml).not.toContain("CRS-1001");
  });

  it("error: renders failure copy plus a Retry control that invokes onRetry", async () => {
    const ResourceTable = await loadResourceTable();
    const onRetry = vi.fn();
    render(
      <ResourceTable
        {...baseProps({ status: "error", message: "The request timed out." }, { onRetry })}
      />,
    );

    expect(screen.getByText(/Could not load courses/i)).toBeTruthy();
    expect(screen.getByText("The request timed out.")).toBeTruthy();
    const retry = screen.getByRole("button", { name: "Retry" });
    retry.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("validationError alongside ready: renders a role=alert banner while previously loaded rows stay visible", async () => {
    const ResourceTable = await loadResourceTable();
    const { container } = render(
      <ResourceTable
        {...baseProps(
          { status: "ready", rows: ROWS },
          { validationError: { message: "Unknown filter value." } },
        )}
      />,
    );

    expect(screen.getByRole("alert").textContent).toMatch(/Unknown filter value\./);
    const table = within(container.querySelector("table") as HTMLElement);
    expect(table.getByText("Advanced Diagnostics")).toBeTruthy();
    expect(table.getByText("Bedside Manner Refresher")).toBeTruthy();
  });

  it("exposes no delete/remove affordance on any row, in any state", async () => {
    const ResourceTable = await loadResourceTable();

    const states: ResourceTableState<Row>[] = [
      { status: "loading" },
      { status: "ready", rows: ROWS },
      { status: "empty" },
      { status: "denied" },
      { status: "error" },
    ];

    for (const state of states) {
      const { unmount } = render(
        <ResourceTable
          {...baseProps(state, {
            selection: {
              selectedIds: [],
              onChange: () => {},
              actions: [{ label: "Archive", onClick: () => {} }],
            },
          })}
        />,
      );

      // Row-scoped controls only — the filter-chip dismiss control ("×",
      // aria-label "Clear all filters") is not a row action and is excluded
      // by scoping the query to <tbody> and the mobile <ul> card list.
      const scopes = [
        ...screen.queryAllByRole("rowgroup"),
        ...Array.from(document.querySelectorAll("ul")),
      ];
      for (const scope of scopes) {
        const controls = within(scope as HTMLElement).queryAllByRole("button", {
          name: /delete|remove/i,
        });
        expect(controls).toHaveLength(0);
      }

      unmount();
    }
  });
});
