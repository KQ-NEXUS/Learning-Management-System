/**
 * Seat accounting — the shared, transaction-taking capacity primitive.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE ADDING AN AUTHORIZATION CHECK.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This module is deliberately NOT wrapped in `withPermission`. It is a
 * transaction-taking primitive called from three places whose callers differ
 * (or are absent):
 *
 *   1. staff enrolment actions (plan 05-07) — already authorized by their own
 *      permission wrapper before control ever reaches this file;
 *   2. the hold-expiry worker (plan 05-09) — a standalone `tsx` process with
 *      no request, no session cookie, no Next.js runtime;
 *   3. Phase 6 checkout — which calls `takeSeat` rather than re-deriving the
 *      race-safe recipe.
 *
 * It therefore MUST import only database types and pure helpers. Importing the
 * permissions module under `src/server/permissions/`, anything under `next/`,
 * or `cohort-scope.ts` (request-side authorization plumbing) puts request-only
 * APIs onto the worker's import closure and fails `tests/boundary.test.ts`
 * ("keeps the worker runtime import closure away from request-only APIs").
 * Authorization is the caller's job and is never re-implemented here.
 *
 * Why a row-level lock and not "count then insert": two concurrent checkouts
 * each counting `seatsTaken` on a capacity-1 cohort both read 0, both insert,
 * and the cohort is oversold. Locking the Cohort row serialises them — the
 * loser blocks until the winner commits, then reads `seatsTaken = 1` and is
 * refused before it inserts anything. The `cohort_capacity_not_exceeded`
 * CHECK (`prisma/sql/001_integrity.sql`) is a backstop that must never be the
 * thing that fires; `tests/seat-accounting.integration.test.ts` asserts it
 * does not.
 *
 * Raw SQL here is always a parameterised tagged template — never the
 * `*RawUnsafe` variants with string interpolation (idiom copied from
 * `reorder-service.ts:272`).
 */

/**
 * The seat-hold TTL, in minutes, that `Cohort.holdMinutes` defaults to in the
 * schema (`@default(30)`). Exported so a call site that needs to display or
 * seed the default references one constant. `holdExpiryFrom` does NOT apply
 * it: a `null` `holdMinutes` column means "no hold", not "unset".
 */
export const HOLD_MINUTES_DEFAULT = 30;

export class StaleEnrolmentError extends Error {
  constructor() {
    super("This enrolment changed while you were working. Refresh and try again.");
    this.name = "StaleEnrolmentError";
  }
}

/** A failed conditional write aborts the caller's transaction, including seat changes. */
export async function updateCurrentEnrolment(
  tx: Pick<SeatTxClient, "enrolment">,
  args: Parameters<SeatTxClient["enrolment"]["update"]>[0],
): Promise<unknown> {
  try {
    return await tx.enrolment.update(args);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") {
      throw new StaleEnrolmentError();
    }
    throw error;
  }
}

/** Refused by the row-lock guard because the cohort is at capacity (D-05). */
export class CapacityExceededError extends Error {
  readonly cohortId: string;
  readonly capacity: number;
  readonly seatsTaken: number;

  constructor(cohortId: string, capacity: number, seatsTaken: number) {
    super(`Cohort ${cohortId} is full (${seatsTaken}/${capacity}).`);
    this.name = "CapacityExceededError";
    this.cohortId = cohortId;
    this.capacity = capacity;
    this.seatsTaken = seatsTaken;
  }
}

/**
 * The learner already has an ACTIVE enrolment in this cohort — a translation
 * of the P2002 raised by the `enrolment_one_active_per_learner_cohort` partial
 * unique index, so the caller sees a typed outcome instead of a raw Prisma
 * error or a 500 (D-15).
 */
export class AlreadyEnrolledError extends Error {
  readonly userId: string;
  readonly cohortId: string;

  constructor(userId: string, cohortId: string) {
    super(
      `User ${userId} already has an active enrolment in cohort ${cohortId}.`,
    );
    this.name = "AlreadyEnrolledError";
    this.userId = userId;
    this.cohortId = cohortId;
  }
}

/** No Cohort row for the given id. */
export class CohortNotFoundError extends Error {
  readonly cohortId: string;

  constructor(cohortId: string) {
    super(`Cohort ${cohortId} does not exist.`);
    this.name = "CohortNotFoundError";
    this.cohortId = cohortId;
  }
}

export class CohortClosedError extends Error {
  constructor(readonly cohortId: string, readonly status: string) {
    super(`Cohort ${cohortId} is ${status.toLowerCase()} and cannot accept new enrolments, approvals, transfers, or publication.`);
    this.name = "CohortClosedError";
  }
}

export function assertCohortOpen(cohortId: string, status: string): void {
  if (!["DRAFT", "PUBLISHED", "IN_PROGRESS"].includes(status)) {
    throw new CohortClosedError(cohortId, status);
  }
}

/** Shared lock for admission and cancellation; held until the caller commits. */
export async function lockCohort(
  tx: Pick<SeatTxClient, "$queryRaw">,
  cohortId: string,
): Promise<{ status: string; seatsTaken: number; capacity: number }> {
  const rows = await tx.$queryRaw<{ status: string; seatsTaken: number; capacity: number }[]>`
    SELECT "status", "seatsTaken", "capacity" FROM "Cohort" WHERE "id" = ${cohortId} FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw new CohortNotFoundError(cohortId);
  return row;
}

export async function lockOpenCohort(
  tx: Pick<SeatTxClient, "$queryRaw">,
  cohortId: string,
) {
  const row = await lockCohort(tx, cohortId);
  assertCohortOpen(cohortId, row.status);
  return row;
}

/**
 * The subset of a Prisma transaction client this module uses — structural, so
 * a unit-test fake and the real `tx` both satisfy it and no `@prisma/client`
 * import is needed. Callers pass `tx as unknown as SeatTxClient`, exactly as
 * `reorder-service.ts` does with `ReorderTx`.
 */
export type SeatTxClient = {
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
  $executeRaw(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number>;
  enrolment: {
    create(args: {
      data: Record<string, unknown>;
      select: { id: true };
    }): Promise<{ id: string }>;
    update(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<unknown>;
  };
  cohort: {
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<unknown>;
  };
};

/**
 * True for a Prisma `PrismaClientKnownRequestError` with code `P2002`
 * (unique-constraint violation), duck-typed on `.code` so this file stays
 * free of a Prisma client import (copied from `resource-service.ts:77-84`).
 */
function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/**
 * The single definition of "does this enrolment currently occupy a seat".
 * Every caller that might otherwise double-count a seat (staff "approve" on a
 * PENDING_PAYMENT enrolment — D-12, RESEARCH Pitfall 3 / Open Question 2)
 * MUST consult this rather than re-deriving it.
 *
 * A seat is held iff the enrolment is ACTIVE, or it is PENDING_PAYMENT with a
 * live hold (`holdExpiresAt` set). A PENDING_PAYMENT enrolment created with no
 * hold (`Cohort.holdMinutes` null/0) has NOT taken a seat; every terminal
 * status has released it.
 */
export function holdsSeat(enrolment: {
  status: string;
  holdExpiresAt: Date | null;
}): boolean {
  if (enrolment.status === "ACTIVE") return true;
  if (enrolment.status === "PENDING_PAYMENT") {
    return enrolment.holdExpiresAt !== null;
  }
  return false;
}

/**
 * The one place the hold rule lives (D-02). Returns the instant a
 * PENDING_PAYMENT seat hold expires, or `null` when the cohort takes no hold
 * — `holdMinutes` is `null` or `0`. `now` is injected so callers stay
 * testable.
 */
export function holdExpiryFrom(
  cohortHoldMinutes: number | null,
  now: Date,
): Date | null {
  if (cohortHoldMinutes === null || cohortHoldMinutes <= 0) return null;
  return new Date(now.getTime() + cohortHoldMinutes * 60_000);
}

/**
 * Takes a seat in `cohortId` for the enrolment described by `args.enrolment`,
 * inside the caller's transaction. Order of operations matters:
 *
 *   1. lock the Cohort row and read `seatsTaken` / `capacity`;
 *   2. `CohortNotFoundError` when no row came back;
 *   3. `CapacityExceededError` when the cohort is full — THIS refusal, not the
 *      `cohort_capacity_not_exceeded` CHECK, is the guard, and nothing is
 *      inserted;
 *   4. create the enrolment, translating a P2002 from the partial unique
 *      index to `AlreadyEnrolledError` (D-15);
 *   5. increment `seatsTaken` by exactly 1 in the same transaction.
 */
export async function takeSeat(
  tx: SeatTxClient,
  args: { cohortId: string; enrolment: Record<string, unknown> },
): Promise<{ id: string }> {
  const row = await lockOpenCohort(tx, args.cohortId);
  if (row.seatsTaken >= row.capacity) {
    throw new CapacityExceededError(args.cohortId, row.capacity, row.seatsTaken);
  }

  let created: { id: string };
  try {
    created = await tx.enrolment.create({
      data: args.enrolment,
      select: { id: true },
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      throw new AlreadyEnrolledError(
        String(args.enrolment.userId ?? ""),
        args.cohortId,
      );
    }
    throw err;
  }

  await tx.cohort.update({
    where: { id: args.cohortId },
    data: { seatsTaken: { increment: 1 } },
  });

  return created;
}

/**
 * Claims one unit of capacity in `cohortId` for an enrolment row that ALREADY
 * EXISTS — the D-12 "approve a hold-less PENDING_PAYMENT enrolment" path.
 *
 * `takeSeat` cannot serve this case: it INSERTs a new enrolment. Here the row
 * was already created hold-less by `addEnrolment` (a cohort with `holdMinutes`
 * null/0 takes no seat until the enrolment reaches ACTIVE — D-02), so approve
 * must run only the capacity gate and the increment, never a second insert
 * (RESEARCH Pitfall 3). The status flip to ACTIVE and the `holdExpiresAt: null`
 * write stay the caller's, in the same transaction.
 *
 * Same row lock and same refusal order as `takeSeat`: lock the Cohort row,
 * `CapacityExceededError` before the counter is touched, then
 * `seatsTaken = seatsTaken + 1`.
 */
export async function claimSeat(
  tx: SeatTxClient,
  args: { cohortId: string },
): Promise<void> {
  const row = await lockOpenCohort(tx, args.cohortId);
  if (row.seatsTaken >= row.capacity) {
    throw new CapacityExceededError(args.cohortId, row.capacity, row.seatsTaken);
  }

  await tx.cohort.update({
    where: { id: args.cohortId },
    data: { seatsTaken: { increment: 1 } },
  });
}

/**
 * Moves an enrolment to a terminal (or transferred) status and, when it
 * `heldSeat`, releases its seat — all under the Cohort row lock.
 *
 * `holdExpiresAt` is always nulled: the new
 * `enrolment_hold_expiry_only_when_pending` CHECK rejects a non-pending row
 * that still carries a hold. The decrement is expressed in SQL as
 * `GREATEST("seatsTaken" - 1, 0)` under the lock, never as a read-then-write
 * in application code — that would reintroduce the race the lock exists to
 * close (D-04, threat T-05-20).
 */
export async function releaseSeat(
  tx: SeatTxClient,
  args: {
    cohortId: string;
    enrolmentId: string;
    toStatus: "WITHDRAWN" | "CANCELLED" | "TRANSFERRED";
    reason: string;
    heldSeat: boolean;
    expected?: { status: string; holdExpiresAt: Date | null };
    withdrawnAt?: Date;
  },
): Promise<void> {
  await tx.$queryRaw`
    SELECT "seatsTaken" FROM "Cohort" WHERE "id" = ${args.cohortId} FOR UPDATE
  `;

  await updateCurrentEnrolment(tx, {
    where: {
      id: args.enrolmentId,
      cohortId: args.cohortId,
      ...(args.expected ?? {
        status: { in: ["ACTIVE", "PENDING_PAYMENT"] },
        OR: args.heldSeat
          ? [{ status: "ACTIVE" }, { status: "PENDING_PAYMENT", holdExpiresAt: { not: null } }]
          : [{ status: "PENDING_PAYMENT", holdExpiresAt: null }],
      }),
    },
    data: {
      status: args.toStatus,
      reason: args.reason,
      holdExpiresAt: null,
      ...(args.withdrawnAt ? { withdrawnAt: args.withdrawnAt } : {}),
    },
  });

  if (args.heldSeat) {
    await tx.$executeRaw`
      UPDATE "Cohort"
         SET "seatsTaken" = GREATEST("seatsTaken" - 1, 0)
       WHERE "id" = ${args.cohortId}
    `;
  }
}
