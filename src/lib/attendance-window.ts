/**
 * The attendance marking window (D-06, RESEARCH 05 Pitfall 4).
 *
 * PURE MODULE. No imports — and explicitly no timezone or locale-formatting
 * code on this path. Timezone is a display concern (see
 * `src/lib/timezone.ts`); the marking window is pure UTC arithmetic on the
 * instants already stored on `ScheduledSession.startsAt` / `endsAt`.
 * Comparing against a wall-clock reconstruction here would drift the
 * boundary by the cohort's UTC offset and let a post-window edit through
 * without a correction reason.
 *
 * Normal marking runs from a session's scheduled start until 7 days
 * (168 hours) after it ends, inclusive at both ends. Outside that window a
 * change still succeeds but requires a correction reason — that rule lives
 * in the attendance service; this module only answers "is `now` inside the
 * window?" and "has the session started yet?".
 */

/**
 * D-06 — a project constant, deliberately NOT a per-cohort field. Promote
 * to a Cohort column only if the product later asks for it.
 */
export const ATTENDANCE_MARKING_WINDOW_HOURS = 168;

const WINDOW_MS = ATTENDANCE_MARKING_WINDOW_HOURS * 3_600_000;

/**
 * Whether `now` is inside the normal marking window: at or after
 * `startsAt`, and at or before `endsAt + 168h`.
 */
export function isWithinMarkingWindow(
  session: { startsAt: Date; endsAt: Date },
  now: Date,
): boolean {
  return (
    now.getTime() >= session.startsAt.getTime() &&
    now.getTime() <= session.endsAt.getTime() + WINDOW_MS
  );
}

/**
 * Whether the session has not started yet. Pre-start marking is restricted
 * to `EXCUSED` / `NOT_RECORDED` (D-09) — the service uses this to enforce
 * that.
 */
export function isBeforeSessionStart(
  session: { startsAt: Date },
  now: Date,
): boolean {
  return now.getTime() < session.startsAt.getTime();
}

/** The instant the normal marking window closes: `endsAt + 168h`. */
export function markingWindowClosesAt(session: { endsAt: Date }): Date {
  return new Date(session.endsAt.getTime() + WINDOW_MS);
}
