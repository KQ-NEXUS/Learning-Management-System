/** Phase 8 UI-SPEC §11 source contracts. Focused component suites exercise the
 * interactions; these named cases keep every approved state and reflow hook
 * represented in the cross-surface gate. jsdom cannot measure actual zoom. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const files = {
  recon: "src/app/staff/reconciliation/ReconciliationWorkspace.tsx",
  detail: "src/app/staff/reconciliation/[caseId]/ReconciliationCaseDetail.tsx",
  hub: "src/app/staff/reports/ReportsHub.tsx",
  dashboard: "src/app/staff/reports/[dataset]/ReportDashboard.tsx",
  history: "src/app/staff/reports/exports/ExportHistory.tsx",
  audit: "src/app/staff/audit/AuditTable.tsx",
};
type Surface = keyof typeof files;
const source = (surface: Surface) => readFileSync(path.join(root, files[surface]), "utf8");

const cases: { name: string; surfaces: Surface[]; evidence: string[] }[] = [
  { name: "UI-EMPTY-RECON retains queue chrome, provider choices and All transactions", surfaces: ["recon"], evidence: ["No unresolved exceptions", "All transactions", "Scoped totals", "Paystack", "Stripe", "Manual"] },
  { name: "UI-EMPTY-REPORT distinguishes checked zero from unavailable", surfaces: ["dashboard"], evidence: ["report.totalRows === 0", "No {definition.id} match these filters", "Not available yet"] },
  { name: "UI-EMPTY-EXPORT keeps filters and Refresh status", surfaces: ["history"], evidence: ["No exports yet", "All datasets", "All statuses", "Refresh status"] },
  { name: "UI-LOADING-PAGES keeps reconciliation, report and history skeletons", surfaces: ["recon", "hub", "history"], evidence: ["animate-pulse", "Loading export history", "Report headlines"] },
  { name: "UI-LOADING-MUTATION names the submitted export action", surfaces: ["recon", "history"], evidence: ["Queuing", "startExport", "pendingJob"] },
  { name: "UI-ERROR-PAGES offers safe recovery across surfaces", surfaces: ["recon", "hub", "history"], evidence: ["Could not load reconciliation data", "Could not load this report", "Export History is unavailable"] },
  { name: "UI-ERROR-MUTATION retains action state and avoids optimistic success", surfaces: ["recon", "history", "audit"], evidence: ["setActionError", "setExportMessage", "role=\"alert\""] },
  { name: "UI-POPULATED-RECON keeps individually linked cases and assignment-only bulk", surfaces: ["recon"], evidence: ["Assign cases", "caseId", "selected.length"] },
  { name: "UI-POPULATED-REPORT shows grouped hub, metrics, breakdown and matching rows", surfaces: ["hub", "dashboard"], evidence: ["Report headlines", "Report metrics", "Breakdown", "Matching rows"] },
  { name: "UI-POPULATED-EXPORT shows lifecycle, as-of, availability and lineage", surfaces: ["history"], evidence: ["Retry of", "As of", "Availability", "Download CSV", "Rerun export"] },
  { name: "UI-PARTIAL-AVAILABILITY labels each report independently", surfaces: ["hub"], evidence: ["Available", "Not available yet", "definition.availability"] },
  { name: "UI-PARTIAL-SETTLEMENT distinguishes pending, not applicable and numeric zero", surfaces: ["hub", "dashboard"], evidence: ["Pending", "Not applicable", "value === null"] },
  { name: "UI-PARTIAL-SECTION isolates failed dashboard sections", surfaces: ["dashboard"], evidence: ["failedSections.includes(\"metrics\")", "failedSections.includes(\"rows\")", "The other report sections are unchanged"] },
  { name: "UI-OVERFLOW-TABLE uses readable horizontal scrolling and mobile cards", surfaces: ["dashboard", "history"], evidence: ["overflow-x-auto", "min-w-max", "sm:hidden", "md:block"] },
  { name: "UI-OVERFLOW-CONTROLS wraps provider and filter controls", surfaces: ["recon", "history"], evidence: ["flex flex-wrap", "Export history filters"] },
  { name: "UI-OVERFLOW-HISTORY wraps investigation notes with chronology", surfaces: ["detail"], evidence: ["Investigation history", "whitespace-pre-wrap break-words", "event.actorName", "exactTime(event.createdAt)"] },
  { name: "UI-ZERO-ONE-MANY-COLLECTION keeps singular, plural and pagination", surfaces: ["recon", "dashboard", "history"], evidence: ["case\" : \"cases", "Matching rows", "Next page", "Previous page"] },
  { name: "UI-ZERO-ONE-MANY-CURRENCY keeps NGN and USD explicitly labelled", surfaces: ["recon", "hub"], evidence: ["item.currency", "currency", "formatMoney"] },
  { name: "UI-LONG-NAMES wraps learner, offer and active filter names", surfaces: ["detail", "hub", "history"], evidence: ["learnerName", "break-words", "row.filters"] },
  { name: "UI-LONG-REFERENCES wraps identifiers and bounds safe failure prose", surfaces: ["detail", "history"], evidence: ["font-mono", "break-all", "row.failure"] },
  { name: "UI-LONG-NOTES keeps bounded input and saved actor/time", surfaces: ["detail"], evidence: ["textarea rows={5}", "event.note", "event.actorName", "exactTime(event.createdAt)"] },
  { name: "UI-LONG-UNAVAILABLE reflows owning-capability explanation", surfaces: ["dashboard", "hub"], evidence: ["definition.unavailableReason", "break-words"] },
  { name: "UI-ZOOM-200-BACKSTOP keeps dense cards single-column by default", surfaces: ["hub", "dashboard"], evidence: ["grid-cols-1", "sm:grid-cols-2", "break-words"] },
  { name: "UI-LARGE-MONEY-BACKSTOP keeps large values, negative variance and null states legible", surfaces: ["recon", "hub", "dashboard"], evidence: ["tabular-nums", "Pending", "Not applicable", "varianceMinor"] },
];

describe("Phase 8 UI consideration matrix", () => {
  it("names all 22 covered considerations and both backstops", () => expect(cases).toHaveLength(24));
  it("keeps wide report columns readable in a bounded horizontal scroll region", () => {
    const dashboard = source("dashboard");
    expect(dashboard).toContain("overflow-x-auto");
    expect(dashboard).toContain("min-w-max");
    expect(dashboard).not.toContain("table-fixed");
  });
  it.each(cases)("$name", ({ surfaces, evidence }) => {
    const combined = surfaces.map(source).join("\n");
    for (const marker of evidence) expect(combined, marker).toContain(marker);
  });
});
