import { describe, expect, it, vi } from "vitest";
import { createTestWithPermission, grant } from "./support/harness";
import { AuthorizationError } from "@/server/permissions";
import { createGradeOverrideService, GradeNotReleasedError, OverrideReasonRequiredError } from "@/server/services/grade-override-service";

function harness(status = "RELEASED", scope = "cohort-1") {
  let grade = { id: "g1", assessmentId: "a1", enrolmentId: "e1", score: 40, maxScore: 100, passed: false, status };
  const history: Array<Record<string, unknown>> = [];
  const create = vi.fn(async ({ data }) => { const row = { id: String(history.length), createdAt: new Date(), ...data }; history.push(row); return row; });
  const updateMany = vi.fn(async ({ data }) => { grade = { ...grade, ...data }; return { count: 1 }; });
  const events = vi.fn(async () => {});
  const audit = vi.fn(async () => {});
  const reactToGradeOverride = vi.fn(async () => {});
  const service = createGradeOverrideService({
    grade: { findUnique: async () => grade },
    enrolmentScope: async () => ({ cohortId: "cohort-1" }),
    withPermission: createTestWithPermission([grant("grades.manage", "COHORT", scope)]).withPermission,
    runInTransaction: async (fn) => fn({
      grade: { findUnique: async () => grade, updateMany },
      assessment: { findUnique: async () => ({ passMark: 50 }) },
      gradeOverride: { create, findMany: async () => history },
    } as never),
    writeEvent: events as never, audit,
    reactToGradeOverride,
  });
  return { service, create, updateMany, events, audit, reactToGradeOverride, history, get grade() { return grade; } };
}

describe("released grade override", () => {
  it("refuses a draft without any writes", async () => {
    const h = harness("DRAFT");
    await expect(h.service.overrideGrade({ gradeId: "g1", newScore: 60, reason: "Correct grading mistake" })).rejects.toBeInstanceOf(GradeNotReleasedError);
    for (const write of [h.create, h.updateMany, h.events, h.audit, h.reactToGradeOverride]) expect(write).not.toHaveBeenCalled();
  });
  it.each(["", "   ", "Too short"])("refuses reason %j before writes", async (reason) => {
    const h = harness();
    await expect(h.service.overrideGrade({ gradeId: "g1", newScore: 60, reason })).rejects.toBeInstanceOf(OverrideReasonRequiredError);
    for (const write of [h.create, h.updateMany, h.events, h.audit, h.reactToGradeOverride]) expect(write).not.toHaveBeenCalled();
  });
  it.each([-1, 101, 1.5, NaN])("refuses invalid score %s without writes", async (newScore) => {
    const h = harness();
    await expect(h.service.overrideGrade({ gradeId: "g1", newScore, reason: "Correct grading mistake" })).rejects.toThrow();
    expect(h.create).not.toHaveBeenCalled(); expect(h.updateMany).not.toHaveBeenCalled();
  });
  it("preserves attributed append-only history, release status, event and audit", async () => {
    const h = harness();
    const first = await h.service.overrideGrade({ gradeId: "g1", newScore: 60, reason: "  Correct grading mistake  " });
    expect(first.override).toMatchObject({ previousScore: 40, newScore: 60, reason: "Correct grading mistake", actorId: "user-1" });
    expect(h.grade).toMatchObject({ score: 60, passed: true, status: "RELEASED" });
    expect(h.events).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "grade.overridden", payload: expect.objectContaining({ passedChanged: true }) }));
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "grade.overridden", reason: "Correct grading mistake", actorId: "user-1" }));
    await h.service.overrideGrade({ gradeId: "g1", newScore: 70, reason: "Second grading correction" });
    expect(h.history).toHaveLength(2);
    expect(h.history[0]).toMatchObject({ previousScore: 40, newScore: 60 });
    expect(h.history[1]).toMatchObject({ previousScore: 60, newScore: 70 });
    expect(h.events).toHaveBeenCalledTimes(2); expect(h.audit).toHaveBeenCalledTimes(2);
  });
  it("calls reactToGradeOverride inside the transaction with the enrolment/assessment/passedChanged/actor context", async () => {
    const h = harness();
    await h.service.overrideGrade({ gradeId: "g1", newScore: 60, reason: "Correct grading mistake" });
    expect(h.reactToGradeOverride).toHaveBeenCalledTimes(1);
    expect(h.reactToGradeOverride).toHaveBeenCalledWith(
      expect.anything(),
      { enrolmentId: "e1", assessmentId: "a1", passedChanged: true, actorId: "user-1" },
    );
  });
  it("denies another cohort's grant", async () => {
    const h = harness("RELEASED", "other-cohort");
    await expect(h.service.overrideGrade({ gradeId: "g1", newScore: 60, reason: "Correct grading mistake" })).rejects.toBeInstanceOf(AuthorizationError);
    expect(h.create).not.toHaveBeenCalled();
  });
  it("refuses a stale correction before writing history, event or audit", async () => {
    const h = harness(); h.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(h.service.overrideGrade({ gradeId: "g1", newScore: 60, reason: "Correct grading mistake" })).rejects.toThrow("changed");
    expect(h.create).not.toHaveBeenCalled(); expect(h.events).not.toHaveBeenCalled(); expect(h.audit).not.toHaveBeenCalled();
    expect(h.reactToGradeOverride).not.toHaveBeenCalled();
  });
});
