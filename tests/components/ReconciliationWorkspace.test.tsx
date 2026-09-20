import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReconciliationWorkspace } from "@/app/staff/reconciliation/ReconciliationWorkspace";
import { ReconciliationCaseDetailView } from "@/app/staff/reconciliation/[caseId]/ReconciliationCaseDetail";
import type { ReconciliationCaseDetail, ReconciliationCaseRow } from "@/server/services/reconciliation-case-service";

const push = vi.fn();
const refresh = vi.fn();
const assignAction = vi.fn();
const resolveAction = vi.fn();
const refundExportAction = vi.fn();
let currentSearchParams = new URLSearchParams("provider=PAYSTACK&currency=NGN");

vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/staff/reconciliation", useSearchParams: () => currentSearchParams, useRouter: () => ({ push, refresh }) }));
vi.mock("@/app/staff/reconciliation/actions", () => ({
  assignReconciliationCasesAction: (...args: unknown[]) => assignAction(...args),
  resolveReconciliationCaseAction: (...args: unknown[]) => resolveAction(...args),
  requestReconciliationRefundExportAction: (...args: unknown[]) => refundExportAction(...args),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); currentSearchParams = new URLSearchParams("provider=PAYSTACK&currency=NGN"); });

const row: ReconciliationCaseRow = {
  caseId: "case-a",
  subject: "PAYMENT",
  risk: "CAPTURED_MONEY",
  status: "OPEN",
  provider: "PAYSTACK",
  currency: "NGN",
  amountMinor: 100_000,
  varianceMinor: -5_000,
  orderReference: "ORDER-A",
  learnerName: "Ada Learner",
  cohortTitle: "Leadership Cohort",
  assigneeName: null,
  openedAt: new Date("2026-09-14T10:00:00.000Z"),
  lastEvidenceAt: new Date("2026-09-15T10:00:00.000Z"),
};

describe("ReconciliationWorkspace", () => {
  it("hides refund export without the current export capability", () => {
    render(<ReconciliationWorkspace rows={[]} />);
    expect(screen.queryByRole("button", { name: "Export refunds CSV" })).toBeNull();
  });

  it.each([
    ["All", "", undefined],
    ["Stripe", "STRIPE", "STRIPE"],
    ["Paystack", "PAYSTACK", "PAYSTACK"],
    ["Manual", "MANUAL", "MANUAL"],
  ])("queues %s refunds with the current provider, currency, dates and refund status", async (_label, provider, expectedProvider) => {
    currentSearchParams = new URLSearchParams({ ...(provider ? { provider } : {}), currency: "NGN", dateFrom: "2026-09-01", dateTo: "2026-09-15", refundStatus: "COMPLETED" });
    refundExportAction.mockResolvedValue({ ok: true, jobId: "job-1", status: "QUEUED" });
    render(<ReconciliationWorkspace canExportRefunds asOf={new Date("2026-09-16T09:00:00.000Z")} />);
    fireEvent.click(screen.getByRole("button", { name: "Export refunds CSV" }));
    const dialog = screen.getByRole("dialog", { name: "Refund CSV options" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Queue refund export" }));
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(refundExportAction).toHaveBeenCalledWith({
      filters: { ...(expectedProvider ? { provider: expectedProvider } : {}), currency: "NGN", from: "2026-09-01", to: "2026-09-15", status: "COMPLETED" },
      columns: ["reference", "occurredAt", "amountMinor", "currency"],
      asOf: "2026-09-16T09:00:00.000Z",
    });
    expect(screen.getByRole("link", { name: "View export history" }).getAttribute("href")).toBe("/staff/reports/exports");
  });

  it("retains refund export options and reason after a failed queue request", async () => {
    refundExportAction.mockResolvedValue({ ok: false, message: "Export not queued." });
    render(<ReconciliationWorkspace canExportRefunds canExportSensitiveRefunds asOf={new Date("2026-09-16T09:00:00.000Z")} />);
    fireEvent.click(screen.getByRole("button", { name: "Export refunds CSV" }));
    const dialog = screen.getByRole("dialog", { name: "Refund CSV options" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Learner" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Operational reason" }), { target: { value: "Finance review" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Queue refund export" }));
    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect((within(dialog).getByRole("checkbox", { name: "Learner" }) as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByRole("textbox", { name: "Operational reason" }) as HTMLTextAreaElement).value).toBe("Finance review");
    expect(screen.queryByRole("link", { name: "View export history" })).toBeNull();
  });

  it("keeps tabs, totals, and the ledger link visible in the empty state", () => {
    render(<ReconciliationWorkspace rows={[]} summary={[]} asOf={new Date("2026-09-15T12:00:00.000Z")} />);
    expect(screen.getByRole("heading", { name: "No unresolved exceptions" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /All|Stripe|Paystack|Manual/ })).toHaveLength(4);
    expect(screen.getByRole("heading", { name: "Scoped totals" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "View all transactions" })).toBeTruthy();
  });

  it("renders loading and exact recoverable error copy without replacing failures with zero", () => {
    const { rerender } = render(<ReconciliationWorkspace loading />);
    expect(screen.getByRole("status").textContent).toContain("Loading reconciliation exceptions");
    rerender(<ReconciliationWorkspace error />);
    expect(screen.getByRole("alert").textContent).toContain("Could not load reconciliation data. Your filters are unchanged.");
    expect(screen.queryByText(/^0$/)).toBeNull();
  });

  it("renders desktop and mobile parity for subject, provider, currency, risk, owner, age, and case link", () => {
    render(<ReconciliationWorkspace rows={[row]} summary={[{ provider: "PAYSTACK", currency: "NGN", subject: "PAYMENT", count: 1, amountMinor: 100_000 }]} />);
    expect(screen.getAllByText("Captured money").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Paystack|PAYSTACK/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/NGN/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole("link", { name: "case-a" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /resolve/i })).toBeNull();
  });

  it("updates provider filters through the URL and preserves normalized existing filters", () => {
    render(<ReconciliationWorkspace rows={[row]} />);
    fireEvent.click(screen.getByRole("button", { name: "Stripe" }));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("provider=STRIPE"));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("currency=NGN"));
  });

  it("offers assignment as the only bulk action and retains selection and assignee after failure", async () => {
    assignAction.mockResolvedValue({ ok: false, message: "failed" });
    render(<ReconciliationWorkspace rows={[row]} assignees={[{ id: "finance-a", name: "Finance A" }]} />);
    const checkboxes = screen.getAllByRole("checkbox", { name: "Select case case-a" });
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByRole("button", { name: "Assign cases" }));
    const dialog = screen.getByRole("dialog", { name: "Assign cases" });
    fireEvent.change(within(dialog).getByLabelText("Assign to"), { target: { value: "finance-a" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Assign cases" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Cases not assigned. Your selection and current assignments are unchanged.");
    expect((within(dialog).getByLabelText("Assign to") as HTMLSelectElement).value).toBe("finance-a");
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("button", { name: /bulk resolve/i })).toBeNull();
  });

  it("supports one, many, and long overflow-safe case content", () => {
    const long = { ...row, caseId: "case-" + "x".repeat(120), learnerName: "Learner ".repeat(30) };
    render(<ReconciliationWorkspace rows={[row, long]} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    expect(screen.getAllByText(long.caseId)).toHaveLength(2);
    expect(screen.getAllByText(long.learnerName.trim()).every((element) => element.className.includes("break-words"))).toBe(true);
  });
});

const detail: ReconciliationCaseDetail = {
  caseId: "case-a", subject: "PAYMENT", risk: "CAPTURED_MONEY", status: "REOPENED",
  openedAt: new Date("2026-09-14T10:00:00.000Z"), lastEvidenceAt: new Date("2026-09-15T10:00:00.000Z"), provider: "PAYSTACK", currency: "NGN", evidence: { issue: "new evidence" },
  order: { id: "order-a", reference: "ORDER-A", status: "PAID", learnerName: "Ada", learnerEmail: "ada@example.test", cohortId: "cohort-a", cohortTitle: "Leadership", enrolmentStates: [] },
  subjectAmount: { kind: "VALUE", minor: 100_000 },
  amounts: { base: { kind: "VALUE", minor: 90_000 }, platformFee: { kind: "VALUE", minor: 5_000 }, gatewayFeeEstimated: { kind: "PENDING" }, learnerTotal: { kind: "VALUE", minor: 100_000 }, schoolSettlementExpected: { kind: "VALUE", minor: 90_000 }, gatewayFeeActual: { kind: "VALUE", minor: 0 }, schoolSettlementActual: { kind: "PENDING" }, platformGrossActual: { kind: "PENDING" }, platformNetActual: { kind: "PENDING" } },
  assignment: { assigneeName: null, assignedAt: null }, resolution: { reason: "ACCEPTED_VARIANCE", note: "Earlier resolution", resolvedAt: new Date("2026-09-14T12:00:00.000Z"), resolvedByName: "Finance A" },
  paymentTimeline: [{ id: "attempt-a", kind: "PAYMENT", provider: "PAYSTACK", currency: "NGN", amountMinor: 100_000, status: "SUCCEEDED", reference: "provider-ref", actorName: null, correlationId: "corr-a", occurredAt: new Date("2026-09-14T09:00:00.000Z") }],
  caseHistory: [{ id: "event-resolved", type: "RESOLVED", actorType: "USER", actorName: "Finance A", evidence: null, fingerprint: "fp", resolutionReason: "ACCEPTED_VARIANCE", note: "Earlier resolution", correlationId: "corr-a", createdAt: new Date("2026-09-14T12:00:00.000Z") }, { id: "event-reopened", type: "REOPENED", actorType: "SYSTEM", actorName: null, evidence: { action: "provider.changed" }, fingerprint: "fp2", resolutionReason: null, note: null, correlationId: "corr-b", createdAt: new Date("2026-09-15T10:00:00.000Z") }],
  operationalHistory: [{ id: "audit-a", action: "enrolment.approved", targetType: "Enrolment", targetId: "enrolment-a", actorType: "USER", correlationId: "corr-a", reason: "approved", createdAt: new Date("2026-09-15T09:00:00.000Z") }],
  links: { paymentHref: "/staff/payments/order-a", refundHref: "/staff/payments/order-a#refunds", cohortHref: "/staff/cohorts/cohort-a" },
};

describe("ReconciliationCaseDetailView", () => {
  it("shows payment and operational chronology, prior resolution, reopen cause, and independently authorized corrective links", () => {
    render(<ReconciliationCaseDetailView detail={detail} />);
    expect(screen.getByText(/reopened because new provider evidence/i)).toBeTruthy();
    expect(screen.getByText("Earlier resolution")).toBeTruthy();
    expect(screen.getByText(/enrolment\.approved/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review payment facts" }).getAttribute("href")).toBe(detail.links.paymentHref);
    expect(screen.getByRole("link", { name: "Open refund controls" }).getAttribute("href")).toBe(detail.links.refundHref);
    expect(screen.getByRole("link", { name: "Open cohort enrolments" }).getAttribute("href")).toBe(detail.links.cohortHref);
    expect(screen.getAllByText(/0\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("— (pending reconciliation)").length).toBeGreaterThan(0);
  });

  it("requires category and note and preserves both after a failed resolution", async () => {
    resolveAction.mockResolvedValue({ ok: false, message: "failed" });
    render(<ReconciliationCaseDetailView detail={detail} />);
    fireEvent.click(screen.getByRole("button", { name: "Resolve exception" }));
    const dialog = screen.getByRole("dialog", { name: "Resolve exception" });
    expect((within(dialog).getByRole("button", { name: "Resolve exception" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Resolution category"), { target: { value: "ACCEPTED_VARIANCE" } });
    fireEvent.change(within(dialog).getByLabelText("Case note"), { target: { value: "Provider confirmed this exception." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Resolve exception" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Exception not resolved. Nothing in the investigation or payment record was changed.");
    expect((within(dialog).getByLabelText("Resolution category") as HTMLSelectElement).value).toBe("ACCEPTED_VARIANCE");
    expect((within(dialog).getByLabelText("Case note") as HTMLTextAreaElement).value).toContain("Provider confirmed");
  });

  it("renders manual values as Not applicable without collapsing actual zero", () => {
    const manual = { ...detail, provider: "MANUAL" as const, amounts: { ...detail.amounts, gatewayFeeEstimated: { kind: "NOT_APPLICABLE" as const }, gatewayFeeActual: { kind: "NOT_APPLICABLE" as const }, schoolSettlementActual: { kind: "NOT_APPLICABLE" as const } } };
    render(<ReconciliationCaseDetailView detail={manual} />);
    expect(screen.getAllByText("Not applicable")).toHaveLength(3);
  });
});
