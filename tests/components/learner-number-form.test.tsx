// @vitest-environment jsdom
/**
 * The learner number settings screen: the preview follows what is typed, a bad
 * pattern says why in plain words, and Save is only offered when there is a
 * valid change to save.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LearnerNumberForm } from "@/app/staff/learner-numbers/LearnerNumberForm";
import type { LearnerNumberSettings } from "@/server/services/learner-number-service";

vi.mock("@/app/staff/learner-numbers/actions", () => ({
  saveLearnerNumberPatternAction: vi.fn(),
  backfillLearnerNumbersAction: vi.fn(),
}));

afterEach(cleanup);

const TODAY = "2026-10-04T12:00:00.000Z";
const settings = (overrides: Partial<LearnerNumberSettings> = {}): LearnerNumberSettings => ({
  pattern: null,
  nextSequence: 1,
  issued: 0,
  withoutNumber: 12,
  preview: [],
  ...overrides,
});
const field = () => screen.getByLabelText("Learner number pattern") as HTMLInputElement;
const type = (value: string) => fireEvent.change(field(), { target: { value } });

describe("LearnerNumberForm", () => {
  it("says numbering is off and offers to turn it on, disabled until a pattern is typed", () => {
    render(<LearnerNumberForm initial={settings()} todayIso={TODAY} />);

    expect(screen.getByText("Off")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Turn on learner numbers" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("previews the next numbers as the pattern is typed, using the registration year", () => {
    render(<LearnerNumberForm initial={settings()} todayIso={TODAY} />);
    type("KQ/{YY}/#####");

    expect(screen.getByText("KQ/26/00001")).toBeTruthy();
    expect(screen.getByText("KQ/26/00002")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Turn on learner numbers" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("previews from where the counter stands", () => {
    render(<LearnerNumberForm initial={settings({ pattern: "KQL-####", nextSequence: 58, issued: 57 })} todayIso={TODAY} />);
    expect(screen.getByText("KQL-0058")).toBeTruthy();
  });

  it("explains a bad pattern, marks the field invalid and withholds Save", () => {
    render(<LearnerNumberForm initial={settings()} todayIso={TODAY} />);
    type("KQL-##");

    expect(screen.getByRole("alert").textContent).toBeTruthy();
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByRole("button", { name: "Turn on learner numbers" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/^KQL-0/)).toBeNull();
  });

  it("fills the field from an example", () => {
    render(<LearnerNumberForm initial={settings()} todayIso={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: "KQL-######" }));

    expect(field().value).toBe("KQL-######");
    expect(screen.getByText("KQL-000001")).toBeTruthy();
  });

  it("has nothing to save while the pattern is unchanged", () => {
    render(<LearnerNumberForm initial={settings({ pattern: "KQL-####" })} todayIso={TODAY} />);

    expect((screen.getByRole("button", { name: "Save pattern" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("No changes to save.")).toBeTruthy();
  });

  it("saves the pattern and shows the status the server returned", async () => {
    const save = vi.fn(async () => ({
      ok: true as const,
      settings: settings({ pattern: "KQL-######", preview: ["KQL-000001"] }),
    }));
    render(<LearnerNumberForm initial={settings()} todayIso={TODAY} save={save} />);
    type("KQL-######");
    fireEvent.click(screen.getByRole("button", { name: "Turn on learner numbers" }));

    await waitFor(() => expect(screen.getByText("On")).toBeTruthy());
    expect(save).toHaveBeenCalledWith({ pattern: "KQL-######" });
    expect(screen.getByRole("button", { name: "Save pattern" })).toBeTruthy();
  });

  it("shows the server's refusal and keeps what was typed", async () => {
    const save = vi.fn(async () => ({ ok: false as const, message: "Your role does not permit changing learner number settings." }));
    render(<LearnerNumberForm initial={settings()} todayIso={TODAY} save={save} />);
    type("KQL-######");
    fireEvent.click(screen.getByRole("button", { name: "Turn on learner numbers" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("does not permit"));
    expect(field().value).toBe("KQL-######");
    expect(screen.getByText("Off")).toBeTruthy();
  });
});

describe("giving numbers to learners who have none", () => {
  const on = (overrides: Partial<LearnerNumberSettings> = {}) =>
    settings({ pattern: "KQL-####", nextSequence: 5, issued: 4, withoutNumber: 12, preview: ["KQL-0005", "KQL-0006"], ...overrides });

  it("is not offered while numbering is off", () => {
    render(<LearnerNumberForm initial={settings()} todayIso={TODAY} />);
    expect(screen.queryByRole("button", { name: /Give .* number/ })).toBeNull();
  });

  it("is not offered when every learner already has a number", () => {
    render(<LearnerNumberForm initial={on({ withoutNumber: 0 })} todayIso={TODAY} />);
    expect(screen.queryByRole("button", { name: /Give .* number/ })).toBeNull();
  });

  it("asks first, saying how many, where the numbers start and that it cannot be undone", () => {
    const backfill = vi.fn();
    render(<LearnerNumberForm initial={on()} todayIso={TODAY} backfill={backfill} />);
    fireEvent.click(screen.getByRole("button", { name: "Give these learners numbers" }));

    const dialog = screen.getByRole("dialog", { name: "Give numbers to 12 learners?" });
    expect(within(dialog).getByText("KQL-0005")).toBeTruthy();
    expect(within(dialog).getByText(/cannot be changed or taken back/)).toBeTruthy();
    expect(backfill).not.toHaveBeenCalled();
  });

  it("cancelling gives nobody a number", () => {
    const backfill = vi.fn();
    render(<LearnerNumberForm initial={on()} todayIso={TODAY} backfill={backfill} />);
    fireEvent.click(screen.getByRole("button", { name: "Give these learners numbers" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    expect(backfill).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("confirming runs it, closes the pop-up and shows the new counts", async () => {
    const backfill = vi.fn(async () => ({
      ok: true as const,
      numbered: 12,
      first: "KQL-0005",
      last: "KQL-0016",
      settings: on({ issued: 16, withoutNumber: 0, nextSequence: 17, preview: ["KQL-0017"] }),
    }));
    render(<LearnerNumberForm initial={on()} todayIso={TODAY} backfill={backfill} />);
    fireEvent.click(screen.getByRole("button", { name: "Give these learners numbers" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Give numbers" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(backfill).toHaveBeenCalledTimes(1);
    expect(screen.getByText("16")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Give .* number/ })).toBeNull();
    expect(screen.getByText("KQL-0017")).toBeTruthy();
  });

  it("a refusal stays in the pop-up as not applied", async () => {
    const backfill = vi.fn(async () => ({ ok: false as const, message: "Your role does not permit changing learner number settings." }));
    render(<LearnerNumberForm initial={on()} todayIso={TODAY} backfill={backfill} />);
    fireEvent.click(screen.getByRole("button", { name: "Give these learners numbers" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Give numbers" }));

    expect(await within(screen.getByRole("dialog")).findByText(/does not permit/)).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
  });
});
