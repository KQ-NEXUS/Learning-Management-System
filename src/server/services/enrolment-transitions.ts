/**
 * The Enrolment status transition table and the PENDING_PAYMENT -> ACTIVE
 * transition body — split out of `enrolment-service.ts` so this module's own
 * import graph stays free of the permission choke point and request-side
 * authorization plumbing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ITS OWN FILE, NOT JUST A FUNCTION INSIDE enrolment-service.ts.
 * ─────────────────────────────────────────────────────────────────────────────
 * `enrolment-service.ts` as a WHOLE imports `withPermission`
 * (`@/server/permissions`) and `cohort-scope.ts` at module scope, because its
 * OTHER exports (`addEnrolment`, `approveEnrolment`, `transferEnrolment`,
 * `withdrawEnrolment`, `cancelEnrolment`) are staff-authorized actions that
 * need them. ES module imports are resolved for the whole file, not per
 * export — so importing only `applyEnrolmentActivation` from
 * `enrolment-service.ts` still pulls the permission choke point onto the
 * importer's static import graph, even though `applyEnrolmentActivation`
 * itself never calls it (06-06's `tests/boundary.test.ts` extension is what
 * caught this: `checkout-webhook-system-service.ts`, imported from an
 * unauthenticated webhook route, was one import away from a module that
 * imports the live `withPermission`).
 *
 * `checkout-webhook-system-service.ts` imports `applyEnrolmentActivation`
 * (and the transition table/errors it needs) from THIS file instead —
 * `enrolment-service.ts` re-exports the same names unchanged, so every
 * existing staff-facing caller (`approveEnrolment`, `transferEnrolment`,
 * `tests/enrolment-service*.test.ts`) is unaffected.
 *
 * This module MUST NOT import the permission choke point, the request
 * actor-getter, `cohort-scope.ts`, or anything under `next/` — the same rule
 * `hold-release-system-service.ts` and `checkout-webhook-system-service.ts`
 * already hold themselves to. It imports only `seat-accounting.ts` and
 * `domain-event-service.ts`, both already isolation-safe by their own header
 * comments.
 */

import {
  claimSeat,
  holdsSeat,
  lockOpenCohort,
  updateCurrentEnrolment,
  type SeatTxClient,
} from "@/server/services/seat-accounting";
import {
  writeDomainEvent,
  type DomainEventTxClient,
} from "@/server/services/domain-event-service";

// ---------------------------------------------------------------------------
// The transition table (D-16) — hand-written app logic, no rules engine.
// ---------------------------------------------------------------------------

export type EnrolmentStatusValue =
  | "PENDING_PAYMENT"
  | "ACTIVE"
  | "COMPLETED"
  | "WITHDRAWN"
  | "TRANSFERRED"
  | "CANCELLED";

/**
 * The only legal status moves. `COMPLETED` is reachable solely from the
 * Phase 9/11 completion engine and is NOT exposed as a Phase-5 action; every
 * terminal status has an empty allow-list.
 */
export const VALID_TRANSITIONS: Record<
  EnrolmentStatusValue,
  EnrolmentStatusValue[]
> = {
  PENDING_PAYMENT: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["WITHDRAWN", "TRANSFERRED", "COMPLETED", "CANCELLED"],
  WITHDRAWN: [],
  TRANSFERRED: [],
  CANCELLED: [],
  COMPLETED: [],
};

/** A status move that is not in `VALID_TRANSITIONS`. */
export class IllegalTransitionError extends Error {
  readonly from: string;
  readonly to: string;
  readonly enrolmentId: string | null;

  constructor(from: string, to: string, enrolmentId: string | null = null) {
    super(`An enrolment cannot move from ${from} to ${to}.`);
    this.name = "IllegalTransitionError";
    this.from = from;
    this.to = to;
    this.enrolmentId = enrolmentId;
  }
}

/**
 * Throws `IllegalTransitionError` when `to` is not an allowed next status for
 * `from`. Every write path calls this before touching the row.
 */
export function assertTransition(
  from: EnrolmentStatusValue,
  to: EnrolmentStatusValue,
  enrolmentId: string | null = null,
): void {
  const allowed = VALID_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new IllegalTransitionError(from, to, enrolmentId);
  }
}

export type EnrolmentRow = {
  id: string;
  userId: string;
  cohortId: string;
  status: string;
  holdExpiresAt: Date | null;
  activatedAt: Date | null;
  withdrawnAt: Date | null;
  reason: string | null;
  orderId: string | null;
  transferredFromId: string | null;
};

/**
 * The minimal transaction surface `applyEnrolmentActivation` needs — a
 * STRICT SUBSET of the single-enrolment `EnrolmentTxClient` surface
 * `enrolment-service.ts` uses for `db.$transaction` (no `enrolment.create`,
 * no `enrolment.findUnique`) — structural, so a caller with its own
 * transaction client shape (a webhook's own `tx`, plan 06-03/06-06) can
 * satisfy it without widening to that larger surface.
 */
export type EnrolmentActivationTxClient = {
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  enrolment: {
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
  domainEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
};

/**
 * The shared PENDING_PAYMENT -> ACTIVE transition body (D-12), callable by
 * both a staff-authorized caller (`enrolment-service.ts`'s
 * `approveEnrolment`, which keeps its own `withPermission` wrapper) and a
 * webhook-driven, actorless caller (Phase 6's Stripe webhook). Takes an
 * ALREADY-FETCHED `enrolment` row and an ALREADY-OPEN `tx` — the caller owns
 * both the read and the transaction boundary.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS FUNCTION PERFORMS NO AUTHORIZATION. READ THIS BEFORE "FIXING" THAT.
 * ─────────────────────────────────────────────────────────────────────────
 * Authorization is the caller's job. A webhook POST has no session cookie
 * and therefore no actor to authorize against (the same reasoning
 * `seat-accounting.ts`'s own header gives for its primitives), so `actorId`
 * is typed `string | null` and an actorless caller is an INTENDED consumer
 * of this export, not a bypass of it.
 *
 * Emits `"enrolment.approved"` when `actorId` is a string (a staff member
 * exercised `enrolments.manage`) and `"enrolment.activated"` when it is
 * `null` (a verified Stripe payment did it with no actor) — so the outbox,
 * Phase 8's reconciliation views and Phase 13's email drain can always tell a
 * webhook-triggered activation apart from a staff override.
 */
export async function applyEnrolmentActivation(
  tx: EnrolmentActivationTxClient,
  args: { enrolment: EnrolmentRow; reason: string; actorId: string | null; now: Date },
): Promise<{ id: string; before: EnrolmentStatusValue; claimedSeat: boolean }> {
  const { enrolment: e, reason, actorId, now } = args;
  const before = e.status as EnrolmentStatusValue;
  assertTransition(before, "ACTIVE", e.id);

  // `claimSeat`/`lockOpenCohort`/`updateCurrentEnrolment` are typed against
  // `SeatTxClient`, which also declares `enrolment.create` (needed by
  // `takeSeat`, never by this path). The cast is the same "structural, cast
  // via unknown" idiom `enrolment-service.ts`'s `applyEnrolmentExit` uses for
  // `releaseSeat`.
  const seatTx = tx as unknown as SeatTxClient;

  // RESEARCH Pitfall 3: consult the single seat-occupancy predicate. A
  // hold-holding enrolment already counts — claim a seat ONLY when none is
  // currently held, so activation never double-counts.
  const heldSeat = holdsSeat(e);
  if (!heldSeat) {
    await claimSeat(seatTx, { cohortId: e.cohortId });
  } else {
    await lockOpenCohort(seatTx, e.cohortId);
  }

  await updateCurrentEnrolment(seatTx, {
    where: { id: e.id, status: e.status, holdExpiresAt: e.holdExpiresAt },
    data: {
      status: "ACTIVE",
      holdExpiresAt: null,
      activatedAt: now,
      reason,
    },
  });

  await writeDomainEvent(tx as unknown as DomainEventTxClient, {
    type: actorId === null ? "enrolment.activated" : "enrolment.approved",
    payload: {
      enrolmentId: e.id,
      cohortId: e.cohortId,
      claimedSeat: !heldSeat,
      actorId,
    },
  });

  return { id: e.id, before, claimedSeat: !heldSeat };
}
