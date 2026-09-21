/**
 * Task 3 (plan 09-01): the pure access-window evaluator (D-01, D-02, D-03).
 *
 * Exhaustive unit coverage of the four named states — `cohort-dates`,
 * `unlimited`, `not-started`, `windowed` — mirrors the pure-evaluator style
 * of `tests/attendance-component.test.ts` / `tests/readiness.test.ts`. No
 * data access.
 */

import { describe, expect, it } from "vitest";
import {
  computeAccessWindow,
  type AccessWindowInput,
} from "@/server/services/access-window";

const MS_PER_DAY = 86_400_000;

function input(overrides: Partial<AccessWindowInput> = {}): AccessWindowInput {
  return {
    deliveryMode: "SELF_PACED",
    cohortEndsAt: null,
    accessDurationDays: null,
    activatedAt: null,
    accessEndsAt: null,
    now: new Date("2026-09-14T00:00:00Z"),
    ...overrides,
  };
}

describe("computeAccessWindow", () => {
  it("INSTRUCTOR_LED → cohort-dates, accessDurationDays ignored entirely (D-01)", () => {
    const result = computeAccessWindow(
      input({
        deliveryMode: "INSTRUCTOR_LED",
        cohortEndsAt: new Date("2026-12-01T00:00:00Z"),
        accessDurationDays: 5,
        activatedAt: new Date("2026-01-01T00:00:00Z"),
      }),
    );
    expect(result).toEqual({
      kind: "cohort-dates",
      readOnly: false,
      endsAt: new Date("2026-12-01T00:00:00Z"),
    });
  });

  it("BLENDED → cohort-dates, accessDurationDays ignored entirely (D-01)", () => {
    const result = computeAccessWindow(
      input({
        deliveryMode: "BLENDED",
        cohortEndsAt: new Date("2026-12-01T00:00:00Z"),
        accessDurationDays: 30,
      }),
    );
    expect(result).toEqual({
      kind: "cohort-dates",
      readOnly: false,
      endsAt: new Date("2026-12-01T00:00:00Z"),
    });
  });

  it("SELF_PACED with accessDurationDays null → unlimited (D-02)", () => {
    const result = computeAccessWindow(
      input({ deliveryMode: "SELF_PACED", accessDurationDays: null }),
    );
    expect(result).toEqual({ kind: "unlimited", readOnly: false, endsAt: null });
  });

  it("SELF_PACED, accessDurationDays set but activatedAt null → not-started (named third state)", () => {
    const result = computeAccessWindow(
      input({
        deliveryMode: "SELF_PACED",
        accessDurationDays: 30,
        activatedAt: null,
      }),
    );
    expect(result).toEqual({ kind: "not-started", readOnly: true, endsAt: null });
  });

  it("SELF_PACED, accessDurationDays=30, activatedAt 10 days ago → windowed, still open", () => {
    const now = new Date("2026-09-14T00:00:00Z");
    const activatedAt = new Date(now.getTime() - 10 * MS_PER_DAY);
    const result = computeAccessWindow(
      input({ deliveryMode: "SELF_PACED", accessDurationDays: 30, activatedAt, now }),
    );
    const expectedEndsAt = new Date(activatedAt.getTime() + 30 * MS_PER_DAY);
    expect(result).toEqual({ kind: "windowed", readOnly: false, endsAt: expectedEndsAt });
  });

  it("SELF_PACED, accessDurationDays=30, activatedAt 31 days ago → windowed, read-only (D-03)", () => {
    const now = new Date("2026-09-14T00:00:00Z");
    const activatedAt = new Date(now.getTime() - 31 * MS_PER_DAY);
    const result = computeAccessWindow(
      input({ deliveryMode: "SELF_PACED", accessDurationDays: 30, activatedAt, now }),
    );
    const expectedEndsAt = new Date(activatedAt.getTime() + 30 * MS_PER_DAY);
    expect(result).toEqual({ kind: "windowed", readOnly: true, endsAt: expectedEndsAt });
  });

  it("exact boundary: now === endsAt is still open (readOnly: false)", () => {
    const activatedAt = new Date("2026-08-15T00:00:00Z");
    const endsAt = new Date(activatedAt.getTime() + 30 * MS_PER_DAY);
    const result = computeAccessWindow(
      input({
        deliveryMode: "SELF_PACED",
        accessDurationDays: 30,
        activatedAt,
        now: endsAt,
      }),
    );
    expect(result).toEqual({ kind: "windowed", readOnly: false, endsAt });
  });

  it("one millisecond past the boundary is read-only", () => {
    const activatedAt = new Date("2026-08-15T00:00:00Z");
    const endsAt = new Date(activatedAt.getTime() + 30 * MS_PER_DAY);
    const oneMsLater = new Date(endsAt.getTime() + 1);
    const result = computeAccessWindow(
      input({
        deliveryMode: "SELF_PACED",
        accessDurationDays: 30,
        activatedAt,
        now: oneMsLater,
      }),
    );
    expect(result).toEqual({ kind: "windowed", readOnly: true, endsAt });
  });

  it("Enrolment.accessEndsAt, when non-null, always wins over a computed window (D-01)", () => {
    const now = new Date("2026-09-14T00:00:00Z");
    const activatedAt = new Date(now.getTime() - 10 * MS_PER_DAY);
    // The computed window from activatedAt + 30 days would still be open,
    // but the persisted accessEndsAt is already in the past — the persisted
    // value must win.
    const persistedAccessEndsAt = new Date(now.getTime() - 1 * MS_PER_DAY);
    const result = computeAccessWindow(
      input({
        deliveryMode: "SELF_PACED",
        accessDurationDays: 30,
        activatedAt,
        accessEndsAt: persistedAccessEndsAt,
        now,
      }),
    );
    expect(result).toEqual({
      kind: "windowed",
      readOnly: true,
      endsAt: persistedAccessEndsAt,
    });
  });
});
