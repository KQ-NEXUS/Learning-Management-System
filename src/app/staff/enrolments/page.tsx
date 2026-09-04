import { loadStaffEnrolments } from "@/server/services/roster-service";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { EnrolmentsTable, type EnrolmentListRow } from "./EnrolmentsTable";

/**
 * The global scoped `/staff/enrolments` list (UI-SPEC line 186).
 *
 * `loadStaffEnrolments` is gated on `enrolments.view` with NO scope resolver
 * — only a GLOBAL grant reaches it (T-05-95). A COHORT-scoped grant is
 * denied here exactly like `cohortService.list({})` denies an unscoped
 * caller in `cohorts/page.tsx` — there is no fetch-then-filter fallback.
 */

export const metadata = { title: "Enrolments" };

export default async function EnrolmentsPage() {
  let rows: EnrolmentListRow[];

  try {
    const enrolments = await loadStaffEnrolments({});
    rows = enrolments.map((e) => ({
      id: e.id,
      status: e.status,
      learnerName: e.learnerName,
      learnerEmail: e.learnerEmail,
      cohortId: e.cohortId,
      cohortCode: e.cohortCode,
      offerTitle: e.offerTitle,
      accessStartsAt: e.accessStartsAt ? e.accessStartsAt.toISOString() : null,
      accessEndsAt: e.accessEndsAt ? e.accessEndsAt.toISOString() : null,
      createdAt: e.createdAt.toISOString(),
    }));
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <p className="text-sm">Your session has ended. Sign in again.</p>;
    }
    if (error instanceof AuthorizationError) {
      // Identical copy whether or not any enrolment exists (RBAC-06).
      return <EnrolmentsTable denied={{ permission: "enrolments.view" }} />;
    }
    throw error;
  }

  return <EnrolmentsTable rows={rows} />;
}
