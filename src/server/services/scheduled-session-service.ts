/**
 * Scheduled-session operations (COH-03) — the delivery calendar.
 *
 * NOT to be confused with `session-service.ts`, which is the AUTH session
 * resolver (token -> actor). This module is about `ScheduledSession` rows: a
 * cohort's classes, their times, locations, meeting links and facilitators.
 *
 * Two things here are easy to get wrong and expensive later:
 *
 *   1. Storage of the instant (D-23). Staff enter a date and time in the
 *      cohort's IANA `timezone`; the value is stored UTC on `startsAt` /
 *      `endsAt` via validated wall-time conversion. Never a hard-coded one-hour offset, never
 *      the host's local time — `Africa/Lagos` observes no DST so a naive fixed
 *      offset passes today's tests and silently drifts for any other zone.
 *
 *   2. Disclosure of `meetingUrl` (D-25). The link is a capability: anyone
 *      holding it can join. `listSessionsForCohort` never selects it.
 *      `readSessionForViewer` returns it only when `isMeetingLinkVisible` is
 *      true for the caller — enrolled AND inside the visibility window AND the
 *      session not cancelled. The gate is server-side; hiding the value in a
 *      component while sending it in the payload is not a gate.
 *
 * Authorization, scoping and audit for the plain CRUD come from
 * `createResourceService`. The reason-bearing paths the factory has no concept
 * of — `createSessionFromWallTime`, `repeatWeeklySessions`, `cancelSession`,
 * the gated `readSessionForViewer` — are hand-wired `withPermission` actions.
 *
 * There is no repeat-rule entity (D-22): "repeat weekly ×N" inserts N
 * independent rows in one transaction. Each can be edited or cancelled alone.
 */

import { prisma } from "@/server/db";
import { withPermission as liveWithPermission } from "@/server/permissions";
import type { ResourceScope } from "@/server/permissions/scope";
import type { createWithPermission } from "@/server/permissions/with-permission";
import { recordAudit } from "@/server/services/audit-service";
import {
  isValidTimeZone,
  utcToWallParts,
} from "@/lib/timezone";
import { parseCohortDateTime } from "@/lib/cohort-datetime";
import {
  createResourceService,
  type Delegate,
  type ResourceAuditEntry,
} from "./resource-service";
import { cohortResourceScope, sessionCohortScope } from "./cohort-scope";
import { writeDomainEvent, type DomainEventTxClient } from "./domain-event-service";

type WithPermission = ReturnType<typeof createWithPermission>;

/** The `EnrolmentStatus` member that means "holding an active place". */
const ACTIVE_ENROLMENT_STATUS = "ACTIVE";

/** Inclusive bounds for a single "repeat weekly" batch (T-05-36). */
const MIN_OCCURRENCES = 1;
const MAX_OCCURRENCES = 52;

/** The reason the factory's bare `archive` writes — the real, reason-bearing
 *  cancel path is `cancelSession`, which every UI must call instead. */
const ARCHIVE_CANCELLATION_REASON = "Cancelled via archive (no reason captured)";

// ---------------------------------------------------------------------------
// Record + typed errors
// ---------------------------------------------------------------------------

export type ScheduledSessionRecord = {
  id: string;
  cohortId: string;
  courseId: string | null;
  title: string;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
  meetingUrl: string | null;
  linkVisibleFromMinutes: number;
  facilitatorId: string | null;
  attendanceExpected: boolean;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** The cohort's timezone failed `isValidTimeZone` — refused before any write. */
export class InvalidTimeZoneError extends Error {
  readonly timeZone: string;
  constructor(timeZone: string) {
    super(
      `The cohort's timezone "${timeZone}" is not a timezone this system recognises. ` +
        `Fix the cohort's timezone before scheduling sessions.`,
    );
    this.name = "InvalidTimeZoneError";
    this.timeZone = timeZone;
  }
}

/** `endTime` was not strictly after `startTime`. */
export class SessionTimeRangeError extends Error {
  constructor(message = "A session's end time must be after its start time.") {
    super(message);
    this.name = "SessionTimeRangeError";
  }
}

/**
 * A `courseId` was supplied that this cohort's session may not be tagged to
 * (D-24): a standalone-Course cohort tags nothing, and a Programme cohort tags
 * only its own `CohortCourse` member courses.
 */
export class SessionCourseNotInCohortError extends Error {
  readonly courseId: string;
  constructor(courseId: string, detail: string) {
    super(`Course ${courseId} cannot be tagged to this session: ${detail}.`);
    this.name = "SessionCourseNotInCohortError";
    this.courseId = courseId;
  }
}

/** A mandatory reason was blank (D-26). Mirrors `publish-service.ts`. */
export class ReasonRequiredError extends Error {
  constructor(message = "A reason is required to cancel a session.") {
    super(message);
    this.name = "ReasonRequiredError";
  }
}

/** `occurrences` fell outside the inclusive 1–52 range (T-05-36). */
export class RepeatOccurrencesError extends Error {
  readonly occurrences: number;
  constructor(occurrences: number) {
    super(
      `A repeat-weekly batch must create between ${MIN_OCCURRENCES} and ` +
        `${MAX_OCCURRENCES} sessions (got ${occurrences}).`,
    );
    this.name = "RepeatOccurrencesError";
    this.occurrences = occurrences;
  }
}

/** No `ScheduledSession` row for the given id. */
export class SessionNotFoundError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`Scheduled session ${sessionId} does not exist.`);
    this.name = "SessionNotFoundError";
    this.sessionId = sessionId;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** `"2026-03-01"` -> `{ year: 2026, month: 3, day: 1 }`. */
function parseWallDate(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) {
    throw new SessionTimeRangeError(`"${date}" is not a valid YYYY-MM-DD date.`);
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** `"09:00"` -> `{ hour: 9, minute: 0 }`. */
function parseTimeOfDay(time: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (!match) {
    throw new SessionTimeRangeError(`"${time}" is not a valid HH:MM time.`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new SessionTimeRangeError(`"${time}" is not a valid HH:MM time.`);
  }
  return { hour, minute };
}

/**
 * Advances a wall-clock CALENDAR date by `days`, staying on the same local
 * clock time. This is date arithmetic on `{year, month, day}` — NOT adding a
 * span of milliseconds to a UTC instant, which would shift the local start
 * time by an hour across a daylight-saving boundary (D-22).
 */
function advanceWallDate(
  parts: { year: number; month: number; day: number },
  days: number,
): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * Converts one occurrence's wall-clock date + start/end times into UTC
 * instants using the cohort's timezone, and asserts the range is ordered.
 */
function toUtcRange(
  dateParts: { year: number; month: number; day: number },
  start: { hour: number; minute: number },
  end: { hour: number; minute: number },
  timeZone: string,
): { startsAt: Date; endsAt: Date } {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const date = `${pad(dateParts.year, 4)}-${pad(dateParts.month)}-${pad(dateParts.day)}`;
  const startsAt = parseCohortDateTime(`${date}T${pad(start.hour)}:${pad(start.minute)}`, timeZone);
  const endsAt = parseCohortDateTime(`${date}T${pad(end.hour)}:${pad(end.minute)}`, timeZone);
  if (!startsAt || !endsAt) {
    throw new SessionTimeRangeError(
      "Enter a valid calendar date and local times that exist in the cohort's timezone.",
    );
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new SessionTimeRangeError();
  }
  return { startsAt, endsAt };
}

/**
 * Whether the meeting link may be shown to this viewer at this instant (D-25).
 *
 * Pure — the same predicate the UI's "the meeting link appears {n} minutes
 * before the session starts" copy is derived from, and the LRN-06 read path
 * (Phase 9) is built on. False unless the viewer is enrolled; false for a
 * cancelled session; otherwise true only from
 * `startsAt - linkVisibleFromMinutes` onward, with no upper bound.
 */
export function isMeetingLinkVisible(
  session: { startsAt: Date; linkVisibleFromMinutes: number; cancelledAt: Date | null },
  now: Date,
  viewer: { enrolled: boolean },
): boolean {
  if (!viewer.enrolled) return false;
  if (session.cancelledAt !== null) return false;
  const opensAt = session.startsAt.getTime() - session.linkVisibleFromMinutes * 60_000;
  return now.getTime() >= opensAt;
}

/** The instant the link becomes visible — for the "appears {n} minutes before" copy. */
function linkVisibleFrom(session: {
  startsAt: Date;
  linkVisibleFromMinutes: number;
}): Date {
  return new Date(session.startsAt.getTime() - session.linkVisibleFromMinutes * 60_000);
}

// ---------------------------------------------------------------------------
// Service dependencies
// ---------------------------------------------------------------------------

/** The `Cohort` slice this service reads: timezone + offer target + member courses. */
export type SessionCohortInfoDelegate = {
  findUnique(args: {
    where: { id: string };
    select: {
      timezone: true;
      courseId: true;
      programmeId: true;
      cohortCourses: { select: { courseId: true } };
    };
  }): Promise<{
    timezone: string;
    courseId: string | null;
    programmeId: string | null;
    cohortCourses: Array<{ courseId: string }>;
  } | null>;
};

/** The transaction client the reason-bearing writes need — structural, so a
 *  Prisma `tx` and a unit-test fake both satisfy it (no `@prisma/client` import). */
export type SessionTxClient = DomainEventTxClient & {
  scheduledSession: {
    create(args: { data: Record<string, unknown> }): Promise<ScheduledSessionRecord>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<ScheduledSessionRecord>;
  };
};

export type ScheduledSessionServiceDeps = {
  delegate: Delegate<ScheduledSessionRecord>;
  cohort: SessionCohortInfoDelegate;
  db: { $transaction: <R>(fn: (tx: SessionTxClient) => Promise<R>) => Promise<R> };
  /** Session id -> scope. The factory's `toScope`. */
  sessionScope: (id: string) => ResourceScope | Promise<ResourceScope>;
  /** Cohort id -> scope. Used by the cohort-keyed create / list actions. */
  cohortScope: (id: string) => ResourceScope | Promise<ResourceScope>;
  /** Whether `userId` holds an ACTIVE enrolment in `cohortId` (D-25 gate). */
  isViewerEnrolled: (cohortId: string, userId: string) => Promise<boolean>;
  withPermission: WithPermission;
  audit: (entry: ResourceAuditEntry) => Promise<void>;
  runInTransaction: <R>(fn: () => Promise<R>) => Promise<R>;
  now?: () => Date;
};

/** The fields shared by the single-create and repeat-weekly inputs. */
type SessionFieldsInput = {
  cohortId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  location?: string;
  meetingUrl?: string;
  linkVisibleFromMinutes?: number;
  facilitatorId?: string;
  attendanceExpected?: boolean;
  courseId?: string;
};

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export function createScheduledSessionService(deps: ScheduledSessionServiceDeps) {
  const { withPermission, delegate, db } = deps;
  const now = deps.now ?? (() => new Date());

  const scheduledSessionService = createResourceService<ScheduledSessionRecord>({
    name: "ScheduledSession",
    delegate,
    permissions: {
      view: "cohorts.view",
      create: "cohorts.manage",
      edit: "cohorts.manage",
    },
    toScope: deps.sessionScope,
    withPermission,
    audit: deps.audit,
    // D-26 — archive is a soft-cancel, never a delete. It cannot carry a
    // reason (the factory hands `archiveData` only an id), so `cancelSession`
    // below is the real path; this keeps a bare `.archive()` call fail-safe.
    archiveData: () => ({
      cancelledAt: now(),
      cancellationReason: ARCHIVE_CANCELLATION_REASON,
    }),
    runInTransaction: deps.runInTransaction,
  });

  /** Reads the cohort's timezone + offer target, or throws if it is gone. */
  async function loadCohortInfo(cohortId: string) {
    const row = await deps.cohort.findUnique({
      where: { id: cohortId },
      select: {
        timezone: true,
        courseId: true,
        programmeId: true,
        cohortCourses: { select: { courseId: true } },
      },
    });
    if (!row) throw new SessionNotFoundError(cohortId);
    if (!isValidTimeZone(row.timezone)) {
      throw new InvalidTimeZoneError(row.timezone);
    }
    return row;
  }

  /** D-24 — a session's optional course tag. */
  function assertCourseTaggable(
    cohort: { courseId: string | null; programmeId: string | null; cohortCourses: Array<{ courseId: string }> },
    courseId: string | undefined,
  ): void {
    if (courseId == null) return;
    if (cohort.programmeId == null) {
      throw new SessionCourseNotInCohortError(
        courseId,
        "a standalone-course cohort's sessions are not tagged to a course",
      );
    }
    const members = new Set(cohort.cohortCourses.map((c) => c.courseId));
    if (!members.has(courseId)) {
      throw new SessionCourseNotInCohortError(
        courseId,
        "it is not a member course of this programme cohort",
      );
    }
  }

  /** Builds the row payload for one occurrence. */
  function buildSessionData(
    input: SessionFieldsInput,
    range: { startsAt: Date; endsAt: Date },
  ): Record<string, unknown> {
    return {
      cohortId: input.cohortId,
      courseId: input.courseId ?? null,
      title: input.title,
      startsAt: range.startsAt,
      endsAt: range.endsAt,
      location: input.location ?? null,
      meetingUrl: input.meetingUrl ?? null,
      ...(input.linkVisibleFromMinutes != null
        ? { linkVisibleFromMinutes: input.linkVisibleFromMinutes }
        : {}),
      facilitatorId: input.facilitatorId ?? null,
      ...(input.attendanceExpected != null
        ? { attendanceExpected: input.attendanceExpected }
        : {}),
    };
  }

  // -------------------------------------------------------------------------
  // createSessionFromWallTime (D-23 / D-24)
  // -------------------------------------------------------------------------

  const createSessionFromWallTime = withPermission<SessionFieldsInput>(
    "cohorts.manage",
    (input) => deps.cohortScope(input.cohortId),
  )(async (input, ctx) => {
    const cohort = await loadCohortInfo(input.cohortId);
    assertCourseTaggable(cohort, input.courseId);

    const range = toUtcRange(
      parseWallDate(input.date),
      parseTimeOfDay(input.startTime),
      parseTimeOfDay(input.endTime),
      cohort.timezone,
    );

    const created = await db.$transaction(async (tx) => {
      const row = await tx.scheduledSession.create({
        data: buildSessionData(input, range),
      });
      await writeDomainEvent(tx, {
        type: "session.created",
        payload: {
          sessionId: row.id,
          cohortId: input.cohortId,
          actorId: ctx.actor.userId,
        },
      });
      return row;
    });

    await deps.audit({
      action: "session.created",
      targetType: "ScheduledSession",
      targetId: created.id,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: null,
      after: created,
    });

    return created;
  });

  // -------------------------------------------------------------------------
  // repeatWeeklySessions (D-22)
  // -------------------------------------------------------------------------

  const repeatWeeklySessions = withPermission<
    SessionFieldsInput & { occurrences: number }
  >("cohorts.manage", (input) => deps.cohortScope(input.cohortId))(
    async (input, ctx) => {
      const { occurrences } = input;
      if (
        !Number.isInteger(occurrences) ||
        occurrences < MIN_OCCURRENCES ||
        occurrences > MAX_OCCURRENCES
      ) {
        throw new RepeatOccurrencesError(occurrences);
      }

      const cohort = await loadCohortInfo(input.cohortId);
      assertCourseTaggable(cohort, input.courseId);

      const baseDate = parseWallDate(input.date);
      const start = parseTimeOfDay(input.startTime);
      const end = parseTimeOfDay(input.endTime);
      // Validate the range once against occurrence 0.
      toUtcRange(baseDate, start, end, cohort.timezone);

      const created = await db.$transaction(async (tx) => {
        const rows: ScheduledSessionRecord[] = [];
        for (let k = 0; k < occurrences; k += 1) {
          // Advance the WALL-CLOCK date, then re-convert, so a DST-shifted
          // zone keeps the same local start time.
          const dateParts = advanceWallDate(baseDate, 7 * k);
          const range = toUtcRange(dateParts, start, end, cohort.timezone);
          const row = await tx.scheduledSession.create({
            data: buildSessionData(input, range),
          });
          await writeDomainEvent(tx, {
            type: "session.created",
            payload: {
              sessionId: row.id,
              cohortId: input.cohortId,
              actorId: ctx.actor.userId,
              occurrenceIndex: k,
            },
          });
          rows.push(row);
        }
        return rows;
      });

      for (const row of created) {
        await deps.audit({
          action: "session.created",
          targetType: "ScheduledSession",
          targetId: row.id,
          actorId: ctx.actor.userId,
          outcome: "SUCCESS",
          reason: null,
          after: row,
        });
      }

      return created;
    },
  );

  // -------------------------------------------------------------------------
  // cancelSession (D-26)
  // -------------------------------------------------------------------------

  const cancelSession = withPermission<{ sessionId: string; reason: string }>(
    "cohorts.manage",
    (input) => deps.sessionScope(input.sessionId),
  )(async (input, ctx) => {
    const reason = input.reason?.trim();
    if (!reason) throw new ReasonRequiredError();

    const before = await delegate.findUnique({ where: { id: input.sessionId } });
    if (!before) throw new SessionNotFoundError(input.sessionId);

    const after = await db.$transaction(async (tx) => {
      const updated = await tx.scheduledSession.update({
        where: { id: input.sessionId },
        data: { cancelledAt: now(), cancellationReason: reason },
      });
      await writeDomainEvent(tx, {
        type: "session.cancelled",
        payload: {
          sessionId: input.sessionId,
          cohortId: before.cohortId,
          actorId: ctx.actor.userId,
          reason,
        },
      });
      return updated;
    });

    await deps.audit({
      action: "session.cancelled",
      targetType: "ScheduledSession",
      targetId: input.sessionId,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason,
      before,
      after,
    });

    return after;
  });

  // -------------------------------------------------------------------------
  // listSessionsForCohort — ordered, includes cancelled, NEVER carries meetingUrl
  // -------------------------------------------------------------------------

  const listSessionsForCohort = withPermission<string>(
    "cohorts.view",
    (cohortId) => deps.cohortScope(cohortId),
  )(async (cohortId) => {
    const cohort = await deps.cohort.findUnique({
      where: { id: cohortId },
      select: {
        timezone: true,
        courseId: true,
        programmeId: true,
        cohortCourses: { select: { courseId: true } },
      },
    });
    const timezone = cohort?.timezone ?? "UTC";

    const rows = await delegate.findMany({ where: { cohortId } });

    return rows
      .slice()
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .map((r) => ({
        id: r.id,
        cohortId: r.cohortId,
        courseId: r.courseId,
        title: r.title,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        location: r.location,
        linkVisibleFromMinutes: r.linkVisibleFromMinutes,
        facilitatorId: r.facilitatorId,
        attendanceExpected: r.attendanceExpected,
        cancelledAt: r.cancelledAt,
        cancellationReason: r.cancellationReason,
        timezone,
        startsAtLabel: utcToWallParts(r.startsAt, timezone).label,
        endsAtLabel: utcToWallParts(r.endsAt, timezone).label,
        // D-25 / T-05-86 — presence only, never the capability itself. The
        // Sessions tab's "Mode/link" column needs to know whether a link is
        // configured without ever receiving the URL; `r.meetingUrl` is read
        // here (never returned) purely to derive this boolean.
        hasMeetingLink: r.meetingUrl !== null,
      }));
  });

  // -------------------------------------------------------------------------
  // readSessionForViewer — the server-side meeting-link gate (D-25)
  // -------------------------------------------------------------------------

  const readSessionForViewer = withPermission<{ sessionId: string }>(
    "cohorts.view",
    (input) => deps.sessionScope(input.sessionId),
  )(async (input, ctx) => {
    const row = await delegate.findUnique({ where: { id: input.sessionId } });
    if (!row) throw new SessionNotFoundError(input.sessionId);

    const enrolled = await deps.isViewerEnrolled(row.cohortId, ctx.actor.userId);
    const visible = isMeetingLinkVisible(row, now(), { enrolled });

    // Strip meetingUrl unconditionally, then add it back only when the gate
    // is open — the closed-gate payload has NO meetingUrl key at all.
    const { meetingUrl, ...safe } = row;

    if (visible) {
      return { ...safe, meetingUrl };
    }
    if (enrolled && row.cancelledAt === null) {
      return { ...safe, meetingUrlAvailableFrom: linkVisibleFrom(row) };
    }
    return { ...safe };
  });

  return {
    scheduledSessionService,
    createSessionFromWallTime,
    repeatWeeklySessions,
    cancelSession,
    listSessionsForCohort,
    readSessionForViewer,
  };
}

// ---------------------------------------------------------------------------
// Prisma-backed binding
// ---------------------------------------------------------------------------

const built = createScheduledSessionService({
  delegate: prisma.scheduledSession as unknown as Delegate<ScheduledSessionRecord>,
  cohort: prisma.cohort as unknown as SessionCohortInfoDelegate,
  db: {
    $transaction: (fn) =>
      prisma.$transaction((tx) => fn(tx as unknown as SessionTxClient)),
  },
  sessionScope: sessionCohortScope,
  cohortScope: cohortResourceScope,
  isViewerEnrolled: async (cohortId, userId) => {
    const row = await prisma.enrolment.findFirst({
      where: { cohortId, userId, status: ACTIVE_ENROLMENT_STATUS },
      select: { id: true },
    });
    return row !== null;
  },
  withPermission: liveWithPermission,
  audit: (entry) =>
    recordAudit({
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      before: entry.before,
      after: entry.after,
      reason: entry.reason,
      outcome: entry.outcome,
    }),
  runInTransaction: (fn) => prisma.$transaction(fn),
});

export const scheduledSessionService = built.scheduledSessionService;
export const createSessionFromWallTime = built.createSessionFromWallTime;
export const repeatWeeklySessions = built.repeatWeeklySessions;
export const cancelSession = built.cancelSession;
export const listSessionsForCohort = built.listSessionsForCohort;
export const readSessionForViewer = built.readSessionForViewer;
