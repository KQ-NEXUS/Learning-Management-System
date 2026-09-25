/**
 * Learner support journey (plan 12-05): list, create, attachment and
 * partial-upload recovery. Detail/reply/lifecycle tests are appended by Task 2.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

const uploadTicketAttachment = vi.fn();
vi.mock("@/components/support/upload-ticket-attachment", () => ({
  uploadTicketAttachment: (...args: unknown[]) => uploadTicketAttachment(...args),
}));

const listOwnTickets = vi.fn();
const getOwnTicketByReference = vi.fn();
const { NotFound } = vi.hoisted(() => ({
  NotFound: class TicketNotFoundError extends Error {},
}));
vi.mock("@/server/services/ticket-service", () => ({
  listOwnTickets: () => listOwnTickets(),
  getOwnTicketByReference: (ref: string) => getOwnTicketByReference(ref),
  TicketNotFoundError: NotFound,
}));
vi.mock("@/server/auth/current-actor", () => ({
  getCurrentActor: async () => ({ userId: "learner-1" }),
}));
vi.mock("@/server/services/ticket-learner-context-service", () => ({
  parseLearnerContextHint: () => null,
  validateLearnerTicketContext: async () => null,
}));

import SupportIndexPage from "@/app/(learner)/support/page";
import { NewTicketForm } from "@/app/(learner)/support/new/NewTicketForm";
import { TICKET_CATEGORY_OPTIONS } from "@/components/support/ticket-labels";
import { validatePickedFiles } from "@/components/support/TicketAttachmentPicker";
import LearnerTicketPage from "@/app/(learner)/support/[reference]/page";
import {
  LearnerTicketDetail,
  type LearnerTicketView,
} from "@/app/(learner)/support/[reference]/LearnerTicketDetail";

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  uploadTicketAttachment.mockReset();
  listOwnTickets.mockReset();
  getOwnTicketByReference.mockReset();
});
afterEach(() => cleanup());

function file(name: string, type = "application/pdf", size = 1024) {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

function fillForm(container: HTMLElement) {
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "TECHNICAL_PROBLEM" } });
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Video will not play" } });
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "It stops at 04:12." } });
  return container;
}

function addFiles(files: File[]) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

describe("learner support list", () => {
  it("renders the exact empty state copy with a single h1", async () => {
    listOwnTickets.mockResolvedValue([]);
    render(await SupportIndexPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("No support tickets yet")).toBeTruthy();
    expect(
      screen.getByText(/If you need help with your account, payment, course, assessment, certificate/),
    ).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Create a ticket" }).length).toBeGreaterThan(0);
  });

  it("lists tickets with reference, category, status and a view link, paginating at 20", async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({
      id: `t${i}`,
      reference: `KQT-${i}`,
      subject: `Subject ${i}`,
      category: "CERTIFICATE",
      status: "OPEN",
      updatedAt: new Date("2026-09-20T10:00:00Z"),
    }));
    listOwnTickets.mockResolvedValue(rows);
    render(await SupportIndexPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getAllByText("Certificate")).toHaveLength(20);
    expect(screen.getByRole("link", { name: /View ticket KQT-0/ }).getAttribute("href")).toBe("/support/KQT-0");
    expect(screen.getByRole("link", { name: "Next" })).toBeTruthy();
  });

  it("renders the load error state", async () => {
    listOwnTickets.mockRejectedValue(new Error("boom"));
    render(await SupportIndexPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("alert").textContent).toContain("We couldn’t load your tickets. Try again.");
  });
});

describe("new ticket form (create)", () => {
  it("offers exactly the seven categories", () => {
    render(<NewTicketForm createTicket={vi.fn()} />);
    const options = Array.from((screen.getByLabelText("Category") as HTMLSelectElement).options)
      .map((o) => o.text)
      .filter((t) => t !== "Select a category");
    expect(options).toEqual([
      "Account access",
      "Payment/order",
      "Course content",
      "Assessment/result",
      "Certificate",
      "Technical problem",
      "Other",
    ]);
    expect(TICKET_CATEGORY_OPTIONS).toHaveLength(7);
  });

  it("shows field errors, preserves input and does not call create", () => {
    const create = vi.fn();
    render(<NewTicketForm createTicket={create} />);
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "ab" } });
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
    expect(screen.getByText("Choose a category.")).toBeTruthy();
    expect(screen.getByText("Enter a subject of at least 3 characters.")).toBeTruthy();
    expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe("ab");
    expect(create).not.toHaveBeenCalled();
  });

  it("creates once with no attachments and navigates to the detail", async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, reference: "KQT-1", initialMessageId: "m1", version: 1 });
    const { container } = render(<NewTicketForm createTicket={create} />);
    fillForm(container);
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/support/KQT-1?created=1"));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("blocks double submission while pending", async () => {
    let release: (v: unknown) => void = () => {};
    const create = vi.fn().mockImplementation(() => new Promise((r) => (release = r)));
    const { container } = render(<NewTicketForm createTicket={create} />);
    fillForm(container);
    const form = container.querySelector("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(create).toHaveBeenCalledTimes(1);
    await waitFor(() => expect((screen.getByRole("button", { name: /Creating ticket/ }) as HTMLButtonElement).disabled).toBe(true));
    release({ ok: true, reference: "KQT-2", initialMessageId: "m", version: 1 });
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it("keeps entered text when the server rejects the create", async () => {
    const create = vi.fn().mockResolvedValue({ ok: false, message: "Your ticket wasn’t created. Your text and selected files are still here." });
    const { container } = render(<NewTicketForm createTicket={create} />);
    fillForm(container);
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
    await screen.findByText(/Your ticket wasn’t created/);
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("It stops at 04:12.");
  });
});

describe("attachment picker", () => {
  it("rejects a fourth, oversize and disallowed file before any intent is requested", () => {
    expect(validatePickedFiles(3, [file("d.pdf")]).error).toBe("You can attach up to 3 files.");
    expect(validatePickedFiles(0, [file("big.pdf", "application/pdf", 11 * 1024 * 1024)]).error).toBe(
      "big.pdf is larger than 10 MB.",
    );
    expect(validatePickedFiles(0, [file("a.exe", "application/x-msdownload")]).error).toBe(
      "Choose a PNG, JPEG, WebP, or PDF file.",
    );
    expect(validatePickedFiles(0, [file("ok.png", "image/png")]).accepted).toHaveLength(1);
  });

  it("announces the constraints, states, and supports remove", () => {
    render(<NewTicketForm createTicket={vi.fn()} />);
    expect(screen.getByText("Add up to 3 PNG, JPEG, WebP, or PDF files. Maximum 10 MB each.")).toBeTruthy();
    addFiles([file("one.pdf"), file("two.png", "image/png")]);
    expect(screen.getAllByText("Pending")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Remove one.pdf/ }));
    expect(screen.queryByText("one.pdf")).toBeNull();
    addFiles([file("bad.exe", "application/x-msdownload")]);
    expect(screen.getByRole("alert").textContent).toBe("Choose a PNG, JPEG, WebP, or PDF file.");
  });
});

describe("partial upload recovery", () => {
  it("creates exactly once when the second file fails, shows the recovery message and routes to the ticket", async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, reference: "KQT-9", initialMessageId: "m9", version: 1 });
    uploadTicketAttachment
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, message: "The uploaded file could not be verified." });
    const { container } = render(<NewTicketForm createTicket={create} />);
    fillForm(container);
    addFiles([file("a.pdf"), file("b.pdf")]);
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/support/KQT-9?upload=partial&failed=1"));
    expect(create).toHaveBeenCalledTimes(1);
    expect(uploadTicketAttachment).toHaveBeenNthCalledWith(1, "m9", expect.any(File));
    expect(
      screen.getByText("Ticket KQT-9 was created, but 1 attachment(s) could not be uploaded. Try again from the ticket."),
    ).toBeTruthy();
    expect(screen.getByText("Upload failed")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Task 2 - detail, reply, resolved / reopen / closed, private-content safety
// ---------------------------------------------------------------------------

const baseView: LearnerTicketView = {
  reference: "KQT-77",
  subject: "Cannot open certificate",
  category: "CERTIFICATE",
  status: "OPEN",
  version: 3,
  createdAt: new Date("2026-09-20T10:00:00Z"),
  updatedAt: new Date("2026-09-21T10:00:00Z"),
  context: null,
  canReply: true,
  canClose: false,
  canReopen: false,
  autoCloseAt: null,
  messages: [
    {
      id: "m1",
      authorRole: "LEARNER",
      body: "Line one\nLine two with averyveryverylongunbrokenwordaverylongunbrokenwordaverylongunbrokenword",
      createdAt: new Date("2026-09-20T10:00:00Z"),
      attachments: [{ id: "a1", filename: "screenshot.png", mimeType: "image/png", sizeBytes: 2048 }],
    },
    {
      id: "m2",
      authorRole: "SUPPORT",
      body: "We are looking into it.",
      createdAt: new Date("2026-09-21T09:00:00Z"),
      attachments: [],
    },
  ],
};

function actionsStub(overrides: Partial<Record<"reply" | "reopen" | "close", ReturnType<typeof vi.fn>>> = {}) {
  return {
    reply: vi.fn().mockResolvedValue({ ok: true, messageId: "m3" }),
    reopen: vi.fn().mockResolvedValue({ ok: true }),
    close: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  } as never;
}

describe("learner detail timeline", () => {
  it("renders an ordered list with absolute times, roles and authorized download links", () => {
    const { container } = render(<LearnerTicketDetail ticket={baseView} banner={null} actions={actionsStub()} />);
    const items = container.querySelectorAll("ol > li");
    expect(items).toHaveLength(2);
    expect(container.querySelectorAll("time[datetime]").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getByText("Support")).toBeTruthy();
    const link = screen.getByRole("link", { name: /screenshot.png/ });
    expect(link.getAttribute("href")).toBe("/api/ticket-attachments/a1/download");
    const body = container.querySelector("ol li p") as HTMLElement;
    expect(body.className).toContain("whitespace-pre-wrap");
    expect(body.className).toContain("break-words");
  });

  it("keeps unsent reply text and file metadata when the reply fails", async () => {
    const reply = vi.fn().mockResolvedValue({ ok: false, kind: "error", message: "x" });
    render(<LearnerTicketDetail ticket={baseView} banner={null} actions={actionsStub({ reply })} />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "More info" } });
    addFiles([file("proof.pdf")]);
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await screen.findByText("Your message wasn’t sent. Your text and selected files are still here.");
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("More info");
    expect(screen.getByText("proof.pdf")).toBeTruthy();
  });

  it("shows the conflict copy, refreshes and preserves the unsent message", async () => {
    const reply = vi.fn().mockResolvedValue({ ok: false, kind: "conflict", message: "stale" });
    render(<LearnerTicketDetail ticket={baseView} banner={null} actions={actionsStub({ reply })} />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await screen.findByText(
      "This ticket changed while you were working. We loaded the latest activity—review it and try again.",
    );
    expect(refresh).toHaveBeenCalled();
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("Keep me");
  });

  it("sends a reply with expected version then uploads files against the new message", async () => {
    const reply = vi.fn().mockResolvedValue({ ok: true, messageId: "m3" });
    uploadTicketAttachment.mockResolvedValue({ ok: true });
    render(<LearnerTicketDetail ticket={baseView} banner={null} actions={actionsStub({ reply })} />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Here you go" } });
    addFiles([file("proof.pdf")]);
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(reply).toHaveBeenCalledWith({ reference: "KQT-77", expectedVersion: 3, body: "Here you go" });
    expect(uploadTicketAttachment).toHaveBeenCalledWith("m3", expect.any(File));
  });
});

describe("resolved, reopen and closed", () => {
  const resolved: LearnerTicketView = {
    ...baseView,
    status: "RESOLVED",
    canReply: false,
    canClose: true,
    canReopen: true,
    autoCloseAt: new Date("2026-09-28T12:00:00Z"),
  };

  it("shows the prompt, exact auto-close date and no composer", () => {
    render(<LearnerTicketDetail ticket={resolved} banner={null} actions={actionsStub()} />);
    expect(screen.getByText("Did this solve the issue?")).toBeTruthy();
    expect(
      screen.getByText("This ticket will close automatically on 28 September 2026 unless you reopen it."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close ticket" })).toBeTruthy();
    expect(screen.queryByLabelText("Message")).toBeNull();
  });

  it("requires a reason to reopen and keeps input when the server rejects", async () => {
    const reopen = vi.fn().mockResolvedValue({ ok: false, kind: "error", message: "This ticket can no longer be reopened." });
    render(<LearnerTicketDetail ticket={resolved} banner={null} actions={actionsStub({ reopen })} />);
    fireEvent.click(screen.getByRole("button", { name: "Reopen ticket" }));
    const dialog = screen.getByRole("dialog");
    const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Reopen ticket")!;
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(reopen).not.toHaveBeenCalled();
    const reasonBox = dialog.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(reasonBox, { target: { value: "Still broken" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(reopen).toHaveBeenCalledWith({ reference: "KQT-77", expectedVersion: 3, reason: "Still broken" }));
    await screen.findByText(/can no longer be reopened/);
    expect((screen.getByRole("dialog").querySelector("textarea") as HTMLTextAreaElement).value).toBe("Still broken");
  });

  it("closes a resolved ticket with the expected version", async () => {
    const close = vi.fn().mockResolvedValue({ ok: true });
    render(<LearnerTicketDetail ticket={resolved} banner={null} actions={actionsStub({ close })} />);
    fireEvent.click(screen.getByRole("button", { name: "Close ticket" }));
    await waitFor(() => expect(close).toHaveBeenCalledWith({ reference: "KQT-77", expectedVersion: 3 }));
  });

  it("hides reopen once the server says the grace window has passed", () => {
    render(
      <LearnerTicketDetail
        ticket={{ ...resolved, canReopen: false, canClose: false }}
        banner={null}
        actions={actionsStub()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Reopen ticket" })).toBeNull();
    expect(screen.getByRole("link", { name: "Create a new ticket" }).getAttribute("href")).toBe("/support/new");
  });

  it("closed tickets are read-only with a link to a new ticket", () => {
    render(
      <LearnerTicketDetail
        ticket={{ ...baseView, status: "CLOSED", canReply: false }}
        banner={null}
        actions={actionsStub()}
      />,
    );
    expect(screen.queryByLabelText("Message")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("This ticket is closed. Create a new ticket if you need more help.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create a new ticket" }).getAttribute("href")).toBe("/support/new");
  });

  it("renders the created and partial-upload banners", () => {
    const { rerender } = render(
      <LearnerTicketDetail ticket={baseView} banner={{ kind: "created", failed: 0 }} actions={actionsStub()} />,
    );
    expect(screen.getByText("Ticket KQT-77 was created.")).toBeTruthy();
    rerender(<LearnerTicketDetail ticket={baseView} banner={{ kind: "partial", failed: 2 }} actions={actionsStub()} />);
    expect(
      screen.getByText("Ticket KQT-77 was created, but 2 attachment(s) could not be uploaded. Try again from the ticket."),
    ).toBeTruthy();
  });
});

describe("private content never reaches learner output", () => {
  it("drops staff-shaped fields and hidden sentinels; no hidden count or placeholder", async () => {
    getOwnTicketByReference.mockResolvedValue({
      ...baseView,
      // Staff-shaped or private data that a faulty service could leak:
      priority: "URGENT",
      queue: "FINANCE",
      assigneeId: "STAFF-SENTINEL-ID",
      internalNote: "INTERNAL-SENTINEL-TEXT",
      hiddenCount: 4,
      context: null,
      messages: baseView.messages.map((m) => ({ ...m, visibility: "PUBLIC", authorId: "AUTHOR-SENTINEL" })),
    });
    const { container } = render(
      await LearnerTicketPage({
        params: Promise.resolve({ reference: "KQT-77" }),
        searchParams: Promise.resolve({}),
      }),
    );
    const html = container.innerHTML;
    for (const leak of [
      "INTERNAL-SENTINEL-TEXT",
      "STAFF-SENTINEL-ID",
      "AUTHOR-SENTINEL",
      "URGENT",
      "FINANCE",
      "Staff only",
    ]) {
      expect(html).not.toContain(leak);
    }
    expect(container.textContent ?? "").not.toMatch(/hidden|internal|private/i);
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
  });

  it("renders the access-denied copy for a foreign or unknown reference", async () => {
    getOwnTicketByReference.mockRejectedValue(new NotFound());
    render(
      await LearnerTicketPage({
        params: Promise.resolve({ reference: "OTHER" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.getByRole("alert").textContent).toBe("You don’t have access to this ticket.");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("renders the generic load error for unexpected failures", async () => {
    getOwnTicketByReference.mockRejectedValue(new Error("db down"));
    render(
      await LearnerTicketPage({
        params: Promise.resolve({ reference: "KQT-77" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.getByRole("alert").textContent).toBe("We couldn’t load this ticket. Try again.");
  });
});

describe("axe accessibility (jsdom)", () => {
  it("learner list, new ticket form and ticket detail have no axe violations", async () => {
    const { axeViolations } = await import("../support/axe");
    listOwnTickets.mockResolvedValue([]);
    const list = render(await SupportIndexPage({ searchParams: Promise.resolve({}) }));
    expect(await axeViolations(list.container)).toEqual([]);
    list.unmount();

    const form = render(<NewTicketForm createTicket={vi.fn()} />);
    expect(await axeViolations(form.container)).toEqual([]);
    form.unmount();

    const detail = render(<LearnerTicketDetail ticket={baseView} banner={null} actions={actionsStub()} />);
    expect(await axeViolations(detail.container)).toEqual([]);
  });
});
