import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { getCurrentActor } from "@/server/auth/current-actor";
import { collectionScopeFromGrants, type CollectionScopeSnapshot } from "@/server/permissions/collection-scope";
import { loadGrantsForUser } from "@/server/services/grant-service";
import {
  getReconciliationSummary,
  listReconciliationAssignees,
  listReconciliationCases,
  type ReconciliationAssigneeOption,
  type ReconciliationCaseFilters,
  type ReconciliationCaseRow,
  type ReconciliationSummaryRow,
} from "@/server/services/reconciliation-case-service";
import { ReconciliationWorkspace } from "./ReconciliationWorkspace";

export const metadata = { title: "Reconciliation" };

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function validDate(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function covers(view: CollectionScopeSnapshot | null, permission: CollectionScopeSnapshot | null): boolean {
  if (!view || !permission) return false;
  if (permission.kind === "GLOBAL") return true;
  return view.kind === "LIMITED" && JSON.stringify(view) === JSON.stringify(permission);
}

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const provider = one(params.provider)?.toUpperCase();
  const subject = one(params.subject)?.toUpperCase();
  const status = one(params.status)?.toUpperCase();
  const filters: ReconciliationCaseFilters = {
    ...(provider === "PAYSTACK" || provider === "STRIPE" || provider === "MANUAL" ? { provider } : {}),
    ...(one(params.currency) ? { currency: one(params.currency)!.toUpperCase() } : {}),
    ...(subject === "PAYMENT" || subject === "REFUND" ? { subject } : {}),
    ...(status === "OPEN" || status === "RESOLVED" || status === "REOPENED" ? { status } : {}),
    ...(validDate(one(params.dateFrom)) ? { dateFrom: validDate(one(params.dateFrom)) } : {}),
    ...(validDate(one(params.dateTo), true) ? { dateTo: validDate(one(params.dateTo), true) } : {}),
  };

  let data: [ReconciliationCaseRow[], ReconciliationSummaryRow[], ReconciliationAssigneeOption[]];
  try {
    data = await Promise.all([
      listReconciliationCases(filters),
      getReconciliationSummary(filters),
      listReconciliationAssignees(),
    ]);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <p className="text-sm text-foreground">Your session has ended. Sign in again.</p>;
    }
    if (error instanceof AuthorizationError) return <ReconciliationWorkspace denied />;
    return <ReconciliationWorkspace error asOf={new Date()} />;
  }
  const [rows, summary, assignees] = data;
  let canExportRefunds = false;
  let canExportSensitiveRefunds = false;
  try {
    const actor = await getCurrentActor();
    if (actor) {
      const grants = await loadGrantsForUser(actor.userId);
      const now = new Date();
      const view = collectionScopeFromGrants(grants, "payments.view", now);
      const exporting = collectionScopeFromGrants(grants, "reports.export", now);
      canExportRefunds = covers(view, exporting);
      canExportSensitiveRefunds = canExportRefunds && covers(view, collectionScopeFromGrants(grants, "users.view", now));
    }
  } catch {
    // Presentation hint only. The export action reauthorizes inside its transaction.
  }
  return <ReconciliationWorkspace rows={rows} summary={summary} assignees={assignees} asOf={new Date()} canExportRefunds={canExportRefunds} canExportSensitiveRefunds={canExportSensitiveRefunds} />;
}
