import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupportWorkspace } from "@/app/staff/support/SupportWorkspace";
import type { QueueView } from "@/server/services/ticket-staff-queue-service";

const push = vi.fn();
const refresh = vi.fn();
let currentSearchParams = new URLSearchParams("");

vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/staff/support", useSearchParams: () => currentSearchParams, useRouter: () => ({ push, refresh }) }));
vi.mock("@/server/services/ticket-staff-queue-service", () => ({}));

afterEach(() => { cleanup(); vi.clearAllMocks(); currentSearchParams = new URLSearchParams(""); });

function makeView(overrides: Partial<QueueView> = {}): QueueView {
  return {
    params: { tab: "my-work", q: "", category: "", priority: "", queue: "", owner: "", page: 1 },
    rows: [{
      id: "t1", reference: "TKT-ABC123", subject: "Cannot access course", learnerName: "Ada Learner", learnerEmail: "ada@example.test",
      category: "COURSE_CONTENT", priority: "URGENT", status: "ASSIGNED", queue: "LEARNING_ASSESSMENT", assigneeId: "s1", assigneeName: "Sam Agent",
      updatedAt: new Date("2026-09-24T10:00:00.000Z"), resolvedAt: null,
    }],
    total: 1, pageCount: 1,
    tabCounts: { "my-work": 1, unassigned: 2, open: 5, escalated: 1, resolved: 3 },
    health: { open: 5, unassigned: 2, urgent: 1, escalated: 1 },
    hasAnyTickets: true,
    asOf: new Date("2026-09-25T12:00:00.000Z"),
    ...overrides,
  };
}

describe("SupportWorkspace queue", () => {
  it("shows five counted tabs with My work selected and deep-link hrefs", () => {
    render(<SupportWorkspace view={makeView()} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["My work(1)", "Unassigned(2)", "All open(5)", "Escalated(1)", "Recently resolved(3)"]);
    expect(screen.getByRole("tab", { name: /My work/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /Escalated/ }).getAttribute("href")).toBe("/staff/support?tab=escalated");
  });

  it("moves between tabs with arrow keys", () => {
    render(<SupportWorkspace view={makeView()} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: /My work/ }), { key: "ArrowRight" });
    expect(push).toHaveBeenCalledWith("/staff/support?tab=unassigned");
  });

  it("health strip entries are filter links", () => {
    render(<SupportWorkspace view={makeView()} />);
    const strip = screen.getByRole("list", { name: "Queue health" });
    expect(within(strip).getByRole("link", { name: /Urgent/ }).getAttribute("href")).toBe("/staff/support?tab=open&priority=URGENT");
  });

  it("round-trips filters through the URL and resets the page", () => {
    currentSearchParams = new URLSearchParams("tab=open&page=3");
    render(<SupportWorkspace view={makeView({ params: { tab: "open", q: "", category: "", priority: "", queue: "", owner: "", page: 3 } })} />);
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "HIGH" } });
    expect(push).toHaveBeenCalledWith("/staff/support?tab=open&priority=HIGH");
  });

  it("offers exactly the five queue names as a filter", () => {
    render(<SupportWorkspace view={makeView()} />);
    const options = within(screen.getByLabelText("Queue")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["All queues", "General Support", "Accounts", "Finance", "Learning & Assessment", "Technical"]);
  });

  it("renders a mobile card projection with priority, status, owner, queue, learner and activity", () => {
    render(<SupportWorkspace view={makeView()} />);
    const cards = within(screen.getByRole("list", { name: "Tickets" }));
    expect(cards.getByText("Urgent")).toBeTruthy();
    expect(cards.getByText("Assigned")).toBeTruthy();
    expect(cards.getByText(/Owner: Sam Agent/)).toBeTruthy();
    expect(cards.getByText(/Learning & Assessment/)).toBeTruthy();
    expect(cards.getByText(/Ada Learner/)).toBeTruthy();
    expect(cards.getByText(/UTC/)).toBeTruthy();
  });

  it("has no row checkbox or bulk action", () => {
    const { container } = render(<SupportWorkspace view={makeView()} />);
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(screen.queryByText(/bulk/i)).toBeNull();
  });

  it("distinguishes tab empty, filtered empty, denied and error states", () => {
    const empty = makeView({ rows: [], total: 0 });
    const { rerender } = render(<SupportWorkspace view={empty} />);
    expect(screen.getByText("No tickets assigned to you.")).toBeTruthy();

    rerender(<SupportWorkspace view={makeView({ rows: [], total: 0, params: { ...empty.params, priority: "HIGH" } })} />);
    expect(screen.getByText("No tickets match these filters.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Clear filters" })).toBeTruthy();

    rerender(<SupportWorkspace denied />);
    expect(screen.getByText("You do not have access to Support")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();

    rerender(<SupportWorkspace error />);
    expect(screen.getByRole("alert").textContent).toContain("We couldn’t load the support queue.");
  });
});
