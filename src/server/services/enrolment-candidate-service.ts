/**
 * Who may be offered when staff add an enrolment by hand (owner request, 2026-10-04).
 *
 * Roster → Add enrolment used to ask for a learner id typed by hand. The picker
 * that replaces it needs a list of learners, and that list is this service's
 * whole job: learner accounts, searchable by name, email or learner number, each
 * marked if they already hold a place in this cohort.
 *
 * The learner number matters here more than anywhere: staff often do not know a
 * learner's name, and two learners can share one. The number is the one thing
 * that tells them apart, so it is both searchable and shown on every row.
 *
 * It is a read gated exactly like the action it serves: `enrolments.manage` on
 * the cohort's own scope. Someone who may not add enrolments to this cohort gets
 * no list of learners from here. Staff accounts and deactivated accounts are
 * never listed.
 */

import { prisma } from "@/server/db";
import { withPermission as liveWithPermission } from "@/server/permissions";
import { cohortResourceScope } from "@/server/services/cohort-scope";

export const ENROLMENT_CANDIDATE_LIMIT = 50;

/** Statuses that mean the learner already has a place, or a pending one, in the cohort. */
const HOLDING_STATUSES = ["ACTIVE", "COMPLETED", "PENDING_PAYMENT"] as const;

export type EnrolmentCandidate = {
  id: string;
  name: string;
  email: string;
  /** `null` for a learner who registered before numbers were switched on. */
  learnerNumber: string | null;
  /** The account exists but its email address has not been confirmed yet. */
  unverified: boolean;
  /** The status of the place they already hold in this cohort, or `null` if they hold none. */
  enrolledStatus: string | null;
};

export type EnrolmentCandidateList = {
  people: EnrolmentCandidate[];
  /** How many learners match in all; more than `people.length` when the list was cut short. */
  total: number;
};

type CandidateUserRow = {
  id: string;
  name: string;
  email: string;
  learnerNumber: string | null;
  status: string;
  enrolments: { status: string }[];
};

export type EnrolmentCandidateDeps = {
  user: {
    findMany(args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
      orderBy: Record<string, unknown>[];
      take: number;
    }): Promise<CandidateUserRow[]>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
  toScope: typeof cohortResourceScope;
  withPermission: typeof liveWithPermission;
};

export function createEnrolmentCandidateService(deps: EnrolmentCandidateDeps) {
  const listEnrolmentCandidates = deps.withPermission<{ cohortId: string; query?: string }>(
    "enrolments.manage",
    (input) => deps.toScope(input.cohortId),
  )(async (input): Promise<EnrolmentCandidateList> => {
    const query = (input.query ?? "").trim().slice(0, 100);

    const where = {
      isStaff: false,
      status: { in: ["ACTIVE", "PENDING_VERIFICATION"] },
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { email: { contains: query, mode: "insensitive" } },
              { learnerNumber: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      deps.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          learnerNumber: true,
          status: true,
          enrolments: {
            where: { cohortId: input.cohortId, status: { in: [...HOLDING_STATUSES] } },
            select: { status: true },
          },
        },
        // Same-named learners sit together, in a stable order.
        orderBy: [{ name: "asc" }, { email: "asc" }],
        take: ENROLMENT_CANDIDATE_LIMIT,
      }),
      deps.user.count({ where }),
    ]);

    return {
      total,
      people: users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        learnerNumber: user.learnerNumber,
        unverified: user.status === "PENDING_VERIFICATION",
        enrolledStatus: user.enrolments[0]?.status ?? null,
      })),
    };
  });

  return { listEnrolmentCandidates };
}

const built = createEnrolmentCandidateService({
  user: prisma.user as unknown as EnrolmentCandidateDeps["user"],
  toScope: cohortResourceScope,
  withPermission: liveWithPermission,
});

export const listEnrolmentCandidates = built.listEnrolmentCandidates;
