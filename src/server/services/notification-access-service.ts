/**
 * Per-target access resolvers for opening a notification (COM-03, D-19, D-21).
 *
 * `resolveOpen` re-runs the destination's own authorization rule on the
 * server before ever handing back a link. Every failure path — the
 * notification id does not exist, belongs to someone else, its target was
 * deleted, or the caller is not allowed to see the target — returns the
 * identical `{ status: "unavailable" }` outcome and mutates nothing except
 * the notification's own read state (T-13-01, T-13-02): the lookup itself
 * filters by `recipientId` equal to the caller, so a foreign or missing id
 * can never be distinguished from a denied one. On success the row is
 * marked read and a fresh, validated href is rebuilt through
 * `notificationHref` from the stored type/target id/params — never from a
 * stored URL (T-13-10).
 *
 * Each per-target resolver is injected so unit tests can supply fakes and
 * the integration test can bind a real, throwaway database; the live
 * singleton at the bottom wires them to the real Prisma client. This
 * service is request-scoped (it may use the permission layer and reads an
 * already-resolved `Actor`) and is imported only by the notification
 * server action — never by a scheduled task (13-CONTEXT.md Assumptions).
 */

import { prisma } from "@/server/db";
import type { Actor } from "@/server/permissions/with-permission";
import { can as liveCan } from "@/server/permissions";
import type { Permission } from "@/server/permissions/catalogue";
import type { ResourceScope } from "@/server/permissions/scope";
import { notificationService as liveNotificationService } from "@/server/services/notification-service";
import { getOwnOrderByReference } from "@/server/services/checkout-service";
import { loadLearnerPath } from "@/server/services/learner-access";
import { getStaffTicketWorkspace } from "@/server/services/ticket-staff-queue-service";
import { getPaymentDetailForStaff } from "@/server/services/payment-read-service";
import { getGradingDetail } from "@/server/services/grading-service";
import { notificationHref } from "@/server/communications/links";
import type { NotificationTargetType } from "@/server/communications/contracts";

export type AccessOutcome = { status: "ok"; href: string } | { status: "unavailable" };

/** The narrow row shape `resolveOpen` needs from the `Notification` table. */
export type NotificationAccessRow = {
  id: string;
  targetType: string;
  targetId: string;
  params: unknown;
};

/**
 * Decides whether `actor` may open the target described by
 * `(targetId, params)`. Never throws by contract — but `resolveOpen` treats
 * a thrown error the same as `false` anyway, so a resolver reusing a
 * destination-page call that itself throws on denial needs no extra
 * try/catch of its own.
 */
export type NotificationAccessResolver = (
  actor: Actor,
  targetId: string,
  params: Record<string, unknown>,
) => Promise<boolean>;

export type NotificationAccessStore = {
  notification: {
    findFirst(args: {
      where: Record<string, unknown>;
    }): Promise<NotificationAccessRow | null>;
  };
};

export type NotificationAccessDeps = {
  db: NotificationAccessStore;
  notificationService: Pick<typeof liveNotificationService, "markRead">;
  /** One resolver per target type; a target with no registered resolver always denies. */
  resolvers: Partial<Record<NotificationTargetType, NotificationAccessResolver>>;
};

function toParams(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function createNotificationAccessService(deps: NotificationAccessDeps) {
  async function resolveOpen(actor: Actor, notificationId: string): Promise<AccessOutcome> {
    // T-13-01: the lookup itself is the ownership check. A foreign or
    // nonexistent id both resolve to `null` here, before anything is
    // mutated (D-19's "without changing anything" for the missing case).
    const row = await deps.db.notification.findFirst({
      where: { id: notificationId, recipientId: actor.userId, archivedAt: null },
    });
    if (!row) {
      return { status: "unavailable" };
    }

    const targetType = row.targetType as NotificationTargetType;
    const params = toParams(row.params);
    const resolver = deps.resolvers[targetType];

    let allowed: boolean;
    try {
      allowed = resolver ? await resolver(actor, row.targetId, params) : false;
    } catch {
      // Any resolver failure — a lookup throwing NotFound, a permission
      // check throwing, anything — denies exactly like an explicit `false`
      // (T-13-02: no different shape for "errored" versus "denied").
      allowed = false;
    }

    // Marked read regardless of outcome once the row is confirmed the
    // caller's own (D-19): opening a link the caller cannot use is still an
    // acknowledged notification, not a retryable one.
    await deps.notificationService.markRead(actor, row.id);

    if (!allowed) {
      return { status: "unavailable" };
    }

    try {
      return { status: "ok", href: notificationHref(targetType, row.targetId, params) };
    } catch {
      // A validated href could not be built (a corrupt targetId/params) —
      // identical denial, never a 500 or a different shape.
      return { status: "unavailable" };
    }
  }

  return { resolveOpen };
}

// ---------------------------------------------------------------------------
// Live resolvers
// ---------------------------------------------------------------------------

/** The narrow slice of the Prisma client `createLearnerTicketResolver` needs. */
export type TicketOwnershipStore = {
  ticket: {
    findFirst(args: {
      where: { userId: string; reference: string };
      select?: { id: true };
    }): Promise<{ id: string } | null>;
  };
};

/**
 * Mirrors `ticket-service.ts`'s `findOwnByReference` ownership rule exactly
 * (`userId` equals the caller, reference matches) — the same predicate the
 * learner ticket page (`getOwnTicketByReference`) applies before rendering.
 * Queried directly rather than through the live `getOwnTicketByReference`
 * export because that export resolves its own actor from the request
 * session; this resolver is handed an already-resolved `Actor` instead.
 */
export function createLearnerTicketResolver(db: TicketOwnershipStore): NotificationAccessResolver {
  return async (actor, targetId) => {
    const ticket = await db.ticket.findFirst({
      where: { userId: actor.userId, reference: targetId },
      select: { id: true },
    });
    return ticket !== null;
  };
}

/** Any authenticated actor may open the dashboard — `resolveOpen` already
 * proved ownership of the notification row before a resolver ever runs. */
export function createAlwaysAllowedResolver(): NotificationAccessResolver {
  return async () => true;
}

/** A lookup that returns the owned record, or `null` when it does not
 * belong to (or does not exist for) the caller — `getOwnOrderByReference`'s
 * exact shape. */
export type OwnRecordLookup = (actor: Actor, targetId: string) => Promise<unknown | null>;

/**
 * Wraps an ownership lookup that takes the already-resolved `Actor`
 * directly (unlike the ticket service, `getOwnOrderByReference` and
 * `loadLearnerPath` both accept `actor` as a parameter rather than
 * re-resolving it from the request), so the destination's own call is
 * reused verbatim (D-21) — LEARNER_ORDER via `getOwnOrderByReference`;
 * LEARNER_ENROLMENT, LEARNER_RESULTS and LEARNER_SESSIONS all via
 * `loadLearnerPath` (a withdrawn, cancelled or foreign enrolment returns
 * `null`, exactly like the lesson-list page's own denial branch).
 */
export function createOwnRecordResolver(lookup: OwnRecordLookup): NotificationAccessResolver {
  return async (actor, targetId) => (await lookup(actor, targetId)) !== null;
}

/** The narrow slice of the permission layer a staff resolver needs. */
export type PermissionCheck = (permission: Permission, scope: ResourceScope) => Promise<boolean>;

/**
 * STAFF_TICKET: `can("tickets.view", {})` is a rendering courtesy only in
 * the real staff ticket page — the actual gate is `getStaffTicketWorkspace`
 * itself (`tickets.view` over an empty scope, throwing `AuthorizationError`/
 * `AuthenticationError`/`TicketNotFoundError`). Reusing that call directly
 * means a denial and a missing reference both simply reject, and
 * `resolveOpen`'s own catch turns either into the identical outcome.
 */
export type StaffTicketLookup = (reference: string) => Promise<unknown>;

export function createStaffTicketResolver(lookup: StaffTicketLookup): NotificationAccessResolver {
  return async (_actor, targetId) => {
    await lookup(targetId);
    return true;
  };
}

/**
 * STAFF_PAYMENT: `getPaymentDetailForStaff` is `payments.view`-wrapped over
 * `orderCohortScope` exactly as the payment detail page requires; it throws
 * on denial and returns `null` for a deleted order, so both collapse to the
 * same `false` here.
 */
export type StaffPaymentLookup = (orderId: string) => Promise<unknown | null>;

export function createStaffPaymentResolver(lookup: StaffPaymentLookup): NotificationAccessResolver {
  return async (_actor, targetId) => (await lookup(targetId)) !== null;
}

/**
 * STAFF_SUBMISSION: `getGradingDetail` is `submissions.view`-wrapped over
 * the submission's own enrolment-derived cohort scope, mirroring the
 * grade-entry page exactly — including that page's own T-09-44-style
 * membership check, which this resolver repeats against the notification's
 * stored `params.cohortId`/`params.assessmentId` so a submission resolved
 * under a broader grant can never be linked as if it belonged to the wrong
 * cohort or assessment.
 */
export type GradingDetailLookup = (input: {
  submissionId: string;
}) => Promise<{ cohortId: string; assessment: { id: string } }>;

export function createStaffSubmissionResolver(lookup: GradingDetailLookup): NotificationAccessResolver {
  return async (_actor, targetId, params) => {
    const detail = await lookup({ submissionId: targetId });
    const cohortId = typeof params.cohortId === "string" ? params.cohortId : "";
    const assessmentId = typeof params.assessmentId === "string" ? params.assessmentId : "";
    return detail.cohortId === cohortId && detail.assessment.id === assessmentId;
  };
}

/** STAFF_EMAIL_LOG: `can("audit.view", {})`, the same global-scope check the
 * staff audit page performs (no per-record existence check — the target is
 * the whole log). */
export function createStaffEmailLogResolver(can: PermissionCheck): NotificationAccessResolver {
  return async () => can("audit.view", {});
}

/** STAFF_LICENCE: `can("licence.view", {})`, the Global-scope check the licence
 * screen itself performs (D-15, T-14-08-03). A denial is the same unavailable
 * outcome as a missing or foreign notification. */
export function createStaffLicenceResolver(can: PermissionCheck): NotificationAccessResolver {
  return async () => can("licence.view", {});
}

export const notificationAccessService = createNotificationAccessService({
  db: prisma as unknown as NotificationAccessStore,
  notificationService: liveNotificationService,
  resolvers: {
    LEARNER_DASHBOARD: createAlwaysAllowedResolver(),
    LEARNER_ORDER: createOwnRecordResolver(getOwnOrderByReference),
    LEARNER_ENROLMENT: createOwnRecordResolver(loadLearnerPath),
    LEARNER_RESULTS: createOwnRecordResolver(loadLearnerPath),
    LEARNER_SESSIONS: createOwnRecordResolver(loadLearnerPath),
    LEARNER_TICKET: createLearnerTicketResolver(prisma as unknown as TicketOwnershipStore),
    STAFF_TICKET: createStaffTicketResolver(getStaffTicketWorkspace),
    STAFF_PAYMENT: createStaffPaymentResolver(getPaymentDetailForStaff),
    STAFF_SUBMISSION: createStaffSubmissionResolver(getGradingDetail),
    STAFF_EMAIL_LOG: createStaffEmailLogResolver(liveCan),
    STAFF_LICENCE: createStaffLicenceResolver(liveCan),
  },
});
