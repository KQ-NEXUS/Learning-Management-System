import { describe, expect, it } from "vitest";
import {
  blockingFailures,
  evaluateCohortReadiness,
  type ReadinessCohortInput,
} from "@/server/services/readiness-service";

/**
 * COH-04 / D-27 / D-28 / D-29 — the pure cohort readiness evaluator.
 *
 * Six categories: Catalogue, Schedule, Price, Capacity, Instructors, Completion.
 * Catalogue / Schedule / Capacity / Instructors are `blocking: true` and
 * FAIL-capable; Price is `blocking: true` but effectively always PASS;
 * Completion (and the two WARN sub-items) are `blocking: false`.
 */

function makeCohort(overrides: Partial<ReadinessCohortInput> = {}): ReadinessCohortInput {
  return {
    deliveryMode: "INSTRUCTOR_LED",
    startsAt: "2026-10-01T00:00:00.000Z",
    endsAt: "2026-12-01T00:00:00.000Z",
    capacity: 20,
    seatsTaken: 5,
    priceMinor: 50000,
    currency: "GBP",
    attendanceThresholdPct: 80,
    instructorCount: 2,
    nonCancelledSessionCount: 8,
    sessions: [
      {
        startsAt: "2026-10-05T09:00:00.000Z",
        endsAt: "2026-10-05T12:00:00.000Z",
        cancelledAt: null,
      },
    ],
    pin: {
      kind: "course",
      publicationId: "pub-1",
      targetStatus: "PUBLISHED",
      completionRule: { type: "ALL_REQUIRED" },
    },
    ...overrides,
  };
}

function find(items: ReturnType<typeof evaluateCohortReadiness>, id: string) {
  return items.find((item) => item.id === id);
}

describe("evaluateCohortReadiness — item shape", () => {
  it("emits exactly the eight documented ids in order", () => {
    const items = evaluateCohortReadiness(makeCohort());
    expect(items.map((item) => item.id)).toEqual([
      "catalogue",
      "schedule",
      "schedule-dates",
      "price",
      "capacity",
      "instructors",
      "completion",
      "attendance-threshold-self-paced",
    ]);
  });

  it("never uses NOT_YET_CHECKED and never carries deferredTo — D-28 makes them real checks", () => {
    const items = evaluateCohortReadiness(makeCohort());
    for (const item of items) {
      expect(item.state).not.toBe("NOT_YET_CHECKED");
      expect(item.deferredTo).toBeUndefined();
    }
  });

  it("every item carries a concrete detail string", () => {
    const items = evaluateCohortReadiness(makeCohort());
    for (const item of items) {
      expect(typeof item.detail).toBe("string");
      expect(item.detail && item.detail.length).toBeGreaterThan(0);
    }
  });

  it("Catalogue / Schedule / Capacity / Instructors are blocking; Price is blocking; Completion items are not", () => {
    const items = evaluateCohortReadiness(makeCohort());
    expect(find(items, "catalogue")?.blocking).toBe(true);
    expect(find(items, "schedule")?.blocking).toBe(true);
    expect(find(items, "price")?.blocking).toBe(true);
    expect(find(items, "capacity")?.blocking).toBe(true);
    expect(find(items, "instructors")?.blocking).toBe(true);
    expect(find(items, "schedule-dates")?.blocking).toBe(false);
    expect(find(items, "completion")?.blocking).toBe(false);
    expect(find(items, "attendance-threshold-self-paced")?.blocking).toBe(false);
  });

  it("categories map to the six-slot checklist including Catalogue", () => {
    const items = evaluateCohortReadiness(makeCohort());
    expect(find(items, "catalogue")?.category).toBe("Catalogue");
    expect(find(items, "schedule")?.category).toBe("Schedule");
    expect(find(items, "schedule-dates")?.category).toBe("Schedule");
    expect(find(items, "price")?.category).toBe("Price");
    expect(find(items, "capacity")?.category).toBe("Capacity");
    expect(find(items, "instructors")?.category).toBe("Instructors");
    expect(find(items, "completion")?.category).toBe("Completion");
    expect(find(items, "attendance-threshold-self-paced")?.category).toBe("Completion");
  });
});

describe("evaluateCohortReadiness — Catalogue (D-29)", () => {
  it("PASS when pinned to a published publication", () => {
    const items = evaluateCohortReadiness(makeCohort());
    expect(find(items, "catalogue")?.state).toBe("PASS");
  });

  it("FAIL when the cohort is pinned to nothing", () => {
    const items = evaluateCohortReadiness(makeCohort({ pin: null }));
    expect(find(items, "catalogue")?.state).toBe("FAIL");
  });

  it("FAIL when the pin has no publicationId (points at a live/draft record)", () => {
    const items = evaluateCohortReadiness(
      makeCohort({
        pin: { kind: "course", publicationId: null, targetStatus: "DRAFT", completionRule: null },
      }),
    );
    expect(find(items, "catalogue")?.state).toBe("FAIL");
  });

  it("FAIL when the pinned target's status is not PUBLISHED", () => {
    const items = evaluateCohortReadiness(
      makeCohort({
        pin: {
          kind: "programme",
          publicationId: "pub-9",
          targetStatus: "ARCHIVED",
          completionRule: { type: "ALL" },
        },
      }),
    );
    expect(find(items, "catalogue")?.state).toBe("FAIL");
  });
});

describe("evaluateCohortReadiness — Schedule (D-28)", () => {
  it("PASS for an instructor-led cohort with a non-cancelled session", () => {
    const items = evaluateCohortReadiness(makeCohort({ nonCancelledSessionCount: 3 }));
    expect(find(items, "schedule")?.state).toBe("PASS");
  });

  it("PASS for a self-paced cohort with zero sessions", () => {
    const items = evaluateCohortReadiness(
      makeCohort({ deliveryMode: "SELF_PACED", nonCancelledSessionCount: 0, sessions: [] }),
    );
    expect(find(items, "schedule")?.state).toBe("PASS");
  });

  it("FAIL for an instructor-led cohort with no non-cancelled sessions", () => {
    const items = evaluateCohortReadiness(
      makeCohort({ nonCancelledSessionCount: 0, sessions: [] }),
    );
    const schedule = find(items, "schedule");
    expect(schedule?.state).toBe("FAIL");
    expect(schedule?.blocking).toBe(true);
  });

  it("schedule-dates WARNs when a session starts before the cohort begins", () => {
    const items = evaluateCohortReadiness(
      makeCohort({
        sessions: [
          {
            startsAt: "2026-09-20T09:00:00.000Z",
            endsAt: "2026-09-20T12:00:00.000Z",
            cancelledAt: null,
          },
        ],
      }),
    );
    expect(find(items, "schedule-dates")?.state).toBe("WARN");
  });

  it("schedule-dates WARNs when a session ends after the cohort finishes", () => {
    const items = evaluateCohortReadiness(
      makeCohort({
        sessions: [
          {
            startsAt: "2026-12-05T09:00:00.000Z",
            endsAt: "2026-12-05T12:00:00.000Z",
            cancelledAt: null,
          },
        ],
      }),
    );
    expect(find(items, "schedule-dates")?.state).toBe("WARN");
  });

  it("schedule-dates PASSes when all sessions fall within the cohort dates", () => {
    const items = evaluateCohortReadiness(makeCohort());
    expect(find(items, "schedule-dates")?.state).toBe("PASS");
  });

  it("schedule-dates ignores cancelled sessions that fall outside the dates", () => {
    const items = evaluateCohortReadiness(
      makeCohort({
        sessions: [
          {
            startsAt: "2026-09-01T09:00:00.000Z",
            endsAt: "2026-09-01T12:00:00.000Z",
            cancelledAt: "2026-08-01T00:00:00.000Z",
          },
        ],
      }),
    );
    expect(find(items, "schedule-dates")?.state).toBe("PASS");
  });
});

describe("evaluateCohortReadiness — Price (D-28)", () => {
  it("PASS for a paid cohort with a currency", () => {
    const items = evaluateCohortReadiness(makeCohort());
    expect(find(items, "price")?.state).toBe("PASS");
  });

  it("PASS for a free cohort — priceMinor 0 is legal", () => {
    const items = evaluateCohortReadiness(makeCohort({ priceMinor: 0 }));
    expect(find(items, "price")?.state).toBe("PASS");
  });

  it("FAIL when currency is missing", () => {
    const items = evaluateCohortReadiness(makeCohort({ currency: null }));
    expect(find(items, "price")?.state).toBe("FAIL");
  });

  it("FAIL when priceMinor is negative", () => {
    const items = evaluateCohortReadiness(makeCohort({ priceMinor: -1 }));
    expect(find(items, "price")?.state).toBe("FAIL");
  });
});

describe("evaluateCohortReadiness — Capacity (D-28)", () => {
  it("PASS when capacity is positive and covers seats taken", () => {
    const items = evaluateCohortReadiness(makeCohort({ capacity: 10, seatsTaken: 10 }));
    expect(find(items, "capacity")?.state).toBe("PASS");
  });

  it("FAIL when capacity is 0", () => {
    const items = evaluateCohortReadiness(makeCohort({ capacity: 0 }));
    const capacity = find(items, "capacity");
    expect(capacity?.state).toBe("FAIL");
    expect(capacity?.detail).toMatch(/at least 1 seat/i);
  });

  it("FAIL when seats taken exceed capacity (oversold)", () => {
    const items = evaluateCohortReadiness(makeCohort({ capacity: 2, seatsTaken: 3 }));
    const capacity = find(items, "capacity");
    expect(capacity?.state).toBe("FAIL");
    expect(capacity?.detail).toMatch(/3 seats already taken but capacity is 2/i);
  });
});

describe("evaluateCohortReadiness — Instructors (D-28)", () => {
  it("PASS for an instructor-led cohort with an instructor", () => {
    const items = evaluateCohortReadiness(makeCohort({ instructorCount: 1 }));
    expect(find(items, "instructors")?.state).toBe("PASS");
  });

  it("PASS for a self-paced cohort with no instructor", () => {
    const items = evaluateCohortReadiness(
      makeCohort({ deliveryMode: "SELF_PACED", instructorCount: 0 }),
    );
    expect(find(items, "instructors")?.state).toBe("PASS");
  });

  it("FAIL for an instructor-led cohort with no instructor", () => {
    const items = evaluateCohortReadiness(makeCohort({ instructorCount: 0 }));
    expect(find(items, "instructors")?.state).toBe("FAIL");
  });

  it("FAIL for a blended cohort with no instructor", () => {
    const items = evaluateCohortReadiness(
      makeCohort({ deliveryMode: "BLENDED", instructorCount: 0 }),
    );
    expect(find(items, "instructors")?.state).toBe("FAIL");
  });
});

describe("evaluateCohortReadiness — Completion (D-28, WARN-only)", () => {
  it("PASS when the pinned publication carries a completion rule", () => {
    const items = evaluateCohortReadiness(makeCohort());
    expect(find(items, "completion")?.state).toBe("PASS");
  });

  it("WARN — never FAIL — when the pinned publication has no completion rule", () => {
    const items = evaluateCohortReadiness(
      makeCohort({
        pin: {
          kind: "course",
          publicationId: "pub-1",
          targetStatus: "PUBLISHED",
          completionRule: null,
        },
      }),
    );
    const completion = find(items, "completion");
    expect(completion?.state).toBe("WARN");
    expect(completion?.blocking).toBe(false);
  });

  it("WARN when there is no pin at all", () => {
    const items = evaluateCohortReadiness(makeCohort({ pin: null }));
    expect(find(items, "completion")?.state).toBe("WARN");
  });

  it("attendance-threshold-self-paced WARNs when a threshold is set on a self-paced cohort", () => {
    const items = evaluateCohortReadiness(
      makeCohort({ deliveryMode: "SELF_PACED", attendanceThresholdPct: 75, instructorCount: 0 }),
    );
    const warn = find(items, "attendance-threshold-self-paced");
    expect(warn?.state).toBe("WARN");
    expect(warn?.blocking).toBe(false);
  });

  it("attendance-threshold-self-paced PASSes on an instructor-led cohort with a threshold", () => {
    const items = evaluateCohortReadiness(makeCohort({ attendanceThresholdPct: 80 }));
    expect(find(items, "attendance-threshold-self-paced")?.state).toBe("PASS");
  });

  it("attendance-threshold-self-paced PASSes on a self-paced cohort with no threshold", () => {
    const items = evaluateCohortReadiness(
      makeCohort({
        deliveryMode: "SELF_PACED",
        attendanceThresholdPct: null,
        instructorCount: 0,
      }),
    );
    expect(find(items, "attendance-threshold-self-paced")?.state).toBe("PASS");
  });
});

describe("evaluateCohortReadiness — blockingFailures", () => {
  it("is empty for a fully ready cohort", () => {
    expect(blockingFailures(evaluateCohortReadiness(makeCohort()))).toHaveLength(0);
  });

  it("is empty for a ready self-paced cohort", () => {
    const items = evaluateCohortReadiness(
      makeCohort({
        deliveryMode: "SELF_PACED",
        nonCancelledSessionCount: 0,
        sessions: [],
        instructorCount: 0,
        attendanceThresholdPct: null,
      }),
    );
    expect(blockingFailures(items)).toHaveLength(0);
  });

  it("catches a catalogue FAIL", () => {
    const failures = blockingFailures(evaluateCohortReadiness(makeCohort({ pin: null })));
    expect(failures.map((item) => item.id)).toContain("catalogue");
    expect(failures.length).toBeGreaterThanOrEqual(1);
  });

  it("catches a schedule FAIL", () => {
    const failures = blockingFailures(
      evaluateCohortReadiness(makeCohort({ nonCancelledSessionCount: 0, sessions: [] })),
    );
    expect(failures.map((item) => item.id)).toContain("schedule");
    expect(failures.length).toBeGreaterThanOrEqual(1);
  });

  it("catches a capacity FAIL", () => {
    const failures = blockingFailures(
      evaluateCohortReadiness(makeCohort({ capacity: 0 })),
    );
    expect(failures.map((item) => item.id)).toContain("capacity");
    expect(failures.length).toBeGreaterThanOrEqual(1);
  });

  it("catches an instructors FAIL", () => {
    const failures = blockingFailures(
      evaluateCohortReadiness(makeCohort({ instructorCount: 0 })),
    );
    expect(failures.map((item) => item.id)).toContain("instructors");
    expect(failures.length).toBeGreaterThanOrEqual(1);
  });

  it("never includes a WARN-only completion gap", () => {
    const failures = blockingFailures(
      evaluateCohortReadiness(
        makeCohort({
          pin: {
            kind: "course",
            publicationId: "pub-1",
            targetStatus: "PUBLISHED",
            completionRule: null,
          },
        }),
      ),
    );
    expect(failures.map((item) => item.id)).not.toContain("completion");
  });
});
