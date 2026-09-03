import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LessonFormFields } from "@/components/catalogue";
import { EMBED_HOST_ALLOWLIST } from "@/lib/embed-url";
import type { LessonType } from "@/lib/upload-limits";

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

    expect(screen.getByLabelText(/title/i)).toBeTruthy();
    expect(screen.getByLabelText("Required")).toBeTruthy();
    expect(screen.getByLabelText("Allow manual complete")).toBeTruthy();
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
    expect(screen.getByLabelText("Embed URL")).toBeTruthy();
  });

  it("renders the LINK URL and optional prose fields", () => {
    render(<LessonFormFields lessonType="LINK" />);
    expect(screen.getByLabelText("Link URL")).toBeTruthy();
    expect(screen.getByText("Optional introductory prose")).toBeTruthy();
  });

  it.each(["QUIZ", "ASSIGNMENT"] as const)(
    "keeps the empty Phase 10 assessment picker visible without blocking %s",
    (lessonType) => {
      render(<LessonFormFields lessonType={lessonType} />);
      const picker = screen.getByLabelText("Assessment") as HTMLSelectElement;
      expect(picker.disabled).toBe(true);
      expect(
        screen.getByText(
          "No assessments exist yet — assessment authoring arrives in Phase 10.",
        ),
      ).toBeTruthy();
    },
  );
});
