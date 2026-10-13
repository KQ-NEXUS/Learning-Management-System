import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMBED_HOST_ALLOWLIST } from "@/lib/embed-url";
import type { LessonType } from "@/lib/upload-limits";

vi.mock("@/components/catalogue/RichTextEditor", () => ({
  RichTextEditor: ({
    value,
    onChange,
    id,
    "aria-invalid": ariaInvalid,
    "aria-describedby": ariaDescribedby,
  }: {
    value: string;
    onChange: (html: string) => void;
    id?: string;
    "aria-invalid"?: boolean;
    "aria-describedby"?: string;
  }) => (
    <textarea
      aria-label="Lesson body"
      id={id}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedby}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

import { LessonFormFields } from "@/components/catalogue/LessonFormFields";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const allTypes: LessonType[] = [
  "TEXT",
  "FILE",
  "IMAGE",
  "VIDEO",
  "EMBED",
  "LINK",
  "QUIZ",
  "ASSIGNMENT",
];

describe("LessonFormFields", () => {
  it.each(allTypes)("renders the common lesson controls for %s", (lessonType) => {
    vi.stubGlobal("fetch", vi.fn());
    render(
      <LessonFormFields
        lessonType={lessonType}
        lessonId="lesson-1"
        initialResources={[]}
      />,
    );

    expect(screen.getByLabelText(/^title/i)).toBeTruthy();
    expect(screen.getByLabelText(/^required/i)).toBeTruthy();
    // A-01: a quiz or assignment lesson is completed by its assessment, so it offers no manual control.
    if (lessonType === "QUIZ" || lessonType === "ASSIGNMENT") {
      expect(screen.queryByLabelText(/^allow manual complete/i)).toBeNull();
      expect(document.querySelector('input[name="allowManualComplete"]')).toBeNull();
      expect(
        screen.getByText(
          lessonType === "QUIZ"
            ? /marked complete automatically when the learner passes the quiz/i
            : /marked complete automatically when the learner submits the assignment/i,
        ),
      ).toBeTruthy();
    } else {
      expect(screen.getByLabelText(/^allow manual complete/i)).toBeTruthy();
    }
  });

  it("binds TEXT lessons to the constrained rich text editor", () => {
    render(<LessonFormFields lessonType="TEXT" />);
    expect(screen.getByLabelText("Lesson body")).toBeTruthy();
    expect(document.querySelector('input[type="hidden"][name="body"]')).toBeTruthy();
  });

  it.each(["FILE", "IMAGE", "VIDEO"] as const)(
    "renders uploads plus optional introductory prose for %s",
    (lessonType) => {
      vi.stubGlobal("fetch", vi.fn());
      render(
        <LessonFormFields
          lessonType={lessonType}
          lessonId="lesson-1"
          initialResources={[]}
        />,
      );
      expect(screen.getByRole("group", { name: `${lessonType.toLowerCase()} resources` })).toBeTruthy();
      expect(screen.getByText("Optional introductory prose")).toBeTruthy();
    },
  );

  it("names every allowed embed host in the EMBED hint", () => {
    render(<LessonFormFields lessonType="EMBED" />);
    const hint = screen.getByText(/allowed hosts/i).textContent ?? "";
    for (const host of EMBED_HOST_ALLOWLIST) expect(hint).toContain(host);
    expect(screen.getByLabelText(/^embed url/i)).toBeTruthy();
  });

  it("renders the LINK URL and optional prose fields", () => {
    render(<LessonFormFields lessonType="LINK" />);
    expect(screen.getByLabelText(/^link url/i)).toBeTruthy();
    expect(screen.getByText("Optional introductory prose")).toBeTruthy();
  });

  const OPTIONS = [
    { id: "q-pub", title: "Safety quiz", type: "QUIZ" as const, status: "PUBLISHED" },
    { id: "q-draft", title: "Draft quiz", type: "QUIZ" as const, status: "DRAFT" },
    { id: "q-old", title: "Old quiz", type: "QUIZ" as const, status: "ARCHIVED" },
    { id: "a-pub", title: "Final essay", type: "ASSIGNMENT" as const, status: "PUBLISHED" },
  ];

  it("a Quiz lesson offers this course's quizzes only — drafts marked, archived and assignments left out", () => {
    render(<LessonFormFields lessonType="QUIZ" assessmentOptions={OPTIONS} />);
    const picker = screen.getByLabelText("Quiz") as HTMLSelectElement;
    expect(picker.disabled).toBe(false);
    expect(Array.from(picker.options).map((o) => o.textContent)).toEqual([
      "Choose a quiz",
      "Safety quiz",
      "Draft quiz (draft)",
    ]);
  });

  it("an Assignment lesson offers assignments only, and pre-selects the saved link", () => {
    render(<LessonFormFields lessonType="ASSIGNMENT" assessmentOptions={OPTIONS} values={{ assessmentId: "a-pub" }} />);
    const picker = screen.getByLabelText("Assignment") as HTMLSelectElement;
    expect(Array.from(picker.options).map((o) => o.value)).toEqual(["", "a-pub"]);
    expect(picker.value).toBe("a-pub");
  });

  it("explains what to do when the course has nothing to link — and never mentions a phase", () => {
    render(<LessonFormFields lessonType="QUIZ" assessmentOptions={[]} />);
    expect(screen.getByText("This course has no quiz yet. Create one under Assessments, then link it here.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Phase \d/);
  });

  it("shows a refused link's message on the picker", () => {
    render(
      <LessonFormFields
        lessonType="QUIZ"
        assessmentOptions={OPTIONS}
        errors={[{ name: "assessmentId", message: "Choose an assessment from this course." }]}
      />,
    );
    expect(screen.getByText("Choose an assessment from this course.")).toBeTruthy();
  });

  it.each(["TEXT", "FILE", "IMAGE", "VIDEO", "EMBED", "LINK"] as const)(
    "wires a server body error to the rich editor and the summary target for %s",
    (lessonType) => {
      vi.stubGlobal("fetch", vi.fn());
      render(
        <LessonFormFields
          lessonType={lessonType}
          lessonId="lesson-1"
          initialResources={[]}
          errors={[{ name: "body", message: "Lesson body cannot be empty" }]}
        />,
      );

      const editor = screen.getByLabelText("Lesson body");
      // The summary's `#field-body` link now reaches the focusable editor.
      expect(editor.getAttribute("id")).toBe("field-body");
      expect(editor.getAttribute("aria-invalid")).toBe("true");

      const describedBy = editor.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      const description = document.getElementById(describedBy as string);
      expect(description?.textContent).toMatch(/Lesson body cannot be empty/);

      // The submitted body still travels in a hidden field.
      expect(
        document.querySelector('input[type="hidden"][name="body"]'),
      ).toBeTruthy();
    },
  );

  it("leaves the editor without an invalid association when there is no body error", () => {
    render(<LessonFormFields lessonType="TEXT" />);
    const editor = screen.getByLabelText("Lesson body");
    expect(editor.getAttribute("id")).toBe("field-body");
    expect(editor.getAttribute("aria-invalid")).toBeNull();
    expect(editor.getAttribute("aria-describedby")).toBeNull();
  });

  it.each(["QUIZ", "ASSIGNMENT"] as const)(
    "exposes no rich body editor for %s even when a body error is present",
    (lessonType) => {
      render(
        <LessonFormFields
          lessonType={lessonType}
          errors={[{ name: "body", message: "ignored for this type" }]}
        />,
      );
      expect(screen.queryByLabelText("Lesson body")).toBeNull();
    },
  );
});
