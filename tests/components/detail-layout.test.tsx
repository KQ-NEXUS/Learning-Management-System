import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import type {
  DetailLayoutProps,
  DetailSection,
} from "@/components/primitives";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function loadDetailLayout(): Promise<ComponentType<DetailLayoutProps>> {
  const primitives = await import("@/components/primitives");
  const component = (primitives as Record<string, unknown>).DetailLayout;

  expect(
    component,
    "the primitives module must export the planned DetailLayout",
  ).toBeTypeOf("function");

  return component as ComponentType<DetailLayoutProps>;
}

const SECTIONS: DetailSection[] = [
  { id: "overview", label: "Overview", content: <p>Overview body copy</p> },
  { id: "schedule", label: "Schedule", content: <p>Schedule body copy</p> },
  { id: "roster", label: "Roster", content: <p>Roster body copy</p> },
];

describe("DetailLayout", () => {
  it("ready: renders breadcrumbs, title, identifier, subtitle, badges and one panel per section", async () => {
    const DetailLayout = await loadDetailLayout();
    render(
      <DetailLayout
        breadcrumbs={[{ label: "Courses", href: "/staff/courses" }, { label: "Diagnostics" }]}
        title="Advanced Diagnostics"
        identifier="CRS-1001"
        subtitle="Finance Practice"
        badges={<span>Published</span>}
        sections={SECTIONS}
        mode="stacked"
      />,
    );

    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Advanced Diagnostics" })).toBeTruthy();
    expect(screen.getByText("CRS-1001")).toBeTruthy();
    expect(screen.getByText("Finance Practice")).toBeTruthy();
    expect(screen.getByText("Published")).toBeTruthy();
    expect(screen.getByText("Overview body copy")).toBeTruthy();
    expect(screen.getByText("Schedule body copy")).toBeTruthy();
    expect(screen.getByText("Roster body copy")).toBeTruthy();
  });

  it("loading: renders its own branch", async () => {
    const DetailLayout = await loadDetailLayout();
    const { container } = render(
      <DetailLayout
        title="Advanced Diagnostics"
        sections={SECTIONS}
        state={{ status: "loading" }}
      />,
    );
    expect(container.querySelector("[aria-busy]")).toBeTruthy();
    expect(screen.getByText(/Loading record/i)).toBeTruthy();
  });

  it("denied: renders its own branch", async () => {
    const DetailLayout = await loadDetailLayout();
    render(
      <DetailLayout
        title="Advanced Diagnostics"
        sections={SECTIONS}
        state={{ status: "denied", permission: "courses.view" }}
      />,
    );
    expect(screen.getByText(/You do not have access to this record/i)).toBeTruthy();
  });

  it("error: renders its own branch and exposes a Retry control", async () => {
    const DetailLayout = await loadDetailLayout();
    const onRetry = vi.fn();
    render(
      <DetailLayout
        title="Advanced Diagnostics"
        sections={SECTIONS}
        state={{ status: "error", message: "Load failed.", onRetry }}
      />,
    );
    expect(screen.getByText(/Could not load this record/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("a per-section error isolates the failing section: siblings still render their content", async () => {
    const DetailLayout = await loadDetailLayout();
    const sectionsWithError: DetailSection[] = [
      { id: "overview", label: "Overview", content: <p>Overview body copy</p> },
      {
        id: "schedule",
        label: "Schedule",
        content: <p>Schedule body copy</p>,
        error: { message: "Schedule failed to load." },
      },
      { id: "roster", label: "Roster", content: <p>Roster body copy</p> },
    ];

    render(
      <DetailLayout
        title="Advanced Diagnostics"
        sections={sectionsWithError}
        mode="stacked"
      />,
    );

    expect(screen.getByText("Schedule failed to load.")).toBeTruthy();
    expect(screen.getByText("Overview body copy")).toBeTruthy();
    expect(screen.getByText("Roster body copy")).toBeTruthy();
    // The failing section's own content must not also render.
    expect(screen.queryByText("Schedule body copy")).toBeNull();
  });

  it("tabbed mode: ArrowRight/ArrowLeft move the active tab, Home selects the first and End the last, exactly one tab carries tabIndex=0", async () => {
    const DetailLayout = await loadDetailLayout();
    render(
      <DetailLayout title="Advanced Diagnostics" sections={SECTIONS} mode="tabbed" />,
    );

    function tabIndexes() {
      return screen.getAllByRole("tab").map((tab) => tab.getAttribute("tabindex"));
    }

    expect(tabIndexes()).toEqual(["0", "-1", "-1"]);

    const firstTab = screen.getByRole("tab", { name: /Overview/ });
    fireEvent.keyDown(firstTab, { key: "ArrowRight" });
    expect(tabIndexes()).toEqual(["-1", "0", "-1"]);

    const secondTab = screen.getByRole("tab", { name: /Schedule/ });
    fireEvent.keyDown(secondTab, { key: "End" });
    expect(tabIndexes()).toEqual(["-1", "-1", "0"]);

    const thirdTab = screen.getByRole("tab", { name: /Roster/ });
    fireEvent.keyDown(thirdTab, { key: "Home" });
    expect(tabIndexes()).toEqual(["0", "-1", "-1"]);

    const firstTabAgain = screen.getByRole("tab", { name: /Overview/ });
    fireEvent.keyDown(firstTabAgain, { key: "ArrowLeft" });
    expect(tabIndexes()).toEqual(["-1", "-1", "0"]);
  });

  it("stacked mode: the same section config exposes every section simultaneously", async () => {
    const DetailLayout = await loadDetailLayout();
    render(
      <DetailLayout title="Advanced Diagnostics" sections={SECTIONS} mode="stacked" />,
    );

    expect(screen.getByText("Overview body copy")).toBeTruthy();
    expect(screen.getByText("Schedule body copy")).toBeTruthy();
    expect(screen.getByText("Roster body copy")).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });
});
