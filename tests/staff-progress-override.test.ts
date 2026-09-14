import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class FakeAuthorizationError extends Error {}
  class FakeAuthenticationError extends Error {}
  class FakeOverrideReasonRequiredError extends Error {}
  class FakeLessonNotOpenableError extends Error {}
  return {
    overrideLessonProgress: vi.fn(),
    FakeAuthorizationError,
    FakeAuthenticationError,
    FakeOverrideReasonRequiredError,
    FakeLessonNotOpenableError,
  };
});
const {
  FakeAuthorizationError,
  FakeAuthenticationError,
  FakeOverrideReasonRequiredError,
  FakeLessonNotOpenableError,
} = mocks;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

vi.mock("@/server/permissions", () => ({
  AuthorizationError: mocks.FakeAuthorizationError,
  AuthenticationError: mocks.FakeAuthenticationError,
}));

vi.mock("@/server/services/lesson-progress-service", () => ({
  overrideLessonProgress: mocks.overrideLessonProgress,
  OverrideReasonRequiredError: mocks.FakeOverrideReasonRequiredError,
  LessonNotOpenableError: mocks.FakeLessonNotOpenableError,
}));

import { overrideLessonProgressAction } from "@/app/staff/cohorts/[id]/progress-actions";

function form(over: Record<string, string> = {}): FormData {
  const data = new FormData();
  const base = {
    cohortId: "cohort-1",
    enrolmentId: "enr-1",
    lessonId: "lesson-1",
    complete: "true",
    reason: "Learner emailed proof of completion",
    ...over,
  };
  Object.entries(base).forEach(([key, value]) => data.set(key, value));
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("overrideLessonProgressAction (D-14, DD-31)", () => {
  it("delegates to overrideLessonProgress with the parsed fields, never an actor id", async () => {
    mocks.overrideLessonProgress.mockResolvedValue({
      enrolmentId: "enr-1",
      lessonId: "lesson-1",
      completed: true,
    });
    const result = await overrideLessonProgressAction(form());
    expect(result).toEqual({ ok: true });
    expect(mocks.overrideLessonProgress).toHaveBeenCalledWith({
      enrolmentId: "enr-1",
      lessonId: "lesson-1",
      complete: true,
      reason: "Learner emailed proof of completion",
    });
  });

  it("parses complete=false into a false boolean, never a truthy string", async () => {
    mocks.overrideLessonProgress.mockResolvedValue({
      enrolmentId: "enr-1",
      lessonId: "lesson-1",
      completed: false,
    });
    await overrideLessonProgressAction(form({ complete: "false" }));
    expect(mocks.overrideLessonProgress).toHaveBeenCalledWith(
      expect.objectContaining({ complete: false }),
    );
  });

  it("never reads formData actorId/userId fields", async () => {
    mocks.overrideLessonProgress.mockResolvedValue({
      enrolmentId: "enr-1",
      lessonId: "lesson-1",
      completed: true,
    });
    await overrideLessonProgressAction(form({ actorId: "someone-else", userId: "someone-else" }));
    const callArgs = mocks.overrideLessonProgress.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty("actorId");
    expect(callArgs).not.toHaveProperty("userId");
  });

  it("maps AuthorizationError to notFound(), never a form error", async () => {
    mocks.overrideLessonProgress.mockRejectedValue(new FakeAuthorizationError("denied"));
    await expect(overrideLessonProgressAction(form())).rejects.toThrow("notFound");
  });

  it("maps AuthenticationError to notFound()", async () => {
    mocks.overrideLessonProgress.mockRejectedValue(new FakeAuthenticationError("no session"));
    await expect(overrideLessonProgressAction(form())).rejects.toThrow("notFound");
  });

  it("surfaces a whitespace-only reason as a form error, never notFound and never a redirect", async () => {
    mocks.overrideLessonProgress.mockRejectedValue(
      new FakeOverrideReasonRequiredError(
        "A reason is required to override a learner's lesson progress.",
      ),
    );
    const result = await overrideLessonProgressAction(form({ reason: "   " }));
    expect(result).toEqual({
      ok: false,
      message: "A reason is required to override a learner's lesson progress.",
    });
  });

  it("surfaces a cross-course lesson id as a form error, not notFound", async () => {
    mocks.overrideLessonProgress.mockRejectedValue(new FakeLessonNotOpenableError("not found"));
    const result = await overrideLessonProgressAction(form());
    expect(result).toEqual({
      ok: false,
      message: "This lesson could not be found on this learner's enrolled path.",
    });
  });

  it("revalidates the cohort detail route and the per-learner page on success", async () => {
    const { revalidatePath } = await import("next/cache");
    mocks.overrideLessonProgress.mockResolvedValue({
      enrolmentId: "enr-1",
      lessonId: "lesson-1",
      completed: true,
    });
    await overrideLessonProgressAction(form());
    expect(revalidatePath).toHaveBeenCalledWith("/staff/cohorts/cohort-1", "page");
    expect(revalidatePath).toHaveBeenCalledWith(
      "/staff/cohorts/cohort-1/learners/enr-1",
      "page",
    );
  });

  it("re-throws an unrecognised error rather than swallowing it", async () => {
    mocks.overrideLessonProgress.mockRejectedValue(new Error("boom"));
    await expect(overrideLessonProgressAction(form())).rejects.toThrow("boom");
  });
});
