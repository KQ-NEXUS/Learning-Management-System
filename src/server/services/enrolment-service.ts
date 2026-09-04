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

  return {
    addEnrolment,
    approveEnrolment,
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
