import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupportWorkspace } from "@/app/staff/support/SupportWorkspace";
import { StaffTicketDetail } from "@/app/staff/support/[reference]/StaffTicketDetail";
import type { QueueView, StaffTicketWorkspace } from "@/server/services/ticket-staff-queue-service";

const push = vi.fn();
const refresh = vi.fn();
let currentSearchParams = new URLSearchParams("");

vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/staff/support", useSearchParams: () => currentSearchParams, useRouter: () => ({ push, refresh }) }));
vi.mock("@/server/services/ticket-staff-queue-service", () => ({}));
const replyAction = vi.fn();
const noteAction = vi.fn();
vi.mock("@/app/staff/support/[reference]/actions", () => ({
  sendPublicReplyAction: (...args: unknown[]) => replyAction(...args),
  addInternalNoteAction: (...args: unknown[]) => noteAction(...args),
}));
vi.mock("@/components/support/upload-ticket-attachment", () => ({ uploadTicketAttachment: vi.fn().mockResolvedValue({ ok: true }) }));

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

const T = (iso: string) => new Date(iso);
function makeWorkspace(overrides: Record<string, unknown> = {}): StaffTicketWorkspace {
  const base = {
    id: "t1", reference: "TKT-ABC123", subject: "Cannot access course", category: "COURSE_CONTENT", priority: "NORMAL",
    status: "ASSIGNED", queue: "GENERAL_SUPPORT", version: 4, assigneeId: "s1",
    context: { kind: "COURSE", safeReference: "CRS-9F2A", href: null, locked: true },
    createdAt: T("2026-09-20T09:00:00.000Z"), updatedAt: T("2026-09-24T10:00:00.000Z"),
    firstRespondedAt: null, resolvedAt: null, closedAt: null,
    learner: { id: "u1", name: "Ada Learner", email: "ada@example.test" },
    names: { u1: "Ada Learner", s1: "Sam Agent", s2: "Kim Agent" },
    timeline: [
      { kind: "MESSAGE", id: "m1", createdAt: T("2026-09-20T09:00:00.000Z"), message: { id: "m1", ticketId: "t1", authorId: "u1", kind: "INITIAL", visibility: "PUBLIC", body: "I cannot open my course", createdAt: T("2026-09-20T09:00:00.000Z"), attachments: [] } },
      { kind: "EVENT", id: "e1", createdAt: T("2026-09-20T09:05:00.000Z"), event: { id: "e1", ticketId: "t1", actorId: "s1", actorType: "USER", type: "CLAIMED", reason: null, statusBefore: "NEW", statusAfter: "ASSIGNED", priorityBefore: null, priorityAfter: null, queueBefore: null, queueAfter: null, assigneeBeforeId: null, assigneeAfterId: "s1", createdAt: T("2026-09-20T09:05:00.000Z") } },
      { kind: "MESSAGE", id: "m2", createdAt: T("2026-09-20T09:10:00.000Z"), message: { id: "m2", ticketId: "t1", authorId: "s1", kind: "INTERNAL_NOTE", visibility: "INTERNAL", body: "Learner enrolled late", createdAt: T("2026-09-20T09:10:00.000Z"), attachments: [] } },
      { kind: "MESSAGE", id: "m3", createdAt: T("2026-09-20T09:20:00.000Z"), message: { id: "m3", ticketId: "t1", authorId: "s1", kind: "REPLY", visibility: "PUBLIC", body: "Looking into it", createdAt: T("2026-09-20T09:20:00.000Z"), attachments: [{ id: "a1", filename: "very-long-filename-that-should-wrap-safely.pdf", mimeType: "application/pdf", sizeBytes: 2048, uploadStatus: "READY", uploadedAt: T("2026-09-20T09:20:00.000Z") }] } },
    ],
  };
  return { ...base, ...overrides } as unknown as StaffTicketWorkspace;
}

describe("StaffTicketDetail timeline", () => {
  it("renders public, internal and event entries in order with absolute times", () => {
    render(<StaffTicketDetail workspace={makeWorkspace()} canManage />);
    const list = screen.getByRole("list", { name: "Ticket chronology" });
    const items = Array.from(list.children);
    expect(items).toHaveLength(4);
    expect(items[0].textContent).toContain("I cannot open my course");
    expect(items[1].textContent).toContain("Sam Agent assigned the ticket to themselves");
    expect(items[2].textContent).toContain("Learner enrolled late");
    expect(items[3].textContent).toContain("Looking into it");
    expect(list.querySelectorAll("time[datetime]").length).toBe(4);
    expect(items[0].textContent).toContain("UTC");
  });

  it("marks internal notes Staff only and offers no edit or delete on any entry", () => {
    render(<StaffTicketDetail workspace={makeWorkspace()} canManage />);
    const list = screen.getByRole("list", { name: "Ticket chronology" });
    const note = within(list).getByText("Learner enrolled late").closest("li")!;
    expect(within(note).getByText("Staff only")).toBeTruthy();
    expect(note.className).toContain("bg-warning-surface");
    expect(within(list).queryByRole("button", { name: /edit|delete|remove/i })).toBeNull();
    expect(within(list).getByRole("link", { name: /very-long-filename/ }).getAttribute("href")).toBe("/api/ticket-attachments/a1/download");
  });

  it("renders locked context with the exact denial and no link", () => {
    render(<StaffTicketDetail workspace={makeWorkspace()} canManage />);
    expect(screen.getByText("Your role cannot open this record.")).toBeTruthy();
    expect(screen.getByText("CRS-9F2A")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /CRS-9F2A/ })).toBeNull();
  });

  it("uses the context href only when present and unlocked", () => {
    render(<StaffTicketDetail workspace={makeWorkspace({ context: { kind: "ORDER", safeReference: "ORD-1", href: "/staff/payments/o1", locked: false } })} canManage />);
    expect(screen.getByRole("link", { name: /ORD-1/ }).getAttribute("href")).toBe("/staff/payments/o1");
  });
});

describe("TicketComposer via StaffTicketDetail", () => {
  it("keeps the internal note badge and helper visible before and during typing", () => {
    render(<StaffTicketDetail workspace={makeWorkspace()} canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Add internal note" }));
    const section = screen.getByRole("heading", { name: "Add internal note", level: 3 }).closest("section")!;
    expect(within(section).getByText("Staff only")).toBeTruthy();
    expect(within(section).getByText("Only staff can see this note.")).toBeTruthy();
    fireEvent.change(within(section).getByLabelText("Internal note"), { target: { value: "typing" } });
    expect(within(section).getByText("Staff only")).toBeTruthy();
    expect(within(section).getByText("Only staff can see this note.")).toBeTruthy();
    expect(section.className).toContain("border-warning");
  });

  it("saves an internal note directly without a review step", async () => {
    noteAction.mockResolvedValue({ ok: true, messageId: "m9" });
    render(<StaffTicketDetail workspace={makeWorkspace()} canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Add internal note" }));
    fireEvent.change(screen.getByLabelText("Internal note"), { target: { value: "Call back tomorrow" } });
    fireEvent.click(screen.getByRole("button", { name: "Save internal note" }));
    await waitFor(() => expect(noteAction).toHaveBeenCalledWith({ reference: "TKT-ABC123", expectedVersion: 4, body: "Call back tomorrow" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cannot send a public reply before the review step, which repeats recipient, body and filenames", async () => {
    replyAction.mockResolvedValue({ ok: true, messageId: "m10" });
    render(<StaffTicketDetail workspace={makeWorkspace()} canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Reply to learner" }));
    expect(screen.queryByRole("button", { name: "Send reply" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Message to learner"), { target: { value: "Try clearing your cache." } });
    fireEvent.click(screen.getByRole("button", { name: "Review reply" }));
    expect(replyAction).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Review reply" });
    expect(within(dialog).getByText("Ada Learner (ada@example.test)")).toBeTruthy();
    expect(within(dialog).getByText("Try clearing your cache.")).toBeTruthy();
    expect(within(dialog).getByText("None")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(replyAction).toHaveBeenCalledWith({ reference: "TKT-ABC123", expectedVersion: 4, body: "Try clearing your cache." }));
  });

  it("closes the review on Escape and keeps the typed message", () => {
    render(<StaffTicketDetail workspace={makeWorkspace()} canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Reply to learner" }));
    fireEvent.change(screen.getByLabelText("Message to learner"), { target: { value: "Draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Review reply" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((screen.getByLabelText("Message to learner") as HTMLTextAreaElement).value).toBe("Draft");
  });

  it("retains the message after a failed send", async () => {
    replyAction.mockResolvedValue({ ok: false, kind: "error", message: "The action did not complete." });
    render(<StaffTicketDetail workspace={makeWorkspace()} canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Reply to learner" }));
    fireEvent.change(screen.getByLabelText("Message to learner"), { target: { value: "Keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "Review reply" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Send reply" }));
    expect((await screen.findAllByRole("alert"))[0].textContent).toContain("Your message wasn’t sent.");
    expect((screen.getByLabelText("Message to learner") as HTMLTextAreaElement).value).toBe("Keep me");
  });

  it("gives read-only staff no reply or note path", () => {
    render(<StaffTicketDetail workspace={makeWorkspace()} canManage={false} />);
    expect(screen.queryByRole("button", { name: "Reply to learner" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add internal note" })).toBeNull();
    expect(screen.getByText(/can read this ticket but cannot/)).toBeTruthy();
  });
});
