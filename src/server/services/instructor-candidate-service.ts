/**
 * Who may be offered as an instructor for a cohort (owner request, 2026-10-04).
 *
 * The cohort screen used to ask for a user id typed by hand. The picker that
 * replaces it needs a list of people, and that list is this service's whole job:
 * active staff accounts, searchable by name or email, each with the roles they
 * hold so two people with the same name can be told apart.
 *
 * It is a read gated exactly like the action it serves: `cohorts.manage` on the
 * cohort's own scope. Someone who may not manage this cohort's instructors gets
 * no list of staff from here. Learner accounts are never listed.
 */

import { prisma } from "@/server/db";
import { withPermission as liveWithPermission } from "@/server/permissions";
import { cohortResourceScope } from "@/server/services/cohort-scope";

export const INSTRUCTOR_CANDIDATE_LIMIT = 50;

export type InstructorCandidate = {
  id: string;
  name: string;
  email: string;
  /** Names of the roles the person actively holds, alphabetical. */
  roles: string[];
  /** Already an instructor on this cohort. */
  assigned: boolean;
};

type CandidateUserRow = {
  id: string;
  name: string;
  email: string;
  assignments: { role: { name: string } }[];
};

export type InstructorCandidateDeps = {
  user: {
    findMany(args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
      orderBy: Record<string, unknown>;
      take: number;
    }): Promise<CandidateUserRow[]>;
  };
  cohortInstructor: {
    findMany(args: { where: { cohortId: string }; select: { userId: true } }): Promise<{ userId: string }[]>;
  };
  toScope: typeof cohortResourceScope;
  withPermission: typeof liveWithPermission;
};

export function createInstructorCandidateService(deps: InstructorCandidateDeps) {
  const listInstructorCandidates = deps.withPermission<{ cohortId: string; query?: string }>(
    "cohorts.manage",
    (input) => deps.toScope(input.cohortId),
  )(async (input): Promise<InstructorCandidate[]> => {
    const query = (input.query ?? "").trim().slice(0, 100);

    const [users, current] = await Promise.all([
      deps.user.findMany({
        where: {
          isStaff: true,
          status: "ACTIVE",
          ...(query
            ? {
                OR: [
                  { name: { contains: query, mode: "insensitive" } },
                  { email: { contains: query, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
          assignments: {
            where: { active: true, revokedAt: null, role: { active: true } },
            select: { role: { select: { name: true } } },
          },
        },
        orderBy: { name: "asc" },
        take: INSTRUCTOR_CANDIDATE_LIMIT,
      }),
      deps.cohortInstructor.findMany({ where: { cohortId: input.cohortId }, select: { userId: true } }),
    ]);

    const assigned = new Set(current.map((row) => row.userId));
    return users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      roles: [...new Set(user.assignments.map((assignment) => assignment.role.name))].sort(),
      assigned: assigned.has(user.id),
    }));
  });

  return { listInstructorCandidates };
}

const built = createInstructorCandidateService({
  user: prisma.user as unknown as InstructorCandidateDeps["user"],
  cohortInstructor: prisma.cohortInstructor as unknown as InstructorCandidateDeps["cohortInstructor"],
  toScope: cohortResourceScope,
  withPermission: liveWithPermission,
});

export const listInstructorCandidates = built.listInstructorCandidates;
