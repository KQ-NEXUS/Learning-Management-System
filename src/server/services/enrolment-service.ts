/**
 * Enrolment state machine (COH-05) — the staff actions add, approve, transfer,
 * withdraw and cancel.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS MECHANISM, NOT POLICY. READ BEFORE ADDING A WORKFLOW.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * There is no approval workflow and no policy or rules engine here (D-16). A
 * staff member holding `enrolments.manage` in the cohort's scope performs the
 * action directly; this module's whole job is to check the transition is legal
 * against an explicit table, capture the mandatory reason, write the audit
 * row, emit exactly one domain event for the Phase-13 email, and keep
 * `seatsTaken` exact. It never creates a duplicate active enrolment — the
 * `enrolment_one_active_per_learner_cohort` partial unique index is the guard
 * and `AlreadyEnrolledError` is the translation; there is deliberately no
 * application-level pre-check (which would itself be a race).
 *
 * No refund and no credit is ever produced here by a withdrawal, a
 * cancellation or a transfer (PRD §15.3(4)). Finance owns that in Phase 7/8
 * against an approved policy — a later reader must not wire one in.
 *
 * A transfer (D-13) carries NO history across: attendance and lesson progress
 * stay on the source enrolment, which is why the source row is retained as
 * TRANSFERRED rather than deleted. The transfer is same-offer only; cross-offer
 * transfer is deferred and there is no compatibility path.
 *
 * `approveEnrolment` is the exact transition Phase 7's manual-payment path
 * calls once a payment is confirmed — no payment record is created or required
 * here. Phase 6 checkout calls `takeSeat` directly for the PENDING_PAYMENT seat
 * hold. Both reuse this surface rather than re-deriving it.
 *
 * Every transition records an `AuditEvent` with `targetType: "Enrolment"` and
 * `targetId` = the enrolment id — the cohort roster's transition history
 * (plan 05-10) reads exactly that key.
 */

import { prisma } from "@/server/db";
import { withPermission as liveWithPermission } from "@/server/permissions";
import type { ResourceScope } from "@/server/permissions/scope";
import type { createWithPermission } from "@/server/permissions/with-permission";
import { recordAudit } from "@/server/services/audit-service";
import type { ResourceAuditEntry } from "@/server/services/resource-service";
import {
  claimSeat,
  CohortNotFoundError,
  holdExpiryFrom,
  holdsSeat,
  releaseSeat,
  takeSeat,
  type SeatTxClient,
} from "@/server/services/seat-accounting";
import {
  writeDomainEvent,
  type DomainEventTxClient,
} from "@/server/services/domain-event-service";
import {
  cohortResourceScope,
  enrolmentCohortScope,
} from "@/server/services/cohort-scope";

type WithPermission = ReturnType<typeof createWithPermission>;
type Audit = (entry: ResourceAuditEntry) => Promise<void>;

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

// ---------------------------------------------------------------------------
// Typed refusals — each one a Server Action turns into a specific message.
// ---------------------------------------------------------------------------

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
 * A transfer target that is not another cohort of the same offer (D-13), or a
 * target that is the source cohort itself. Cross-offer transfer is deferred.
 */
export class CrossOfferTransferError extends Error {
  readonly sourceCohortId: string;
  readonly targetCohortId: string;

  constructor(sourceCohortId: string, targetCohortId: string, detail: string) {
    super(`This enrolment cannot be transferred: ${detail}.`);
    this.name = "CrossOfferTransferError";
    this.sourceCohortId = sourceCohortId;
    this.targetCohortId = targetCohortId;
  }
}

/** No `Enrolment` row for the given id. */
export class EnrolmentNotFoundError extends Error {
  readonly enrolmentId: string;

  constructor(enrolmentId: string) {
    super(`Enrolment ${enrolmentId} does not exist.`);
    this.name = "EnrolmentNotFoundError";
    this.enrolmentId = enrolmentId;
  }
}

/** A mandatory reason was blank (COH-05 — every action needs one). */
export class ReasonRequiredError extends Error {
  constructor(message = "A reason is required for this enrolment action.") {
    super(message);
    this.name = "ReasonRequiredError";
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

/** Copy of the `publish-service.ts` shape — reused by all five actions. */
function requireReason(reason: string | null | undefined): string {
  const trimmed = reason?.trim();
  if (!trimmed) throw new ReasonRequiredError();
  return trimmed;
}

// ---------------------------------------------------------------------------
// Injected surface — a Prisma client satisfies it and so does a unit-test fake.
// ---------------------------------------------------------------------------

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

type CohortOfferRow = {
  id: string;
  holdMinutes: number | null;
  courseId: string | null;
  programmeId: string | null;
};

/** The transaction client the writes need — structural, no `@prisma/client`. */
export type EnrolmentTxClient = SeatTxClient &
  DomainEventTxClient & {
    enrolment: SeatTxClient["enrolment"] & {
      findUnique(args: { where: { id: string } }): Promise<EnrolmentRow | null>;
    };
  };

/**
 * The minimal transaction surface `applyEnrolmentExit` needs — a STRICT
 * subset of `EnrolmentTxClient` (no `enrolment.create`, no
 * `enrolment.findUnique`) so a caller that already has the `Enrolment` row in
 * hand — plan 05-11's `cancelCohort` bulk path — can satisfy this with its
 * own transaction client shape without widening it to the single-enrolment
 * surface. The real `EnrolmentTxClient` used by `db.$transaction` above is a
 * superset and is passed here unchanged.
 */
export type EnrolmentExitTxClient = {
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
 * The shared WITHDRAWN/CANCELLED transition body (D-14), extracted so
 * `withdrawEnrolment`, `cancelEnrolment` and plan 05-11's `cancelCohort` bulk
 * path all apply the SAME state-machine check, seat release and event
 * emission rather than three copies that can drift. Takes an
 * ALREADY-FETCHED `enrolment` row and an ALREADY-OPEN `tx` — the caller owns
 * both the read and the transaction boundary; this function only validates
 * the transition and performs the write.
 *
 * Throws `IllegalTransitionError` (via `assertTransition`) for a source
 * status with no legal move to `toStatus` — including every terminal status,
 * which is exactly what stops `cancelCohort` from touching an
 * already-WITHDRAWN/CANCELLED/TRANSFERRED/COMPLETED row.
 */
export async function applyEnrolmentExit(
  tx: EnrolmentExitTxClient,
  args: {
    enrolment: EnrolmentRow;
    toStatus: "WITHDRAWN" | "CANCELLED";
    reason: string;
    actorId: string;
    now: Date;
  },
): Promise<{ id: string; before: EnrolmentStatusValue; toStatus: "WITHDRAWN" | "CANCELLED" }> {
  const { enrolment: e, toStatus, reason, actorId, now } = args;
  const before = e.status as EnrolmentStatusValue;
  assertTransition(before, toStatus, e.id);

  // `releaseSeat` is typed against `SeatTxClient`, which also declares
  // `enrolment.create` (needed by `takeSeat`, never by this path). The cast
  // is the same "structural, cast via unknown" idiom `cohort-service.ts`
  // uses for its own `$transaction` binding — `EnrolmentExitTxClient` stays
  // narrow so a caller with no create surface (the bulk cancel path) can
  // still satisfy it.
  await releaseSeat(tx as unknown as SeatTxClient, {
    cohortId: e.cohortId,
    enrolmentId: e.id,
    toStatus,
    reason,
    heldSeat: holdsSeat(e),
    ...(toStatus === "WITHDRAWN" ? { withdrawnAt: now } : {}),
  });

  const eventType = toStatus === "WITHDRAWN" ? "enrolment.withdrawn" : "enrolment.cancelled";
  await writeDomainEvent(tx, {
    type: eventType,
    payload: {
      enrolmentId: e.id,
      cohortId: e.cohortId,
      actorId,
      reason,
    },
  });

  return { id: e.id, before, toStatus };
}

export type EnrolmentServiceDeps = {
  db: {
    $transaction: <R>(fn: (tx: EnrolmentTxClient) => Promise<R>) => Promise<R>;
  };
  enrolment: {
    findUnique(args: { where: { id: string } }): Promise<EnrolmentRow | null>;
  };
  cohort: {
    findUnique(args: { where: { id: string } }): Promise<CohortOfferRow | null>;
  };
  /** Enrolment id -> scope. Resolves the OWNING cohort from the row (D-21). */
  enrolmentScope: (enrolmentId: string) => ResourceScope | Promise<ResourceScope>;
  /** Cohort id -> scope. Used by the cohort-keyed `addEnrolment`. */
  cohortScope: (cohortId: string) => ResourceScope | Promise<ResourceScope>;
  withPermission: WithPermission;
  audit: Audit;
  now?: () => Date;
};

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export function createEnrolmentService(deps: EnrolmentServiceDeps) {
  const { withPermission, db } = deps;
  const now = deps.now ?? (() => new Date());

  // -------------------------------------------------------------------------
  // addEnrolment (D-11) — comp / corporate / scholarship, orderId stays null
  // -------------------------------------------------------------------------

  const addEnrolment = withPermission<{
    cohortId: string;
    userId: string;
    target: "ACTIVE" | "PENDING_PAYMENT";
    reason: string;
    accessStartsAt?: Date;
    accessEndsAt?: Date;
  }>("enrolments.manage", (input) => deps.cohortScope(input.cohortId))(
    async (input, ctx) => {
      const reason = requireReason(input.reason);

      const cohort = await deps.cohort.findUnique({
        where: { id: input.cohortId },
      });
      if (!cohort) throw new CohortNotFoundError(input.cohortId);

      const holdExpiresAt =
        input.target === "PENDING_PAYMENT"
          ? holdExpiryFrom(cohort.holdMinutes, now())
          : null;

      // D-02: a PENDING_PAYMENT enrolment on a cohort with no hold
      // (holdMinutes null/0) does NOT take a seat — the seat is only counted
      // when it reaches ACTIVE.
      const takesSeat =
        input.target === "ACTIVE" ||
        (input.target === "PENDING_PAYMENT" && holdExpiresAt !== null);

      const data: Record<string, unknown> = {
        cohortId: input.cohortId,
        userId: input.userId,
        status: input.target,
        orderId: null,
        reason,
        ...(input.accessStartsAt
          ? { accessStartsAt: input.accessStartsAt }
          : {}),
        ...(input.accessEndsAt ? { accessEndsAt: input.accessEndsAt } : {}),
        ...(input.target === "ACTIVE" ? { activatedAt: now() } : {}),
        ...(holdExpiresAt ? { holdExpiresAt } : {}),
      };

      const created = await db.$transaction(async (tx) => {
        const row = takesSeat
          ? await takeSeat(tx, { cohortId: input.cohortId, enrolment: data })
          : await tx.enrolment.create({ data, select: { id: true } });
        await writeDomainEvent(tx, {
          type: "enrolment.created",
          payload: {
            enrolmentId: row.id,
            cohortId: input.cohortId,
            userId: input.userId,
            status: input.target,
            actorId: ctx.actor.userId,
          },
        });
        return row;
      });

      await deps.audit({
        action: "enrolment.created",
        targetType: "Enrolment",
        targetId: created.id,
        actorId: ctx.actor.userId,
        outcome: "SUCCESS",
        reason,
        before: null,
        after: {
          status: input.target,
          cohortId: input.cohortId,
          userId: input.userId,
          heldSeat: takesSeat,
        },
      });

      return { id: created.id, status: input.target, heldSeat: takesSeat };
    },
  );

  // -------------------------------------------------------------------------
  // approveEnrolment (D-12) — PENDING_PAYMENT -> ACTIVE, no payment record
  // -------------------------------------------------------------------------

  const approveEnrolment = withPermission<{
    enrolmentId: string;
    reason: string;
  }>("enrolments.manage", (input) => deps.enrolmentScope(input.enrolmentId))(
    async (input, ctx) => {
      const reason = requireReason(input.reason);

      const result = await db.$transaction(async (tx) => {
        const e = await tx.enrolment.findUnique({
          where: { id: input.enrolmentId },
        });
        if (!e) throw new EnrolmentNotFoundError(input.enrolmentId);
        const before = e.status;
        assertTransition(before as EnrolmentStatusValue, "ACTIVE", e.id);

        // RESEARCH Pitfall 3: consult the single seat-occupancy predicate.
        // A hold-holding enrolment already counts — claim a seat ONLY when
        // none is currently held, so approve never double-counts.
        const heldSeat = holdsSeat(e);
        if (!heldSeat) {
          await claimSeat(tx, { cohortId: e.cohortId });
        }

        await tx.enrolment.update({
          where: { id: e.id },
          data: {
            status: "ACTIVE",
            holdExpiresAt: null,
            activatedAt: now(),
            reason,
          },
        });

        await writeDomainEvent(tx, {
          type: "enrolment.approved",
          payload: {
            enrolmentId: e.id,
            cohortId: e.cohortId,
            claimedSeat: !heldSeat,
            actorId: ctx.actor.userId,
          },
        });

        return { id: e.id, before, claimedSeat: !heldSeat };
      });

      await deps.audit({
        action: "enrolment.approved",
        targetType: "Enrolment",
        targetId: result.id,
        actorId: ctx.actor.userId,
        outcome: "SUCCESS",
        reason,
        before: { status: result.before },
        after: { status: "ACTIVE" },
      });

      return { id: result.id, status: "ACTIVE" as const, claimedSeat: result.claimedSeat };
    },
  );

  // -------------------------------------------------------------------------
  // withdrawEnrolment / cancelEnrolment (D-14)
  //
  // WITHDRAWN is for an enrolment whose access has started; CANCELLED is for
  // before access or an administrative void. Both release the seat only when
  // one is actually held (`heldSeat`), so cancelling a hold-less
  // PENDING_PAYMENT enrolment does not wrongly decrement `seatsTaken`.
  //
  // The transition body is `applyEnrolmentExit` (module scope, below) — it is
  // exported and callable with an ALREADY-OPEN `tx` so plan 05-11's
  // `cancelCohort` bulk path can apply it to every affected enrolment inside
  // its own single `$transaction`, instead of re-implementing the state
  // machine a second time.
  // -------------------------------------------------------------------------

  function makeTerminalAction(
    toStatus: "WITHDRAWN" | "CANCELLED",
    eventType: "enrolment.withdrawn" | "enrolment.cancelled",
  ) {
    return withPermission<{ enrolmentId: string; reason: string }>(
      "enrolments.manage",
      (input) => deps.enrolmentScope(input.enrolmentId),
    )(async (input, ctx) => {
      const reason = requireReason(input.reason);

      const result = await db.$transaction(async (tx) => {
        const e = await tx.enrolment.findUnique({
          where: { id: input.enrolmentId },
        });
        if (!e) throw new EnrolmentNotFoundError(input.enrolmentId);

        return applyEnrolmentExit(tx, {
          enrolment: e,
          toStatus,
          reason,
          actorId: ctx.actor.userId,
          now: now(),
        });
      });

      await deps.audit({
        action: eventType,
        targetType: "Enrolment",
        targetId: result.id,
        actorId: ctx.actor.userId,
        outcome: "SUCCESS",
        reason,
        before: { status: result.before },
        after: { status: toStatus },
      });

      return { id: result.id, status: toStatus };
    });
  }

  const withdrawEnrolment = makeTerminalAction("WITHDRAWN", "enrolment.withdrawn");
  const cancelEnrolment = makeTerminalAction("CANCELLED", "enrolment.cancelled");

  // -------------------------------------------------------------------------
  // transferEnrolment (D-13) — same offer only
  //
  // Authorization is resolved on the SOURCE cohort (`enrolmentScope`). The
  // target is confined below to a sibling cohort of the SAME offer, which is
  // what stops a transfer from becoming a write into a cohort the caller's
  // grant does not cover (T-05-40). Cross-offer transfer is deferred — there
  // is no compatibility path. History (see the file header) is never copied;
  // the source row is retained as TRANSFERRED, linked from the new row's
  // `transferredFromId`.
  // -------------------------------------------------------------------------

  const transferEnrolment = withPermission<{
    enrolmentId: string;
    targetCohortId: string;
    reason: string;
  }>("enrolments.manage", (input) => deps.enrolmentScope(input.enrolmentId))(
    async (input, ctx) => {
      const reason = requireReason(input.reason);

      const source = await deps.enrolment.findUnique({
        where: { id: input.enrolmentId },
      });
      if (!source) throw new EnrolmentNotFoundError(input.enrolmentId);

      if (input.targetCohortId === source.cohortId) {
        throw new CrossOfferTransferError(
          source.cohortId,
          input.targetCohortId,
          "the target cohort is the same as the source cohort",
        );
      }

      const [sourceCohort, targetCohort] = await Promise.all([
        deps.cohort.findUnique({ where: { id: source.cohortId } }),
        deps.cohort.findUnique({ where: { id: input.targetCohortId } }),
      ]);
      if (!sourceCohort) throw new CohortNotFoundError(source.cohortId);
      if (!targetCohort) throw new CohortNotFoundError(input.targetCohortId);

      const sameOffer =
        (sourceCohort.courseId !== null &&
          sourceCohort.courseId === targetCohort.courseId) ||
        (sourceCohort.programmeId !== null &&
          sourceCohort.programmeId === targetCohort.programmeId);
      if (!sameOffer) {
        throw new CrossOfferTransferError(
          source.cohortId,
          input.targetCohortId,
          "the target cohort belongs to a different course or programme",
        );
      }

      const result = await db.$transaction(async (tx) => {
        const e = await tx.enrolment.findUnique({
          where: { id: input.enrolmentId },
        });
        if (!e) throw new EnrolmentNotFoundError(input.enrolmentId);
        const before = e.status;
        assertTransition(before as EnrolmentStatusValue, "TRANSFERRED", e.id);

        await releaseSeat(tx, {
          cohortId: e.cohortId,
          enrolmentId: e.id,
          toStatus: "TRANSFERRED",
          reason,
          heldSeat: holdsSeat(e),
        });

        // takeSeat enforces the TARGET cohort's capacity with the same row
        // lock as any other seat take. A full target throws here and the
        // whole transfer rolls back — the source stays as it was (T-05-46).
        const created = await takeSeat(tx, {
          cohortId: input.targetCohortId,
          enrolment: {
            userId: e.userId,
            cohortId: input.targetCohortId,
            status: "ACTIVE",
            activatedAt: now(),
            reason,
            transferredFromId: e.id,
            orderId: null,
          },
        });

        await writeDomainEvent(tx, {
          type: "enrolment.transferred",
          payload: {
            sourceEnrolmentId: e.id,
            targetEnrolmentId: created.id,
            sourceCohortId: e.cohortId,
            targetCohortId: input.targetCohortId,
            actorId: ctx.actor.userId,
          },
        });

        return { sourceId: e.id, targetId: created.id, before };
      });

      await deps.audit({
        action: "enrolment.transferred",
        targetType: "Enrolment",
        targetId: result.sourceId,
        actorId: ctx.actor.userId,
        outcome: "SUCCESS",
        reason,
        before: { status: result.before },
        after: {
          status: "TRANSFERRED",
          transferredToId: result.targetId,
          targetCohortId: input.targetCohortId,
        },
      });
      await deps.audit({
        action: "enrolment.transferred",
        targetType: "Enrolment",
        targetId: result.targetId,
        actorId: ctx.actor.userId,
        outcome: "SUCCESS",
        reason,
        before: null,
        after: {
          status: "ACTIVE",
          transferredFromId: result.sourceId,
          cohortId: input.targetCohortId,
        },
      });

      return {
        sourceEnrolmentId: result.sourceId,
        targetEnrolmentId: result.targetId,
      };
    },
  );

  return {
    addEnrolment,
    approveEnrolment,
    transferEnrolment,
    withdrawEnrolment,
    cancelEnrolment,
  };
}

// ---------------------------------------------------------------------------
// Prisma-backed binding
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any;

const ENROLMENT_SELECT = {
  id: true,
  userId: true,
  cohortId: true,
  status: true,
  holdExpiresAt: true,
  activatedAt: true,
  withdrawnAt: true,
  reason: true,
  orderId: true,
  transferredFromId: true,
} as const;

const liveAudit: Audit = (entry) =>
  recordAudit({
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    before: entry.before,
    after: entry.after,
    reason: entry.reason,
    outcome: entry.outcome,
  });

/**
 * Builds the enrolment service against a given Prisma client and
 * `withPermission`. Production passes the singleton and the live authorizer;
 * `tests/enrolment-service.integration.test.ts` passes a testcontainer client
 * and a GLOBAL-grant harness so the integration test exercises the real
 * transaction and the real seat-accounting primitives.
 */
export function createPrismaBackedEnrolmentService(
  client: AnyPrisma,
  withPermission: WithPermission,
  audit: Audit = liveAudit,
) {
  return createEnrolmentService({
    db: {
      $transaction: (fn) =>
        client.$transaction((tx: unknown) => fn(tx as EnrolmentTxClient)),
    },
    enrolment: {
      findUnique: (args) =>
        client.enrolment.findUnique({
          where: args.where,
          select: ENROLMENT_SELECT,
        }),
    },
    cohort: {
      findUnique: (args) =>
        client.cohort.findUnique({
          where: args.where,
          select: {
            id: true,
            holdMinutes: true,
            courseId: true,
            programmeId: true,
          },
        }),
    },
    enrolmentScope: enrolmentCohortScope,
    cohortScope: cohortResourceScope,
    withPermission,
    audit,
  });
}

const built = createPrismaBackedEnrolmentService(prisma, liveWithPermission);

export const addEnrolment = built.addEnrolment;
export const approveEnrolment = built.approveEnrolment;
export const transferEnrolment = built.transferEnrolment;
export const withdrawEnrolment = built.withdrawEnrolment;
export const cancelEnrolment = built.cancelEnrolment;
