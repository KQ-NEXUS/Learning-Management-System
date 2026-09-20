/**
 * Async assessment authoring scope resolver (Phase 10).
 *
 * Turns an assessmentId into a `ResourceScope` the authorization core
 * (`src/server/permissions/scope.ts` `grantMatches`) can match a COURSE,
 * PROGRAMME or GLOBAL grant against. This is the resolver staff authoring
 * actions (`assessments.create`/`assessments.edit`) use — grading actions
 * scope through `enrolmentCohortScope` (cohort-scope.ts) instead, since
 * grading is Cohort-scoped (D-05), not Course-scoped.
 *
 * This file is authorization *input*, not an authorization *check*. It must
 * not take a value import from the permissions layer or anything under it —
 * only the `ResourceScope` type, written as `import type`. Keeping that
 * layer out of here is what stops it reaching the scheduled-function import
 * closure (`tests/boundary.test.ts`), the same constraint `cohort-scope.ts`
 * and the `*-system-service.ts` modules document in their headers.
 *
 * The resolver takes ONLY an id and reads the row from the database. Its
 * signature does not accept a caller-supplied courseId — a caller-asserted
 * parent id would be a scope the caller chose (same T-05-06 class threat
 * `cohort-scope.ts` documents, tracked here as T-10-07).
 */

import { prisma } from "@/server/db";
import type { ResourceScope } from "@/server/permissions/scope";

/** The `Assessment` delegate slice this module uses. Injected for unit tests. */
export type AssessmentScopeDelegate = {
  findUnique(args: {
    where: { id: string };
    select: { courseId: true };
  }): Promise<{ courseId: string } | null>;
};

export type AssessmentScopeDeps = {
  assessment: AssessmentScopeDelegate;
};

export function createAssessmentScopeResolvers(deps: AssessmentScopeDeps) {
  /**
   * Resolves an assessmentId to a `ResourceScope` populating `courseIds`
   * from the Assessment row's own `courseId` — never from anything the
   * caller supplied. A missing row returns `{}` so the authorization core
   * denies by default (T-10-07); a missing Assessment must never widen
   * scope.
   */
  async function assessmentCourseScope(assessmentId: string): Promise<ResourceScope> {
    const row = await deps.assessment.findUnique({
      where: { id: assessmentId },
      select: { courseId: true },
    });

    if (!row) {
      return {};
    }

    return { courseIds: [row.courseId] };
  }

  return { assessmentCourseScope };
}

const built = createAssessmentScopeResolvers({
  assessment: prisma.assessment as unknown as AssessmentScopeDelegate,
});

/** Bound to `prisma.assessment` — the resolver Assessment authoring actions use as `toScope`. */
export const assessmentCourseScope = built.assessmentCourseScope;
