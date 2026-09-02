/**
 * The shared two-band position convention.
 *
 * `position` occupies two bands under one TOTAL unique index per parent
 * (`Module_courseId_position_key`, `Lesson_moduleId_position_key`,
 * `ProgrammeCourse_programmeId_position_key` — see
 * `prisma/migrations/20260901115332_init/migration.sql`).
 *
 * - **Live band, 0 .. n-1.** Contiguous, no gaps, rewritten wholesale by the
 *   reorder.
 * - **Reorder parking band, -1 .. -n.** Occupied for the duration of ONE
 *   statement inside the reorder transaction (plan 04-05 pass one maps `p`
 *   to `-p - 1`). Never observed by another session.
 * - **Withdrawn band, at or below -1,000,001.** A withdrawn row keeps a
 *   real, unique slot because the index is total and `withdrawnAt` exempts
 *   nothing. Parking it far below the reorder band is what stops a
 *   withdrawal from colliding with an in-flight reorder of its live
 *   siblings.
 *
 * `MAX_ARRANGEMENT_SIZE` is the wall between the reorder band and the
 * withdrawn band. An arrangement larger than it is refused outright rather
 * than allowed to wrap into the withdrawn band silently.
 *
 * Pure module, no Prisma import — plans 04-04 (Module/Lesson services) and
 * 04-05 (the reorder transaction) both import this rather than each
 * inventing the rule.
 */

/** The first slot of the withdrawn band, one past the reorder band's wall. */
export const WITHDRAWN_PARK_BASE = -1_000_000;

/**
 * The largest arrangement a reorder will accept. Also the wall between the
 * reorder parking band (`-1 .. -n`) and the withdrawn band
 * (`WITHDRAWN_PARK_BASE` and below) — the two must stay disjoint however
 * large a single arrangement grows.
 */
export const MAX_ARRANGEMENT_SIZE = 100_000;

/**
 * Where to park a row being withdrawn.
 *
 * `minSiblingPosition` is the minimum `position` currently held by ANY
 * sibling of the parent — live, parked, or already withdrawn. If no
 * sibling has been withdrawn yet (the minimum is `null` or still inside the
 * live/reorder bands), the row parks at `WITHDRAWN_PARK_BASE - 1`, the
 * first slot of the withdrawn band. If a sibling is already withdrawn
 * (the minimum sits at or below `WITHDRAWN_PARK_BASE`), the new row parks
 * one slot deeper than that — so two withdrawals from the same parent can
 * never collide with each other, only ever deepen the band.
 */
export function parkedWithdrawnPosition(minSiblingPosition: number | null): number {
  if (minSiblingPosition !== null && minSiblingPosition < WITHDRAWN_PARK_BASE) {
    return minSiblingPosition - 1;
  }
  return WITHDRAWN_PARK_BASE - 1;
}

/**
 * Where to append a restored (or newly created) row.
 *
 * `maxLiveSiblingPosition` is the maximum `position` among the parent's
 * LIVE siblings only (never withdrawn ones — their positions are deep
 * negative and would produce a negative append slot). D-34: restoring
 * appends to the end of the order rather than guessing the original
 * position, which is very likely occupied by now. Clamped at 0 so a parent
 * whose only rows are withdrawn (or which has none at all) appends at the
 * start of the live band, never at a negative successor.
 */
export function nextAppendPosition(maxLiveSiblingPosition: number | null): number {
  if (maxLiveSiblingPosition === null || maxLiveSiblingPosition < 0) {
    return 0;
  }
  return maxLiveSiblingPosition + 1;
}

/**
 * Refuses an arrangement too large to stay inside the reorder parking band
 * without touching the withdrawn band. Called before the reorder's pass one
 * (plan 04-05), which maps each live position `p` to a parking slot
 * `-p - 1`.
 */
export function assertArrangementSize(count: number): void {
  if (count > MAX_ARRANGEMENT_SIZE) {
    throw new Error(
      `Arrangement of ${count} rows exceeds the maximum of ${MAX_ARRANGEMENT_SIZE}.`,
    );
  }
}
