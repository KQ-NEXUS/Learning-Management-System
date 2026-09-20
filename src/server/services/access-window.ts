/**
 * The self-paced access-window evaluator (D-01, D-02, D-03).
 *
 * PURE MODULE — no imports at all. Same discipline as `readiness-service.ts`
 * and `attendance-component.ts`: a data-access import here would put this
 * module on the worker import closure and break `tests/boundary.test.ts`.
 * This module has zero data-access or type-level imports of any kind.
 *
 * INSTRUCTOR_LED and BLENDED cohorts are unaffected by any of this — they
 * keep using the Cohort-wide `startsAt`/`endsAt` dates (D-01 scopes the
 * per-enrolment window strictly to SELF_PACED). For SELF_PACED, `null`
 * `accessDurationDays` means unlimited access (D-02); a set value is a day
 * count measured from `Enrolment.activatedAt`, not from the Cohort's own
 * dates. `Enrolment.accessEndsAt`, once persisted, is authoritative over a
 * freshly computed window — D-01 stores the per-enrolment window on the
 * Enrolment precisely so a later Cohort-level change to
 * `accessDurationDays` cannot retroactively move an already-activated
 * learner's own end date.
 *
 * D-03's rule, stated in the imperative: a closed window (`readOnly: true`)
 * is a RENDERING AND AUTHORIZATION concern ONLY. No caller may translate
 * `readOnly: true` into an `Enrolment.status` change, and there is
 * deliberately no sweep/worker job that revisits this decision — every read
 * recomputes it fresh from `now`.
 */

const MS_PER_DAY = 86_400_000;

export type AccessWindowInput = {
  /** `Cohort.deliveryMode` as a string so this module needs no Prisma enum import. */
  deliveryMode: string;
  /** `Cohort.endsAt` — used verbatim for INSTRUCTOR_LED/BLENDED (D-01). */
  cohortEndsAt: Date | null;
  /** `Cohort.accessDurationDays` — `null` means unlimited (D-02). */
  accessDurationDays: number | null;
  /** `Enrolment.activatedAt` — the self-paced window's start reference. */
  activatedAt: Date | null;
  /**
   * `Enrolment.accessEndsAt` — when non-null, this persisted value is
   * authoritative and wins over any freshly computed window (D-01).
   */
  accessEndsAt: Date | null;
  /** The server clock. Explicit input so no caller can read a client-controlled value (T-09-10). */
  now: Date;
};

/**
 * Four named states — never collapse "not started yet" or "unlimited" into
 * a fake open/closed boolean. `readOnly`/`endsAt` are present on every
 * variant so callers can branch on `kind` for messaging while still reading
 * `readOnly`/`endsAt` uniformly.
 */
export type AccessWindow =
  | { kind: "cohort-dates"; readOnly: boolean; endsAt: Date | null }
  | { kind: "unlimited"; readOnly: boolean; endsAt: Date | null }
  | { kind: "not-started"; readOnly: boolean; endsAt: Date | null }
  | { kind: "windowed"; readOnly: boolean; endsAt: Date | null };

export function computeAccessWindow(input: AccessWindowInput): AccessWindow {
  if (input.deliveryMode !== "SELF_PACED") {
    // D-01 — INSTRUCTOR_LED and BLENDED ignore accessDurationDays entirely.
    return { kind: "cohort-dates", readOnly: false, endsAt: input.cohortEndsAt };
  }

  if (input.accessDurationDays === null) {
    // D-02 — null means unlimited access.
    return { kind: "unlimited", readOnly: false, endsAt: null };
  }

  if (input.activatedAt === null) {
    // Named third state — never a fake open window before activation.
    return { kind: "not-started", readOnly: true, endsAt: null };
  }

  const computedEndsAt = new Date(
    input.activatedAt.getTime() + input.accessDurationDays * MS_PER_DAY,
  );
  // D-01 — a persisted per-enrolment value is authoritative over a freshly
  // computed one.
  const endsAt = input.accessEndsAt ?? computedEndsAt;
  // D-03 — `now === endsAt` is still open; strictly-greater is read-only.
  const readOnly = input.now.getTime() > endsAt.getTime();

  return { kind: "windowed", readOnly, endsAt };
}
