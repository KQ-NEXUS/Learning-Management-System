import { notFound } from "next/navigation";
import {
  AuthenticationError,
  AuthorizationError,
  can,
} from "@/server/permissions";
import {
  cohortService,
  loadCohortReadinessAggregate,
  loadCohortInstructors,
} from "@/server/services/cohort-service";
import { evaluateCohortReadiness } from "@/server/services/readiness-service";
import { listSessionsForCohort } from "@/server/services/scheduled-session-service";
import {
  loadCohortRoster,
  loadAttendanceExceptions,
  type ExceptionCategory,
} from "@/server/services/roster-service";
import { courseService } from "@/server/services/course-service";
import { programmeService } from "@/server/services/programme-service";
import { utcToWallParts } from "@/lib/timezone";
import { cohortResourceScope } from "@/server/services/cohort-scope";
import { DetailLayout, DetailFacts, StatusPill } from "@/components/primitives";
import { ReadinessPanel } from "@/components/catalogue/ReadinessPanel";
import { CohortDetailActions } from "@/components/catalogue/CohortDetailActions";
import { SessionsTab, type SessionRow } from "./SessionsTab";
import { RosterTab, type RosterRowView } from "./RosterTab";
import { ExceptionsTab, type AttendanceExceptionView } from "./ExceptionsTab";
import { InstructorsPanel, type InstructorRow } from "./InstructorsPanel";
import { GradingTab } from "./GradingTab";

export const metadata = { title: "Cohort" };

const STATUS_TONE: Record<
  string,
  "success" | "neutral" | "warning" | "danger"
> = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  IN_PROGRESS: "success",
  COMPLETED: "neutral",
  CANCELLED: "danger",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const DELIVERY_LABEL: Record<string, string> = {
  SELF_PACED: "Self-paced",
  INSTRUCTOR_LED: "Instructor-led",
  BLENDED: "Blended",
};

type TitleRow = { id: string; title: string };

/** D-23: every date shown with its explicit zone label, in mono — `utcToWallParts` already bakes the `(timezone)` suffix into `label`. */
/** "12 Sep 2026, 10:00" in the cohort's own timezone (the zone is shown once, after a range). */
function zoned(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: timezone,
    }).format(date);
  } catch {
    return utcToWallParts(date, timezone).label;
  }
}

function formatPrice(priceMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(currency === "NGN" ? "en-NG" : "en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(priceMinor / 100);
  } catch {
    return `${priceMinor} minor units ${currency}`;
  }
}

function toIso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

export default async function CohortDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ categories?: string; search?: string; tab?: string }>;
}) {
  const { id: cohortId } = await params;
  const sp = await searchParams;
  const categories = sp.categories
    ? (sp.categories.split(",").filter(Boolean) as ExceptionCategory[])
    : undefined;
  const search = sp.search?.trim() ? sp.search.trim() : undefined;

  // The core load — a denial here must be indistinguishable from a missing
  // cohort (RBAC-06, matching `courses/[id]/page.tsx:52-56`).
  let cohort: Awaited<ReturnType<typeof cohortService.get>>;
  let readinessAggregate: Awaited<
    ReturnType<typeof loadCohortReadinessAggregate>
  >;
  try {
    cohort = await cohortService.get(cohortId);
    if (!cohort) notFound();
    readinessAggregate = await loadCohortReadinessAggregate(cohortId);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return (
        <p className="text-sm text-foreground">
          Your session has ended. Sign in again.
        </p>
      );
    }
    if (error instanceof AuthorizationError) {
      notFound();
    }
    throw error;
  }
  if (!readinessAggregate) notFound();

  // D-27: the page runs the one shared evaluator; the panel only draws its
  // output, so the panel and the server-side publish refusal agree by
  // construction (T-05-103).
  const readinessItems = evaluateCohortReadiness(readinessAggregate);

  // T-05-105: each tab's data is loaded independently so a caller lacking
  // one permission (e.g. `attendance.view` without `cohorts.view`) loses
  // only that section, not the whole record.
  let sessions: SessionRow[] | undefined;
  let sessionsErrorMessage: string | null = null;
  try {
    const rows = await listSessionsForCohort(cohortId);
    sessions = rows.map((r) => ({
      id: r.id,
      cohortId: r.cohortId,
      courseId: r.courseId,
      title: r.title,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      startsAtLabel: r.startsAtLabel,
      endsAtLabel: r.endsAtLabel,
      location: r.location,
      facilitatorId: r.facilitatorId,
      attendanceExpected: r.attendanceExpected,
      cancelledAt: toIso(r.cancelledAt),
      cancellationReason: r.cancellationReason,
      timezone: r.timezone,
      hasMeetingLink: r.hasMeetingLink,
    }));
  } catch (error) {
    if (
      error instanceof AuthorizationError ||
      error instanceof AuthenticationError
    ) {
      sessionsErrorMessage =
        "You do not have access to this cohort's sessions.";
    } else {
      throw error;
    }
  }

  let rosterRows: RosterRowView[] | undefined;
  let rosterErrorMessage: string | null = null;
  try {
    const rows = await loadCohortRoster({ cohortId });
    rosterRows = rows.map((r) => ({
      learnerId: r.learnerId,
      learnerName: r.learnerName,
      learnerEmail: r.learnerEmail,
      enrolmentId: r.enrolmentId,
      status: r.status,
      transitionCount: r.transitionCount,
      latestTransition: r.latestTransition
        ? {
            action: r.latestTransition.action,
            reason: r.latestTransition.reason,
            actorName: r.latestTransition.actorName,
            at: r.latestTransition.at.toISOString(),
          }
        : null,
      accessStartsAt: toIso(r.accessStartsAt),
      accessEndsAt: toIso(r.accessEndsAt),
      instructors: r.instructors,
      attendance: r.attendance,
      progress: r.progress,
      assessment: r.assessment,
      completion: r.completion,
    }));
  } catch (error) {
    if (
      error instanceof AuthorizationError ||
      error instanceof AuthenticationError
    ) {
      rosterErrorMessage = "You do not have access to this cohort's roster.";
    } else {
      throw error;
    }
  }

  let exceptionRows: AttendanceExceptionView[] | undefined;
  let exceptionsErrorMessage: string | null = null;
  try {
    const rows = await loadAttendanceExceptions({
      cohortId,
      categories,
      search,
    });
    exceptionRows = rows.map((r): AttendanceExceptionView => {
      if (r.category === "missing-register") {
        return {
          category: "missing-register",
          sessionId: r.sessionId,
          sessionTitle: r.sessionTitle,
          sessionStartsAt: r.sessionStartsAt.toISOString(),
          markingClosesAt: r.markingClosesAt.toISOString(),
          unmarkedLearnerCount: r.unmarkedLearnerCount,
        };
      }
      if (r.category === "at-risk") {
        return {
          category: "at-risk",
          enrolmentId: r.enrolmentId,
          learnerName: r.learnerName,
          earnedPct: r.earnedPct,
          requiredPct: r.requiredPct,
        };
      }
      return {
        category: "disputed",
        enrolmentId: r.enrolmentId,
        learnerName: r.learnerName,
        sessionId: r.sessionId,
        sessionTitle: r.sessionTitle,
        correctionReason: r.correctionReason,
        correctedByName: r.correctedByName,
        correctedAt: toIso(r.correctedAt),
      };
    });
  } catch (error) {
    if (
      error instanceof AuthorizationError ||
      error instanceof AuthenticationError
    ) {
      exceptionsErrorMessage =
        "You do not have access to this cohort's attendance exceptions.";
    } else {
      throw error;
    }
  }

  const activeEnrolmentCount =
    rosterRows?.filter((r) => r.status === "ACTIVE").length ?? 0;

  const offerId = cohort.courseId ?? cohort.programmeId;
  const offerKind: "Course" | "Programme" = cohort.courseId
    ? "Course"
    : "Programme";
  const offerTitle = offerId
    ? await (cohort.courseId ? courseService : programmeService)
        .get(offerId)
        .then((row) => (row as unknown as TitleRow | null)?.title ?? "—")
        .catch(() => "—")
    : "—";

  const resource = await cohortResourceScope(cohortId);
  const [canPublish, canManage, canManageEnrolments] = await Promise.all([
    can("cohorts.publish", resource),
    can("cohorts.manage", resource),
    can("enrolments.manage", resource),
  ]);

  let instructorRows: InstructorRow[] = [];
  try {
    const rows = await loadCohortInstructors({ cohortId });
    instructorRows = rows.map((r) => ({
      id: r.id,
      userId: r.user.id,
      userName: r.user.name,
      userEmail: r.user.email,
    }));
  } catch (error) {
    if (!(
      error instanceof AuthorizationError ||
      error instanceof AuthenticationError
    )) {
      throw error;
    }
  }

  return (
    <DetailLayout
      mode="tabbed"
      initialSectionId={sp.tab}
      breadcrumbs={[
        { label: "Workspace", href: "/staff/cohorts" },
        { label: "Cohorts", href: "/staff/cohorts" },
        { label: cohort.title },
      ]}
      title={cohort.title}
      identifier={cohort.code}
      actions={
        <CohortDetailActions
          cohortId={cohortId}
          code={cohort.code}
          status={cohort.status}
          expectedUpdatedAt={cohort.updatedAt.toISOString()}
          readinessItems={readinessItems}
          activeEnrolmentCount={activeEnrolmentCount}
          canPublish={canPublish}
          canManage={canManage}
        />
      }
      badges={
        <>
          <StatusPill
            label={STATUS_LABEL[cohort.status] ?? cohort.status}
            tone={STATUS_TONE[cohort.status] ?? "neutral"}
          />
          <StatusPill
            label={DELIVERY_LABEL[cohort.deliveryMode] ?? cohort.deliveryMode}
          />
        </>
      }
      sections={[
        {
          id: "overview",
          label: "Overview",
          content: (
            <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_380px]">
              <section aria-label="Cohort details" className="min-w-0 lg:pr-14">
                <h2 className="pb-4 text-[22px] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground">
                  Cohort details
                </h2>
                <div className="border-t border-foreground">
                  <DetailFacts
                    facts={[
                      // A viewer without access to the offer's own list sees the kind only, not a dash.
                      {
                        label: "Offer",
                        value:
                          offerTitle === "—"
                            ? offerKind
                            : `${offerKind}: ${offerTitle}`,
                      },
                      {
                        label: "Enrolment window",
                        value: `${zoned(cohort.enrolmentOpensAt, cohort.timezone)} to ${zoned(cohort.enrolmentClosesAt, cohort.timezone)} (${cohort.timezone})`,
                        mono: true,
                      },
                      {
                        label: "Dates",
                        value: `${zoned(cohort.startsAt, cohort.timezone)} to ${zoned(cohort.endsAt, cohort.timezone)} (${cohort.timezone})`,
                        mono: true,
                      },
                      {
                        label: "Seats",
                        value: (
                          <span className="flex items-center gap-4 font-sans tabular-nums">
                            <span>
                              {cohort.seatsTaken} of {cohort.capacity} taken
                            </span>
                            <span
                              aria-hidden
                              className="h-1 w-36 overflow-hidden rounded-full bg-accent-wash"
                            >
                              <span
                                className="block h-full rounded-full bg-progress-fill"
                                style={{
                                  width: `${Math.min(100, Math.round((cohort.seatsTaken / Math.max(cohort.capacity, 1)) * 100))}%`,
                                }}
                              />
                            </span>
                          </span>
                        ),
                      },
                      {
                        label: "NGN price",
                        value:
                          cohort.priceNgnMinor != null
                            ? formatPrice(cohort.priceNgnMinor, "NGN")
                            : "Not set",
                        mono: true,
                      },
                      {
                        label: "USD price",
                        value:
                          cohort.priceUsdMinor != null
                            ? formatPrice(cohort.priceUsdMinor, "USD")
                            : "Not set",
                        mono: true,
                      },
                      {
                        label: "Delivery mode",
                        value:
                          DELIVERY_LABEL[cohort.deliveryMode] ??
                          cohort.deliveryMode,
                      },
                      {
                        label: "Seat-hold minutes",
                        value:
                          cohort.holdMinutes && cohort.holdMinutes > 0
                            ? `${cohort.holdMinutes} min`
                            : "No hold — seat taken only on activation",
                        mono: true,
                      },
                      {
                        label: "Attendance threshold",
                        value:
                          cohort.attendanceThresholdPct != null
                            ? `${cohort.attendanceThresholdPct}%`
                            : "Not set",
                        mono: true,
                      },
                    ]}
                  />
                </div>
              </section>
              <div className="flex flex-col gap-12 lg:border-l lg:border-border lg:pl-10">
                <InstructorsPanel
                  cohortId={cohortId}
                  instructors={instructorRows}
                  canManage={canManage}
                />
                <ReadinessPanel items={readinessItems} />
              </div>
            </div>
          ),
        },
        {
          id: "sessions",
          label: "Sessions",
          badge: sessions?.length,
          content: (
            <SessionsTab
              facilitatorNames={Object.fromEntries(instructorRows.map((row) => [row.userId, row.userName]))}
              cohortId={cohortId}
              cohortTimezone={cohort.timezone}
              sessions={sessions}
              canManage={canManage}
            />
          ),
          error: sessionsErrorMessage
            ? { message: sessionsErrorMessage }
            : undefined,
        },
        {
          id: "roster",
          label: "Roster",
          badge: rosterRows?.length,
          content: (
            <RosterTab
              cohortId={cohortId}
              rows={rosterRows}
              canManage={canManageEnrolments}
            />
          ),
          error: rosterErrorMessage
            ? { message: rosterErrorMessage }
            : undefined,
        },
        {
          id: "exceptions",
          label: "Exceptions",
          badge: exceptionRows?.length,
          content: (
            <ExceptionsTab
              cohortId={cohortId}
              rows={exceptionRows}
              categories={categories}
              search={search}
            />
          ),
          error: exceptionsErrorMessage
            ? { message: exceptionsErrorMessage }
            : undefined,
        },
        {
          id: "grading",
          label: "Grading",
          content: <GradingTab cohortId={cohortId} />,
        },
      ]}
    />
  );
}
