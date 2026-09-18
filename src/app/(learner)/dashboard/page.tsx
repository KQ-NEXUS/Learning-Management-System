import Link from "next/link";
import { redirect } from "next/navigation";
import { MapPin, Video } from "lucide-react";
import { getCurrentActor } from "@/server/auth/current-actor";
import { loadLearnerDashboard } from "@/server/services/enrolment-dashboard-service";
import type {
  LearnerDashboardCard,
  UpcomingSessionCard,
} from "@/server/services/enrolment-dashboard-service";
import { ProgressMeter } from "@/components/learner/ProgressMeter";
import { DeferredSlot } from "@/components/learner/DeferredSlot";
import { CertificateSlot } from "@/components/learner/CertificateSlot";
import { NextUpCard } from "@/components/learner/NextUpCard";
import { utcToWallParts } from "@/lib/timezone";

/**
 * `/dashboard` (LRN-01, 09-08 Task 3) — the entry point every other learner
 * surface links from.
 *
 * T-09-01 / DD-20: re-resolves `getCurrentActor()` itself rather than
 * trusting the `(learner)/layout.tsx` guard (convenience only) and calls
 * `loadLearnerDashboard(actor)`, which accepts no id parameter — there is no
 * value here for a caller to tamper with.
 */

const ACCESS_ENDING_WARNING =
  "flex flex-col gap-1 rounded-lg bg-warning-surface px-4 py-3 text-sm text-warning";

function formatCohortDate(date: Date, timezone: string): string {
  const p = utcToWallParts(date, timezone);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

function MutedLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <span aria-hidden className="font-mono">
        •
      </span>
      {children}
    </p>
  );
}

function ProgressSection({ card }: { card: LearnerDashboardCard }) {
  const { progress } = card;

  if (progress.structure === "unpinned") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-6 shadow-xs">
        <h3 className="text-[16px] font-semibold text-foreground">Your progress</h3>
        <MutedLine>Course progress isn&apos;t available for this enrolment yet.</MutedLine>
      </div>
    );
  }

  const { requiredLessonsComplete, requiredLessonsTotal, attendance } = progress;
  const completionPct =
    requiredLessonsTotal > 0
      ? Math.round((requiredLessonsComplete / requiredLessonsTotal) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-xs">
      <h3 className="text-[16px] font-semibold text-foreground">Your progress</h3>
      <ProgressMeter
        label="Required lessons complete"
        valuePct={completionPct}
        captionText={`${requiredLessonsComplete} of ${requiredLessonsTotal} required lessons complete`}
      />
      {attendance.kind === "computed" && (
        <ProgressMeter
          label="Attendance"
          valuePct={attendance.earnedPct}
          captionText={`Attendance: ${attendance.earnedPct}% of ${attendance.requiredPct}% required`}
        />
      )}
      {attendance.kind === "no-sessions" && <MutedLine>No countable sessions yet</MutedLine>}
    </div>
  );
}

function sessionModeIcon(mode: UpcomingSessionCard["mode"]) {
  if (mode === "in-person") return <MapPin aria-hidden className="size-4 shrink-0 text-muted-foreground" />;
  if (mode === "virtual") return <Video aria-hidden className="size-4 shrink-0 text-muted-foreground" />;
  return null;
}

function UpcomingSessionsSection({ card }: { card: LearnerDashboardCard }) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-xs">
      <div className="flex items-center justify-between">
        <h3 className="text-[16px] font-semibold text-foreground">Upcoming sessions</h3>
        {card.hasMoreSessions && (
          <Link
            href={`/learn/${card.enrolmentId}/sessions`}
            className="text-sm font-semibold text-accent underline underline-offset-2"
          >
            View all
          </Link>
        )}
      </div>

      {card.upcomingSessions.length === 0 ? (
        <MutedLine>No sessions are scheduled yet</MutedLine>
      ) : (
        <ul className="flex flex-col gap-3">
          {card.upcomingSessions.map((session) => (
            <li key={session.id} className="flex items-start gap-2">
              {sessionModeIcon(session.mode)}
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold text-foreground">{session.title}</p>
                <p className="text-sm text-muted-foreground">
                  {utcToWallParts(session.startsAt, card.timezone).label}
                  {session.mode === "in-person" && session.location ? ` — ${session.location}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AccessNoticeBanner({ card }: { card: LearnerDashboardCard }) {
  if (card.accessNotice.kind === "ending") {
    return (
      <div className={ACCESS_ENDING_WARNING}>
        Your access ends {formatCohortDate(card.accessNotice.endsAt, card.timezone)}
      </div>
    );
  }
  if (card.accessNotice.kind === "ended") {
    return (
      <div className="flex flex-col gap-1 rounded-lg bg-warning-surface px-4 py-3 text-sm text-warning">
        <p className="font-semibold">Your access window has ended</p>
        <p>You can no longer open lesson content, but your progress and results stay on record.</p>
      </div>
    );
  }
  return null;
}

/**
 * 10-15 — Phase 9's "Assessments" and "Results" named gaps, widened. Each
 * renders one of three states: still `deferred` (identical `DeferredSlot`
 * treatment Phase 9 shipped, unchanged), `tracked`-but-empty, or
 * `tracked`-and-populated. `tickets` stays a pure `DeferredSlot` below —
 * Phase 12's own gap to close. `certificate` is now filled by
 * `CertificateSlot` (plan 11-13) — Phase 9's own named gap, closed.
 */
function AssessmentsCard({ card }: { card: LearnerDashboardCard }) {
  const col = card.assessmentObligations;

  if (col.kind === "deferred") {
    return <DeferredSlot title="Assessments" copy="Assignments and quizzes — arriving in a future update" />;
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3 shadow-xs">
      <p className="text-sm font-semibold text-foreground">Assessments</p>
      {col.items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Nothing due right now</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {col.items.map((item) => (
            <li key={item.assessmentId} className="text-[11px] text-muted-foreground">
              {item.lessonId ? (
                <Link
                  href={`/learn/${card.enrolmentId}/lessons/${item.lessonId}`}
                  className="text-accent underline underline-offset-2"
                >
                  {item.title}
                </Link>
              ) : (
                item.title
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultsCard({ card }: { card: LearnerDashboardCard }) {
  const col = card.results;

  if (col.kind === "deferred") {
    return <DeferredSlot title="Results" copy="Results — arriving in a future update" />;
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3 shadow-xs">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">Results</p>
        {col.recent.length > 0 && (
          <Link
            href={`/learn/${card.enrolmentId}/results`}
            className="text-[11px] font-semibold text-accent underline underline-offset-2"
          >
            View all
          </Link>
        )}
      </div>
      {col.recent.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No results yet</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {col.recent.map((result) => (
            <li key={result.assessmentId} className="text-[11px] text-muted-foreground">
              {result.title}
              {result.effectiveScore !== null && result.maxScore !== null
                ? ` — ${result.effectiveScore} / ${result.maxScore}`
                : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EnrolmentSection({ card }: { card: LearnerDashboardCard }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {card.cohortTitle}
      </h2>

      <AccessNoticeBanner card={card} />

      <NextUpCard action={card.nextAction} enrolmentId={card.enrolmentId} timezone={card.timezone} />

      <div className="grid gap-6 md:grid-cols-2">
        <ProgressSection card={card} />
        <UpcomingSessionsSection card={card} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <AssessmentsCard card={card} />
        <ResultsCard card={card} />
        <DeferredSlot title="Support tickets" copy="Support tickets — arriving in a future update" />
        <CertificateSlot certificate={card.certificate} />
      </div>
    </section>
  );
}

export default async function DashboardPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  const dashboard = await loadLearnerDashboard(actor);

  return (
    <div className="flex flex-col gap-10">
      <h1 className="text-[25px] font-semibold leading-[1.2] text-foreground">Your dashboard</h1>

      {dashboard.cards.length === 0 ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-8 text-center shadow-xs">
          <p className="text-[16px] font-semibold text-foreground">Nothing to pick up right now</p>
          <p className="text-sm text-muted-foreground">
            Check back once your instructor schedules the next session, or explore what&apos;s next
            in your course.
          </p>
          <Link
            href="/courses"
            className="mx-auto w-fit rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:opacity-90"
          >
            Browse the catalogue
          </Link>
        </div>
      ) : (
        dashboard.cards.map((card) => <EnrolmentSection key={card.enrolmentId} card={card} />)
      )}
    </div>
  );
}
