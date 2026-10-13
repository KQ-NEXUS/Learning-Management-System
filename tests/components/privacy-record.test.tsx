/**
 * The learner privacy screens (plan 15-22; D-12, NFR-11, UI-SPEC S2 and S3).
 *
 * Component and page level proof, with the services and Server Actions mocked
 * (their behaviour is proven against a real database elsewhere):
 *   - S2 lookup: one field, exact copy, an empty submit and a no-match message
 *     with the value refilled and focus on the alert, a match redirects, a
 *     caller without the permission sees the denied panel;
 *   - S3 record: facts, the Export data and Anonymise account sections with the
 *     exact UI-SPEC copy; an unknown id, a staff account and a caller without
 *     the permission all get the standard 404;
 *   - ExportSection: the audited modal (reason of 10), every job state, the
 *     disabled button with its visible reason, and continuity in restricted mode;
 *   - AnonymiseSection: the typed email check (case and spaces ignored,
 *     mismatch shown on blur or Enter), the danger modal (reason of 20), the
 *     lists rendered from ANONYMISE_POLICY, the after-state and focus on the
 *     success note, and write behaviour in restricted mode.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Component, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  requestLearnerExportAction: vi.fn(),
  anonymiseLearnerAction: vi.fn(),
  getPrivacyRecord: vi.fn(),
  findLearnerForPrivacy: vi.fn(),
  can: vi.fn(),
}));

// The real redirect() and notFound() run, so the pages throw exactly what Next.js handles.
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return { ...actual, useRouter: () => ({ refresh: mocks.refresh }) };
});
// `ANONYMISE_POLICY` is a real constant in a module that reaches the database.
vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("@/app/staff/privacy/actions", () => ({
  requestLearnerExportAction: mocks.requestLearnerExportAction,
  anonymiseLearnerAction: mocks.anonymiseLearnerAction,
}));
vi.mock("@/server/services/privacy-read-service", () => ({
  privacyReadService: { getPrivacyRecord: mocks.getPrivacyRecord, findLearnerForPrivacy: mocks.findLearnerForPrivacy },
}));
vi.mock("@/server/permissions", () => {
  class AuthenticationError extends Error {}
  class AuthorizationError extends Error {}
  // `withPermission` is only called when a service module loads (to wrap a handler); nothing runs it here.
  return { AuthenticationError, AuthorizationError, can: mocks.can, withPermission: () => () => async () => undefined };
});

import {
  LicenceRestrictionProvider,
  type LicenceRestrictionValue,
} from "@/components/licence/LicenceRestrictionProvider";
import LearnerPrivacyLookupPage from "@/app/staff/privacy/page";
import LearnerPrivacyRecordPage from "@/app/staff/privacy/[userId]/page";
import { AnonymiseSection } from "@/app/staff/privacy/[userId]/AnonymiseSection";
import { ExportSection, type ExportSectionStatus } from "@/app/staff/privacy/[userId]/ExportSection";
import { LookupForm } from "@/app/staff/privacy/LookupForm";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { ANONYMISE_POLICY } from "@/server/services/privacy-anonymise-service";
import type { PrivacyRecord } from "@/server/services/privacy-read-service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.can.mockResolvedValue(true);
});
afterEach(cleanup);

const RESTRICTED: LicenceRestrictionValue = { restricted: true, canViewLicence: false, stateLabel: null };
const EMAIL = "Ada.Okafor@Example.test";
const NO_EXPORT: ExportSectionStatus = {
  state: "none",
  expiresAt: null,
  canDownload: false,
  downloadPath: null,
  inFlight: false,
};

function exportSection(status: Partial<ExportSectionStatus> = {}) {
  return <ExportSection userId="user-1" learnerName="Ada Okafor" exportStatus={{ ...NO_EXPORT, ...status }} />;
}

function anonymiseSection(overrides: Partial<Parameters<typeof AnonymiseSection>[0]> = {}) {
  return (
    <AnonymiseSection
      userId="user-1"
      learnerName="Ada Okafor"
      learnerEmail={EMAIL}
      policy={ANONYMISE_POLICY}
      anonymised={false}
      anonymisedAt={null}
      anonymisedByName={null}
      {...overrides}
    />
  );
}

function record(overrides: Partial<PrivacyRecord> = {}): PrivacyRecord {
  return {
    userId: "user-1",
    name: "Ada Okafor",
    email: EMAIL,
    learnerNumber: "KQL-000482",
    accountStatus: "ACTIVE",
    registeredAt: new Date("2026-03-05T13:30:00.000Z"),
    enrolmentCount: 3,
    anonymisedAt: null,
    anonymisedByName: null,
    exportStatus: {
      state: "none",
      jobId: null,
      requestedAt: null,
      expiresAt: null,
      canDownload: false,
      downloadPath: null,
      canRetry: false,
      inFlight: false,
    },
    ...overrides,
  };
}

/** The framework's own "this segment was not found" error, as thrown by notFound(). */
function isNotFound(error: unknown): boolean {
  return (error as { digest?: string } | null)?.digest === "NEXT_HTTP_ERROR_FALLBACK;404";
}
function redirectTarget(error: unknown): string | null {
  const digest = (error as { digest?: string } | null)?.digest ?? "";
  return digest.startsWith("NEXT_REDIRECT") ? (digest.split(";")[2] ?? null) : null;
}
async function thrownBy(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return null;
}

// ---------------------------------------------------------------------------
// S2 — lookup
// ---------------------------------------------------------------------------

describe("S2 lookup form", () => {
  it("shows the field, its help text and the primary button with the exact UI-SPEC copy", () => {
    render(<LookupForm value="" message={null} />);
    const field = screen.getByLabelText("Learner email or learner number") as HTMLInputElement;
    expect(field.type).toBe("text");
    expect(field.name).toBe("q");
    expect(field.autocomplete).toBe("off");
    expect(field.getAttribute("spellcheck")).toBe("false");
    expect(screen.getByRole("button", { name: "Find learner" })).toBeTruthy();
    const help = screen.getByText("Enter the exact email address or learner number. Partial matches are not shown.");
    expect(field.getAttribute("aria-describedby")).toContain(help.id);
    expect(screen.queryByRole("alert")).toBeNull();
    // A native GET form, so the page can redirect and drop the value from the address bar.
    expect(field.form?.method).toBe("get");
  });

  it("with a message: refills the value, shows the alert, links it to the field and moves focus to it", () => {
    render(<LookupForm value="nobody@example.test" message="No learner matches that email address or learner number. Check it and try again." />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("No learner matches that email address or learner number. Check it and try again.");
    expect(document.activeElement).toBe(alert);
    const field = screen.getByLabelText("Learner email or learner number") as HTMLInputElement;
    expect(field.value).toBe("nobody@example.test");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toContain(alert.id);
  });
});

describe("S2 lookup page", () => {
  const NO_MATCH = "No learner matches that email address or learner number. Check it and try again.";
  const page = (q?: string | string[]) => LearnerPrivacyLookupPage({ searchParams: Promise.resolve(q === undefined ? {} : { q }) });

  it("shows only the form before a search, with no message and no lookup", async () => {
    render(await page());
    expect(screen.getByRole("heading", { level: 1, name: "Learner privacy" })).toBeTruthy();
    expect(screen.getByText("Export one learner's data or anonymise their account. Every action is recorded in the audit log.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.findLearnerForPrivacy).not.toHaveBeenCalled();
  });

  it("an empty or blank submit shows the empty message and does not look anything up", async () => {
    for (const q of ["", "   "]) {
      cleanup();
      render(await page(q));
      expect(screen.getByRole("alert").textContent).toBe("Enter an email address or learner number.");
    }
    expect(mocks.findLearnerForPrivacy).not.toHaveBeenCalled();
  });

  it("a match redirects to the learner's record and does not echo the value", async () => {
    mocks.findLearnerForPrivacy.mockResolvedValue({ userId: "user-1" });
    const error = await thrownBy(() => page("ada.okafor@example.test"));
    expect(redirectTarget(error)).toBe("/staff/privacy/user-1");
    expect(mocks.findLearnerForPrivacy).toHaveBeenCalledWith({ query: "ada.okafor@example.test" });
  });

  it("no match (unknown, staff, partial or malformed) shows one message with the value refilled", async () => {
    mocks.findLearnerForPrivacy.mockResolvedValue(null);
    render(await page("nobody@example.test"));
    expect(screen.getByRole("alert").textContent).toBe(NO_MATCH);
    expect((screen.getByLabelText("Learner email or learner number") as HTMLInputElement).value).toBe("nobody@example.test");
  });

  it("a repeated q parameter is malformed input, not a search", async () => {
    render(await page(["a@example.test", "b@example.test"]));
    expect(screen.getByRole("alert").textContent).toBe(NO_MATCH);
    expect(mocks.findLearnerForPrivacy).not.toHaveBeenCalled();
  });

  it("shows the denied panel for a caller without the permission, before and after a search", async () => {
    mocks.can.mockResolvedValue(false);
    render(await page());
    expect(screen.getByText("You do not have access to learner privacy tools")).toBeTruthy();
    cleanup();
    mocks.can.mockResolvedValue(true);
    mocks.findLearnerForPrivacy.mockRejectedValue(new AuthorizationError("privacy.manage"));
    render(await page("ada@example.test"));
    expect(screen.getByText("You do not have access to learner privacy tools")).toBeTruthy();
    expect(screen.queryByRole("alert", { name: "" })?.textContent ?? "").not.toContain("No learner matches");
  });

  it("shows the session-ended state when the session has gone", async () => {
    mocks.findLearnerForPrivacy.mockRejectedValue(new AuthenticationError());
    render(await page("ada@example.test"));
    expect(screen.getByText("Your session has ended")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// S3 — record page
// ---------------------------------------------------------------------------

describe("S3 record page", () => {
  const page = (userId = "user-1") => LearnerPrivacyRecordPage({ params: Promise.resolve({ userId }) });

  it("shows the title, number, status and the Learner details facts with the exact labels", async () => {
    mocks.getPrivacyRecord.mockResolvedValue(record());
    render(await page());
    expect(screen.getByRole("heading", { level: 1, name: "Ada Okafor" })).toBeTruthy();
    expect(screen.getAllByText("KQL-000482").length).toBeGreaterThan(0);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toContain("Learner privacy");
    expect(screen.getByRole("heading", { level: 2, name: "Learner details" })).toBeTruthy();
    const facts = screen.getByText("Name").closest("dl")!;
    const labels = Array.from(facts.querySelectorAll("dt")).map((node) => node.textContent);
    expect(labels).toEqual(["Name", "Email address", "Learner number", "Account status", "Registered", "Enrolments"]);
    const value = (label: string) => within(facts).getByText(label).nextElementSibling!.textContent;
    expect(value("Email address")).toBe(EMAIL);
    expect(value("Account status")).toBe("Active");
    expect(value("Enrolments")).toBe("3");
    expect(value("Registered")).toBe("5 Mar 2026, 14:30 WAT");
    expect(screen.getByRole("heading", { level: 2, name: "Export data" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Anonymise account" })).toBeTruthy();
  });

  it("renders a dash for a missing learner number and the status words for each state", async () => {
    mocks.getPrivacyRecord.mockResolvedValue(record({ learnerNumber: null, accountStatus: "PENDING_VERIFICATION" }));
    render(await page());
    const facts = screen.getByText("Name").closest("dl")!;
    expect(within(facts).getByText("Learner number").nextElementSibling!.textContent).toBe("—");
    expect(within(facts).getByText("Account status").nextElementSibling!.textContent).toBe("Pending verification");
    cleanup();
    mocks.getPrivacyRecord.mockResolvedValue(record({ accountStatus: "DEACTIVATED" }));
    render(await page());
    expect(screen.getAllByText("Deactivated").length).toBeGreaterThan(0);
  });

  it("an unknown id, a staff account and a caller without the permission all get the standard 404", async () => {
    mocks.getPrivacyRecord.mockResolvedValueOnce(null);
    expect(isNotFound(await thrownBy(() => page("no-such-user")))).toBe(true);
    mocks.getPrivacyRecord.mockRejectedValueOnce(new AuthorizationError("privacy.manage"));
    expect(isNotFound(await thrownBy(() => page("user-1")))).toBe(true);
  });

  it("shows the session-ended state when the session has gone, never an account", async () => {
    mocks.getPrivacyRecord.mockRejectedValue(new AuthenticationError());
    render(await page());
    expect(screen.getByText("Your session has ended")).toBeTruthy();
    expect(screen.queryByText("Ada Okafor")).toBeNull();
  });

  it("after anonymisation: title, status and the after line; no export and no action", async () => {
    mocks.getPrivacyRecord.mockResolvedValue(
      record({
        name: "Anonymised learner",
        email: "anonymised-user-1@invalid.example",
        accountStatus: "ANONYMISED",
        anonymisedAt: new Date("2026-10-07T09:30:00.000Z"),
        anonymisedByName: "Privacy Staff Member",
      }),
    );
    render(await page());
    expect(screen.getByRole("heading", { level: 1, name: "Anonymised learner" })).toBeTruthy();
    expect(screen.getAllByText("Anonymised").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/This account was anonymised on/).textContent,
    ).toBe(
      "This account was anonymised on 7 Oct 2026, 10:30 WAT by Privacy Staff Member. There is no personal data left to export or change.",
    );
    expect(screen.queryByRole("heading", { name: "Export data" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Prepare data export" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Anonymise account" })).toBeNull();
    expect(screen.queryByLabelText("Type the learner's email address to confirm")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// S3 — Export data
// ---------------------------------------------------------------------------

describe("ExportSection", () => {
  function openModal() {
    fireEvent.click(screen.getByRole("button", { name: "Prepare data export" }));
    return within(screen.getByRole("dialog"));
  }

  it("shows the body copy and an enabled primary button when nothing has been exported", () => {
    render(exportSection());
    expect(screen.getByRole("heading", { level: 2, name: "Export data" })).toBeTruthy();
    expect(
      screen.getByText(
        "Prepares one file with this learner's profile, enrolments, orders and payments, attendance, submissions, grades, certificates, support requests and consent records. Passwords, security tokens, staff-only notes and other people's data are left out.",
      ),
    ).toBeTruthy();
    expect((screen.getByRole("button", { name: "Prepare data export" }) as HTMLButtonElement).disabled).toBe(false);
    for (const word of ["Being prepared", "Ready", "Failed", "Expired"]) expect(screen.queryByText(word)).toBeNull();
  });

  it("opens the audited modal with the exact copy and needs a reason of 10 characters", () => {
    render(exportSection());
    const dialog = openModal();
    expect(dialog.getByText("Audited action")).toBeTruthy();
    expect(dialog.getByRole("heading", { name: "Export this learner's data?" })).toBeTruthy();
    expect(
      dialog.getByText(
        "This prepares one file containing Ada Okafor's personal data. Your name and reason are recorded in the audit log, and the file can only be downloaded for a limited time.",
      ),
    ).toBeTruthy();
    expect(dialog.getByText(/Reason \(for example, the learner's request reference\)/)).toBeTruthy();
    const confirm = dialog.getByRole("button", { name: "Prepare export" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "123456789" } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "1234567890" } });
    expect(confirm.disabled).toBe(false);
    // Default tone, not the red danger confirm.
    expect(confirm.className).toContain("bg-accent");
    expect(confirm.className).not.toContain("bg-danger");
  });

  it("requests the export, closes the modal, announces the request and refreshes on demand", async () => {
    mocks.requestLearnerExportAction.mockResolvedValue({ ok: true, status: "QUEUED" });
    render(exportSection());
    const dialog = openModal();
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "Request ref DSAR-0042" } });
    fireEvent.click(dialog.getByRole("button", { name: "Prepare export" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.requestLearnerExportAction).toHaveBeenCalledWith({ userId: "user-1", reason: "Request ref DSAR-0042" });
    expect(screen.getByRole("status").textContent).toBe("Export requested. It usually takes under a minute.");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Check export status" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2));
  });

  it("keeps the modal open with the action's message when the request fails", async () => {
    mocks.requestLearnerExportAction.mockResolvedValue({ ok: false, message: "The export was not requested. Try again; if it fails again, contact an administrator." });
    render(exportSection());
    const dialog = openModal();
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "Request ref DSAR-0042" } });
    fireEvent.click(dialog.getByRole("button", { name: "Prepare export" }));
    await waitFor(() => expect(screen.getByText("Action not applied")).toBeTruthy());
    expect(screen.getByText(/The export was not requested/)).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each(["queued", "processing"] as const)(
    "while %s: shows Being prepared and disables the button, with the visible reason linked by aria-describedby",
    (state) => {
      render(exportSection({ state, inFlight: true }));
      expect(screen.getByText("Being prepared")).toBeTruthy();
      const button = screen.getByRole("button", { name: "Prepare data export" }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      const reason = screen.getByText("An export for this learner is already being prepared.");
      expect(button.getAttribute("aria-describedby")).toBe(reason.id);
    },
  );

  it("succeeded: Ready, the availability time and the download link", () => {
    render(
      exportSection({
        state: "succeeded",
        expiresAt: "2026-10-08T15:00:00.000Z",
        canDownload: true,
        downloadPath: "/api/staff/reports/exports/job-1/download",
      }),
    );
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText(/Available until/).textContent).toBe("Available until 8 Oct 2026, 16:00 WAT");
    const link = screen.getByRole("link", { name: "Download data file" });
    expect(link.getAttribute("href")).toBe("/api/staff/reports/exports/job-1/download");
    expect((screen.getByRole("button", { name: "Prepare data export" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("succeeded but not downloadable offers no link", () => {
    render(exportSection({ state: "succeeded", expiresAt: "2026-10-08T15:00:00.000Z", canDownload: false, downloadPath: null }));
    expect(screen.queryByRole("link", { name: "Download data file" })).toBeNull();
  });

  it("failed: shows the failure, and Retry export opens the same audited modal", () => {
    render(exportSection({ state: "failed" }));
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByText("The export failed. No file was created.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry export" }));
    expect(within(screen.getByRole("dialog")).getByRole("heading", { name: "Export this learner's data?" })).toBeTruthy();
  });

  it("expired: shows the expiry copy and still offers a new export", () => {
    render(exportSection({ state: "expired" }));
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.getByText("This file has expired. Prepare a new export if you still need it.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Prepare data export" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("stays usable in licence restricted mode (continuity): the confirm is not disabled by the mirror", () => {
    render(<LicenceRestrictionProvider value={RESTRICTED}>{exportSection()}</LicenceRestrictionProvider>);
    const dialog = openModal();
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "Request ref DSAR-0042" } });
    expect((dialog.getByRole("button", { name: "Prepare export" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// S3 — Anonymise account
// ---------------------------------------------------------------------------

describe("AnonymiseSection", () => {
  const typedField = () => screen.getByLabelText("Type the learner's email address to confirm") as HTMLInputElement;
  const dangerButton = () => screen.getByRole("button", { name: "Anonymise account" }) as HTMLButtonElement;
  const REASON = "Erasure request ref DSAR-0042";

  function typeEmail(value: string) {
    fireEvent.change(typedField(), { target: { value } });
  }

  function openModal() {
    typeEmail(EMAIL);
    fireEvent.click(dangerButton());
    return within(screen.getByRole("dialog"));
  }

  it("renders the danger zone with the exact copy, the deletion note and the export-first advice", () => {
    const { container } = render(anonymiseSection());
    expect(screen.getByRole("heading", { level: 2, name: "Anonymise account" })).toBeTruthy();
    expect(
      screen.getByText(
        "Anonymising replaces this learner's name and email address, removes their phone number and password, signs them out everywhere and deactivates the account. This cannot be undone.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Permanent deletion is not available until the retention policy is approved.")).toBeTruthy();
    expect(
      screen.getByText("If the learner asked for a copy of their data, prepare and download the export before you anonymise."),
    ).toBeTruthy();
    expect(container.querySelector("section")!.className).toContain("border-t-2");
    expect(container.querySelector("section")!.className).toContain("border-danger");
    // The danger button uses exactly the approved classes.
    expect(dangerButton().className).toBe(
      "inline-flex min-h-[46px] items-center justify-center rounded-md bg-danger px-5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50",
    );
  });

  it("renders every item of ANONYMISE_POLICY under What changes and What is kept", () => {
    render(anonymiseSection());
    const changes = screen.getByRole("heading", { level: 3, name: "What changes" }).parentElement!;
    const kept = screen.getByRole("heading", { level: 3, name: "What is kept" }).parentElement!;
    for (const item of ANONYMISE_POLICY.changes) expect(within(changes).getByText(item)).toBeTruthy();
    for (const item of ANONYMISE_POLICY.removes) expect(within(changes).getByText(`Removed: ${item}`)).toBeTruthy();
    for (const item of ANONYMISE_POLICY.keeps) expect(within(kept).getByText(item)).toBeTruthy();
    expect(within(changes).getAllByRole("listitem")).toHaveLength(ANONYMISE_POLICY.changes.length + ANONYMISE_POLICY.removes.length);
    expect(within(kept).getAllByRole("listitem")).toHaveLength(ANONYMISE_POLICY.keeps.length);
  });

  it("renders whatever the policy constant says, so a later owner change edits one constant", () => {
    render(
      anonymiseSection({
        policy: { changes: ["Changed thing"], removes: ["Removed thing"], keeps: ["Kept thing A", "Kept thing B"] },
      }),
    );
    expect(screen.getByText("Changed thing")).toBeTruthy();
    expect(screen.getByText("Removed: Removed thing")).toBeTruthy();
    expect(screen.getByText("Kept thing B")).toBeTruthy();
    expect(screen.queryByText(ANONYMISE_POLICY.keeps[0])).toBeNull();
  });

  it("keeps the danger button disabled with the visible reason until the typed email matches", () => {
    render(anonymiseSection());
    const reason = screen.getByText("Type the learner's email address above to continue.");
    expect(dangerButton().disabled).toBe(true);
    expect(dangerButton().getAttribute("aria-describedby")).toBe(reason.id);

    typeEmail("ada.okafor");
    expect(dangerButton().disabled).toBe(true);
    // No mismatch message per keystroke.
    expect(screen.queryByText("This does not match the learner's email address.")).toBeNull();
    expect(typedField().autocomplete).toBe("off");
  });

  it("shows the mismatch message on blur, linked to the field, and clears it once the email matches", () => {
    render(anonymiseSection());
    typeEmail("someone.else@example.test");
    fireEvent.blur(typedField());
    const mismatch = screen.getByText("This does not match the learner's email address.");
    expect(mismatch.getAttribute("role")).toBe("alert");
    expect(typedField().getAttribute("aria-describedby")).toBe(mismatch.id);
    expect(typedField().getAttribute("aria-invalid")).toBe("true");
    expect(dangerButton().disabled).toBe(true);

    // Case and surrounding spaces are ignored.
    typeEmail("  ada.okafor@EXAMPLE.TEST  ");
    expect(screen.queryByText("This does not match the learner's email address.")).toBeNull();
    expect(dangerButton().disabled).toBe(false);
    expect(dangerButton().getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByText("Type the learner's email address above to continue.")).toBeNull();
  });

  it("pressing Enter with a mismatch shows the message instead of opening the modal", () => {
    render(anonymiseSection());
    typeEmail("wrong@example.test");
    fireEvent.keyDown(typedField(), { key: "Enter" });
    expect(screen.getByText("This does not match the learner's email address.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    // An empty field is a mismatch too: the guard never passes on nothing.
    typeEmail("");
    expect(dangerButton().disabled).toBe(true);
  });

  it("opens the danger modal with the exact copy and needs a reason of 20 characters", () => {
    render(anonymiseSection());
    const dialog = openModal();
    expect(dialog.getByText("Cannot be undone")).toBeTruthy();
    expect(dialog.getByRole("heading", { name: "Anonymise Ada Okafor's account?" })).toBeTruthy();
    expect(
      dialog.getByText(
        "Their personal details are replaced and they are signed out everywhere. The records listed under What is kept stay. This cannot be undone.",
      ),
    ).toBeTruthy();
    expect(dialog.getByText(/Reason \(for example, the learner's request reference\)/)).toBeTruthy();
    const confirm = dialog.getByRole("button", { name: "Anonymise account" }) as HTMLButtonElement;
    expect(confirm.className).toContain("bg-danger");
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "1234567890123456789" } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "12345678901234567890" } });
    expect(confirm.disabled).toBe(false);
  });

  it("while the action runs, the modal controls are disabled", async () => {
    // A deferred promise, settled at the end: a transition that never settles would hold up every later one.
    let settle!: (value: unknown) => void;
    mocks.anonymiseLearnerAction.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    render(anonymiseSection());
    const dialog = openModal();
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: REASON } });
    fireEvent.click(dialog.getByRole("button", { name: "Anonymise account" }));
    await waitFor(() => expect(dialog.getByRole("button", { name: "Working…" })).toBeTruthy());
    expect((dialog.getByRole("button", { name: "Working…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((dialog.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect((dialog.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);

    settle({ ok: false, message: "The account was not changed. Try again; if it fails again, contact an administrator." });
    await waitFor(() => expect((dialog.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("on success: closes the modal, shows the status note, moves focus to it and refreshes from the server", async () => {
    mocks.anonymiseLearnerAction.mockResolvedValue({ ok: true });
    render(anonymiseSection());
    const dialog = openModal();
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: REASON } });
    fireEvent.click(dialog.getByRole("button", { name: "Anonymise account" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.anonymiseLearnerAction).toHaveBeenCalledWith({ userId: "user-1", reason: REASON });
    const note = screen.getByRole("status");
    expect(note.textContent).toBe("Account anonymised. The learner has been signed out everywhere and can no longer sign in.");
    await waitFor(() => expect(document.activeElement).toBe(note));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    // The action controls are gone; the typed email is no longer on the page.
    expect(screen.queryByLabelText("Type the learner's email address to confirm")).toBeNull();
  });

  it("keeps the success note, and adds the server's after line, when the page re-renders as anonymised", async () => {
    mocks.anonymiseLearnerAction.mockResolvedValue({ ok: true });
    const { rerender } = render(anonymiseSection());
    const dialog = openModal();
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: REASON } });
    fireEvent.click(dialog.getByRole("button", { name: "Anonymise account" }));
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    const note = screen.getByRole("status");

    rerender(anonymiseSection({ anonymised: true, anonymisedAt: "2026-10-07T09:30:00.000Z", anonymisedByName: "Privacy Staff Member" }));
    expect(screen.getByRole("status")).toBe(note);
    expect(document.activeElement).toBe(note);
    expect(screen.getByText(/This account was anonymised on/).textContent).toBe(
      "This account was anonymised on 7 Oct 2026, 10:30 WAT by Privacy Staff Member. There is no personal data left to export or change.",
    );
  });

  it("after a reload of an anonymised account: only the after line, no action sections", () => {
    render(anonymiseSection({ anonymised: true, anonymisedAt: "2026-10-07T09:30:00.000Z", anonymisedByName: null }));
    expect(screen.getByText(/This account was anonymised on/).textContent).toBe(
      "This account was anonymised on 7 Oct 2026, 10:30 WAT by a staff member. There is no personal data left to export or change.",
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("heading", { name: "What changes" })).toBeNull();
  });

  it("on a refused action: keeps the modal open and shows the failure copy under 'Action not applied'", async () => {
    mocks.anonymiseLearnerAction.mockResolvedValue({
      ok: false,
      message: "The account was not changed. Try again; if it fails again, contact an administrator.",
    });
    render(anonymiseSection());
    const dialog = openModal();
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: REASON } });
    fireEvent.click(dialog.getByRole("button", { name: "Anonymise account" }));
    await waitFor(() => expect(screen.getByText("Action not applied")).toBeTruthy());
    expect(screen.getByText("The account was not changed. Try again; if it fails again, contact an administrator.")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("on a concurrent change: shows the reload copy", async () => {
    const reload = "This account changed while you were working. Reload the page and check it before trying again.";
    mocks.anonymiseLearnerAction.mockResolvedValue({ ok: false, message: reload });
    render(anonymiseSection());
    const dialog = openModal();
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: REASON } });
    fireEvent.click(dialog.getByRole("button", { name: "Anonymise account" }));
    await waitFor(() => expect(screen.getByText(reload)).toBeTruthy());
  });

  it("clears the failure when the modal is cancelled and reopened", async () => {
    mocks.anonymiseLearnerAction.mockResolvedValue({ ok: false, message: "The account was not changed. Try again; if it fails again, contact an administrator." });
    render(anonymiseSection());
    const dialog = openModal();
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: REASON } });
    fireEvent.click(dialog.getByRole("button", { name: "Anonymise account" }));
    await waitFor(() => expect(screen.getByText("Action not applied")).toBeTruthy());
    // The transition finishes just after the failure is shown; only then can the modal be cancelled.
    await waitFor(() => expect((dialog.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(dangerButton());
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByText("Action not applied")).toBeNull();
  });

  it("in licence restricted mode (write): the modal confirm is disabled with a visible reason", () => {
    render(<LicenceRestrictionProvider value={RESTRICTED}>{anonymiseSection()}</LicenceRestrictionProvider>);
    const dialog = openModal();
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: REASON } });
    expect((dialog.getByRole("button", { name: "Anonymise account" }) as HTMLButtonElement).disabled).toBe(true);
    expect(dialog.getByText(/Unavailable in/)).toBeTruthy();
  });

  it("lets a framework redirect thrown through the action reach the error boundary instead of becoming 'try again'", async () => {
    const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
    let redirectError: unknown;
    try {
      actual.redirect("/signin");
    } catch (error) {
      redirectError = error;
    }
    mocks.anonymiseLearnerAction.mockRejectedValue(redirectError);

    const caught: unknown[] = [];
    class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch(error: unknown) {
        caught.push(error);
      }
      render() {
        return this.state.failed ? <p>boundary</p> : this.props.children;
      }
    }

    render(<Boundary>{anonymiseSection()}</Boundary>);
    const dialog = openModal();
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: REASON } });
    fireEvent.click(dialog.getByRole("button", { name: "Anonymise account" }));
    await waitFor(() => expect(caught).toContain(redirectError));
    expect(screen.queryByText("Action not applied")).toBeNull();
  });
});
