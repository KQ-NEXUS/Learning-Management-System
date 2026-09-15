/**
 * `GradeEntryClient` (plan 10-13, ASM-05, ASM-06, D-07) — the two
 * mutually-exclusive control-set rule, asserted as ABSENCE (not disabled),
 * the client-side reason-length gate, and the mandatory-reason override
 * flow. Modelled on `tests/components/staff-progress-override.test.tsx`'s
 * `within(dialog)` disambiguation, needed here because the trigger button
 * and the modal's confirm button share the label "Override grade".
 *
 * `saveDraft`/`release`/`override` are injected via props (the same
 * testability seam `GradingQueueTable`'s own `onRelease` prop uses) rather
 * than mocking "./actions" as a module.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { GradeEntryClient, type GradeEntryClientProps } from "@/app/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/GradeEntryClient";

afterEach(cleanup);

function setup(overrides: Partial<GradeEntryClientProps> = {}) {
  const saveDraft = vi.fn(async () => ({ ok: true as const, grade: { id: "g1", status: "DRAFT", score: 8, gradedAt: new Date().toISOString() } as never }));
  const release = vi.fn(async () => ({ ok: true as const, grade: { id: "g1", status: "RELEASED" } as never }));
  const override = vi.fn(async () => ({ ok: true as const, result: {} as never }));

  const props: GradeEntryClientProps = {
    cohortId: "c1",
    assessmentId: "a1",
    submissionId: "s1",
    gradeId: null,
    status: null,
    score: null,
    feedback: null,
    maxScore: 20,
    overrides: [],
    saveDraft,
    release,
    override,
    ...overrides,
  };

  return { ...render(<GradeEntryClient {...props} />), saveDraft, release, override, props };
}

describe("GradeEntryClient — DRAFT / no grade yet", () => {
  it("renders Score and Feedback fields, 'Save draft', and no Override control anywhere", () => {
    setup();
    expect(screen.getByLabelText("Score")).toBeTruthy();
    expect(screen.getByLabelText("Feedback")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Override grade/ })).toBeNull();
  });

  it("with an existing DRAFT grade, renders 'Save draft' and 'Release' and still no Override control", () => {
    setup({ status: "DRAFT", gradeId: "g1", score: 8, feedback: "Keep going" });
    expect(screen.getByRole("button", { name: "Save draft" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Release" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Override grade/ })).toBeNull();
  });

  it("renders the feedback hint beside the field", () => {
    setup();
    expect(screen.getByText("Visible to the learner once released.")).toBeTruthy();
  });

  it("disables Release until a whole-number score within range is entered", () => {
    setup();
    const releaseButton = screen.getByRole("button", { name: "Release" }) as HTMLButtonElement;
    expect(releaseButton.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Score"), { target: { value: "15" } });
    expect((screen.getByRole("button", { name: "Release" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not render the certificate-impact placeholder in DRAFT state", () => {
    setup();
    expect(screen.queryByText(/Certificate impact/)).toBeNull();
  });
});

describe("GradeEntryClient — RELEASED", () => {
  const releasedProps: Partial<GradeEntryClientProps> = {
    status: "RELEASED",
    gradeId: "g1",
    score: 18,
    feedback: "Excellent submission",
  };

  it("renders score/feedback read-only and 'Override grade', never 'Save draft' or 'Release'", () => {
    setup(releasedProps);
    expect(screen.getByText("Excellent submission")).toBeTruthy();
    expect(screen.getByText("18 / 20")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Override grade" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Release" })).toBeNull();
    expect(screen.queryByLabelText("Score")).toBeNull();
    expect(screen.queryByLabelText("Feedback")).toBeNull();
  });

  it("renders the certificate-impact named-gap placeholder verbatim", () => {
    setup(releasedProps);
    expect(
      screen.getByText("Certificate impact — not yet evaluated (arriving in a future update)"),
    ).toBeTruthy();
  });

  it("opens ConfirmModal with a reason field whose confirm button stays disabled below 10 characters", () => {
    setup(releasedProps);
    fireEvent.click(screen.getByRole("button", { name: "Override grade" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/reason/i)).toBeTruthy();
    expect(within(dialog).getByLabelText("New score")).toBeTruthy();

    const confirmButton = within(dialog).getByRole("button", { name: "Override grade" }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: "short" } });
    expect((within(dialog).getByRole("button", { name: "Override grade" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText(/reason/i), {
      target: { value: "Recount confirmed a marking error" },
    });
    expect((within(dialog).getByRole("button", { name: "Override grade" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("confirming calls the override callback once with the new score and the trimmed reason", async () => {
    const { override } = setup(releasedProps);
    fireEvent.click(screen.getByRole("button", { name: "Override grade" }));
    const dialog = screen.getByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("New score"), { target: { value: "19" } });
    fireEvent.change(within(dialog).getByLabelText(/reason/i), {
      target: { value: "  Recount confirmed a marking error  " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Override grade" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(override).toHaveBeenCalledExactlyOnceWith({
      cohortId: "c1",
      assessmentId: "a1",
      submissionId: "s1",
      gradeId: "g1",
      newScore: 19,
      reason: "Recount confirmed a marking error",
    });
  });

  it("renders override history rows newest-first with previous/new scores, actor name, and the reason in quotes", () => {
    setup({
      ...releasedProps,
      overrides: [
        {
          previousScore: 12,
          newScore: 15,
          reason: "First correction",
          actorName: "Amina Bello",
          createdAt: "2026-03-01T00:00:00.000Z",
        },
        {
          previousScore: 15,
          newScore: 18,
          reason: "Second correction",
          actorName: "Chidi Okoro",
          createdAt: "2026-03-05T00:00:00.000Z",
        },
      ],
    });

    const rows = screen.getAllByText(/Overridden from/);
    expect(rows).toHaveLength(2);
    // Rendered in the order supplied — the page server-sorts newest first,
    // so the first row here is the most recent override.
    expect(rows[0].textContent).toContain("Overridden from 12 to 15 by Amina Bello");
    expect(rows[0].textContent).toContain("“First correction”");
    expect(rows[1].textContent).toContain("Overridden from 15 to 18 by Chidi Okoro");
  });
});
