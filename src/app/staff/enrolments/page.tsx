import { loadStaffEnrolments } from "@/server/services/roster-service";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { EnrolmentsTable, type EnrolmentListRow } from "./EnrolmentsTable";
import { SessionEnded } from "@/components/shell/SessionEnded";

/**
 * The `/staff/enrolments` list (UI-SPEC line 186).
 *
 * `loadStaffEnrolments` follows the caller's `enrolments.view` grants
 * (integration warning #1): everything for a GLOBAL grant, only in-scope
 * cohorts' enrolments otherwise, filtered in the query itself (T-05-95 — no
 * fetch-then-filter). A caller with no grant is denied.
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
      return <SessionEnded />;
    }
    if (error instanceof AuthorizationError) {
      // Identical copy whether or not any enrolment exists (RBAC-06).
      return <EnrolmentsTable denied={{ permission: "enrolments.view" }} />;
    }
    throw error;
  }

  return <EnrolmentsTable rows={rows} />;
}
