import { listCohortsForStaff, loadCohortInstructors } from "@/server/services/cohort-service";
import { AuthenticationError, AuthorizationError, can } from "@/server/permissions";
import { CohortsTable, type CohortRow } from "./CohortsTable";

export const metadata = { title: "Cohorts" };

export default async function CohortsPage() {
  let rows: CohortRow[];

  try {
    // Integration warning #1 — every cohort for a GLOBAL grant, only the
    // caller's in-scope cohorts otherwise; each row carries its own course or
    // programme title, so a scoped instructor sees real titles too.
    const cohorts = await listCohortsForStaff();

    // One permission-checked lookup per cohort; a cohort whose instructors this viewer cannot read
    // simply shows none, rather than failing the whole list.
    const instructorNames = new Map<string, string[]>(
      await Promise.all(
        cohorts.map(async (c) => {
          try {
            const found = await loadCohortInstructors({ cohortId: c.id });
            return [c.id, found.map((r) => r.user.name)] as [string, string[]];
          } catch {
            return [c.id, []] as [string, string[]];
          }
        }),
      ),
    );

    rows = cohorts.map((c) => {
      const isCourse = c.courseId != null;
      const offerTitle = (isCourse ? c.course?.title : c.programme?.title) ?? "—";
      return {
        id: c.id,
        code: c.code,
        title: c.title,
        courseId: c.courseId,
        programmeId: c.programmeId,
        offerKind: isCourse ? "Course" : "Programme",
        offerTitle,
        deliveryMode: c.deliveryMode,
        timezone: c.timezone,
        enrolmentOpensAt: c.enrolmentOpensAt.toISOString(),
        enrolmentClosesAt: c.enrolmentClosesAt.toISOString(),
        startsAt: c.startsAt.toISOString(),
        instructors: instructorNames.get(c.id) ?? [],
        capacity: c.capacity,
        seatsTaken: c.seatsTaken,
        status: c.status,
      };
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <p className="text-sm text-foreground">Your session has ended. Sign in again.</p>;
    }
    if (error instanceof AuthorizationError) {
      // The primitive renders the denial. Copy is identical whether or not
      // any cohort exists, so the page leaks nothing (RBAC-06).
      return <CohortsTable denied={{ permission: "cohorts.view" }} />;
    }
    throw error;
  }

  // Only offer "create" to staff who can actually use it; the destination page 404s otherwise.
  const canCreate = await can("cohorts.manage", {});
  return <CohortsTable rows={rows} canCreate={canCreate} />;
}
