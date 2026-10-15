/**
 * Operations status page sections (plan 15-13, UI-SPEC S1): every state and the
 * approved copy, rendered from fixture section data. The sections are server
 * components with no client state, so they render directly.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  OperationsBand,
  OperationsSections,
  OverallStatusPill,
  ALL_CLEAR_LINE,
} from "@/app/staff/operations/OperationsSections";
import {
  summariseOpsStatus,
  type OpsEmailFailureRow,
  type OpsFailedWorkRow,
  type OpsJobId,
  type OpsJobRow,
  type OpsJobStatus,
  type OpsPaymentExceptionRow,
  type OpsStatus,
} from "@/server/services/ops-status-types";

afterEach(cleanup);

const CHECKED_AT = new Date("2026-10-08T12:00:00.000Z");
const SECTION_ERROR = "Couldn't load this section. Reload the page; if it persists, check the host logs.";

const JOB_NAMES: [OpsJobId, string][] = [
  ["drain-domain-events", "Event processing"],
  ["dispatch-export-jobs", "Export dispatch"],
  ["process-export-jobs", "Export processing"],
  ["expire-export-jobs", "Export expiry"],
  ["reconcile-payments", "Payment reconciliation"],
  ["release-expired-holds", "Seat hold release"],
  ["cleanup-stale-uploads", "Upload cleanup"],
  ["close-resolved-tickets", "Ticket auto-close"],
  ["cleanup-notifications", "Notification cleanup"],
  ["check-licence", "Licence check"],
];

function jobs(overrides: Partial<Record<OpsJobId, Partial<OpsJobRow>>> = {}): OpsJobRow[] {
  return JOB_NAMES.map(([id, name]) => ({
    id,
    name,
    status: (id === "cleanup-notifications" ? "untracked" : "idle") as OpsJobStatus,
    lastActivityAt: null,
    detail: { text: id === "cleanup-notifications" ? "No stored record shows when this job last ran. Check the host's function log." : "Nothing waiting" },
    ...overrides[id],
  }));
}

function allClear(): OpsStatus {
  return {
    checkedAt: CHECKED_AT,
    jobs: { state: "ok", jobs: jobs() },
    failedWork: { state: "ok", rows: [], total: 0 },
    paymentExceptions: { state: "ok", rows: [], total: 0, reconciliation: { open: 0, highRisk: 0 } },
    emailFailures: { state: "ok", rows: [], total: 0 },
    integrity: {
      state: "ok",
      checks: [
        { id: "a", label: "Paid orders have a successful payment", status: "passed", violationCount: 0 },
        { id: "b", label: "One live enrolment per learner and cohort", status: "passed", violationCount: 0 },
      ],
    },
  };
}

function exportRow(index: number, label = "Payments"): OpsFailedWorkRow {
  return {
    key: `export_failed:${index}`,
    kind: "export_failed",
    label,
    reference: `ref${String(index).padStart(5, "0")}`,
    at: new Date(CHECKED_AT.getTime() - index * 60_000),
    attempts: null,
    maxAttempts: null,
  };
}

function renderPage(status: OpsStatus) {
  const summary = summariseOpsStatus(status);
  return render(
    <div>
      <OverallStatusPill needsAttention={summary.needsAttention} />
      <OperationsBand summary={summary} checkedAt={status.checkedAt} maxSendAttempts={5} />
      <OperationsSections status={status} summary={summary} />
    </div>,
  );
}

/** The wrapper under a section's heading, which carries the severity rule. */
function sectionOf(name: string): HTMLElement {
  return screen.getByRole("heading", { level: 2, name }).closest("section") as HTMLElement;
}

describe("Operations status: all clear", () => {
  it("shows the All clear pill, the all-clear line, every empty copy and zero figures", () => {
    renderPage(allClear());

    expect(screen.getByText("All clear")).toBeTruthy();
    expect(screen.queryByText("Needs attention")).toBeNull();
    expect(screen.getByText(ALL_CLEAR_LINE)).toBeTruthy();
    expect(screen.getByText("No failed or stuck work.")).toBeTruthy();
    expect(screen.getByText("No payment exceptions.")).toBeTruthy();
    expect(screen.getByText("No email failures.")).toBeTruthy();

    // A zero renders as "0", never blank, with the spoken plural form beside it.
    expect(screen.getByText("0 failed jobs")).toBeTruthy();
    expect(screen.getByText("0 payment exceptions")).toBeTruthy();
    expect(screen.getByText("0 email failures")).toBeTruthy();
    expect(screen.getAllByText("0")).toHaveLength(3);
    expect(screen.getByText("Exports and events that stopped")).toBeTruthy();
    expect(screen.getByText("Orders, webhooks and refunds")).toBeTruthy();
    expect(screen.getByText("Not delivered after 5 attempts")).toBeTruthy();
    expect(screen.getByText(/^Checked/).textContent).toBe("Checked 8 Oct 2026, 13:00 WAT");

    // Sections in the approved order, none flagged.
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Scheduled jobs",
      "Failed and stuck work",
      "Payment exceptions",
      "Email failures",
      "Data integrity checks",
    ]);
    expect(document.querySelector(".alert-dot")).toBeNull();
  });

  it("lists all ten jobs with their status words, and gives Not tracked its host-log guidance", () => {
    renderPage(allClear());
    const jobsTable = within(sectionOf("Scheduled jobs")).getByRole("table", { name: "Scheduled jobs", hidden: true });
    for (const [, name] of JOB_NAMES) {
      expect(within(jobsTable).getByText(name)).toBeTruthy();
    }
    expect(within(jobsTable).getAllByText("Nothing waiting").length).toBeGreaterThan(0);
    expect(within(jobsTable).getByText("Not tracked")).toBeTruthy();
    expect(
      within(jobsTable).getByText("No stored record shows when this job last ran. Check the host's function log."),
    ).toBeTruthy();
    expect(screen.getByText(/^Status is worked out from stored records/)).toBeTruthy();
    expect(
      within(jobsTable)
        .getAllByRole("columnheader", { hidden: true })
        .map((h) => h.textContent),
    ).toEqual(["Job", "Status", "Last activity", "Detail"]);
  });

  it("shows each integrity check as Passed", () => {
    renderPage(allClear());
    const table = within(sectionOf("Data integrity checks")).getByRole("table", { name: "Data integrity checks", hidden: true });
    expect(within(table).getAllByText("Passed")).toHaveLength(2);
    expect(within(table).getByText("Paid orders have a successful payment")).toBeTruthy();
    expect(within(table).getByText("One live enrolment per learner and cohort")).toBeTruthy();
  });
});

describe("Operations status: needs attention", () => {
  function failing(): OpsStatus {
    const status = allClear();
    status.jobs = {
      state: "ok",
      jobs: jobs({
        "drain-domain-events": { status: "behind", detail: { text: "Oldest waiting event: 12 minutes" } },
        "process-export-jobs": { status: "failing", detail: { text: "1 failed export" } },
        "check-licence": {
          status: "running",
          lastActivityAt: new Date("2026-10-05T13:00:00.000Z"),
          detail: { text: "Last licence check", at: new Date("2026-10-05T13:00:00.000Z") },
        },
      }),
    };
    const stopped: OpsFailedWorkRow = {
      key: "event_stopped:1",
      kind: "event_stopped",
      label: "Order exception",
      reference: "evt00001",
      at: new Date("2026-10-08T11:00:00.000Z"),
      attempts: 3,
      maxAttempts: 3,
    };
    const retrying: OpsFailedWorkRow = { ...stopped, key: "event_retrying:2", kind: "event_retrying", reference: "evt00002", attempts: 1 };
    const waiting: OpsFailedWorkRow = { ...exportRow(3, "Audit"), key: "export_waiting:3", kind: "export_waiting" };
    status.failedWork = { state: "ok", rows: [exportRow(1), stopped, retrying, waiting], total: 4 };
    const payments: OpsPaymentExceptionRow[] = [
      { key: "o1", kind: "order", orderId: "o1", orderReference: "ORD-2610-1", reasonLabel: "Payment needs review", at: CHECKED_AT },
      { key: "w1", kind: "webhook", provider: "Paystack", reason: "signature_invalid", at: CHECKED_AT },
      { key: "w2", kind: "webhook", provider: "Stripe", reason: "exception", at: CHECKED_AT },
      { key: "r1", kind: "refund", orderId: "o2", orderReference: "ORD-2610-2", at: CHECKED_AT },
      { key: "s1", kind: "stuck_attempt", orderId: "o3", minutes: 52, at: CHECKED_AT },
    ];
    status.paymentExceptions = { state: "ok", rows: payments, total: 5, reconciliation: { open: 2, highRisk: 1 } };
    const emails: OpsEmailFailureRow[] = [
      { id: "email0001xyz", reference: "email000", templateLabel: "Enrolment confirmed", attempts: 5, maxAttempts: 5, lastAttemptAt: CHECKED_AT, stuckSending: false, since: CHECKED_AT },
      { id: "email0002xyz", reference: "email000", templateLabel: "Password reset", attempts: 1, maxAttempts: 5, lastAttemptAt: CHECKED_AT, stuckSending: true, since: CHECKED_AT },
    ];
    status.emailFailures = { state: "ok", rows: emails, total: 2 };
    status.integrity = {
      state: "ok",
      checks: [
        { id: "a", label: "Paid orders have a successful payment", status: "violations", violationCount: 1 },
        { id: "b", label: "One live enrolment per learner and cohort", status: "violations", violationCount: 3 },
        { id: "c", label: "Cohorts are within capacity", status: "passed", violationCount: 0 },
      ],
    };
    return status;
  }

  it("shows the Needs attention pill, no all-clear line, and figures with singular and plural forms", () => {
    renderPage(failing());
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.queryByText("All clear")).toBeNull();
    expect(screen.queryByText(ALL_CLEAR_LINE)).toBeNull();
    expect(screen.getByText("4 failed jobs")).toBeTruthy();
    // Five exceptions plus two open reconciliation cases.
    expect(screen.getByText("7 payment exceptions")).toBeTruthy();
    expect(screen.getByText("2 email failures")).toBeTruthy();
  });

  it("flags every failing section with the alert dot and a danger rule", () => {
    renderPage(failing());
    for (const name of ["Scheduled jobs", "Failed and stuck work", "Payment exceptions", "Email failures", "Data integrity checks"]) {
      const section = sectionOf(name);
      expect(section.querySelector(".alert-dot"), name).not.toBeNull();
      expect(section.querySelector(".border-t-2.border-danger"), name).not.toBeNull();
    }
    expect(within(sectionOf("Scheduled jobs")).getByText("2 need attention")).toBeTruthy();
    expect(within(sectionOf("Failed and stuck work")).getByText("4 open")).toBeTruthy();
    expect(within(sectionOf("Data integrity checks")).getByText("2 need review")).toBeTruthy();
  });

  it("uses the approved wording for jobs, failed work, payments and emails", () => {
    renderPage(failing());
    const jobsSection = within(sectionOf("Scheduled jobs"));
    expect(jobsSection.getAllByText("Behind").length).toBeGreaterThan(0);
    expect(jobsSection.getAllByText("Failing").length).toBeGreaterThan(0);
    expect(jobsSection.getAllByText("Running normally").length).toBeGreaterThan(0);
    expect(jobsSection.getAllByText("Oldest waiting event: 12 minutes").length).toBeGreaterThan(0);
    expect(jobsSection.getAllByText(/Last licence check:/).length).toBeGreaterThan(0);

    const work = within(sectionOf("Failed and stuck work"));
    expect(work.getAllByText("Payments export failed").length).toBeGreaterThan(0);
    expect(work.getAllByText("Order exception event stopped after 3 of 3 attempts").length).toBeGreaterThan(0);
    expect(work.getAllByText("Order exception event retrying: 1 of 3 attempts").length).toBeGreaterThan(0);
    expect(work.getAllByText(/^Audit export waiting since/).length).toBeGreaterThan(0);
    expect(work.getAllByText("Open export history").length).toBeGreaterThan(0);
    expect(work.getAllByText("Open audit log").length).toBeGreaterThan(0);

    const pay = within(sectionOf("Payment exceptions"));
    expect(pay.getAllByText("Order ORD-2610-1: Payment needs review").length).toBeGreaterThan(0);
    expect(pay.getAllByText("Paystack webhook rejected: the signature did not match").length).toBeGreaterThan(0);
    expect(pay.getAllByText("Stripe webhook could not be applied").length).toBeGreaterThan(0);
    expect(pay.getAllByText("Refund failed for order ORD-2610-2").length).toBeGreaterThan(0);
    expect(pay.getAllByText("Payment still processing after 52 minutes").length).toBeGreaterThan(0);
    expect(pay.getAllByText("2 open reconciliation cases (1 high risk)").length).toBeGreaterThan(0);
    expect(pay.getAllByText("Open order").length).toBeGreaterThan(0);
    expect(pay.getAllByText("Open reconciliation").length).toBeGreaterThan(0);

    const email = within(sectionOf("Email failures"));
    expect(email.getAllByText("5 of 5 attempts").length).toBeGreaterThan(0);
    expect(email.getAllByText("1 of 5 attempts").length).toBeGreaterThan(0);
    expect(email.getAllByText(/^Stuck sending since/).length).toBeGreaterThan(0);
    expect(email.getAllByText(/^Last attempt/).length).toBeGreaterThan(0);
    expect(email.getAllByText("Open email log").length).toBeGreaterThan(0);

    const integrity = within(sectionOf("Data integrity checks"));
    expect(integrity.getAllByText("1 record needs review").length).toBeGreaterThan(0);
    expect(integrity.getAllByText("3 records need review").length).toBeGreaterThan(0);
    expect(integrity.getAllByText("Passed").length).toBeGreaterThan(0);
  });

  it("uses the singular form for one open reconciliation case", () => {
    const status = allClear();
    status.paymentExceptions = { state: "ok", rows: [], total: 0, reconciliation: { open: 1, highRisk: 0 } };
    renderPage(status);
    expect(screen.getAllByText("1 open reconciliation case (0 high risk)").length).toBeGreaterThan(0);
    // Open cases alone are not "all clear".
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.getByText("1 payment exception")).toBeTruthy();
    expect(screen.queryByText("No payment exceptions.")).toBeNull();
  });

  it("uses singular forms for one failed job and one email failure", () => {
    const status = allClear();
    status.failedWork = { state: "ok", rows: [exportRow(1)], total: 1 };
    status.emailFailures = {
      state: "ok",
      rows: [{ id: "x", reference: "xxxxxxxx", templateLabel: "Password reset", attempts: 2, maxAttempts: 5, lastAttemptAt: CHECKED_AT, stuckSending: false, since: CHECKED_AT }],
      total: 1,
    };
    renderPage(status);
    expect(screen.getByText("1 failed job")).toBeTruthy();
    expect(screen.getByText("1 email failure")).toBeTruthy();
  });
});

describe("Operations status: ten-row boundary (NFR-07)", () => {
  it("shows no footer for exactly 10 rows", () => {
    const status = allClear();
    status.failedWork = { state: "ok", rows: Array.from({ length: 10 }, (_, i) => exportRow(i + 1)), total: 10 };
    renderPage(status);
    expect(screen.queryByText(/^Showing/)).toBeNull();
    expect(screen.queryByText(/View all in/)).toBeNull();
  });

  it("shows 'Showing 10 of 11.' and the workspace link for 11", () => {
    const status = allClear();
    status.failedWork = { state: "ok", rows: Array.from({ length: 10 }, (_, i) => exportRow(i + 1)), total: 11 };
    status.emailFailures = {
      state: "ok",
      rows: Array.from({ length: 10 }, (_, i) => ({
        id: `e${i}`,
        reference: `email0${i}`,
        templateLabel: "Password reset",
        attempts: 5,
        maxAttempts: 5,
        lastAttemptAt: CHECKED_AT,
        stuckSending: false,
        since: CHECKED_AT,
      })),
      total: 11,
    };
    renderPage(status);
    const work = within(sectionOf("Failed and stuck work"));
    expect(work.getByText("Showing 10 of 11.")).toBeTruthy();
    const link = work.getByRole("link", { name: "View all in Export history" });
    expect(link.getAttribute("href")).toBe("/staff/reports/exports");
    expect(link.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    const email = within(sectionOf("Email failures"));
    expect(email.getByText("Showing 10 of 11.")).toBeTruthy();
    expect(email.getByRole("link", { name: "View all in Email log" }).getAttribute("href")).toBe("/staff/email-log?status=FAILED");
  });
});

describe("Operations status: section failure is isolated", () => {
  it("shows the section load failure copy for one section while the others still render", () => {
    const status = allClear();
    status.paymentExceptions = { state: "error" };
    renderPage(status);
    const payments = within(sectionOf("Payment exceptions"));
    expect(payments.getByText(SECTION_ERROR)).toBeTruthy();
    expect(payments.queryByText("No payment exceptions.")).toBeNull();
    // The other sections are untouched.
    expect(screen.getAllByText(SECTION_ERROR)).toHaveLength(1);
    expect(screen.getByText("No failed or stuck work.")).toBeTruthy();
    expect(screen.getByText("No email failures.")).toBeTruthy();
    // A section that could not load is not evidence of health.
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.queryByText(ALL_CLEAR_LINE)).toBeNull();
  });
});

describe("Operations status: responsive rows and long labels", () => {
  it("renders stacked cards below 768px and a fixed-layout table from 768px, with TH and TD cells", () => {
    const status = allClear();
    status.failedWork = { state: "ok", rows: [exportRow(1, "A very long dataset label that keeps going and going well past the width of its column")], total: 1 };
    renderPage(status);
    const section = sectionOf("Failed and stuck work");

    const cards = section.querySelector("ul[aria-label$='(cards)']") as HTMLElement;
    expect(cards.className).toContain("md:hidden");
    expect(cards.querySelector("li")?.className).toContain("border-b border-border py-4");

    const table = section.querySelector("table") as HTMLElement;
    expect(table.className).toContain("table-fixed");
    expect(table.className).toContain("w-full");
    expect(table.className).toContain("hidden");
    expect(table.className).toContain("md:table");
    expect(table.querySelector("th")?.className).toContain("text-ink-soft");
    const cell = table.querySelector("td") as HTMLElement;
    expect(cell.className).toContain("py-3.5 pr-4");
    // Long labels wrap inside the cell instead of widening the table.
    expect(cell.className).toContain("break-words");
    expect(cell.textContent).toContain("A very long dataset label");
    expect(cards.querySelector("p")?.className).toContain("break-words");
  });

  it("gives every row link a trailing arrow icon hidden from assistive technology", () => {
    const status = allClear();
    status.failedWork = { state: "ok", rows: [exportRow(1)], total: 1 };
    renderPage(status);
    const links = within(sectionOf("Failed and stuck work")).getAllByRole("link", { name: "Open export history", hidden: true });
    expect(links.length).toBe(2);
    for (const link of links) {
      expect(link.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
