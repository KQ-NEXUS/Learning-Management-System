import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/app/(learner)/learn/[enrolmentId]/lessons/[lessonId]/actions.ts`
 * (09-11 Task 2).
 *
 * Mirrors `tests/staff-progress-override.test.ts`'s convention of a full
 * mock of `@/server/services/lesson-progress-service` with fake error
 * classes standing in for the real ones — the action's own `instanceof`
 * checks are against whatever the module import resolves to, so a fake
 * class substituted at the same export name satisfies them without needing
 * the real service (and its live-Prisma singleton) constructed at all.
 */

const mocks = vi.hoisted(() => {
  class FakeLessonNotOpenableError extends Error {
    enrolmentId: string;
    lessonId: string;
    reason: "not-found" | "locked" | "access-window-closed";
    constructor(
      enrolmentId: string,
      lessonId: string,
      reason: "not-found" | "locked" | "access-window-closed",
    ) {
      super(reason);
      this.name = "LessonNotOpenableError";
      this.enrolmentId = enrolmentId;
      this.lessonId = lessonId;
      this.reason = reason;
    }
  }
  class FakeManualCompletionNotPermittedError extends Error {
    lessonId: string;
    constructor(lessonId: string) {
      super("not permitted");
      this.name = "ManualCompletionNotPermittedError";
      this.lessonId = lessonId;
    }
  }
  class FakeNotAVideoLessonError extends Error {
    lessonId: string;
    constructor(lessonId: string) {
      super("not a video lesson");
      this.name = "NotAVideoLessonError";
      this.lessonId = lessonId;
    }
  }
  class FakeInvalidWatchProgressError extends Error {
    field: string;
    value: number;
    constructor(field: string, value: number) {
      super("invalid watch progress");
      this.name = "InvalidWatchProgressError";
      this.field = field;
      this.value = value;
    }
  }
  return {
    getCurrentActor: vi.fn(),
    markLessonComplete: vi.fn(),
    undoLessonComplete: vi.fn(),
    recordWatchProgress: vi.fn(),
    revalidatePath: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    }),
    FakeLessonNotOpenableError,
    FakeManualCompletionNotPermittedError,
    FakeNotAVideoLessonError,
    FakeInvalidWatchProgressError,
  };
});

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/auth/current-actor", () => ({ getCurrentActor: mocks.getCurrentActor }));
vi.mock("@/server/services/lesson-progress-service", () => ({
  markLessonComplete: mocks.markLessonComplete,
  undoLessonComplete: mocks.undoLessonComplete,
  recordWatchProgress: mocks.recordWatchProgress,
  LessonNotOpenableError: mocks.FakeLessonNotOpenableError,
  ManualCompletionNotPermittedError: mocks.FakeManualCompletionNotPermittedError,
  NotAVideoLessonError: mocks.FakeNotAVideoLessonError,
  InvalidWatchProgressError: mocks.FakeInvalidWatchProgressError,
}));

import {
  markLessonCompleteAction,
  undoLessonCompleteAction,
  recordWatchProgressAction,
} from "@/app/(learner)/learn/[enrolmentId]/lessons/[lessonId]/actions";

const ACTOR = { userId: "user-a", roles: [] };

function form(over: Record<string, string> = {}) {
  const data = new FormData();
  data.set("enrolmentId", "enrolment-1");
  data.set("lessonId", "lesson-1");
  Object.entries(over).forEach(([key, value]) => data.set(key, value));
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
  mocks.getCurrentActor.mockResolvedValue(ACTOR);
});

describe("markLessonCompleteAction", () => {
  it("redirects a signed-out caller to sign-in instead of calling the service", async () => {
    mocks.getCurrentActor.mockResolvedValue(null);

    await expect(markLessonCompleteAction(form())).rejects.toThrow("NEXT_REDIRECT:/signin");
    expect(mocks.markLessonComplete).not.toHaveBeenCalled();
  });

  it("calls the service with the session-derived actor, ignoring a userId planted in FormData", async () => {
    mocks.markLessonComplete.mockResolvedValue({
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      completed: true,
    });

    await markLessonCompleteAction(form({ userId: "attacker-planted-id" }));

    expect(mocks.markLessonComplete).toHaveBeenCalledWith(ACTOR, {
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
    });
  });

  it("revalidates the lesson page and does not redirect on success", async () => {
    mocks.markLessonComplete.mockResolvedValue({
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      completed: true,
    });

    await markLessonCompleteAction(form());

    expect(mocks.revalidatePath).toHaveBeenCalledWith("/learn/enrolment-1/lessons/lesson-1");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects to the lesson-list page for a locked lesson", async () => {
    mocks.markLessonComplete.mockRejectedValue(
      new mocks.FakeLessonNotOpenableError("enrolment-1", "lesson-1", "locked"),
    );

    await expect(markLessonCompleteAction(form())).rejects.toThrow(
      "NEXT_REDIRECT:/learn/enrolment-1",
    );
  });

  it("redirects to the lesson-list page for a not-found lesson", async () => {
    mocks.markLessonComplete.mockRejectedValue(
      new mocks.FakeLessonNotOpenableError("enrolment-1", "lesson-1", "not-found"),
    );

    await expect(markLessonCompleteAction(form())).rejects.toThrow(
      "NEXT_REDIRECT:/learn/enrolment-1",
    );
  });

  it("redirects back to the same lesson page for a closed access window", async () => {
    mocks.markLessonComplete.mockRejectedValue(
      new mocks.FakeLessonNotOpenableError("enrolment-1", "lesson-1", "access-window-closed"),
    );

    await expect(markLessonCompleteAction(form())).rejects.toThrow(
      "NEXT_REDIRECT:/learn/enrolment-1/lessons/lesson-1",
    );
  });

  it("redirects back to the same lesson page when manual completion is not permitted", async () => {
    mocks.markLessonComplete.mockRejectedValue(
      new mocks.FakeManualCompletionNotPermittedError("lesson-1"),
    );

    await expect(markLessonCompleteAction(form())).rejects.toThrow(
      "NEXT_REDIRECT:/learn/enrolment-1/lessons/lesson-1",
    );
  });

  it("re-throws an error of no known type to the route's error boundary", async () => {
    mocks.markLessonComplete.mockRejectedValue(new Error("db exploded"));

    await expect(markLessonCompleteAction(form())).rejects.toThrow("db exploded");
  });
});

describe("undoLessonCompleteAction", () => {
  it("redirects a signed-out caller to sign-in instead of calling the service", async () => {
    mocks.getCurrentActor.mockResolvedValue(null);

    await expect(undoLessonCompleteAction(form())).rejects.toThrow("NEXT_REDIRECT:/signin");
    expect(mocks.undoLessonComplete).not.toHaveBeenCalled();
  });

  it("calls the service with the session-derived actor, ignoring an actorId planted in FormData", async () => {
    mocks.undoLessonComplete.mockResolvedValue({
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      completed: false,
    });

    await undoLessonCompleteAction(form({ actorId: "attacker-planted-id" }));

    expect(mocks.undoLessonComplete).toHaveBeenCalledWith(ACTOR, {
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
    });
  });

  it("revalidates the lesson page and does not redirect on success", async () => {
    mocks.undoLessonComplete.mockResolvedValue({
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      completed: false,
    });

    await undoLessonCompleteAction(form());

    expect(mocks.revalidatePath).toHaveBeenCalledWith("/learn/enrolment-1/lessons/lesson-1");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects back to the same lesson page for a closed access window", async () => {
    mocks.undoLessonComplete.mockRejectedValue(
      new mocks.FakeLessonNotOpenableError("enrolment-1", "lesson-1", "access-window-closed"),
    );

    await expect(undoLessonCompleteAction(form())).rejects.toThrow(
      "NEXT_REDIRECT:/learn/enrolment-1/lessons/lesson-1",
    );
  });

  it("redirects to the lesson-list page for a not-found enrolment", async () => {
    mocks.undoLessonComplete.mockRejectedValue(
      new mocks.FakeLessonNotOpenableError("enrolment-1", "lesson-1", "not-found"),
    );

    await expect(undoLessonCompleteAction(form())).rejects.toThrow(
      "NEXT_REDIRECT:/learn/enrolment-1",
    );
  });
});

describe("recordWatchProgressAction", () => {
  function watchInput(over: Partial<{
    enrolmentId: string;
    lessonId: string;
    secondsWatched: number;
    durationSeconds: number | null;
  }> = {}) {
    return {
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      secondsWatched: 30,
      durationSeconds: 100,
      ...over,
    };
  }

  it("returns { completed: false } and does not call redirect for a signed-out caller", async () => {
    mocks.getCurrentActor.mockResolvedValue(null);

    const result = await recordWatchProgressAction(watchInput());

    expect(result).toEqual({ completed: false });
    expect(mocks.recordWatchProgress).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("calls the service with the session-derived actor and the plain-object input", async () => {
    mocks.recordWatchProgress.mockResolvedValue({
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      percentWatched: 30,
      completed: false,
    });

    await recordWatchProgressAction(watchInput());

    expect(mocks.recordWatchProgress).toHaveBeenCalledWith(ACTOR, {
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      secondsWatched: 30,
      durationSeconds: 100,
    });
  });

  it("returns { completed: false } and does not revalidate when the lesson has not yet crossed 90%", async () => {
    mocks.recordWatchProgress.mockResolvedValue({
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      percentWatched: 30,
      completed: false,
    });

    const result = await recordWatchProgressAction(watchInput());

    expect(result).toEqual({ completed: false });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns { completed: true } and revalidates the lesson page when completion transitions to true", async () => {
    mocks.recordWatchProgress.mockResolvedValue({
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      percentWatched: 95,
      completed: true,
    });

    const result = await recordWatchProgressAction(watchInput());

    expect(result).toEqual({ completed: true });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/learn/enrolment-1/lessons/lesson-1");
  });

  it("swallows LessonNotOpenableError and returns { completed: false }", async () => {
    mocks.recordWatchProgress.mockRejectedValue(
      new mocks.FakeLessonNotOpenableError("enrolment-1", "lesson-1", "locked"),
    );

    const result = await recordWatchProgressAction(watchInput());

    expect(result).toEqual({ completed: false });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("swallows NotAVideoLessonError and returns { completed: false }", async () => {
    mocks.recordWatchProgress.mockRejectedValue(new mocks.FakeNotAVideoLessonError("lesson-1"));

    const result = await recordWatchProgressAction(watchInput());

    expect(result).toEqual({ completed: false });
  });

  it("swallows InvalidWatchProgressError and returns { completed: false }", async () => {
    mocks.recordWatchProgress.mockRejectedValue(
      new mocks.FakeInvalidWatchProgressError("secondsWatched", -5),
    );

    const result = await recordWatchProgressAction(watchInput());

    expect(result).toEqual({ completed: false });
  });

  it("re-throws an error of no known type to the route's error boundary", async () => {
    mocks.recordWatchProgress.mockRejectedValue(new Error("db exploded"));

    await expect(recordWatchProgressAction(watchInput())).rejects.toThrow("db exploded");
  });
});
