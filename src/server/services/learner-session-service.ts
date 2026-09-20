/**
 * Ownership-scoped session list for a learner's own cohort (LRN-06, 09-10).
 *
 * DD-23: `isMeetingLinkVisible` and `linkVisibleFrom` are IMPORTED from
 * `scheduled-session-service.ts`, never reimplemented. That file's header
 * already names link disclosure as one of the two things "easy to get wrong
 * and expensive later"; a second copy of the minute arithmetic is exactly
 * the drift it warns about. Importing from that module pulls
 * `withPermission` onto this module's runtime closure — acceptable because
 * this file is only ever called from a Server Component, never from a
 * worker or webhook entrypoint (unlike `checkout-webhook-system-service.ts`
 * or the Netlify scheduled functions `tests/boundary.test.ts` walks the
 * import closure of). If a future entrypoint needs this module from a
 * closure-sensitive context, move `isMeetingLinkVisible` + `linkVisibleFrom`
 * into a small pure module (e.g. `src/lib/session-visibility.ts`) imported
 * by both files, per DD-23's own fallback.
 *
 * DD-24: the gate is applied by OMITTING the key. A session outside its
 * window has no `meetingUrl` property at all on the returned `SessionView`
 * — not `null`, not an empty string. `scheduled-session-service.ts`'s
 * `readSessionForViewer` already does exactly this
 * (`const { meetingUrl, ...safe } = row`); this file copies that shape.
 *
 * A learner's attendance read here is their OWN row only, keyed on the
 * enrolment already proven to be theirs by `getOwnActiveEnrolment`
 * (T-09-01 denial parity) — no other learner's `AttendanceRecord` is ever
 * queried or returned (T-09-36).
 *
 * Follows the injected-deps / live-singleton convention `learner-access.ts`
 * and `enrolment-dashboard-service.ts` already use.
 */

import { prisma } from "@/server/db";
import type { Actor } from "@/server/permissions/with-permission";
import {
  getOwnActiveEnrolment,
  type OwnEnrolmentSnapshot,
} from "@/server/services/learner-access";
import {
  isMeetingLinkVisible,
  linkVisibleFrom,
} from "@/server/services/scheduled-session-service";
import type { AttendanceStateValue } from "@/server/services/attendance-component";

// ---------------------------------------------------------------------------
// Store — the narrow structural slice this module needs.
// ---------------------------------------------------------------------------

/**
 * The full session row this module is allowed to read, INCLUDING
 * `meetingUrl` — unlike `enrolment-dashboard-service.ts`'s deliberately
 * narrower `DashboardSessionStoreRow` (DD-19 there), this is the one module
 * whose job is exactly to gate that column, so it must be able to read it.
 */
export type LearnerSessionStoreRow = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
  meetingUrl: string | null;
  linkVisibleFromMinutes: number;
  cancelledAt: Date | null;
  cancellationReason: string | null;
};

export type LearnerSessionAttendanceStoreRow = {
  sessionId: string;
  state: AttendanceStateValue;
};

export type LearnerSessionStore = {
  scheduledSession: {
    findMany(args: { where: { cohortId: string } }): Promise<LearnerSessionStoreRow[]>;
  };
  attendanceRecord: {
    findMany(args: {
      where: { enrolmentId: string };
    }): Promise<LearnerSessionAttendanceStoreRow[]>;
  };
};

/**
 * The one `learner-access.ts` function this service composes, bundled so a
 * test can build its own `createLearnerAccessService(fakeStore)` instance
 * and hand its returned function in here — full unit coverage with no
 * Postgres and no module mocking, mirroring
 * `EnrolmentDashboardLearnerAccess`'s identical shape.
 */
export type LearnerSessionAccess = {
  getOwnActiveEnrolment(
    actor: Actor,
    enrolmentId: string,
  ): Promise<OwnEnrolmentSnapshot | null>;
};

export type LearnerSessionServiceDeps = {
  store: LearnerSessionStore;
  access: LearnerSessionAccess;
  /** Explicit clock — no caller may read a client-controlled value (T-09-10 precedent). */
  now?: () => Date;
};

// ---------------------------------------------------------------------------
// Returned shape
// ---------------------------------------------------------------------------

export type SessionMode = "virtual" | "in-person" | "unknown";

export type SessionView = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  mode: SessionMode;
  /** The caller's OWN `AttendanceRecord.state`, or `"NOT_RECORDED"` when no row exists. */
  attendance: AttendanceStateValue;
  /** Present ONLY when `isMeetingLinkVisible` is true for this viewer at this instant (DD-24). */
  meetingUrl?: string;
  /** Present only when the link is not yet visible and the session is not cancelled. */
  meetingUrlAvailableFrom?: Date;
};

export type OwnCohortSessions = {
  timezone: string;
  upcoming: SessionView[];
  past: SessionView[];
};

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export function createLearnerSessionService(deps: LearnerSessionServiceDeps) {
  const { store, access } = deps;
  const now = deps.now ?? (() => new Date());

  /**
   * `mode` is derived from the presence of the `meetingUrl` column, then the
   * value itself is discarded via the strip-then-add-back destructure below
   * (DD-24) — deriving the badge never risks exposing the URL (T-09-35).
   */
  function buildView(
    row: LearnerSessionStoreRow,
    attendance: AttendanceStateValue,
    at: Date,
  ): SessionView {
    const hasMeetingUrl = row.meetingUrl !== null;
    const mode: SessionMode = hasMeetingUrl
      ? "virtual"
      : row.location !== null
        ? "in-person"
        : "unknown";

    const visible = isMeetingLinkVisible(row, at, { enrolled: true });

    // Strip meetingUrl unconditionally, then add it back only when the gate
    // is open — the closed-gate view has NO meetingUrl key at all (DD-24),
    // mirroring `readSessionForViewer`'s identical shape.
    const { meetingUrl, ...safe } = row;

    const base: SessionView = {
      id: safe.id,
      title: safe.title,
      startsAt: safe.startsAt,
      endsAt: safe.endsAt,
      location: safe.location,
      cancelledAt: safe.cancelledAt,
      cancellationReason: safe.cancellationReason,
      mode,
      attendance,
    };

    if (visible) {
      return { ...base, meetingUrl: meetingUrl as string };
    }
    if (row.cancelledAt === null) {
      return { ...base, meetingUrlAvailableFrom: linkVisibleFrom(row) };
    }
    return base;
  }

  /**
   * `null` whenever `getOwnActiveEnrolment` returns `null` — same denial
   * parity (not-found / not-mine / not-ACTIVE are indistinguishable to the
   * caller, T-09-01). Otherwise the caller's own cohort's sessions, split on
   * `endsAt` relative to `at`, upcoming ascending by `startsAt` and past
   * descending.
   */
  async function listOwnCohortSessions(
    actor: Actor,
    enrolmentId: string,
    at: Date = now(),
  ): Promise<OwnCohortSessions | null> {
    const enrolment = await access.getOwnActiveEnrolment(actor, enrolmentId);
    if (!enrolment) return null;

    const [sessions, records] = await Promise.all([
      store.scheduledSession.findMany({ where: { cohortId: enrolment.cohortId } }),
      store.attendanceRecord.findMany({ where: { enrolmentId: enrolment.id } }),
    ]);

    const attendanceBySession = new Map(records.map((r) => [r.sessionId, r.state]));
    const toView = (row: LearnerSessionStoreRow) =>
      buildView(row, attendanceBySession.get(row.id) ?? "NOT_RECORDED", at);

    const upcomingRows = sessions
      .filter((s) => s.endsAt.getTime() > at.getTime())
      .slice()
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const pastRows = sessions
      .filter((s) => s.endsAt.getTime() <= at.getTime())
      .slice()
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());

    return {
      timezone: enrolment.cohort.timezone,
      upcoming: upcomingRows.map(toView),
      past: pastRows.map(toView),
    };
  }

  return { listOwnCohortSessions };
}

// ---------------------------------------------------------------------------
// Prisma-backed binding
// ---------------------------------------------------------------------------

const liveStore: LearnerSessionStore = {
  scheduledSession: {
    findMany: (args) => prisma.scheduledSession.findMany(args),
  },
  attendanceRecord: {
    findMany: (args) =>
      prisma.attendanceRecord.findMany(args) as unknown as Promise<
        LearnerSessionAttendanceStoreRow[]
      >,
  },
};

const built = createLearnerSessionService({
  store: liveStore,
  access: { getOwnActiveEnrolment },
});

export const listOwnCohortSessions = built.listOwnCohortSessions;
