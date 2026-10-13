/**
 * The enrolment-status, session-change and cohort-cancellation mapper group
 * (D-07, D-11, D-12, D-16, Pitfall 4/5).
 *
 * Six `DomainEventType`s share this file because they all resolve the same
 * question — "who does this enrolment/session/cohort change affect, and what
 * do they see?" — and two of them (cohort cancellation vs. its own
 * per-enrolment fan-out) must coordinate to avoid double-mailing the same
 * learner (T-13-39):
 *
 *  - `enrolment.withdrawn` / `enrolment.cancelled` share one mapper (D-07):
 *    both mean "this enrolment's access has ended". A staff withdrawal or
 *    cancellation mails the learner once — UNLESS a `cohort.cancelled` event
 *    with the same cohortId/actorId/reason exists within a 60-second window
 *    (Task 3, Pitfall 4), in which case the per-enrolment mail is
 *    `superseded_by_cohort_cancellation` and the cohort-level mail below
 *    covers it instead.
 *  - `enrolment.transferred` mails the SOURCE enrolment's learner once,
 *    naming both cohort titles and linking to the NEW (target) enrolment.
 *  - `session.cancelled` fans out to every learner with an ACTIVE enrolment
 *    in the session's cohort AT DRAIN TIME (D-11) — never the payload's own
 *    idea of who was enrolled when the event was written.
 *  - `session.updated` (A-01 — no producer exists yet; proven only with
 *    synthetic outbox events) also fans out to every ACTIVE learner, but
 *    coalesces: a newer, still-unprocessed `session.updated` for the same
 *    session supersedes an older one (D-12, "one drain run" semantics — the
 *    claim-order-ASC drain naturally processes oldest-first, so this is a
 *    "is there anything newer still waiting" check), and ANY
 *    `session.cancelled` for the session always wins over a pending update.
 *  - `cohort.cancelled` mails every DISTINCT user behind the per-enrolment
 *    events it superseded, exactly once each, with `cohort-cancelled`.
 *
 * The staff/system `reason` on every one of these payloads is staff-internal
 * (T-13-03): it is read ONLY as a query parameter for the supersession
 * lookups below (bound as a parameter, never concatenated — T-13-40) and is
 * never copied into an email param, a notification param, or any other
 * persisted field.
 */

import { Prisma } from "@prisma/client";
import {
  requireString,
  type DrainEvent,
  type EventIntent,
  type EventMapper,
  type MapperGroup,
} from "@/server/services/event-intent-mappers";
import type { SkipReason } from "@/server/communications/contracts";
import { buildCorrelationId } from "@/server/communications/contracts";
import { enrolmentPath, sessionsPath } from "@/server/communications/links";

/** Same-cohortId/actorId/reason window either side of a `cohort.cancelled`
 * event that identifies its per-enrolment siblings (Pitfall 4, D-07). */
const CANCELLATION_WINDOW_MS = 60_000;

// ---------------------------------------------------------------------------
// Cohort-cancellation precedence (shared by the withdrawn/cancelled mapper
// AND the cohort.cancelled mapper below — Task 3)
// ---------------------------------------------------------------------------

/**
 * True when a `cohort.cancelled` event with the same cohortId/actorId/reason
 * exists within `CANCELLATION_WINDOW_MS` AFTER this enrolment event —
 * regardless of which of the two the drain happens to process first, since
 * both rows already exist (written in the same `cancelCohort` transaction)
 * by the time either is claimed. Every value is bound as a query parameter
 * (T-13-40) — the reason string is compared inside SQL, never returned.
 */
async function hasCohortCancellationPeer(
  tx: Prisma.TransactionClient,
  args: { cohortId: string; actorId: string; reason: string; eventOccurredAt: Date },
): Promise<boolean> {
  const windowEnd = new Date(args.eventOccurredAt.getTime() + CANCELLATION_WINDOW_MS);
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "DomainEvent"
    WHERE "type" = 'cohort.cancelled'
      AND "payload"->>'cohortId' = ${args.cohortId}
      AND "payload"->>'actorId' = ${args.actorId}
      AND "payload"->>'reason' = ${args.reason}
      AND "occurredAt" >= ${args.eventOccurredAt}
      AND "occurredAt" <= ${windowEnd}
    LIMIT 1
  `);
  return rows.length > 0;
}

/**
 * The enrolment ids of the `enrolment.withdrawn`/`enrolment.cancelled` events
 * a `cohort.cancelled` event supersedes: same cohortId/actorId/reason,
 * recorded within `CANCELLATION_WINDOW_MS` up to (and including) the cohort
 * event's own `occurredAt`. Bound as query parameters throughout (T-13-40).
 */
async function findSupersededEnrolmentIds(
  tx: Prisma.TransactionClient,
  args: { cohortId: string; actorId: string; reason: string; cohortEventOccurredAt: Date },
): Promise<string[]> {
  const windowStart = new Date(args.cohortEventOccurredAt.getTime() - CANCELLATION_WINDOW_MS);
  const rows = await tx.$queryRaw<Array<{ enrolmentId: string | null }>>(Prisma.sql`
    SELECT "payload"->>'enrolmentId' AS "enrolmentId"
    FROM "DomainEvent"
    WHERE "type" IN ('enrolment.withdrawn', 'enrolment.cancelled')
      AND "payload"->>'cohortId' = ${args.cohortId}
      AND "payload"->>'actorId' = ${args.actorId}
      AND "payload"->>'reason' = ${args.reason}
      AND "occurredAt" >= ${windowStart}
      AND "occurredAt" <= ${args.cohortEventOccurredAt}
  `);
  return rows
    .map((row) => row.enrolmentId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

// ---------------------------------------------------------------------------
// enrolment.withdrawn / enrolment.cancelled (D-07)
// ---------------------------------------------------------------------------

/**
 * `enrolment.withdrawn` and `enrolment.cancelled` share this mapper: both
 * mean "this enrolment's access has ended", differing only in which template
 * and notification type applies. Returns no intents when the enrolment no
 * longer exists. When a `cohort.cancelled` peer exists for the same
 * cohortId/actorId/reason (Task 3), the mail is superseded — the cohort-level
 * mail covers the learner instead, and no notification is produced here.
 */
const enrolmentStatusChangeMail: EventMapper = async (event, ctx) => {
  const enrolmentId = requireString(event.payload, "enrolmentId");
  const cohortId = requireString(event.payload, "cohortId");
  const actorId = requireString(event.payload, "actorId");
  // Read only to compare inside the supersession lookup below — never copied
  // into any persisted field (T-13-03).
  const reason = requireString(event.payload, "reason");

  const enrolment = await ctx.tx.enrolment.findUnique({
    where: { id: enrolmentId },
    select: { id: true, userId: true, cohort: { select: { title: true } } },
  });
  if (!enrolment) return [];

  const isWithdrawn = event.type === "enrolment.withdrawn";
  const template = isWithdrawn ? "enrolment-withdrawn" : "enrolment-cancelled";
  const notificationType = isWithdrawn ? "enrolment.withdrawn" : "enrolment.cancelled";

  const email = {
    template,
    params: { cohortTitle: enrolment.cohort.title },
    correlationId: buildCorrelationId(event.id),
  } as const;

  const superseded = await hasCohortCancellationPeer(ctx.tx, {
    cohortId,
    actorId,
    reason,
    eventOccurredAt: event.occurredAt,
  });
  if (superseded) {
    return [
      {
        recipientUserId: enrolment.userId,
        email,
        skipReason: "superseded_by_cohort_cancellation" as SkipReason,
      },
    ];
  }

  return [
    {
      recipientUserId: enrolment.userId,
      email,
      notification: {
        type: notificationType,
        targetType: "LEARNER_DASHBOARD",
        targetId: enrolment.id,
        params: { cohortTitle: enrolment.cohort.title },
      },
    },
  ];
};

// ---------------------------------------------------------------------------
// enrolment.transferred (D-07)
// ---------------------------------------------------------------------------

/**
 * Mails the SOURCE enrolment's learner once, naming both cohort titles and
 * linking to the NEW (target) enrolment — the learner's access now lives
 * there, not at the source enrolment (which is retained as TRANSFERRED
 * history, never deleted).
 */
const enrolmentTransferredMail: EventMapper = async (event, ctx) => {
  const sourceEnrolmentId = requireString(event.payload, "sourceEnrolmentId");
  const targetEnrolmentId = requireString(event.payload, "targetEnrolmentId");
  const targetCohortId = requireString(event.payload, "targetCohortId");

  const sourceEnrolment = await ctx.tx.enrolment.findUnique({
    where: { id: sourceEnrolmentId },
    select: { userId: true, cohort: { select: { title: true } } },
  });
  if (!sourceEnrolment) return [];

  const targetCohort = await ctx.tx.cohort.findUnique({
    where: { id: targetCohortId },
    select: { title: true },
  });
  if (!targetCohort) return [];

  return [
    {
      recipientUserId: sourceEnrolment.userId,
      email: {
        template: "enrolment-transferred",
        params: {
          fromCohortTitle: sourceEnrolment.cohort.title,
          toCohortTitle: targetCohort.title,
          enrolmentPath: enrolmentPath(targetEnrolmentId),
        },
        correlationId: buildCorrelationId(event.id),
      },
      notification: {
        type: "enrolment.transferred",
        targetType: "LEARNER_ENROLMENT",
        targetId: targetEnrolmentId,
        params: {
          fromCohortTitle: sourceEnrolment.cohort.title,
          toCohortTitle: targetCohort.title,
        },
      },
    },
  ];
};

// ---------------------------------------------------------------------------
// session.cancelled (D-11)
// ---------------------------------------------------------------------------

/**
 * Fans out to every learner with an ACTIVE enrolment in the session's cohort
 * AT DRAIN TIME (D-11) — a learner whose enrolment has since become
 * WITHDRAWN/CANCELLED/TRANSFERRED/PENDING_PAYMENT gets nothing. Always sends
 * (A-10) — no delay, no coalescing, no supersession check of its own (it IS
 * the thing `session.updated` below defers to).
 */
const sessionCancelledMail: EventMapper = async (event, ctx) => {
  const sessionId = requireString(event.payload, "sessionId");
  const cohortId = requireString(event.payload, "cohortId");

  const session = await ctx.tx.scheduledSession.findUnique({
    where: { id: sessionId },
    select: { title: true, startsAt: true, cohort: { select: { title: true } } },
  });
  if (!session) return [];

  const activeEnrolments = await ctx.tx.enrolment.findMany({
    where: { cohortId, status: "ACTIVE" },
    select: { id: true, userId: true },
  });

  return activeEnrolments.map((enrolment) => ({
    recipientUserId: enrolment.userId,
    email: {
      template: "session-cancelled",
      params: {
        sessionTitle: session.title,
        cohortTitle: session.cohort.title,
        startsAtIso: session.startsAt.toISOString(),
        sessionsPath: sessionsPath(enrolment.id),
      },
      correlationId: buildCorrelationId(event.id, enrolment.userId),
    },
    notification: {
      type: "session.cancelled",
      targetType: "LEARNER_SESSIONS",
      targetId: enrolment.id,
      params: { sessionTitle: session.title },
    },
  }));
};

// ---------------------------------------------------------------------------
// session.updated (A-01 — synthetic events only, D-12 coalescing)
// ---------------------------------------------------------------------------

/** True when the session has been cancelled — either the session row's own
 * `cancelledAt`, or (belt-and-braces, T-13-41) a `session.cancelled`
 * `DomainEvent` for the same sessionId exists at all. Cancellation always
 * wins over a pending update (D-12), regardless of timing. */
async function isSessionCancelled(
  tx: Prisma.TransactionClient,
  args: { sessionId: string; cancelledAt: Date | null },
): Promise<boolean> {
  if (args.cancelledAt !== null) return true;
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "DomainEvent"
    WHERE "type" = 'session.cancelled'
      AND "payload"->>'sessionId' = ${args.sessionId}
    LIMIT 1
  `);
  return rows.length > 0;
}

/** True when a newer, still-unprocessed `session.updated` event exists for
 * the same session — "newer" means a later `occurredAt`, or the same
 * `occurredAt` with a greater `id` (a deterministic tie-break). The
 * claim-order-ASC drain processes the oldest first, so this check alone is
 * what makes "several pending updates collapse to the latest" work without
 * any special-casing of run boundaries (D-12's "within one drain run"). */
async function hasNewerUnprocessedSessionUpdate(
  tx: Prisma.TransactionClient,
  args: { sessionId: string; occurredAt: Date; id: string },
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "DomainEvent"
    WHERE "type" = 'session.updated'
      AND "payload"->>'sessionId' = ${args.sessionId}
      AND "processedAt" IS NULL
      AND (
        "occurredAt" > ${args.occurredAt}
        OR ("occurredAt" = ${args.occurredAt} AND "id" > ${args.id})
      )
    LIMIT 1
  `);
  return rows.length > 0;
}

function skippedSessionUpdateIntent(
  event: DrainEvent,
  enrolment: { id: string; userId: string },
  skipReason: SkipReason,
): EventIntent {
  return {
    recipientUserId: enrolment.userId,
    email: {
      template: "session-updated",
      // Never persisted — a SKIPPED dispatch always stores JsonNull
      // (domain-event-drain-service.ts) — kept empty so nothing here could
      // leak even if that ever changed.
      params: {},
      correlationId: buildCorrelationId(event.id, enrolment.userId),
    },
    skipReason,
  };
}

/**
 * Reads the session's LATEST title/start/end/location from the database at
 * drain time — never from the payload, which may describe a stale version of
 * the session by the time this event is actually processed (Pitfall 5). No
 * producer writes this event today (A-01); it is proven with synthetic
 * outbox events written directly by the integration test.
 */
const sessionUpdatedMail: EventMapper = async (event, ctx) => {
  const sessionId = requireString(event.payload, "sessionId");

  const session = await ctx.tx.scheduledSession.findUnique({
    where: { id: sessionId },
    select: {
      title: true,
      startsAt: true,
      endsAt: true,
      location: true,
      cancelledAt: true,
      cohortId: true,
      cohort: { select: { title: true } },
    },
  });
  if (!session) return [];

  const activeEnrolments = await ctx.tx.enrolment.findMany({
    where: { cohortId: session.cohortId, status: "ACTIVE" },
    select: { id: true, userId: true },
  });
  if (activeEnrolments.length === 0) return [];

  if (await isSessionCancelled(ctx.tx, { sessionId, cancelledAt: session.cancelledAt })) {
    return activeEnrolments.map((enrolment) =>
      skippedSessionUpdateIntent(event, enrolment, "superseded_by_session_cancellation"),
    );
  }

  if (
    await hasNewerUnprocessedSessionUpdate(ctx.tx, {
      sessionId,
      occurredAt: event.occurredAt,
      id: event.id,
    })
  ) {
    return activeEnrolments.map((enrolment) =>
      skippedSessionUpdateIntent(event, enrolment, "coalesced_into_later_update"),
    );
  }

  return activeEnrolments.map((enrolment) => ({
    recipientUserId: enrolment.userId,
    email: {
      template: "session-updated",
      params: {
        sessionTitle: session.title,
        cohortTitle: session.cohort.title,
        startsAtIso: session.startsAt.toISOString(),
        endsAtIso: session.endsAt.toISOString(),
        ...(session.location ? { location: session.location } : {}),
        sessionsPath: sessionsPath(enrolment.id),
      },
      correlationId: buildCorrelationId(event.id, enrolment.userId),
    },
    notification: {
      type: "session.updated",
      targetType: "LEARNER_SESSIONS",
      targetId: enrolment.id,
      params: { sessionTitle: session.title },
    },
  }));
};

// ---------------------------------------------------------------------------
// cohort.cancelled (D-07, Pitfall 4)
// ---------------------------------------------------------------------------

/**
 * Mails every DISTINCT user behind the per-enrolment `enrolment.withdrawn`/
 * `enrolment.cancelled` events this cohort cancellation superseded, exactly
 * once each (T-13-39) — never the whole cohort roster, and never a learner
 * who withdrew earlier by a different actor/reason or outside the window.
 * Always sends (A-10).
 */
const cohortCancelledMail: EventMapper = async (event, ctx) => {
  const cohortId = requireString(event.payload, "cohortId");
  const actorId = requireString(event.payload, "actorId");
  // Read only to find this cancellation's own per-enrolment siblings — never
  // copied into any persisted field (T-13-03).
  const reason = requireString(event.payload, "reason");

  const enrolmentIds = await findSupersededEnrolmentIds(ctx.tx, {
    cohortId,
    actorId,
    reason,
    cohortEventOccurredAt: event.occurredAt,
  });
  if (enrolmentIds.length === 0) return [];

  const enrolments = await ctx.tx.enrolment.findMany({
    where: { id: { in: enrolmentIds } },
    select: { id: true, userId: true },
  });
  if (enrolments.length === 0) return [];

  const cohort = await ctx.tx.cohort.findUnique({ where: { id: cohortId }, select: { title: true } });
  if (!cohort) return [];

  // One row per DISTINCT user — a user could in principle appear more than
  // once in the superseded set only if they held two affected enrolments in
  // the same cohort, which the platform does not allow; de-duplicating here
  // is the structural guarantee against ever double-mailing regardless.
  const enrolmentIdByUserId = new Map<string, string>();
  for (const enrolment of enrolments) {
    if (!enrolmentIdByUserId.has(enrolment.userId)) {
      enrolmentIdByUserId.set(enrolment.userId, enrolment.id);
    }
  }

  return [...enrolmentIdByUserId.entries()].map(([userId, enrolmentId]) => ({
    recipientUserId: userId,
    email: {
      template: "cohort-cancelled",
      params: { cohortTitle: cohort.title },
      correlationId: buildCorrelationId(event.id, userId),
    },
    notification: {
      type: "cohort.cancelled",
      targetType: "LEARNER_DASHBOARD",
      targetId: enrolmentId,
      params: { cohortTitle: cohort.title },
    },
  }));
};

export function createEnrolmentSessionMappers(): MapperGroup {
  return {
    "enrolment.withdrawn": enrolmentStatusChangeMail,
    "enrolment.cancelled": enrolmentStatusChangeMail,
    "enrolment.transferred": enrolmentTransferredMail,
    "session.cancelled": sessionCancelledMail,
    "session.updated": sessionUpdatedMail,
    "cohort.cancelled": cohortCancelledMail,
  };
}
