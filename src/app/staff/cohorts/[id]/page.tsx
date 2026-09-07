import { notFound } from "next/navigation";
import { AuthenticationError, AuthorizationError, can } from "@/server/permissions";
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

export const metadata = { title: "Cohort" };

const STATUS_TONE: Record<string, "success" | "neutral" | "warning" | "danger"> = {
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
function zoned(date: Date, timezone: string): string {
  return utcToWallParts(date, timezone).label;
}

function formatPrice(priceMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(priceMinor / 100);
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
  searchParams: Promise<{ categories?: string; search?: string }>;
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
  let readinessAggregate: Awaited<ReturnType<typeof loadCohortReadinessAggregate>>;
  try {
    cohort = await cohortService.get(cohortId);
    if (!cohort) notFound();
    readinessAggregate = await loadCohortReadinessAggregate(cohortId);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <p className="text-sm text-foreground">Your session has ended. Sign in again.</p>;
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
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      sessionsErrorMessage = "You do not have access to this cohort's sessions.";
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
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      rosterErrorMessage = "You do not have access to this cohort's roster.";
    } else {
      throw error;
    }
  }

  let exceptionRows: AttendanceExceptionView[] | undefined;
  let exceptionsErrorMessage: string | null = null;
  try {
    const rows = await loadAttendanceExceptions({ cohortId, categories, search });
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
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      exceptionsErrorMessage = "You do not have access to this cohort's attendance exceptions.";
    } else {
      throw error;
    }
  }

  const activeEnrolmentCount = rosterRows?.filter((r) => r.status === "ACTIVE").length ?? 0;

  const offerId = cohort.courseId ?? cohort.programmeId;
  const offerKind: "Course" | "Programme" = cohort.courseId ? "Course" : "Programme";
  const offerTitle = offerId
    ? await (cohort.courseId ? courseService : programmeService)
        .get(offerId)
        .then((row) => (row as unknown as TitleRow | null)?.title ?? "—")
        .catch(() => "—")
    : "—";

  const resource = await cohortResourceScope(cohortId);
  const [canPublish, canManage] = await Promise.all([
    can("cohorts.publish", resource),
    can("cohorts.manage", resource),
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
    if (!(error instanceof AuthorizationError || error instanceof AuthenticationError)) {
      throw error;
    }
  }

  return (
    <DetailLayout
      mode="tabbed"
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
          <StatusPill label={STATUS_LABEL[cohort.status] ?? cohort.status} tone={STATUS_TONE[cohort.status] ?? "neutral"} />
          <StatusPill label={DELIVERY_LABEL[cohort.deliveryMode] ?? cohort.deliveryMode} />
        </>
      }
      sections={[
        {
          id: "overview",
          label: "Overview",
          content: (
            <div className="flex flex-col gap-4">
              <DetailFacts
                facts={[
                  { label: "Offer", value: `${offerKind}: ${offerTitle}` },
                  {
                    label: "Enrolment window",
                    value: `${zoned(cohort.enrolmentOpensAt, cohort.timezone)} → ${zoned(cohort.enrolmentClosesAt, cohort.timezone)}`,
                    mono: true,
                  },
                  {
                    label: "Dates",
                    value: `${zoned(cohort.startsAt, cohort.timezone)} → ${zoned(cohort.endsAt, cohort.timezone)}`,
                    mono: true,
                  },
                  {
                    label: "Seats",
                    value: `${cohort.seatsTaken} / ${cohort.capacity}`,
                    mono: true,
                  },
                  { label: "Price", value: formatPrice(cohort.priceMinor, cohort.currency), mono: true },
                  { label: "Delivery mode", value: DELIVERY_LABEL[cohort.deliveryMode] ?? cohort.deliveryMode },
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
                      cohort.attendanceThresholdPct != null ? `${cohort.attendanceThresholdPct}%` : "Not set",
                    mono: true,
                  },
                ]}
              />
              <ReadinessPanel items={readinessItems} />
              <InstructorsPanel
                cohortId={cohortId}
                instructors={instructorRows}
                canManage={canManage}
              />
            </div>
          ),
        },
        {
          id: "sessions",
          label: "Sessions",
          badge: sessions?.length,
          content: <SessionsTab cohortId={cohortId} cohortTimezone={cohort.timezone} sessions={sessions} />,
          error: sessionsErrorMessage ? { message: sessionsErrorMessage } : undefined,
        },
        {
          id: "roster",
          label: "Roster",
          badge: rosterRows?.length,
          content: <RosterTab cohortId={cohortId} rows={rosterRows} />,
          error: rosterErrorMessage ? { message: rosterErrorMessage } : undefined,
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
          error: exceptionsErrorMessage ? { message: exceptionsErrorMessage } : undefined,
        },
      ]}
    />
  );
}
