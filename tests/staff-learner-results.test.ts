import { describe, expect, it, vi } from "vitest";
import { createTestWithPermission, grant } from "./support/harness";
import { AuthorizationError } from "@/server/permissions/with-permission";
import {
  createStaffLearnerResultsService,
  type LearnerResultCard,
} from "@/server/services/staff-learner-results-service";

/**
 * COH-07 — staff see a learner's quiz (and assignment) results from the
 * cohort. Gated on submissions.view over the learner's cohort; each result is
 * then narrowed to its assessment's course (F-05), so a course-scoped grader in
 * a programme cohort sees only their course.
 */

function card(assessmentId: string, courseId: string, over: Partial<LearnerResultCard> = {}): LearnerResultCard {
  return {
    assessmentId, courseId, title: `Quiz ${assessmentId}`, type: "QUIZ",
    effectiveScore: 8, maxScore: 10, passed: true, passMark: 5, feedback: null,
    attemptsRemaining: 1, history: [], overrides: [], ...over,
  };
}

function service(grants: Parameters<typeof createTestWithPermission>[0], cards: LearnerResultCard[] = [card("q1", "c1"), card("q2", "c2")]) {
  const { withPermission } = createTestWithPermission(grants, { userId: "staff-1" });
  const getOwnResults = vi.fn(async () => cards);
  const svc = createStaffLearnerResultsService({
    withPermission,
    enrolmentScope: async () => ({ cohortId: "cohort-1", programmeId: "prog-1", courseIds: ["c1", "c2"] }),
    enrolmentOwner: async (id) => (id === "enr-1" ? { userId: "learner-1" } : null),
    grantsFor: async () => grants,
    getOwnResults,
  });
  return { svc, getOwnResults };
}

describe("loadLearnerResultsForStaff (COH-07)", () => {
  it("reads the learner's own results on their behalf, for a cohort-scoped grant", async () => {
    const { svc, getOwnResults } = service([grant("submissions.view", "COHORT", "cohort-1")]);
    const results = await svc.loadLearnerResultsForStaff({ enrolmentId: "enr-1" });
    expect(results.map((r) => r.assessmentId)).toEqual(["q1", "q2"]);
    expect(getOwnResults).toHaveBeenCalledWith({ userId: "learner-1" }, { enrolmentId: "enr-1" });
  });

  it("a COURSE-scoped grader sees only their course's results (F-05)", async () => {
    const { svc } = service([grant("submissions.view", "COURSE", "c1")]);
    const results = await svc.loadLearnerResultsForStaff({ enrolmentId: "enr-1" });
    expect(results.map((r) => r.assessmentId)).toEqual(["q1"]);
  });

  it("no submissions.view over the cohort is refused, and nothing is read", async () => {
    const { svc, getOwnResults } = service([grant("cohorts.view", "COHORT", "cohort-1")]);
    await expect(svc.loadLearnerResultsForStaff({ enrolmentId: "enr-1" })).rejects.toBeInstanceOf(AuthorizationError);
    expect(getOwnResults).not.toHaveBeenCalled();
  });

  it("an unknown enrolment reads nothing", async () => {
    const { svc, getOwnResults } = service([grant("submissions.view")]);
    expect(await svc.loadLearnerResultsForStaff({ enrolmentId: "missing" })).toEqual([]);
    expect(getOwnResults).not.toHaveBeenCalled();
  });
});
