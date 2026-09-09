/**
 * The attendance component (D-20, ATT-02).
 *
 * PURE MODULE — no imports at all. Same discipline as
 * `readiness-service.ts`: a data-access import here would put this module
 * on the worker import closure and break `tests/boundary.test.ts`.
 *
 * This computes the ATTENDANCE COMPONENT ONLY — the learner's earned
 * attendance percent versus the cohort's required threshold. It
 * deliberately does NOT produce a completion verdict: D-20 reserves the
 * overall completion decision, and its recalculation when an attendance
 * record is corrected, for the Phase 9 / Phase 11 completion engine, which
 * subscribes to the "attendance changed" domain event.
 *
 * Third states, not fake zeroes (D-18, RESEARCH 05 Pitfall 7): a cohort
 * with no attendance rule returns `{ kind: "no-rule" }` and a cohort whose
 * countable session set is empty returns `{ kind: "no-sessions" }` — the
 * roster renders those as an explicit state, never `0%` or a blank.
 */

/**
 * The five `AttendanceState` values, as a local string union so this module
 * needs no `@prisma/client` type import. Matches `prisma/schema.prisma`
 * `enum AttendanceState`.
 */
export type AttendanceStateValue =
  | "PRESENT"
  | "ABSENT"
  | "LATE"
  | "EXCUSED"
  | "NOT_RECORDED";

export type AttendanceComponentEntry = {
  state: AttendanceStateValue;
  /** `ScheduledSession.attendanceExpected` — a `false` session is excluded. */
  attendanceExpected: boolean;
  /** `ScheduledSession.cancelledAt` — a cancelled session is excluded. */
  cancelledAt: Date | string | null;
};

export type AttendanceComponentInput = {
  /** `Cohort.attendanceThresholdPct` — `null` means "no attendance rule". */
  thresholdPct: number | null;
  entries: AttendanceComponentEntry[];
};

export type AttendanceComponent =
  | {
      kind: "computed";
      /** Attended countable sessions as a percent, rounded to nearest integer. */
      earnedPct: number;
      /** The cohort threshold, echoed for the roster. */
      requiredPct: number;
      attendedCount: number;
      countableCount: number;
      meetsThreshold: boolean;
    }
  | { kind: "no-rule" }
  | { kind: "no-sessions" };

/** `PRESENT` and `LATE` both count as having attended. */
const ATTENDED: ReadonlySet<AttendanceStateValue> = new Set<AttendanceStateValue>([
  "PRESENT",
  "LATE",
]);

/** `EXCUSED` leaves both the numerator and the denominator. */
const EXCLUDED_FROM_DENOMINATOR: ReadonlySet<AttendanceStateValue> =
  new Set<AttendanceStateValue>(["EXCUSED"]);

export function computeAttendanceComponent(
  input: AttendanceComponentInput,
): AttendanceComponent {
  if (input.thresholdPct === null) {
    return { kind: "no-rule" };
  }

  const countable = input.entries.filter(
    (e) =>
      e.attendanceExpected &&
      e.cancelledAt === null &&
      !EXCLUDED_FROM_DENOMINATOR.has(e.state),
  );

  if (countable.length === 0) {
    return { kind: "no-sessions" };
  }

  const attendedCount = countable.filter((e) => ATTENDED.has(e.state)).length;
  const countableCount = countable.length;
  const earnedPct = Math.round((attendedCount / countableCount) * 100);
  const requiredPct = input.thresholdPct;

  return {
    kind: "computed",
    earnedPct,
    requiredPct,
    attendedCount,
    countableCount,
    meetsThreshold: earnedPct >= requiredPct,
  };
}
