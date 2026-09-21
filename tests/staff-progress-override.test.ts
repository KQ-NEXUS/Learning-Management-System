import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class FakeAuthorizationError extends Error {}
  class FakeAuthenticationError extends Error {}
  class FakeOverrideReasonRequiredError extends Error {}
  class FakeLessonNotOpenableError extends Error {}
  return {
    overrideLessonProgress: vi.fn(),
    loadCohortRoster: vi.fn(),
    loadLearnerPath: vi.fn(),
    enrolmentCohortScope: vi.fn(),
    can: vi.fn(),
    notFound: vi.fn(() => {
      throw new Error("notFound");
    }),
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
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

vi.mock("@/server/permissions", () => ({
  AuthorizationError: mocks.FakeAuthorizationError,
  AuthenticationError: mocks.FakeAuthenticationError,
  can: mocks.can,
}));

vi.mock("@/server/services/lesson-progress-service", () => ({
  overrideLessonProgress: mocks.overrideLessonProgress,
  OverrideReasonRequiredError: mocks.FakeOverrideReasonRequiredError,
  LessonNotOpenableError: mocks.FakeLessonNotOpenableError,
}));

vi.mock("@/server/services/roster-service", () => ({
  loadCohortRoster: mocks.loadCohortRoster,
}));

vi.mock("@/server/services/learner-access", () => ({
  loadLearnerPath: mocks.loadLearnerPath,
}));

vi.mock("@/server/services/cohort-scope", () => ({
  enrolmentCohortScope: mocks.enrolmentCohortScope,
}));

import { overrideLessonProgressAction } from "@/app/staff/cohorts/[id]/progress-actions";
import LearnerProgressPage from "@/app/staff/cohorts/[id]/learners/[enrolmentId]/page";
import { ProgressOverridePanel } from "@/app/staff/cohorts/[id]/learners/[enrolmentId]/ProgressOverridePanel";

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

// ---------------------------------------------------------------------------
// LearnerProgressPage (D-14, DD-31, T-09-44, T-09-45, T-09-46)
//
// A Server Component: invoked directly, its returned element tree (or its
// `notFound()` throw) is inspected — the same convention
// `tests/arrange-page-route.test.ts` / `tests/lesson-preview-route.test.ts`
// use for every other page in this codebase. Creating JSX never executes a
// component's body (only actual reconciliation does), so walking `.props`
// proves what data reaches `ProgressOverridePanel` without any DOM/jsdom and
// without triggering that component's own hooks.
// ---------------------------------------------------------------------------

type AnyElement = { type?: unknown; props?: Record<string, unknown> } | null | undefined;

function collectDescendants(el: AnyElement): AnyElement[] {
  if (!el || typeof el !== "object") return [];
  const out: AnyElement[] = [el];
  const props = el.props ?? {};
  const queue: unknown[] = [];
  if (props.children !== undefined) queue.push(props.children);
  if (Array.isArray(props.sections)) {
    for (const section of props.sections as Array<{ content?: unknown }>) {
      if (section?.content !== undefined) queue.push(section.content);
    }
  }
  for (const item of queue) {
    const items = Array.isArray(item) ? item : [item];
    for (const child of items) out.push(...collectDescendants(child as AnyElement));
  }
  return out;
}

function findByType(root: AnyElement, type: unknown): AnyElement {
  return collectDescendants(root).find((el) => el?.type === type) ?? null;
}

function rosterRow(over: Record<string, unknown> = {}) {
  return {
    learnerId: "user-1",
    learnerName: "Ada Lovelace",
    learnerEmail: "ada@example.test",
    enrolmentId: "enr-1",
    status: "ACTIVE",
    transitionCount: 0,
    latestTransition: null,
    accessStartsAt: null,
    accessEndsAt: null,
    instructors: [],
    attendance: { kind: "no-rule" },
    progress: { kind: "tracked", completed: 1, total: 2 },
    assessment: { kind: "deferred", phase: 10 },
    completion: { kind: "deferred", phase: 11 },
    ...over,
  };
}

function decoratedLesson(over: Record<string, unknown> = {}) {
  return {
    id: "lesson-1",
    title: "Lesson One",
    type: "TEXT",
    position: 0,
    required: true,
    allowManualComplete: true,
    withdrawnAt: null,
    locked: false,
    blockingLessonTitle: null,
    completed: false,
    completedSource: null,
    completedAt: null,
    ...over,
  };
}

function learnerPath(lessons: ReturnType<typeof decoratedLesson>[]) {
  return {
    enrolment: { id: "enr-1", cohortId: "cohort-1", status: "ACTIVE" },
    courses: [
      {
        courseId: "course-1",
        courseTitle: "Course One",
        modules: [{ id: "mod-1", title: "Module One", position: 0, lessons }],
      },
    ],
    progress: new Set(lessons.filter((l) => l.completed).map((l) => l.id)),
    sequencing: [],
  };
}

const pageParams = (over: Record<string, string> = {}) =>
  ({
    params: Promise.resolve({ id: "cohort-1", enrolmentId: "enr-1", ...over }),
  }) as never;

describe("LearnerProgressPage (D-14, DD-31)", () => {
  beforeEach(() => {
    mocks.can.mockResolvedValue(true);
    mocks.enrolmentCohortScope.mockResolvedValue({ cohortId: "cohort-1" });
  });

  it("maps AuthorizationError from loadCohortRoster to notFound()", async () => {
    mocks.loadCohortRoster.mockRejectedValue(new FakeAuthorizationError("denied"));
    await expect(LearnerProgressPage(pageParams())).rejects.toThrow("notFound");
  });

  it("maps AuthenticationError from loadCohortRoster to notFound()", async () => {
    mocks.loadCohortRoster.mockRejectedValue(new FakeAuthenticationError("no session"));
    await expect(LearnerProgressPage(pageParams())).rejects.toThrow("notFound");
  });

  it("rejects a cross-cohort enrolmentId with notFound(), never rendering (T-09-44)", async () => {
    mocks.loadCohortRoster.mockResolvedValue([rosterRow({ enrolmentId: "some-other-enrolment" })]);
    await expect(LearnerProgressPage(pageParams())).rejects.toThrow("notFound");
    expect(mocks.loadLearnerPath).not.toHaveBeenCalled();
  });

  it("defensively 404s if loadLearnerPath returns null despite a matching roster row", async () => {
    mocks.loadCohortRoster.mockResolvedValue([rosterRow()]);
    mocks.loadLearnerPath.mockResolvedValue(null);
    await expect(LearnerProgressPage(pageParams())).rejects.toThrow("notFound");
  });

  it("loads the learner's path on the owner's behalf, using the roster row's learnerId", async () => {
    mocks.loadCohortRoster.mockResolvedValue([rosterRow({ learnerId: "user-42" })]);
    mocks.loadLearnerPath.mockResolvedValue(learnerPath([decoratedLesson()]));
    await LearnerProgressPage(pageParams());
    expect(mocks.loadLearnerPath).toHaveBeenCalledWith({ userId: "user-42" }, "enr-1");
  });

  it("passes each pinned lesson through to the override panel, including an AUTO_VIDEO source and its timestamp", async () => {
    mocks.loadCohortRoster.mockResolvedValue([rosterRow()]);
    mocks.loadLearnerPath.mockResolvedValue(
      learnerPath([
        decoratedLesson({ id: "l1", title: "Intro", completed: true, completedSource: "MANUAL" }),
        decoratedLesson({
          id: "l2",
          title: "Video lesson",
          completed: true,
          completedSource: "AUTO_VIDEO",
          completedAt: new Date("2026-03-01T00:00:00.000Z"),
        }),
        decoratedLesson({ id: "l3", title: "Untouched", completed: false }),
      ]),
    );

    const result = await LearnerProgressPage(pageParams());
    const panel = findByType(result as AnyElement, ProgressOverridePanel);
    expect(panel).toBeTruthy();
    const lessons = panel!.props!.lessons as Array<Record<string, unknown>>;
    expect(lessons).toHaveLength(3);
    const videoLesson = lessons.find((l) => l.id === "l2");
    expect(videoLesson).toMatchObject({
      completedSource: "AUTO_VIDEO",
      completedAt: "2026-03-01T00:00:00.000Z",
    });
    expect(lessons.find((l) => l.id === "l3")).toMatchObject({ completed: false, completedAt: null });
  });

  it("threads the RBAC courtesy check into canOverride — true when the caller holds enrolments.manage", async () => {
    mocks.loadCohortRoster.mockResolvedValue([rosterRow()]);
    mocks.loadLearnerPath.mockResolvedValue(learnerPath([decoratedLesson()]));
    mocks.can.mockResolvedValue(true);

    const result = await LearnerProgressPage(pageParams());
    const panel = findByType(result as AnyElement, ProgressOverridePanel);
    expect(panel!.props!.canOverride).toBe(true);
  });

  it("threads canOverride as false for a caller without enrolments.manage", async () => {
    mocks.loadCohortRoster.mockResolvedValue([rosterRow()]);
    mocks.loadLearnerPath.mockResolvedValue(learnerPath([decoratedLesson()]));
    mocks.can.mockResolvedValue(false);

    const result = await LearnerProgressPage(pageParams());
    const panel = findByType(result as AnyElement, ProgressOverridePanel);
    expect(panel!.props!.canOverride).toBe(false);
  });
});
