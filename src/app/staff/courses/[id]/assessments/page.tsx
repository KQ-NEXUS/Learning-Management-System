import { notFound } from "next/navigation";
import { AuthenticationError, AuthorizationError, can } from "@/server/permissions";
import { courseService } from "@/server/services/course-service";
import { assessmentService } from "@/server/services/assessment-service";
import { AssessmentsTable, type AssessmentRow } from "./AssessmentsTable";

export const metadata = { title: "Assessments" };

/**
 * The Course-scoped assessment list (ASM-01, ASM-03).
 *
 * Data access goes through `assessmentService` only — this route never
 * touches `@prisma/client` (enforced by the ESLint boundary and, for this
 * route tree specifically, an AST assertion in
 * `tests/assessment-staff-routes.test.ts`).
 */
export default async function AssessmentsListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: courseId } = await params;

  let course: { id: string } | null;
  try {
    course = (await courseService.get(courseId)) as unknown as { id: string } | null;
  } catch (error) {
    // A denial must not confirm existence — same response as "not found".
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      notFound();
    }
    throw error;
  }
  if (!course) notFound();

  let assessments: AssessmentRow[];
  try {
    // The explicit `scope` makes this a Course-scoped list, not the
    // GLOBAL-only unscoped listing `courseService.list({})` uses — a scoped
    // staff grant can reach this Course's assessments without a GLOBAL
    // grant. `where` filters the rows themselves to this Course; `scope`
    // is what the authorization core checks the actor's grant against.
    assessments = (await assessmentService.list({
      where: { courseId },
      scope: { courseIds: [courseId] },
    })) as unknown as AssessmentRow[];
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <p className="text-sm">Your session has ended. Sign in again.</p>;
    }
    if (error instanceof AuthorizationError) {
      // T-10-25: a denial renders as a denial, never an empty table — an
      // empty table would read as "this course has no assessments," which
      // is a scope leak dressed as data.
      return <AssessmentsTable courseId={courseId} denied={{ permission: "courses.view" }} />;
    }
    throw error;
  }
  // Only offer "create" to staff who can actually use it; the destination page 404s otherwise.
  const canCreate = await can("assessments.create", { courseIds: [courseId] });
  return <AssessmentsTable courseId={courseId} rows={assessments} canCreate={canCreate} />;
}
