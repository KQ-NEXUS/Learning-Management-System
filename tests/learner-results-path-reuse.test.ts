/**
 * Plan 15-28 (NFR-02 statement budget): the results and obligations reads reuse a path the caller
 * loaded for the same enrolment instead of loading it again, and still load their own when the
 * handed-in path is for a different enrolment or none is given.
 */

import { describe, expect, it, vi } from "vitest";
import { createLearnerResultsService, type LearnerResultsDeps } from "@/server/services/learner-results-service";
import type { LearnerPath } from "@/server/services/learner-access";

const actor = { userId: "learner-1" };

function pathFor(enrolmentId: string): LearnerPath {
  return {
    enrolment: { id: enrolmentId, status: "ACTIVE" },
    courses: [{ courseId: "course-1", courseTitle: "Course", modules: [] }],
    progress: new Set<string>(),
    sequencing: [],
  } as unknown as LearnerPath;
}

function build() {
  const loadPath = vi.fn(async (_actor: unknown, enrolmentId: string) => pathFor(enrolmentId));
  const assessmentFindMany = vi.fn(async () => []);
  const deps = {
    // The enrolment is ACTIVE: the COMPLETED lookup finds nothing.
    enrolment: {
      findMany: vi.fn(async (args: { where: { status: string } }) =>
        args.where.status === "ACTIVE" ? [{ id: "enrolment-1", userId: "learner-1" }] : [],
      ),
    },
    loadPath,
    assessment: { findMany: assessmentFindMany },
    grade: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []) },
    attempt: { findMany: vi.fn(async () => []) },
    quizResult: vi.fn(),
    submissions: vi.fn(),
  } as unknown as LearnerResultsDeps;
  return { service: createLearnerResultsService(deps), loadPath, assessmentFindMany };
}

describe("learner results reuse a path the caller already loaded", () => {
  it("getOwnResults does not load the path again for the same enrolment", async () => {
    const { service, loadPath, assessmentFindMany } = build();
    await service.getOwnResults(actor, { enrolmentId: "enrolment-1" }, { path: pathFor("enrolment-1") });
    expect(loadPath).not.toHaveBeenCalled();
    expect(assessmentFindMany).toHaveBeenCalledOnce();
  });

  it("getOwnAssessmentObligations does not load the path again for the same enrolment", async () => {
    const { service, loadPath } = build();
    await service.getOwnAssessmentObligations(actor, { enrolmentId: "enrolment-1" }, { path: pathFor("enrolment-1") });
    expect(loadPath).not.toHaveBeenCalled();
  });

  it("loads its own path when the handed-in path is for another enrolment", async () => {
    const { service, loadPath } = build();
    await service.getOwnResults(actor, { enrolmentId: "enrolment-1" }, { path: pathFor("enrolment-2") });
    expect(loadPath).toHaveBeenCalledOnce();
    expect(loadPath).toHaveBeenCalledWith(actor, "enrolment-1", { includeCompleted: true });
  });

  it("loads its own path when none is given, exactly as before", async () => {
    const { service, loadPath } = build();
    await service.getOwnAssessmentObligations(actor, { enrolmentId: "enrolment-1" });
    expect(loadPath).toHaveBeenCalledOnce();
    expect(loadPath).toHaveBeenCalledWith(actor, "enrolment-1", { includeCompleted: false });
  });
});
