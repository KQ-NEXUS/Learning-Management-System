/**
 * EmailLogTable (D-06, UI-SPEC "Delivery log page") — filters, states, Resend
 * visibility, and the audited resend dialog. A client sibling of
 * `AuditTable`'s and `CertificateQueueTable`'s existing component tests.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EmailLogTable, type EmailLogFilters } from "@/app/staff/email-log/EmailLogTable";
import type { EmailDeliveryLogRow } from "@/server/services/email-delivery-log-service";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  resendEmailAction: vi.fn(),
}));

vi.mock("@/app/staff/email-log/actions", () => ({ resendEmailAction: mocks.resendEmailAction }));

let currentSearch = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => "/staff/email-log",
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  currentSearch = "";
});

const NO_FILTERS: EmailLogFilters = { status: "", template: "" };

function makeRow(overrides: Partial<EmailDeliveryLogRow> = {}): EmailDeliveryLogRow {
  return {
    id: "ed-1",
    template: "enrolment-confirmed",
    toEmail: "learner@example.test",
    status: "FAILED",
    attempts: 2,
    maxAttempts: 5,
    nextAttemptAt: null,
    error: "provider_rejected",
    skipReason: null,
    createdAt: new Date("2026-09-20T10:00:00Z"),
    sentAt: null,
    isStub: false,
    canResend: true,
    ...overrides,
  };
}

describe("EmailLogTable — filters", () => {
  it("renders status and template as select filters", () => {
    render(<EmailLogTable rows={[makeRow()]} filters={NO_FILTERS} canManageUsers />);
    expect(screen.getByRole("combobox", { name: /status/i })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /template/i })).toBeTruthy();
  });

  it("the template select lists every TEMPLATE_IDS option", () => {
    render(<EmailLogTable rows={[makeRow()]} filters={NO_FILTERS} canManageUsers />);
    const select = screen.getByRole("combobox", { name: /template/i }) as HTMLSelectElement;
    expect(within(select).getByRole("option", { name: "ticket-created" })).toBeTruthy();
    expect(within(select).getByRole("option", { name: "email-verification" })).toBeTruthy();
  });

  it("changing the status filter pushes an updated query string", () => {
    render(<EmailLogTable rows={[makeRow()]} filters={NO_FILTERS} canManageUsers />);
    fireEvent.change(screen.getByRole("combobox", { name: /status/i }), { target: { value: "FAILED" } });
    expect(mocks.push).toHaveBeenCalledWith("/staff/email-log?status=FAILED");
  });
});

describe("EmailLogTable — states", () => {
  it("renders the exact empty-state copy when there are no rows and no active filters", () => {
    render(<EmailLogTable rows={[]} filters={NO_FILTERS} canManageUsers />);
    expect(screen.getByText("No emails sent yet")).toBeTruthy();
    expect(
      screen.getByText("Transactional emails appear here once lifecycle events are processed."),
    ).toBeTruthy();
  });

  it("renders the exact load-error copy", () => {
    render(<EmailLogTable filters={NO_FILTERS} error={{}} />);
    expect(
      screen.getByText(
        "Couldn't load the delivery log. Reload the page; if it persists, contact an administrator.",
      ),
    ).toBeTruthy();
  });

  it("renders an identical denied state whether or not the caller could have seen rows", () => {
    const { container: withoutHint, unmount } = render(
      <EmailLogTable filters={NO_FILTERS} denied={{ permission: "audit.view" }} />,
    );
    const htmlA = withoutHint.innerHTML;
    unmount();
    const { container: withHint } = render(
      <EmailLogTable filters={NO_FILTERS} denied={{ permission: "audit.view" }} rows={[makeRow()]} />,
    );
    expect(withHint.innerHTML).toBe(htmlA);
    expect(htmlA).not.toContain("learner@example.test");
  });
});

describe("EmailLogTable — Resend visibility", () => {
  it("renders no Resend control when the viewer cannot manage users", () => {
    render(<EmailLogTable rows={[makeRow()]} filters={NO_FILTERS} canManageUsers={false} />);
    expect(screen.queryByRole("button", { name: "Resend" })).toBeNull();
  });

  it("renders Resend only on rows whose canResend is true, for a viewer who can manage users", () => {
    render(
      <EmailLogTable
        rows={[makeRow({ id: "ed-1", canResend: true }), makeRow({ id: "ed-2", canResend: false, status: "QUEUED" })]}
        filters={NO_FILTERS}
        canManageUsers
      />,
    );
    // jsdom applies no CSS, so both ResourceTable's desktop `<table>` and its
    // `sm:hidden` mobile card list are in the DOM at once — the single
    // eligible row therefore surfaces one Resend control per representation.
    const table = within(screen.getByRole("table"));
    expect(table.getAllByRole("button", { name: "Resend" })).toHaveLength(1);
  });
});

describe("EmailLogTable — long recipient containment (G-13-2)", () => {
  const LONG_RECIPIENT = `${"a".repeat(180)}@${"b".repeat(19)}`;
  const LONG_ERROR = "e".repeat(200);

  it("renders a 200-character recipient in a bounded truncate wrapper with the full value in title", () => {
    expect(LONG_RECIPIENT).toHaveLength(200);
    render(
      <EmailLogTable
        rows={[makeRow({ toEmail: LONG_RECIPIENT, error: LONG_ERROR })]}
        filters={NO_FILTERS}
        canManageUsers
      />,
    );
    const table = within(screen.getByRole("table"));
    const wrapper = table.getByText(LONG_RECIPIENT);
    // The complete value is still the React text content (never sliced in JS).
    expect(wrapper.textContent).toBe(LONG_RECIPIENT);
    const classes = wrapper.className.split(/\s+/);
    expect(classes).toContain("block");
    expect(classes).toContain("truncate");
    expect(classes.some((c) => /^max-w-/.test(c))).toBe(true);
    expect(wrapper.getAttribute("title")).toBe(LONG_RECIPIENT);
    // The td keeps the mono treatment.
    const cell = wrapper.closest("td");
    expect(cell?.className).toContain("font-mono");

    // Later columns and the action still render for the same row.
    expect(table.getByText("FAILED")).toBeTruthy();
    expect(table.getByText("2 of 5")).toBeTruthy();
    expect(table.getByRole("button", { name: "Resend" })).toBeTruthy();
    // Last error truncation is unchanged.
    const errorEl = table.getByText(LONG_ERROR);
    expect(errorEl.className).toContain("truncate");
    expect(errorEl.getAttribute("title")).toBe(LONG_ERROR);
  });

  it("still hides Resend for a long-recipient row when the viewer cannot manage users", () => {
    render(
      <EmailLogTable rows={[makeRow({ toEmail: LONG_RECIPIENT })]} filters={NO_FILTERS} canManageUsers={false} />,
    );
    expect(screen.queryByRole("button", { name: "Resend" })).toBeNull();
  });
});

describe("EmailLogTable — resend dialog", () => {
  function openDialog(row: EmailDeliveryLogRow = makeRow()) {
    render(<EmailLogTable rows={[row]} filters={NO_FILTERS} canManageUsers />);
    // Both the desktop and mobile representations render their own Resend
    // button for the same row (see the note above); either opens the one
    // shared ConfirmModal.
    fireEvent.click(screen.getAllByRole("button", { name: "Resend" })[0]);
    return within(screen.getByRole("dialog"));
  }

  it("disables confirm until the reason reaches the 10-character minimum", () => {
    const dialog = openDialog();
    const confirm = dialog.getByRole("button", { name: "Resend email" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "123456789" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "1234567890" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the exact UI-SPEC failure copy and keeps the dialog open on a failed resend", async () => {
    mocks.resendEmailAction.mockResolvedValue({ ok: false, message: "Email not resent. Try again." });
    const dialog = openDialog();
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "a valid reason" } });
    fireEvent.click(dialog.getByRole("button", { name: "Resend email" }));

    await waitFor(() => expect(screen.getByText("Email not resent. Try again.")).toBeTruthy());
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("shows a success note and closes the dialog on a successful resend", async () => {
    mocks.resendEmailAction.mockResolvedValue({ ok: true });
    const dialog = openDialog();
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "a valid reason" } });
    fireEvent.click(dialog.getByRole("button", { name: "Resend email" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("status").textContent).toContain("learner@example.test");
    expect(mocks.resendEmailAction).toHaveBeenCalledWith({ dispatchId: "ed-1", reason: "a valid reason" });
  });
});

describe("EmailLogTable accessibility (axe)", () => {
  it("has no violations in the ready state", async () => {
    const { axeViolations } = await import("../support/axe");
    const { container } = render(<EmailLogTable rows={[makeRow()]} filters={NO_FILTERS} canManageUsers />);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("has no violations in the empty state", async () => {
    const { axeViolations } = await import("../support/axe");
    const { container } = render(<EmailLogTable rows={[]} filters={NO_FILTERS} canManageUsers />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
