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
import { can } from "@/server/permissions";

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

export async function loadStaffOverview(): Promise<StaffOverview> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  const [
    canEnrolments,
    canPayments,
    canAttendance,
    canCohorts,
    canGrading,
    canCertificates,
    canRefunds,
  ] = await Promise.all([
    can("enrolments.view", {}),
    can("payments.view", {}),
    can("attendance.view", {}),
    can("cohorts.view", {}),
    can("submissions.view", {}),
    can("certificates.view", {}),
    can("refunds.manage", {}),
  ]);

  // ---- figures ----
  const learnersInDelivery = canEnrolments
    ? await Promise.all([
        prisma.enrolment.count({ where: { status: "ACTIVE", cohort: { status: "IN_PROGRESS" } } }),
        prisma.cohort.count({ where: { status: "IN_PROGRESS" } }),
      ]).then(([learners, cohorts]) => ({ learners, cohorts }))
    : null;

  const enrolments = canEnrolments
    ? await Promise.all([
        prisma.enrolment.count({
          where: { status: { in: ["ACTIVE", "COMPLETED"] }, createdAt: { gte: monthStart } },
        }),
        prisma.enrolment.count({
          where: { status: { in: ["ACTIVE", "COMPLETED"] }, createdAt: { gte: lastMonthStart, lt: monthStart } },
        }),
      ]).then(([thisMonth, lastMonth]) => ({ thisMonth, lastMonth }))
    : null;

  const revenue = canPayments
    ? await prisma.order
        .groupBy({
          by: ["currency"],
          where: { status: { in: ["PAID", "PARTIALLY_REFUNDED"] }, paidAt: { gte: monthStart } },
          _sum: { amountMinor: true },
        })
        .then((rows) => rows.map((r) => ({ currency: r.currency, amountMinor: r._sum.amountMinor ?? 0 })))
    : null;

  const attendance = canAttendance
    ? await prisma.attendanceRecord
        .groupBy({
          by: ["state"],
          where: { state: { in: ["PRESENT", "LATE", "ABSENT"] }, session: { startsAt: { gte: monthStart, lte: now } } },
          _count: { _all: true },
        })
        .then((rows) => {
          const count = (s: string) => rows.find((r) => r.state === s)?._count._all ?? 0;
          const attended = count("PRESENT") + count("LATE");
          const recorded = attended + count("ABSENT");
          return { percent: recorded > 0 ? Math.round((attended / recorded) * 100) : null, recorded };
        })
    : null;

  // ---- the work queue ----
  const anyQueueSource = canGrading || canAttendance || canCertificates || canRefunds || canPayments;
  let queue: OverviewQueueItem[] | null = null;
  if (anyQueueSource) {
    queue = [];

    if (canGrading) {
      const subs = await prisma.submission.findMany({
        where: { uploadStatus: "READY", grades: { none: {} }, enrolment: { status: "ACTIVE" } },
        select: {
          submittedAt: true,
          assessmentId: true,
          assessment: { select: { title: true } },
          enrolment: { select: { cohortId: true, cohort: { select: { code: true } } } },
        },
        orderBy: { submittedAt: "asc" },
      });
      const groups = new Map<string, { title: string; code: string; cohortId: string; assessmentId: string; count: number; oldest: Date }>();
      for (const s of subs) {
        const key = `${s.enrolment.cohortId}:${s.assessmentId}`;
        const g = groups.get(key);
        if (g) g.count += 1;
        else
          groups.set(key, {
            title: s.assessment.title,
            code: s.enrolment.cohort.code,
            cohortId: s.enrolment.cohortId,
            assessmentId: s.assessmentId,
            count: 1,
            oldest: s.submittedAt,
          });
      }
      for (const g of groups.values()) {
        const age = ageDaysOf(g.oldest, now);
        queue.push({
          key: `grading:${g.cohortId}:${g.assessmentId}`,
          kind: "grading",
          title: "Submissions awaiting grading",
          detail: `${g.title} · ${g.code} · ${g.count} ${g.count === 1 ? "submission" : "submissions"}`,
          href: `/staff/cohorts/${g.cohortId}/grading/${g.assessmentId}`,
          ageDays: age,
          overdue: age >= OVERDUE_AFTER_DAYS,
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
          cohort: { enrolments: { some: { status: "ACTIVE" } } },
        },
        select: { id: true, title: true, endsAt: true, cohortId: true, cohort: { select: { code: true } } },
        orderBy: { endsAt: "asc" },
        take: 5,
      });
      for (const s of sessions) {
        const age = ageDaysOf(s.endsAt, now);
        queue.push({
          key: `attendance:${s.id}`,
          kind: "attendance",
          title: "Attendance not marked",
          detail: `${s.title} · ${s.cohort.code}`,
          href: `/staff/cohorts/${s.cohortId}/sessions/${s.id}/attendance`,
          ageDays: age,
          overdue: age >= OVERDUE_AFTER_DAYS,
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
        queue.push({
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
        where: { status: "REQUESTED" },
        select: { createdAt: true, currency: true, amountMinor: true, orderId: true, order: { select: { reference: true } } },
        orderBy: { createdAt: "asc" },
        take: 5,
      });
      for (const r of refunds) {
        const age = ageDaysOf(r.createdAt, now);
        queue.push({
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
        where: { status: "EXCEPTION" },
        select: { updatedAt: true },
        orderBy: { updatedAt: "asc" },
      });
      if (exceptions.length > 0) {
        const age = ageDaysOf(exceptions[0].updatedAt, now);
        queue.push({
          key: "payments:exception",
          kind: "payment",
          title: "Payments needing review",
          detail: `${exceptions.length} ${exceptions.length === 1 ? "order" : "orders"} in an exception state`,
          href: "/staff/payments",
          ageDays: age,
          overdue: age >= OVERDUE_AFTER_DAYS,
        });
      }
    }

    queue.sort((a, b) => b.ageDays - a.ageDays);
  }

  // ---- enrolments per week ----
  let weekly: StaffOverview["weekly"] = null;
  if (canEnrolments) {
    const thisWeek = weekStartOf(now);
    const first = new Date(thisWeek.getTime() - 11 * 7 * DAY_MS);
    const rows = await prisma.enrolment.findMany({
      where: { status: { in: ["ACTIVE", "COMPLETED"] }, createdAt: { gte: first } },
      select: { createdAt: true },
    });
    weekly = Array.from({ length: 12 }, (_, i) => ({ weekStart: new Date(first.getTime() + i * 7 * DAY_MS), count: 0 }));
    for (const r of rows) {
      const idx = Math.floor((weekStartOf(r.createdAt).getTime() - first.getTime()) / (7 * DAY_MS));
      if (idx >= 0 && idx < 12) weekly[idx].count += 1;
    }
  }

  // ---- next sessions and filling cohorts ----
  let nextSessions: StaffOverview["nextSessions"] = null;
  let filling: StaffOverview["filling"] = null;
  if (canCohorts) {
    const sessions = await prisma.scheduledSession.findMany({
      where: { cancelledAt: null, startsAt: { gte: now, lte: new Date(now.getTime() + 7 * DAY_MS) } },
      select: {
        id: true,
        title: true,
        startsAt: true,
        location: true,
        meetingUrl: true,
        cohortId: true,
        cohort: { select: { code: true, timezone: true } },
      },
      orderBy: { startsAt: "asc" },
      take: 6,
    });
    nextSessions = sessions.map((s) => ({
      id: s.id,
      cohortId: s.cohortId,
      cohortCode: s.cohort.code,
      title: s.title,
      startsAt: s.startsAt,
      timezone: s.cohort.timezone,
      location: s.location,
      virtual: !!s.meetingUrl && !s.location,
    }));

    const open = await prisma.cohort.findMany({
      where: { status: "PUBLISHED", enrolmentClosesAt: { gt: now } },
      select: { id: true, code: true, title: true, startsAt: true, timezone: true, capacity: true },
    });
    const taken = open.length
      ? await prisma.enrolment.groupBy({
          by: ["cohortId"],
          where: { cohortId: { in: open.map((c) => c.id) }, status: { in: ["ACTIVE", "COMPLETED"] } },
          _count: { _all: true },
        })
      : [];
    const takenBy = new Map(taken.map((t) => [t.cohortId, t._count._all]));
    filling = open
      .map((c) => ({
        cohortId: c.id,
        code: c.code,
        title: c.title,
        startsAt: c.startsAt,
        timezone: c.timezone,
        taken: takenBy.get(c.id) ?? 0,
        capacity: c.capacity,
      }))
      .filter((c) => c.capacity > 0)
      .sort((a, b) => b.taken / b.capacity - a.taken / a.capacity)
      .slice(0, 3);
  }

  return {
    now,
    figures: { learnersInDelivery, enrolments, revenue, attendance },
    queue,
    weekly,
    nextSessions,
    filling,
  };
}
