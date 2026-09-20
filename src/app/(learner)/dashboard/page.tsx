import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { ArrowRight, MapPin, Video } from "lucide-react";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";
import { getCurrentActor } from "@/server/auth/current-actor";
import { profileService } from "@/server/services/profile-service";
import { loadLearnerDashboard } from "@/server/services/enrolment-dashboard-service";
import type {
  LearnerDashboardCard,
  UpcomingSessionCard,
} from "@/server/services/enrolment-dashboard-service";
import { EnrolmentRow } from "@/components/learner/EnrolmentRow";
import { ProgressMeter } from "@/components/learner/ProgressMeter";
import { DeferredSlot } from "@/components/learner/DeferredSlot";
import { CertificateSlot } from "@/components/learner/CertificateSlot";
import { utcToWallParts } from "@/lib/timezone";

/**
 * `/dashboard` (LRN-01, 09-08 Task 3) — the entry point every other learner
 * surface links from.
 *
 * Drawn as the mockup's dashboard: a greeting in the navy band, then a "Continue where you left
 * off" block for the learner's main enrolment (progress, next lesson, and a side rail with the
 * next session, assessment due and attendance), then a second row with their other courses and
 * results on the left and upcoming sessions and certificates on the right.
 *
 * T-09-01 / DD-20: re-resolves `getCurrentActor()` itself rather than
 * trusting the `(learner)/layout.tsx` guard (convenience only) and calls
 * `loadLearnerDashboard(actor)`, which accepts no id parameter — there is no
 * value here for a caller to tamper with.
 */

const ACCESS_ENDING_WARNING =
  "flex flex-col gap-1 border-l-2 border-warning py-1 pl-4 text-sm text-warning";

function formatCohortDate(date: Date, timezone: string): string {
  const p = utcToWallParts(date, timezone);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** "Mon 21 Sep, 09:00" in the cohort's own timezone. */
function whenLabel(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: timezone,
    }).format(new Date(date));
  } catch {
    return utcToWallParts(date, timezone).label;
  }
}

/** "Good morning" / "afternoon" / "evening" by the wall-clock hour in the learner's zone. */
function greetingFor(now: Date, timezone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: timezone }).format(now),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function MutedLine({ children }: { children: ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <span aria-hidden className="font-mono">
        •
      </span>
      {children}
    </p>
  );
}

/** A titled block: 22px heading over an ink rule, with an optional aside on the right of the heading. */
function Section({
  title,
  aside,
  label,
  children,
}: {
  title: string;
  aside?: ReactNode;
  label?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={label ?? title}>
      <div className="flex items-baseline justify-between gap-4 pb-4">
        <h2 className="text-[22px] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground">{title}</h2>
        {aside}
      </div>
      <div className="border-t border-foreground">{children}</div>
    </section>
  );
}

/** One line of the side rail: small label, a semibold value and an optional muted sub-line. */
function RailItem({
  label,
  value,
  sub,
  last,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`py-5 ${last ? "" : "border-b border-border"}`}>
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-semibold text-foreground">{value}</div>
      {sub && <div className="text-sm text-muted-foreground">{sub}</div>}
    </div>
  );
}

function ProgressBlock({ card }: { card: LearnerDashboardCard }) {
  const { progress } = card;

  if (progress.structure === "unpinned") {
    return (
      <>
        <h3 className="sr-only">Your progress</h3>
        <MutedLine>Course progress isn&apos;t available for this enrolment yet.</MutedLine>
      </>
    );
  }

  const { requiredLessonsComplete, requiredLessonsTotal } = progress;
  const completionPct =
    requiredLessonsTotal > 0 ? Math.round((requiredLessonsComplete / requiredLessonsTotal) * 100) : 0;

  return (
    <div>
      <h3 className="sr-only">Your progress</h3>
      <ProgressMeter
        label="Required lessons complete"
        valuePct={completionPct}
        captionText={`${requiredLessonsComplete} of ${requiredLessonsTotal} required lessons complete`}
      />
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
      <div className="flex flex-col gap-1 border-l-2 border-warning py-1 pl-4 text-sm text-warning">
        <p className="font-semibold">Your access window has ended</p>
        <p>You can no longer open lesson content, but your progress and results stay on record.</p>
      </div>
    );
  }
  return null;
}

/** The "next lesson / next up" row at the foot of the hero block. */
function NextUpBlock({ card }: { card: LearnerDashboardCard }) {
  const action = card.nextAction;

  if (action.kind === "lesson") {
    const started = card.progress.structure !== "unpinned" && card.progress.requiredLessonsComplete > 0;
    return (
      <div className="flex flex-col gap-4 pt-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h3 className="text-[13px] font-normal text-muted-foreground">Next lesson</h3>
          <p className="text-base font-semibold text-foreground">{action.lessonTitle}</p>
          <p className="text-sm text-muted-foreground">in {action.moduleTitle}</p>
        </div>
        <Link
          href={`/learn/${card.enrolmentId}/lessons/${action.lessonId}`}
          className="inline-flex min-h-[46px] w-fit shrink-0 items-center justify-center gap-2 rounded-md bg-accent px-5 text-sm font-semibold text-accent-contrast hover:bg-accent-deep"
        >
          {started ? "Resume lesson" : "Start lesson"}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 pt-2">
      <h3 className="text-[13px] font-normal text-muted-foreground">Next up</h3>
      {action.kind === "session" && (
        <p className="text-base font-semibold text-foreground">
          {action.title} — {whenLabel(action.startsAt, card.timezone)}
        </p>
      )}
      {action.kind === "complete" && (
        <p className="text-sm text-foreground">
          You&apos;ve completed everything required here. Your certificate, if this course issues one,
          is shown in the Certificate section below.
        </p>
      )}
      {action.kind === "none" && (
        <>
          <p className="text-base font-semibold text-foreground">Nothing to pick up right now</p>
          <p className="text-sm text-muted-foreground">
            Check back once your instructor schedules the next session, or explore what&apos;s next in
            your course.
          </p>
        </>
      )}
    </div>
  );
}

function sessionIcon(mode: UpcomingSessionCard["mode"]) {
  if (mode === "virtual") return <Video aria-hidden className="size-[18px] shrink-0 text-accent" />;
  return <MapPin aria-hidden className="size-[18px] shrink-0 text-accent" />;
}

/** The hero: the learner's main enrolment. */
function HeroSection({ card }: { card: LearnerDashboardCard }) {
  const completed = card.enrolmentStatus === "COMPLETED";
  const { progress } = card;
  const nextSession = card.upcomingSessions[0];
  const obligations = card.assessmentObligations;
  const firstDue = obligations.kind === "tracked" ? obligations.items[0] : undefined;

  return (
    <section aria-label="Your current course" className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-6 lg:pr-12">
        <p className="text-sm text-muted-foreground">
          {completed ? "Course complete" : "Continue where you left off"}
        </p>
        <h2 className="text-[36px] leading-[1.1] font-semibold tracking-[-0.03em] text-foreground">
          {card.cohortTitle}
        </h2>
        {!completed && <AccessNoticeBanner card={card} />}
        <ProgressBlock card={card} />
        <NextUpBlock card={card} />
      </div>

      {!completed && (
        <div className="lg:border-l lg:border-border lg:pl-10">
          {nextSession && (
            <RailItem
              label="Next session"
              value={whenLabel(nextSession.startsAt, card.timezone)}
              sub={[nextSession.title, nextSession.mode === "in-person" ? nextSession.location : null]
                .filter(Boolean)
                .join(" · ")}
            />
          )}
          {obligations.kind === "deferred" ? (
            <DeferredSlot title="Assessments" copy="Assignments and quizzes — arriving in a future update" />
          ) : (
            <RailItem
              label="Assessment due"
              value={
                firstDue ? (
                  firstDue.lessonId ? (
                    <Link
                      href={`/learn/${card.enrolmentId}/lessons/${firstDue.lessonId}`}
                      className="text-accent hover:underline"
                    >
                      {firstDue.title}
                    </Link>
                  ) : (
                    firstDue.title
                  )
                ) : (
                  "Nothing due right now"
                )
              }
              sub={
                firstDue?.dueAt
                  ? `Due ${whenLabel(new Date(firstDue.dueAt), card.timezone)}`
                  : undefined
              }
            />
          )}
          {progress.structure !== "unpinned" && progress.attendance.kind === "computed" && (
            <RailItem
              label="Attendance"
              value={`${progress.attendance.earnedPct}% of ${progress.attendance.requiredPct}% required`}
              last
            />
          )}
          {progress.structure !== "unpinned" && progress.attendance.kind === "no-sessions" && (
            <RailItem label="Attendance" value="No countable sessions yet" last />
          )}
        </div>
      )}
    </section>
  );
}

function ResultsSection({ card }: { card: LearnerDashboardCard }) {
  const col = card.results;

  if (col.kind === "deferred") {
    return <DeferredSlot title="Results" copy="Results — arriving in a future update" />;
  }

  return (
    <Section
      title="Results"
      aside={
        col.recent.length > 0 ? (
          <Link
            href={`/learn/${card.enrolmentId}/results`}
            className="text-sm font-semibold text-accent hover:underline"
          >
            View all
          </Link>
        ) : undefined
      }
    >
      {col.recent.length === 0 ? (
        <p className="pt-4 text-sm text-muted-foreground">No results yet</p>
      ) : (
        <ul>
          {col.recent.map((result) => {
            const hasScore = result.effectiveScore !== null && result.maxScore !== null;
            const pct =
              hasScore && (result.maxScore as number) > 0
                ? Math.round(((result.effectiveScore as number) / (result.maxScore as number)) * 100)
                : null;
            return (
              <li
                key={result.assessmentId}
                className="flex items-baseline justify-between gap-4 border-b border-border py-4"
              >
                <span className="font-semibold text-foreground">{result.title}</span>
                {hasScore && (
                  <span className="font-mono text-[20px] font-medium tabular-nums">
                    {pct !== null ? `${pct}%` : `${result.effectiveScore} / ${result.maxScore}`}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function UpcomingSessionsSection({ card }: { card: LearnerDashboardCard }) {
  return (
    <Section title="Upcoming sessions">
      {card.upcomingSessions.length === 0 ? (
        <div className="pt-4">
          <MutedLine>No sessions are scheduled yet</MutedLine>
        </div>
      ) : (
        <>
          <ul>
            {card.upcomingSessions.map((session) => (
              <li key={session.id} className="flex gap-4 border-b border-border py-4">
                <span className="pt-0.5">{sessionIcon(session.mode)}</span>
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">{session.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {whenLabel(session.startsAt, card.timezone)}
                    {session.mode === "in-person" && session.location ? ` · ${session.location}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {card.hasMoreSessions && (
            <Link
              href={`/learn/${card.enrolmentId}/sessions`}
              className="inline-block pt-4 font-semibold text-accent hover:underline"
            >
              View all sessions
            </Link>
          )}
        </>
      )}
    </Section>
  );
}

export default async function DashboardPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  const dashboard = await loadLearnerDashboard(actor);
  const cards = dashboard.cards;

  if (cards.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <LearnerPageHeader size="hero" title="Your dashboard" />
        <div className="flex flex-col items-start gap-3 border-t border-foreground pt-5">
          <p className="text-[16px] font-semibold text-foreground">Nothing to pick up right now</p>
          <p className="text-sm text-muted-foreground">
            Check back once your instructor schedules the next session, or explore what&apos;s next
            in your course.
          </p>
          <Link
            href="/courses"
            className="w-fit rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:bg-accent-deep"
          >
            Browse the catalogue
          </Link>
        </div>
      </div>
    );
  }

  // The main enrolment is the first one still being worked on; a finished course leads only when
  // nothing else is active.
  const primary = cards.find((c) => c.enrolmentStatus !== "COMPLETED") ?? cards[0];
  const others = cards.filter((c) => c !== primary);
  const primaryActive = primary.enrolmentStatus !== "COMPLETED";

  const profile = await profileService.getOwnProfile(actor).catch(() => null);
  const firstName = profile?.name?.trim().split(/\s+/)[0];
  const greeting = `${greetingFor(new Date(), primary.timezone)}${firstName ? `, ${firstName}` : ""}.`;
  const nextSession = primaryActive ? primary.upcomingSessions[0] : undefined;

  const certificateCards = cards.filter((c) => c.certificate.kind !== "not-applicable");

  return (
    <div className="flex flex-col gap-16">
      <LearnerPageHeader
        size="hero"
        title={greeting}
        subtitle={
          nextSession
            ? `Your next live session is ${whenLabel(nextSession.startsAt, primary.timezone)}.`
            : undefined
        }
      />

      <HeroSection card={primary} />

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-12 lg:pr-14">
          {others.length > 0 && (
            <Section title="Your other courses">
              {others.map((card) => (
                <EnrolmentRow key={card.enrolmentId} card={card} />
              ))}
            </Section>
          )}
          {primaryActive && <ResultsSection card={primary} />}
        </div>

        <div className="flex min-w-0 flex-col gap-12 lg:border-l lg:border-border lg:pl-10">
          {primaryActive && <UpcomingSessionsSection card={primary} />}
          {certificateCards.length > 0 && (
            <Section title="Certificates">
              {certificateCards.map((card) => (
                <CertificateSlot key={card.enrolmentId} certificate={card.certificate} />
              ))}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
