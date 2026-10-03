/**
 * A-01: a quiz or assignment lesson is completed by its assessment, so the
 * learner sees what completes it and is offered neither "Mark complete" nor
 * "Undo". Other lesson types keep the manual control.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/app/(lesson)/learn/[enrolmentId]/lessons/[lessonId]/actions", () => ({
  markLessonCompleteAction: vi.fn(),
  undoLessonCompleteAction: vi.fn(),
}));

import { assessmentCompletionHint, LessonCompleteControl } from "@/components/learner/LessonCompleteControl";

afterEach(cleanup);

const base = {
  enrolmentId: "enr-1",
  lessonId: "les-1",
  completedSource: null,
  // The stuck/skip-able states came from this flag; for these types it must not matter.
  allowManualComplete: true,
  relockCount: 0,
};

describe("assessmentCompletionHint", () => {
  it("names what completes a quiz or assignment lesson, and nothing for other types", () => {
    expect(assessmentCompletionHint("QUIZ")).toMatch(/when you pass the quiz/);
    expect(assessmentCompletionHint("ASSIGNMENT")).toMatch(/when you submit your assignment/);
    for (const type of ["TEXT", "VIDEO", "FILE", "IMAGE", "EMBED", "LINK", undefined]) {
      expect(assessmentCompletionHint(type)).toBeNull();
    }
  });
});

describe("LessonCompleteControl for quiz and assignment lessons", () => {
  it.each([
    ["QUIZ", /marked complete when you pass the quiz/i],
    ["ASSIGNMENT", /marked complete when you submit your assignment/i],
  ] as const)("%s, not completed: explains what completes it and offers no button", (lessonType, hint) => {
    render(<LessonCompleteControl {...base} completed={false} lessonType={lessonType} />);

    expect(screen.getByText(hint)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("Mark complete")).toBeNull();
  });

  it.each(["QUIZ", "ASSIGNMENT"])("%s, completed: shows Completed with no Undo", (lessonType) => {
    render(
      <LessonCompleteControl {...base} completed completedSource="AUTO_ASSESSMENT" lessonType={lessonType} relockCount={3} />,
    );

    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("Undo")).toBeNull();
  });

  it("a TEXT lesson still offers Mark complete, and Undo once completed", () => {
    const { unmount } = render(<LessonCompleteControl {...base} completed={false} lessonType="TEXT" />);
    expect(screen.getByRole("button", { name: "Mark complete" })).toBeTruthy();
    unmount();

    render(<LessonCompleteControl {...base} completed completedSource="MANUAL" lessonType="TEXT" />);
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });
});
