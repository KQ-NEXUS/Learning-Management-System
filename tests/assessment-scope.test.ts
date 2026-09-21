/**
 * Task 3 (plan 10-01): the async assessment authoring scope resolver.
 *
 * Drives `createAssessmentScopeResolvers` with an in-memory fake delegate.
 * Proves a known assessment resolves to `{ courseIds: [courseId] }`, that an
 * unknown id denies by default (`{}`) without throwing, and that the
 * delegate is queried with a `select` naming only `courseId`.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createAssessmentScopeResolvers,
  type AssessmentScopeDeps,
} from "@/server/services/assessment-scope";

type AssessmentRow = { id: string; courseId: string };

function makeDeps(assessments: AssessmentRow[]) {
  const findUnique = vi.fn(async ({ where }: { where: { id: string } }) => {
    const row = assessments.find((a) => a.id === where.id);
    return row ? { courseId: row.courseId } : null;
  });
  const deps: AssessmentScopeDeps = { assessment: { findUnique } };
  return { deps, findUnique };
}

describe("assessmentCourseScope", () => {
  it("known assessment → { courseIds: [courseId] }", async () => {
    const { deps } = makeDeps([{ id: "asm-1", courseId: "course-x" }]);
    const { assessmentCourseScope } = createAssessmentScopeResolvers(deps);
    expect(await assessmentCourseScope("asm-1")).toEqual({ courseIds: ["course-x"] });
  });

  it("missing assessment → {} (deny by default), does not throw", async () => {
    const { deps } = makeDeps([]);
    const { assessmentCourseScope } = createAssessmentScopeResolvers(deps);
    await expect(assessmentCourseScope("ghost")).resolves.toEqual({});
  });

  it("findUnique is called with a select naming only courseId", async () => {
    const { deps, findUnique } = makeDeps([{ id: "asm-1", courseId: "course-x" }]);
    const { assessmentCourseScope } = createAssessmentScopeResolvers(deps);
    await assessmentCourseScope("asm-1");
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "asm-1" },
      select: { courseId: true },
    });
  });
});
