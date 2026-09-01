import { describe, expect, it } from "vitest";
import { courseScope } from "@/server/services/course-service";

describe("courseScope", () => {
  it("maps a course id to a course-scoped resource", () => {
    expect(courseScope("course-1")).toEqual({ courseIds: ["course-1"] });
  });

  it("produces a scope a course-scoped grant can match", () => {
    const scope = courseScope("course-1");
    expect(scope.courseIds).toContain("course-1");
    expect(scope.cohortId).toBeUndefined();
    expect(scope.programmeId).toBeUndefined();
  });
});
