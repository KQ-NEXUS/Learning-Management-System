/**
 * COH-07 — a staff read of one learner's results, from the cohort.
 *
 * Kept out of `learner-results-service.ts` on purpose: that file is the
 * learner's own read (DD-15 — every enrolment derived from the authenticated
 * owner, no permission imports). This file is the staff side, gated by
 * `submissions.view`, and reuses the learner read on the learner's behalf.
 */
import { prisma } from "@/server/db";
import { withPermission as liveWithPermission } from "@/server/permissions";
import type { Actor, createWithPermission, RawGrant } from "@/server/permissions/with-permission";
import { hasPermission, isGrantActive, narrowScopeToCourse, type ResourceScope } from "@/server/permissions/scope";
import { loadGrantsForUser } from "./grant-service";
import { enrolmentCohortScope } from "./cohort-scope";
import { getOwnResults, type LearnerResultCard } from "./learner-results-service";

export type { LearnerResultCard };

export type StaffLearnerResultsDeps = {
  withPermission: ReturnType<typeof createWithPermission>;
  /** The enrolment's cohort scope (cohort, programme and every course it delivers). */
  enrolmentScope: (enrolmentId: string) => Promise<ResourceScope>;
  enrolmentOwner: (enrolmentId: string) => Promise<{ userId: string } | null>;
  grantsFor: (userId: string) => Promise<RawGrant[]>;
  getOwnResults: (actor: Actor, input: { enrolmentId?: string }) => Promise<LearnerResultCard[]>;
};

/**
 * Staff act on the learner's behalf — the same pattern the staff progress
 * page uses for `loadLearnerPath` — once `submissions.view` over the
 * learner's cohort is proven, so the numbers are exactly what the learner
 * sees (released grades only, effective attempt, overrides). Each result is
 * then kept only if the caller's grant also covers that assessment's course
 * (F-05's `narrowScopeToCourse`): a COURSE-scoped grader in a programme
 * cohort sees their own course's results, not every member course's.
 */
export function createStaffLearnerResultsService(deps: StaffLearnerResultsDeps) {
  const loadLearnerResultsForStaff = deps.withPermission<{ enrolmentId: string }>(
    "submissions.view",
    (input) => deps.enrolmentScope(input.enrolmentId),
  )(async (input, ctx): Promise<LearnerResultCard[]> => {
    const owner = await deps.enrolmentOwner(input.enrolmentId);
    if (!owner) return [];
    const [cards, scope, rawGrants] = await Promise.all([
      deps.getOwnResults({ userId: owner.userId }, { enrolmentId: input.enrolmentId }),
      deps.enrolmentScope(input.enrolmentId),
      deps.grantsFor(ctx.actor.userId),
    ]);
    const now = new Date();
    const grants = rawGrants
      .filter((g) => isGrantActive(g, now))
      .map(({ permission, scopeType, scopeId }) => ({ permission, scopeType, scopeId }));
    return cards.filter((card) =>
      hasPermission(grants, "submissions.view", narrowScopeToCourse(scope, card.courseId)),
    );
  });
  return { loadLearnerResultsForStaff };
}

export const loadLearnerResultsForStaff = createStaffLearnerResultsService({
  withPermission: liveWithPermission,
  enrolmentScope: async (enrolmentId) => enrolmentCohortScope(enrolmentId),
  enrolmentOwner: (enrolmentId) =>
    prisma.enrolment.findUnique({ where: { id: enrolmentId }, select: { userId: true } }),
  grantsFor: loadGrantsForUser,
  getOwnResults,
}).loadLearnerResultsForStaff;
