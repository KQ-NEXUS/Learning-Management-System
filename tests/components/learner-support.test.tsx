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
vi.mock("@/server/services/ticket-service", () => ({
  listOwnTickets: () => listOwnTickets(),
  getOwnTicketByReference: vi.fn(),
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

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  uploadTicketAttachment.mockReset();
  listOwnTickets.mockReset();
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
