/**
 * The staff overview (`/staff`): the day's figures, the work waiting for someone, the
 * enrolment trend, the next sessions and the cohorts that are filling up.
 *
 * Every section is gated by the view permission its data belongs to. A section the actor
 * cannot see comes back `null`, never empty: an empty section would read as "nothing here"
 * when the truth is "not yours to see" (the same rule the list pages follow, RBAC-06).
 * All checks are GLOBAL-scope — the same scope the unscoped list pages already require —
 * so a staff account with only cohort- or course-scoped grants sees no overview sections.
 *
 * Read-only. The database is reached only from this services layer (boundary rule).
 */

import { prisma } from "@/server/db";
import { collectionScopeFor, type Permission } from "@/server/permissions";
import {
  cohortWhereForCollection,
  submissionWhereForCollection,
  type CollectionScopeSnapshot,
} from "@/server/permissions/collection-scope";

const DAY_MS = 24 * 60 * 60 * 1000;

export type OverviewQueueItem = {
  key: string;
  kind: "grading" | "attendance" | "certificates" | "refund" | "payment";
  title: string;
  detail: string;
  href: string;
  /** Whole days since the item started waiting. */
  ageDays: number;
  /** Waiting long enough that it should read as overdue. */
  overdue: boolean;
};

export type OverviewSession = {
  id: string;
  cohortId: string;
  cohortCode: string;
  title: string;
  startsAt: Date;
  timezone: string;
  location: string | null;
  virtual: boolean;
};

export type OverviewFillingCohort = {
  cohortId: string;
  code: string;
  title: string;
  startsAt: Date;
  timezone: string;
  taken: number;
  capacity: number;
};

export type StaffOverview = {
  now: Date;
  figures: {
    learnersInDelivery: { learners: number; cohorts: number } | null;
    enrolments: { thisMonth: number; lastMonth: number } | null;
    /** Paid orders this month, per currency (minor units). */
    revenue: { currency: string; amountMinor: number }[] | null;
    /** Percent of recorded attendance this month that was present or late; null when none recorded. */
    attendance: { percent: number | null; recorded: number } | null;
  };
  queue: OverviewQueueItem[] | null;
  /** Enrolments per week for the last 12 weeks, oldest first, with each week's Monday. */
  weekly: { weekStart: Date; count: number }[] | null;
  nextSessions: OverviewSession[] | null;
  filling: OverviewFillingCohort[] | null;
};

/** The Monday (00:00 UTC) of the week containing `d`. */
function weekStartOf(d: Date): Date {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (start.getUTCDay() + 6) % 7; // Monday = 0
  start.setUTCDate(start.getUTCDate() - dow);
  return start;
}

const ageDaysOf = (since: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY_MS));
const OVERDUE_AFTER_DAYS = 3;

export type StaffOverviewDeps = {
  /** The Prisma client — the live singleton, or a test container's client. */
  db: typeof prisma;
  /** The caller's collection scope for a permission, or null when they hold it nowhere. */
  scopeFor: (permission: Permission) => Promise<CollectionScopeSnapshot | null>;
  now?: () => Date;
};

/**
 * Integration warning #1 — every figure and queue item follows the caller's
 * own grants: all of it for a GLOBAL grant, only in-scope cohorts' data for a
 * COHORT/PROGRAMME/COURSE grant, and a section is hidden (null) for a
 * permission held nowhere. The filters are part of each query.
 */
export function createStaffOverviewLoader(deps: StaffOverviewDeps) {
  const prisma = deps.db;
  return async function loadStaffOverview(): Promise<StaffOverview> {
  const now = deps.now?.() ?? new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  const [
    enrolmentScope,
    paymentScope,
    attendanceScope,
    cohortScope,
    gradingScope,
    certificateScope,
    refundScope,
  ] = await Promise.all([
    deps.scopeFor("enrolments.view"),
    deps.scopeFor("payments.view"),
    deps.scopeFor("attendance.view"),
    deps.scopeFor("cohorts.view"),
    deps.scopeFor("submissions.view"),
    deps.scopeFor("certificates.view"),
    deps.scopeFor("refunds.manage"),
  ]);
  const canEnrolments = enrolmentScope !== null;
  const canPayments = paymentScope !== null;
  const canAttendance = attendanceScope !== null;
  const canCohorts = cohortScope !== null;
  const canGrading = gradingScope !== null;
  // The flagged-certificates item links to a list that needs a GLOBAL grant.
  const canCertificates = certificateScope?.kind === "GLOBAL";
  const canRefunds = refundScope !== null;
  const cohortsIn = (scope: CollectionScopeSnapshot | null) => (scope ? cohortWhereForCollection(scope) : {});

  // ---- figures ----
  // One read for both numbers: the running cohorts, each with its count of active enrolments
  // (a relation count is part of the same SQL statement). It used to be two separate counts.
  const learnersInDelivery = canEnrolments
    ? await prisma.cohort
        .findMany({
          where: { AND: [{ status: "IN_PROGRESS" }, cohortsIn(enrolmentScope)] },
          select: { _count: { select: { enrolments: { where: { status: "ACTIVE" } } } } },
        })
        .then((rows) => ({
          learners: rows.reduce((total, row) => total + row._count.enrolments, 0),
          cohorts: rows.length,
        }))
    : null;

  const revenue = canPayments
    ? await prisma.order
        .groupBy({
          by: ["currency"],
          where: {
            status: { in: ["PAID", "PARTIALLY_REFUNDED"] },
            paidAt: { gte: monthStart },
            cohort: cohortsIn(paymentScope),
          },
          _sum: { amountMinor: true },
        })
        .then((rows: Array<{ currency: string; _sum: { amountMinor: number | null } }>) =>
          rows.map((r) => ({ currency: r.currency, amountMinor: r._sum.amountMinor ?? 0 })),
        )
    : null;

  const attendance = canAttendance
    ? await prisma.attendanceRecord
        .groupBy({
          by: ["state"],
          where: {
            state: { in: ["PRESENT", "LATE", "ABSENT"] },
            session: { startsAt: { gte: monthStart, lte: now }, cohort: cohortsIn(attendanceScope) },
          },
          _count: { _all: true },
        })
        .then((rows: Array<{ state: string; _count: { _all: number } }>) => {
          const count = (s: string) => rows.find((r) => r.state === s)?._count._all ?? 0;
          const attended = count("PRESENT") + count("LATE");
          const recorded = attended + count("ABSENT");
          return { percent: recorded > 0 ? Math.round((attended / recorded) * 100) : null, recorded };
        })
    : null;

  // ---- the work queue ----
  // Cohort codes (and time zones) are named by three sections below. They are collected as ids
  // and read once after the sections have run, instead of once per section through a nested read.
  type CohortInfo = Map<string, { code: string; timezone: string }>;
  const cohortIdsToName = new Set<string>();
  const cohortInfoAt = (cohortInfo: CohortInfo, id: string) => cohortInfo.get(id) ?? { code: "", timezone: "UTC" };

  const anyQueueSource = canGrading || canAttendance || canCertificates || canRefunds || canPayments;
  // Entries that name a cohort are finished after the cohort lookup; the order of the entries is
  // the order the sections ran in, so ties in the final sort resolve exactly as they did before.
  const queueEntries: (OverviewQueueItem | ((cohortInfo: CohortInfo) => OverviewQueueItem))[] = [];
  if (anyQueueSource) {
    if (canGrading) {
      const subs = await prisma.submission.findMany({
        where: {
          AND: [
            { uploadStatus: "READY", grades: { none: {} }, enrolment: { status: "ACTIVE" } },
            gradingScope ? submissionWhereForCollection(gradingScope) : {},
          ],
        },
        select: { submittedAt: true, assessmentId: true, enrolmentId: true },
        orderBy: { submittedAt: "asc" },
      });
      const [assessments, enrolmentRows] = subs.length
        ? await Promise.all([
            prisma.assessment.findMany({
              where: { id: { in: [...new Set(subs.map((s) => s.assessmentId))] } },
              select: { id: true, title: true },
            }),
            prisma.enrolment.findMany({
              where: { id: { in: [...new Set(subs.map((s) => s.enrolmentId))] } },
              select: { id: true, cohortId: true },
            }),
          ])
        : [[], []];
      const titleOf = new Map(assessments.map((a) => [a.id, a.title]));
      const cohortOfEnrolment = new Map(enrolmentRows.map((e) => [e.id, e.cohortId]));
      const groups = new Map<string, { title: string; cohortId: string; assessmentId: string; count: number; oldest: Date }>();
      for (const s of subs) {
        const cohortId = cohortOfEnrolment.get(s.enrolmentId);
        if (!cohortId) continue; // the enrolment row is required by the foreign key; defensive only
        const key = `${cohortId}:${s.assessmentId}`;
        const g = groups.get(key);
        if (g) g.count += 1;
        else
          groups.set(key, {
            title: titleOf.get(s.assessmentId) ?? "",
            cohortId,
            assessmentId: s.assessmentId,
            count: 1,
            oldest: s.submittedAt,
          });
      }
      for (const g of groups.values()) {
        cohortIdsToName.add(g.cohortId);
        queueEntries.push((cohortInfo) => {
          const age = ageDaysOf(g.oldest, now);
          return {
            key: `grading:${g.cohortId}:${g.assessmentId}`,
            kind: "grading",
            title: "Submissions awaiting grading",
            detail: `${g.title} · ${cohortInfoAt(cohortInfo, g.cohortId).code} · ${g.count} ${g.count === 1 ? "submission" : "submissions"}`,
            href: `/staff/cohorts/${g.cohortId}/grading/${g.assessmentId}`,
            ageDays: age,
            overdue: age >= OVERDUE_AFTER_DAYS,
          };
        });
      }
    }

    if (canAttendance) {
      const sessions = await prisma.scheduledSession.findMany({
        where: {
          cancelledAt: null,
          attendanceExpected: true,
          endsAt: { lt: now, gte: new Date(now.getTime() - 14 * DAY_MS) },
          attendance: { none: { state: { not: "NOT_RECORDED" } } },
          cohort: { AND: [{ enrolments: { some: { status: "ACTIVE" } } }, cohortsIn(attendanceScope)] },
        },
        select: { id: true, title: true, endsAt: true, cohortId: true },
        orderBy: { endsAt: "asc" },
        take: 5,
      });
      for (const s of sessions) {
        cohortIdsToName.add(s.cohortId);
        queueEntries.push((cohortInfo) => {
          const age = ageDaysOf(s.endsAt, now);
          return {
            key: `attendance:${s.id}`,
            kind: "attendance",
            title: "Attendance not marked",
            detail: `${s.title} · ${cohortInfoAt(cohortInfo, s.cohortId).code}`,
            href: `/staff/cohorts/${s.cohortId}/sessions/${s.id}/attendance`,
            ageDays: age,
            overdue: age >= OVERDUE_AFTER_DAYS,
          };
        });
      }
    }

    if (canCertificates) {
      const flagged = await prisma.certificate.findMany({
        where: { status: "ACTIVE", reviewFlaggedAt: { not: null } },
        select: { reviewFlaggedAt: true },
        orderBy: { reviewFlaggedAt: "asc" },
      });
      if (flagged.length > 0) {
        const age = ageDaysOf(flagged[0].reviewFlaggedAt!, now);
        queueEntries.push({
          key: "certificates:flagged",
          kind: "certificates",
          title: "Certificates flagged for review",
          detail: `${flagged.length} ${flagged.length === 1 ? "certificate" : "certificates"} · a grade, attendance or completion changed`,
          href: "/staff/certificates/issued?status=flagged",
          ageDays: age,
          overdue: age >= OVERDUE_AFTER_DAYS,
        });
      }
    }

    if (canRefunds) {
      const refunds = await prisma.refund.findMany({
        where: { status: "REQUESTED", order: { cohort: cohortsIn(refundScope) } },
        select: { createdAt: true, currency: true, amountMinor: true, orderId: true, order: { select: { reference: true } } },
        orderBy: { createdAt: "asc" },
        take: 5,
      });
      for (const r of refunds) {
        const age = ageDaysOf(r.createdAt, now);
        queueEntries.push({
          key: `refund:${r.orderId}:${r.createdAt.getTime()}`,
          kind: "refund",
          title: "Refund request",
          detail: `${r.order.reference} · ${new Intl.NumberFormat("en", { style: "currency", currency: r.currency }).format(r.amountMinor / 100)}`,
          href: `/staff/payments/${r.orderId}`,
          ageDays: age,
          overdue: age >= OVERDUE_AFTER_DAYS,
        });
      }
    }

    if (canPayments) {
      const exceptions = await prisma.order.findMany({
        where: { status: "EXCEPTION", cohort: cohortsIn(paymentScope) },
        select: { updatedAt: true },
        orderBy: { updatedAt: "asc" },
      });
      if (exceptions.length > 0) {
        const age = ageDaysOf(exceptions[0].updatedAt, now);
        queueEntries.push({
          key: "payments:exception",
          kind: "payment",
          // An ORDER in the EXCEPTION status (for example a payment that arrived after the order
          // was cancelled). This is not the reconciliation queue, which tracks ledger mismatches
          // as its own cases, so the title says "orders" and the link opens the payments list
          // already filtered to them (audit A-12).
          title: "Orders needing review",
          detail: `${exceptions.length} ${exceptions.length === 1 ? "order" : "orders"} in an exception state`,
          href: "/staff/payments?status=EXCEPTION",
          ageDays: age,
          overdue: age >= OVERDUE_AFTER_DAYS,
        });
      }
    }

  }

  // ---- enrolments: this month, last month and per week, from one read ----
  // The month figures and the 12-week trend count the same rows (active or completed, created in
  // the caller's scope). The trend window starts at least 11 weeks back, which is always before the
  // start of last month, so one read serves all three numbers.
  let enrolments: StaffOverview["figures"]["enrolments"] = null;
  let weekly: StaffOverview["weekly"] = null;
  if (canEnrolments) {
    const thisWeek = weekStartOf(now);
    const first = new Date(thisWeek.getTime() - 11 * 7 * DAY_MS);
    const rows = await prisma.enrolment.findMany({
      where: { status: { in: ["ACTIVE", "COMPLETED"] }, createdAt: { gte: first }, cohort: cohortsIn(enrolmentScope) },
      select: { createdAt: true },
    });
    weekly = Array.from({ length: 12 }, (_, i) => ({ weekStart: new Date(first.getTime() + i * 7 * DAY_MS), count: 0 }));
    let thisMonth = 0;
    let lastMonth = 0;
    for (const r of rows) {
      const idx = Math.floor((weekStartOf(r.createdAt).getTime() - first.getTime()) / (7 * DAY_MS));
      if (idx >= 0 && idx < 12) weekly[idx].count += 1;
      if (r.createdAt >= monthStart) thisMonth += 1;
      else if (r.createdAt >= lastMonthStart) lastMonth += 1;
    }
    enrolments = { thisMonth, lastMonth };
  }

  // ---- next sessions and filling cohorts ----
  let nextSessionRows:
    | { id: string; title: string; startsAt: Date; location: string | null; meetingUrl: string | null; cohortId: string }[]
    | null = null;
  let filling: StaffOverview["filling"] = null;
  if (canCohorts) {
    nextSessionRows = await prisma.scheduledSession.findMany({
      where: {
        cancelledAt: null,
        startsAt: { gte: now, lte: new Date(now.getTime() + 7 * DAY_MS) },
        cohort: cohortsIn(cohortScope),
      },
      select: { id: true, title: true, startsAt: true, location: true, meetingUrl: true, cohortId: true },
      orderBy: { startsAt: "asc" },
      take: 6,
    });
    for (const s of nextSessionRows) cohortIdsToName.add(s.cohortId);

    // The count of taken seats rides in the same statement as the cohort row (a filtered relation count).
    const open = await prisma.cohort.findMany({
      where: { AND: [{ status: "PUBLISHED", enrolmentClosesAt: { gt: now } }, cohortsIn(cohortScope)] },
      select: {
        id: true,
        code: true,
        title: true,
        startsAt: true,
        timezone: true,
        capacity: true,
        _count: { select: { enrolments: { where: { status: { in: ["ACTIVE", "COMPLETED"] } } } } },
      },
    });
    filling = open
      .map((c) => ({
        cohortId: c.id,
        code: c.code,
        title: c.title,
        startsAt: c.startsAt,
        timezone: c.timezone,
        taken: c._count.enrolments,
        capacity: c.capacity,
      }))
      .filter((c) => c.capacity > 0)
      .sort((a, b) => b.taken / b.capacity - a.taken / a.capacity)
      .slice(0, 3);
  }

  // ---- one lookup for every cohort code and time zone named above ----
  const cohortInfo: CohortInfo = new Map();
  if (cohortIdsToName.size > 0) {
    const named = await prisma.cohort.findMany({
      where: { id: { in: [...cohortIdsToName] } },
      select: { id: true, code: true, timezone: true },
    });
    for (const c of named) cohortInfo.set(c.id, { code: c.code, timezone: c.timezone });
  }

  const queue: OverviewQueueItem[] | null = anyQueueSource
    ? queueEntries
        .map((entry) => (typeof entry === "function" ? entry(cohortInfo) : entry))
        .sort((x, y) => y.ageDays - x.ageDays)
    : null;

  const nextSessions: StaffOverview["nextSessions"] = nextSessionRows
    ? nextSessionRows.map((s) => ({
        id: s.id,
        cohortId: s.cohortId,
        cohortCode: cohortInfoAt(cohortInfo, s.cohortId).code,
        title: s.title,
        startsAt: s.startsAt,
        timezone: cohortInfoAt(cohortInfo, s.cohortId).timezone,
        location: s.location,
        virtual: !!s.meetingUrl && !s.location,
      }))
    : null;

  return {
    now,
    figures: { learnersInDelivery, enrolments, revenue, attendance },
    queue,
    weekly,
    nextSessions,
    filling,
  };
  };
}

export const loadStaffOverview = createStaffOverviewLoader({ db: prisma, scopeFor: collectionScopeFor });
