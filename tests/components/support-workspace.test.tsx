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
const claimAction = vi.fn();
const acceptAction = vi.fn();
const assignAction = vi.fn();
const queueAction = vi.fn();
const priorityAction = vi.fn();
const escalateAction = vi.fn();
const resolveAction = vi.fn();
vi.mock("@/app/staff/support/[reference]/actions", () => ({
  sendPublicReplyAction: (...args: unknown[]) => replyAction(...args),
  addInternalNoteAction: (...args: unknown[]) => noteAction(...args),
  claimTicketAction: (...args: unknown[]) => claimAction(...args),
  acceptEscalationAction: (...args: unknown[]) => acceptAction(...args),
  assignTicketAction: (...args: unknown[]) => assignAction(...args),
  moveQueueAction: (...args: unknown[]) => queueAction(...args),
  changePriorityAction: (...args: unknown[]) => priorityAction(...args),
  escalateTicketAction: (...args: unknown[]) => escalateAction(...args),
  resolveTicketAction: (...args: unknown[]) => resolveAction(...args),
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

const ASSIGNEES = [{ id: "s1", name: "Sam Agent" }, { id: "s2", name: "Kim Agent" }];
const CONFLICT = "This ticket changed while you were working. We loaded the latest activity—review it and try again.";

describe("StaffTicketDetail operational actions", () => {
  it("assign to me claims with the expected version and never alters the ticket optimistically", async () => {
    claimAction.mockResolvedValue({ ok: true });
    render(<StaffTicketDetail workspace={makeWorkspace({ assigneeId: null, status: "OPEN" })} canManage assignees={ASSIGNEES} />);
    fireEvent.click(screen.getByRole("button", { name: "Assign to me" }));
    await waitFor(() => expect(claimAction).toHaveBeenCalledWith({ reference: "TKT-ABC123", expectedVersion: 4 }));
    expect(refresh).toHaveBeenCalled();
    expect(screen.getAllByText("Unassigned").length).toBeGreaterThan(0);
    expect((await screen.findByRole("status")).textContent).toContain("Ticket assigned to you.");
  });

  it("assigns an unowned ticket to a chosen eligible owner", async () => {
    assignAction.mockResolvedValue({ ok: true });
    render(<StaffTicketDetail workspace={makeWorkspace({ assigneeId: null, status: "OPEN" })} canManage assignees={ASSIGNEES} />);
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    const dialog = screen.getByRole("dialog", { name: "Assign ticket" });
    fireEvent.change(within(dialog).getByLabelText(/Assignee/), { target: { value: "s2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Assign ticket" }));
    await waitFor(() => expect(assignAction).toHaveBeenCalledWith({ reference: "TKT-ABC123", expectedVersion: 4, assigneeId: "s2", reason: undefined }));
  });

  it("requires a Reassignment reason before replacing an existing owner", async () => {
    assignAction.mockResolvedValue({ ok: true });
    render(<StaffTicketDetail workspace={makeWorkspace()} canManage assignees={ASSIGNEES} />);
    fireEvent.click(screen.getByRole("button", { name: "Reassign" }));
    const dialog = screen.getByRole("dialog", { name: "Reassign ticket" });
    fireEvent.change(within(dialog).getByLabelText(/New owner/), { target: { value: "s2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reassign ticket" }));
    expect(within(dialog).getByText("Reassignment reason is required.")).toBeTruthy();
    expect(assignAction).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Reassignment reason/), { target: { value: "Shift change" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reassign ticket" }));
    await waitFor(() => expect(assignAction).toHaveBeenCalledWith({ reference: "TKT-ABC123", expectedVersion: 4, assigneeId: "s2", reason: "Shift change" }));
  });

  it("requires a Priority reason only for Urgent", async () => {
    priorityAction.mockResolvedValue({ ok: true });
    render(<StaffTicketDetail workspace={makeWorkspace()} canManage assignees={ASSIGNEES} />);
    fireEvent.click(screen.getByRole("button", { name: "Change priority" }));
    const dialog = screen.getByRole("dialog", { name: "Change priority" });
    fireEvent.change(within(dialog).getByLabelText(/^Priority \(/), { target: { value: "URGENT" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Change priority" }));
    expect(within(dialog).getByText("Priority reason is required.")).toBeTruthy();
    expect(priorityAction).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Priority reason/), { target: { value: "Exam tomorrow" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Change priority" }));
    await waitFor(() => expect(priorityAction).toHaveBeenCalledWith({ reference: "TKT-ABC123", expectedVersion: 4, priority: "URGENT", reason: "Exam tomorrow" }));
  });

  it("escalation needs a reason, offers exactly the five queues and an optional owner", async () => {
    escalateAction.mockResolvedValue({ ok: true });
    render(<StaffTicketDetail workspace={makeWorkspace()} canManage assignees={ASSIGNEES} />);
    fireEvent.click(screen.getByRole("button", { name: "Escalate" }));
    const dialog = screen.getByRole("dialog", { name: "Escalate ticket" });
    const queues = within(within(dialog).getByLabelText(/Target queue/)).getAllByRole("option").map((o) => o.textContent);
    expect(queues).toEqual(["General Support", "Accounts", "Finance", "Learning & Assessment", "Technical"]);
    fireEvent.change(within(dialog).getByLabelText(/Target queue/), { target: { value: "FINANCE" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Escalate ticket" }));
    expect(within(dialog).getByText("Escalation reason is required.")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Escalate to owner/), { target: { value: "s2" } });
    fireEvent.change(within(dialog).getByLabelText(/Escalation reason/), { target: { value: "Refund dispute" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Escalate ticket" }));
    await waitFor(() => expect(escalateAction).toHaveBeenCalledWith({ reference: "TKT-ABC123", expectedVersion: 4, queue: "FINANCE", assigneeId: "s2", reason: "Refund dispute" }));
  });

  it("moves queue and resolves with a required note and expected version", async () => {
    queueAction.mockResolvedValue({ ok: true });
    resolveAction.mockResolvedValue({ ok: true });
    render(<StaffTicketDetail workspace={makeWorkspace()} canManage assignees={ASSIGNEES} />);
    fireEvent.click(screen.getByRole("button", { name: "Move queue" }));
    let dialog = screen.getByRole("dialog", { name: "Move to queue" });
    fireEvent.change(within(dialog).getByLabelText(/^Queue \(/), { target: { value: "TECHNICAL" } });
    fireEvent.change(within(dialog).getByLabelText(/Queue reason/), { target: { value: "Needs engineering" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move ticket" }));
    await waitFor(() => expect(queueAction).toHaveBeenCalledWith({ reference: "TKT-ABC123", expectedVersion: 4, queue: "TECHNICAL", reason: "Needs engineering" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Resolve ticket" }));
    dialog = screen.getByRole("dialog", { name: "Resolve ticket" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Resolve ticket" }));
    expect(within(dialog).getByText("Resolution note is required.")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Resolution note/), { target: { value: "Fixed access" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Resolve ticket" }));
    await waitFor(() => expect(resolveAction).toHaveBeenCalledWith({ reference: "TKT-ABC123", expectedVersion: 4, reason: "Fixed access" }));
  });

  it("accepts an escalation directly", async () => {
    acceptAction.mockResolvedValue({ ok: true });
    render(<StaffTicketDetail workspace={makeWorkspace({ status: "ESCALATED" })} canManage assignees={ASSIGNEES} />);
    expect(screen.queryByRole("button", { name: "Escalate" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Accept escalation" }));
    await waitFor(() => expect(acceptAction).toHaveBeenCalledWith({ reference: "TKT-ABC123", expectedVersion: 4 }));
  });

  it("on a stale conflict reloads latest, shows the banner, keeps input and does not retry silently", async () => {
    resolveAction.mockResolvedValue({ ok: false, kind: "conflict", message: CONFLICT });
    render(<StaffTicketDetail workspace={makeWorkspace()} canManage assignees={ASSIGNEES} />);
    fireEvent.click(screen.getByRole("button", { name: "Resolve ticket" }));
    const dialog = screen.getByRole("dialog", { name: "Resolve ticket" });
    fireEvent.change(within(dialog).getByLabelText(/Resolution note/), { target: { value: "Fixed access" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Resolve ticket" }));
    expect(await within(dialog).findByText(CONFLICT)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
    expect(resolveAction).toHaveBeenCalledTimes(1);
    expect((within(dialog).getByLabelText(/Resolution note/) as HTMLTextAreaElement).value).toBe("Fixed access");
  });

  it("keeps dialog input and shows the failure when a command fails", async () => {
    priorityAction.mockResolvedValue({ ok: false, kind: "error", message: "The action did not complete. Nothing was changed." });
    render(<StaffTicketDetail workspace={makeWorkspace()} canManage assignees={ASSIGNEES} />);
    fireEvent.click(screen.getByRole("button", { name: "Change priority" }));
    const dialog = screen.getByRole("dialog", { name: "Change priority" });
    fireEvent.change(within(dialog).getByLabelText(/^Priority \(/), { target: { value: "HIGH" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Change priority" }));
    expect(await within(dialog).findByText("The action did not complete. Nothing was changed.")).toBeTruthy();
    expect((within(dialog).getByLabelText(/^Priority \(/) as HTMLSelectElement).value).toBe("HIGH");
  });

  it("gives tickets.view-only staff no mutation controls", () => {
    render(<StaffTicketDetail workspace={makeWorkspace()} canManage={false} assignees={ASSIGNEES} />);
    for (const name of ["Assign to me", "Assign", "Reassign", "Move queue", "Change priority", "Escalate", "Resolve ticket", "Accept escalation"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });
});

describe("long content, narrow viewport and focus contracts (12-09)", () => {
  it("wraps a very long unbroken message and attachment name instead of overflowing", () => {
    const long = "x".repeat(400);
    const ws = makeWorkspace();
    (ws.timeline[0] as unknown as { message: { body: string } }).message.body = long;
    render(<StaffTicketDetail workspace={ws} canManage />);
    const list = screen.getByRole("list", { name: "Ticket chronology" });
    const bodyEl = within(list).getByText(long);
    expect(bodyEl.className).toMatch(/break-words|overflow-wrap:anywhere/);
    expect(bodyEl.closest(".min-w-0")).not.toBeNull();
    expect(within(list).getByRole("link", { name: /very-long-filename/ }).innerHTML).toContain("overflow-wrap:anywhere");
    // No fixed viewport-width classes that would force horizontal scroll.
    expect(list.innerHTML).not.toMatch(/\bw-screen\b|\bmin-w-\[\d{3,}px\]|\bw-\[\d{3,}px\]/);
  });

  it("queue tabs scroll horizontally on their own strip and never widen the page", () => {
    render(<SupportWorkspace view={makeView()} />);
    const tablist = screen.getByRole("tablist");
    expect(tablist.className).toContain("overflow-x-auto");
    expect(screen.getAllByRole("tab").every((t) => t.className.includes("shrink-0"))).toBe(true);
  });

  it("returns focus to the opener and keeps the typed draft when the review dialog closes", async () => {
    render(<StaffTicketDetail workspace={makeWorkspace()} canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Reply to learner" }));
    fireEvent.change(screen.getByLabelText("Message to learner"), { target: { value: "Draft" } });
    const opener = screen.getByRole("button", { name: "Review reply" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Review reply" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect((screen.getByLabelText("Message to learner") as HTMLTextAreaElement).value).toBe("Draft");
  });

  it("announces action failures through an alert region", async () => {
    resolveAction.mockResolvedValue({ ok: false, error: "Could not resolve." });
    render(<StaffTicketDetail workspace={makeWorkspace()} canManage />);
    fireEvent.click(screen.getByRole("button", { name: /Resolve/ }));
    const dialog = screen.getByRole("dialog");
    const field = within(dialog).getAllByRole("textbox")[0];
    fireEvent.change(field, { target: { value: "Fixed for learner" } });
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
  });
});
