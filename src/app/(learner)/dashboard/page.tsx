import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { getCurrentActor } from "@/server/auth/current-actor";
import { profileService } from "@/server/services/profile-service";
import { loadLearnerDashboard } from "@/server/services/enrolment-dashboard-service";
import type { DashboardTicketSummary, LearnerDashboardCard } from "@/server/services/enrolment-dashboard-service";
import { EnrolmentRow } from "@/components/learner/EnrolmentRow";
import { DeferredSlot } from "@/components/learner/DeferredSlot";
import { CertificateSlot } from "@/components/learner/CertificateSlot";
import { SectionHead } from "@/components/site/Section";
import { utcToWallParts } from "@/lib/timezone";
import { LagosTime } from "@/components/time/LagosTime";
import { TicketStatusPill, TicketTime } from "@/components/support/ticket-labels";
import type { Metadata } from "next";

/**
 * `/dashboard` (LRN-01, 09-08 Task 3) — the entry point every other learner surface links
 * from, drawn as the IETC mockup (design/mockups/learner-dashboard.html):
 *
 *   1. a peach head whose title is the learner's next step (the next lesson, or what to do
 *      when there is none), with the way in and the progress count;
 *   2. the module strip: every module in order, black when done, orange where they are;
 *   3. a white strip with what is coming (the next sessions and the next assessment due);
 *   4. a black strip with the latest result, attendance and the learner's name;
 *   5. their other courses and results, beside support tickets and certificates.
 *
 * T-09-01 / DD-20: re-resolves `getCurrentActor()` itself rather than trusting the
 * `(learner)/layout.tsx` guard (convenience only) and calls `loadLearnerDashboard(actor)`,
 * which accepts no id parameter — there is no value here for a caller to tamper with.
 */

/** A notice in the head: a tinted block, never a side stripe. */
const HEAD_NOTE = "flex flex-col gap-1 rounded-xl bg-warning-surface px-4 py-3.5 text-[15px] text-pill-amber-ink";
/** Pulls a band out to the full width of the shell's padded <main>. */
const BLEED = "-mx-5 px-5 md:-mx-14 md:px-14";
const BTN_INK =
  "inline-flex min-h-12 w-fit items-center justify-center gap-2.5 rounded-[10px] bg-ink px-[22px] text-[15.5px] font-bold text-white hover:bg-ink-hover";
const LINK = "font-bold text-ink underline underline-offset-4 hover:text-orange-text";

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

/** The learner's next step, as the head's title and lede. */
function nextStep(card: LearnerDashboardCard): { title: string; lede: string } {
  const action = card.nextAction;
  if (card.enrolmentStatus === "COMPLETED" || action.kind === "complete") {
    return {
      title: "You've completed everything required here.",
      lede: "Your certificate, if this course issues one, is shown in the Certificates section below.",
    };
  }
  if (action.kind === "lesson") return { title: action.lessonTitle, lede: `Your next lesson, in ${action.moduleTitle}.` };
  if (action.kind === "session") {
    return { title: action.title, lede: `Your next live session, ${whenLabel(action.startsAt, card.timezone)}.` };
  }
  return {
    title: "Nothing to pick up right now.",
    lede: "Check back once your instructor schedules the next session, or explore what's next in your course.",
  };
}

function AccessNotice({ card }: { card: LearnerDashboardCard }) {
  if (card.accessNotice.kind === "ending") {
    return (
      <div className={HEAD_NOTE}>
        <p>
          Your access ends <LagosTime value={card.accessNotice.endsAt} variant="date" />
        </p>
      </div>
    );
  }
  if (card.accessNotice.kind === "ended") {
    return (
      <div className={HEAD_NOTE}>
        <p className="font-bold">Your access window has ended</p>
        <p>You can no longer open lesson content, but your progress and results stay on record.</p>
      </div>
    );
  }
  return null;
}

/** 1. The peach head: greeting, the next step as the title, the way in and the count. */
function Head({ card, greeting }: { card: LearnerDashboardCard; greeting: string }) {
  const completed = card.enrolmentStatus === "COMPLETED";
  const step = nextStep(card);
  const action = card.nextAction;
  const { progress } = card;
  const started = progress.structure !== "unpinned" && progress.requiredLessonsComplete > 0;
  return (
    <section aria-labelledby="next-step" className={`${BLEED} bg-peach pt-7 pb-[30px] md:pt-10`}>
      <p className="text-[14.5px] font-bold text-peach-text">
        {greeting} {completed ? "Course complete:" : "Continue where you left off in"} {card.cohortTitle}.
      </p>
      <p className="mt-5 text-[14.5px] font-bold text-orange-text">Next up</p>
      <h1 id="next-step" className="ietc-display mt-1 max-w-[20ch] text-[clamp(42px,5.2vw,74px)]">
        {step.title}
      </h1>
      <p className="mt-3 max-w-[58ch] text-[17px] text-peach-text md:text-[18.5px]">{step.lede}</p>
      {!completed && card.accessNotice.kind !== "none" && (
        <div className="mt-5 max-w-[640px]">
          <AccessNotice card={card} />
        </div>
      )}
      <ProgressLine card={card} />
      {!completed && (
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
          {action.kind === "lesson" ? (
            <Link href={`/learn/${card.enrolmentId}/lessons/${action.lessonId}`} className={BTN_INK}>
              {started ? "Resume lesson" : "Start lesson"} <ArrowRight aria-hidden className="size-[19px]" strokeWidth={2.3} />
            </Link>
          ) : (
            <Link href={`/learn/${card.enrolmentId}`} className={BTN_INK}>
              Open the course <ArrowRight aria-hidden className="size-[19px]" strokeWidth={2.3} />
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

/** The required-lessons bar and count under the head's title. */
function ProgressLine({ card }: { card: LearnerDashboardCard }) {
  const { progress } = card;
  if (progress.structure === "unpinned") {
    return (
      <div className="mt-5">
        <h2 className="sr-only">Your progress</h2>
        <p className="text-[14.5px] text-peach-text">Course progress isn&apos;t available for this enrolment yet.</p>
      </div>
    );
  }
  const { requiredLessonsComplete: done, requiredLessonsTotal: total } = progress;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-[18px] gap-y-2">
      <h2 className="sr-only">Your progress</h2>
      <div
        role="progressbar"
        aria-label="Required lessons complete"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2.5 w-full max-w-[300px] overflow-hidden rounded-full bg-ink/15"
      >
        <div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[14.5px] font-semibold text-peach-text">
        {done} of {total} required lessons complete
      </p>
    </div>
  );
}

/** 2. The module strip: black when done, orange where the learner is. */
function ModuleStrip({ card }: { card: LearnerDashboardCard }) {
  const modules = card.progress.modules ?? [];
  if (modules.length === 0) return null;
  return (
    <nav aria-label="Modules" className="-mx-5 md:-mx-14">
      <ol
        className="flex overflow-x-auto border-y-2 border-ink [scrollbar-width:none] md:grid"
        style={{ gridTemplateColumns: `repeat(${modules.length}, minmax(0, 1fr))` }}
      >
        {modules.map((mod, i) => (
          <li
            key={`${i}-${mod.title}`}
            aria-current={mod.state === "current" ? "step" : undefined}
            className={`flex min-h-16 min-w-[132px] flex-none items-center gap-2.5 border-l-2 border-ink px-3 py-2.5 text-[12.5px] leading-tight font-semibold first:border-l-0 first:pl-5 md:min-w-0 md:first:pl-14 ${
              mod.state === "done" ? "bg-ink text-white" : mod.state === "current" ? "bg-orange" : "bg-ground"
            }`}
          >
            <b className="ietc-display text-[28px] leading-none">{i + 1}</b>
            {mod.state === "done" && <Check aria-hidden className="size-[15px] shrink-0" strokeWidth={3.4} />}
            <span className="min-w-0">
              {mod.title}
              <span className="sr-only">{mod.state === "done" ? " (done)" : mod.state === "current" ? " (you are here)" : ""}</span>
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** 3. What is coming: the next two sessions and the next assessment due. */
function ComingUp({ card }: { card: LearnerDashboardCard }) {
  const sessions = card.upcomingSessions.slice(0, 2);
  const obligations = card.assessmentObligations;
  const due = obligations.kind === "tracked" ? obligations.items[0] : undefined;
  const time = (date: Date) =>
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: card.timezone }).format(new Date(date));
  const day = (date: Date) =>
    new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: card.timezone }).format(new Date(date));

  const cells: ReactNode[] = sessions.map((session, i) => (
    <div key={session.id}>
      <p className="text-[14.5px] font-bold text-orange-text">
        {day(session.startsAt)} · {i === 0 ? "Next session" : "Session"}
      </p>
      <p className="ietc-display mt-1 text-[52px] leading-none">{time(session.startsAt)}</p>
      <p className="mt-2 font-bold">{session.title}</p>
      {session.location && <p className="text-[14.5px] text-ink-soft">{session.location}</p>}
      <Link href={i === 0 ? `/learn/${card.enrolmentId}/sessions` : "/learn/calendar"} className={`${LINK} mt-2 inline-block text-[14.5px]`}>
        {i === 0 ? "View all sessions" : "Open calendar"}
      </Link>
    </div>
  ));
  if (sessions.length === 0) {
    cells.push(
      <div key="no-sessions">
        <p className="text-[14.5px] font-bold text-orange-text">Sessions</p>
        <p className="ietc-display mt-1 text-[28px] leading-none">None scheduled yet</p>
        <p className="mt-2 text-[14.5px] text-ink-soft">Your instructor adds live sessions to the calendar.</p>
        <Link href="/learn/calendar" className={`${LINK} mt-2 inline-block text-[14.5px]`}>
          Open calendar
        </Link>
      </div>,
    );
  }
  if (obligations.kind === "deferred") {
    cells.push(
      <div key="no-assessments">
        <p className="text-[14.5px] font-bold text-orange-text">Assessments</p>
        <p className="mt-2 text-[14.5px] text-ink-soft">No quizzes or assignments are set for this course yet.</p>
      </div>,
    );
  }
  if (due) {
    cells.push(
      <div key="due">
        <p className="text-[14.5px] font-bold text-orange-text">{due.dueAt ? <>{day(due.dueAt)} · Assessment due</> : "Assessment due"}</p>
        <p className="ietc-display mt-1 text-[52px] leading-none">{due.dueAt ? time(due.dueAt) : "Open"}</p>
        <p className="mt-2 font-bold">{due.title}</p>
        {due.dueAt && (
          <p className="text-[14.5px] text-ink-soft">
            Due <LagosTime value={due.dueAt} />
          </p>
        )}
        {due.lessonId && (
          <Link href={`/learn/${card.enrolmentId}/lessons/${due.lessonId}`} className={`${LINK} mt-2 inline-block text-[14.5px]`}>
            Open it
          </Link>
        )}
      </div>,
    );
  }
  if (cells.length === 0) return null;
  return (
    <section aria-labelledby="coming-up" className={`${BLEED} grid bg-paper md:grid-cols-3`}>
      <h2 id="coming-up" className="sr-only">
        Upcoming sessions
      </h2>
      {cells.map((cell, i) => (
        <div key={i} className={`py-6 md:py-7 md:pr-7 ${i > 0 ? "border-t border-rule md:border-t-0 md:border-l md:pl-7" : ""}`}>
          {cell}
        </div>
      ))}
    </section>
  );
}

/** 4. The black strip: the latest result, attendance and who this is. */
function Record({ card, name }: { card: LearnerDashboardCard; name: string | undefined }) {
  const latest = card.results.kind === "tracked" ? card.results.recent[0] : undefined;
  const latestPct =
    latest && latest.effectiveScore !== null && latest.maxScore !== null && latest.maxScore > 0
      ? Math.round((latest.effectiveScore / latest.maxScore) * 100)
      : null;
  const attendance = card.progress.structure !== "unpinned" ? card.progress.attendance : null;
  if (latestPct === null && attendance === null && !name) return null;
  return (
    <section aria-label="Your record" className={`${BLEED} flex flex-wrap items-end justify-between gap-x-14 gap-y-7 bg-ink py-8 text-white md:py-10`}>
      <div className="flex flex-wrap gap-x-14 gap-y-6">
        {latestPct !== null && latest && (
          <div className="flex items-center gap-4">
            <span className="ietc-display text-[64px] leading-none text-orange md:text-[76px]">{latestPct}%</span>
            <span>
              <b className="block font-bold">Latest result</b>
              <span className="text-[14.5px] text-on-ink-soft">{latest.title}</span>
            </span>
          </div>
        )}
        {attendance?.kind === "computed" && attendance.earnedPct > 0 && (
          <div className="flex items-center gap-4">
            <span className="ietc-display text-[64px] leading-none text-orange md:text-[76px]">{attendance.earnedPct}%</span>
            <span>
              <b className="block font-bold">Attendance</b>
              <span className="block text-[14.5px] text-on-ink-soft">{attendance.earnedPct}% attended</span>
              <span className="block text-[14.5px] text-on-ink-soft">{attendance.requiredPct}% needed to qualify</span>
            </span>
          </div>
        )}
        {attendance?.kind === "computed" && attendance.earnedPct === 0 && (
          <div>
            <b className="block font-bold">Attendance</b>
            <span className="ietc-display block text-[28px] leading-tight">No sessions attended yet</span>
            <span className="text-[14.5px] text-on-ink-soft">You need {attendance.requiredPct}% to qualify</span>
          </div>
        )}
        {attendance?.kind === "no-sessions" && (
          <div>
            <b className="block font-bold">Attendance</b>
            <span className="ietc-display block text-[28px] leading-tight">No countable sessions yet</span>
          </div>
        )}
      </div>
      {name && (
        <div className="md:text-right">
          <p className="ietc-display text-[44px] leading-[0.9] uppercase md:text-[64px]">{name}</p>
          <p className="mt-2 text-sm text-on-ink-soft">{card.cohortTitle}</p>
        </div>
      )}
    </section>
  );
}

function ResultsSection({ card }: { card: LearnerDashboardCard }) {
  const col = card.results;
  if (col.kind === "deferred") return <DeferredSlot title="Results" copy="No results yet." />;
  return (
    <section aria-labelledby="results">
      <SectionHead
        id="results"
        title="Results"
        aside={
          col.recent.length > 0 ? (
            <Link href={`/learn/${card.enrolmentId}/results`} className={LINK}>
              View all
            </Link>
          ) : undefined
        }
      />
      {col.recent.length === 0 ? (
        <p className="pt-4 text-ink-soft">No results yet</p>
      ) : (
        <ul>
          {col.recent.map((result) => {
            const hasScore = result.effectiveScore !== null && result.maxScore !== null;
            const pct =
              hasScore && (result.maxScore as number) > 0
                ? Math.round(((result.effectiveScore as number) / (result.maxScore as number)) * 100)
                : null;
            return (
              <li key={result.assessmentId} className="flex items-baseline justify-between gap-4 border-b border-rule py-4">
                <span>{result.title}</span>
                {hasScore && (
                  <span className="font-bold tabular-nums">
                    {pct !== null ? `${pct}%` : `${result.effectiveScore} / ${result.maxScore}`}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Plan 12-06 (UI-SPEC 7.4) - owner-only, learner-safe fields; no priority/owner/queue. */
function SupportTicketsSection({ tickets }: { tickets: DashboardTicketSummary[] }) {
  return (
    <section aria-labelledby="tickets">
      <SectionHead
        id="tickets"
        title="Support tickets"
        aside={
          tickets.length > 0 ? (
            <Link href="/support" className={LINK}>
              View all support tickets
            </Link>
          ) : undefined
        }
      />
      {tickets.length === 0 ? (
        <div className="flex flex-col items-start gap-2 pt-4">
          <p className="text-ink-soft">No open support tickets</p>
          <Link href="/support/new" className={LINK}>
            Get help
          </Link>
        </div>
      ) : (
        <ul>
          {tickets.map((ticket) => (
            <li key={ticket.id} className="flex flex-col gap-1.5 border-b border-rule py-4">
              <Link
                href={`/support/${encodeURIComponent(ticket.reference)}`}
                className="font-bold underline underline-offset-4 hover:text-orange-text"
              >
                {ticket.subject}
              </Link>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14.5px] text-ink-soft">
                <span>{ticket.reference}</span>
                <TicketStatusPill status={ticket.status} />
                <span>
                  Updated <TicketTime value={ticket.updatedAt} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  const dashboard = await loadLearnerDashboard(actor);
  const cards = dashboard.cards;
  const supportTickets = dashboard.supportTickets ?? [];

  if (cards.length === 0) {
    return (
      <div className="flex flex-col gap-12">
        <header className="pt-7 md:pt-10">
          <h1 className="ietc-display text-[clamp(38px,4.4vw,64px)]">Your dashboard</h1>
          <h2 className="ietc-display mt-6 text-[28px] leading-none">You&apos;re not enrolled in a course yet</h2>
          <p className="mt-2 max-w-[58ch] text-ink-soft">
            Browse the catalogue to find a course or programme, and it will appear here once you enrol.
          </p>
          <Link href="/courses" className={`${BTN_INK} mt-5`}>
            Browse the catalogue
          </Link>
        </header>
        <div className="max-w-[560px]">
          <SupportTicketsSection tickets={supportTickets} />
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
  const fullName = profile?.name?.trim() || undefined;
  const firstName = fullName?.split(/\s+/)[0];
  const greeting = `${greetingFor(new Date(), primary.timezone)}${firstName ? `, ${firstName}` : ""}.`;

  const certificateCards = cards.filter((c) => c.certificate.kind !== "not-applicable");

  return (
    <div data-primary-content className="flex flex-col">
      <Head card={primary} greeting={greeting} />
      <ModuleStrip card={primary} />
      {primaryActive && <ComingUp card={primary} />}
      <Record card={primary} name={fullName} />

      <div className="grid gap-11 pt-10 lg:grid-cols-2 lg:gap-16 lg:pt-12">
        <div className="flex min-w-0 flex-col gap-10">
          {others.length > 0 && (
            <section aria-labelledby="other-courses">
              <SectionHead id="other-courses" title="Your other courses" />
              {others.map((card) => (
                <EnrolmentRow key={card.enrolmentId} card={card} />
              ))}
            </section>
          )}
          {/* ASM-07: results stay readable after completion (G-01: visible, not operable). */}
          <ResultsSection card={primary} />
        </div>

        <div className="flex min-w-0 flex-col gap-10">
          <SupportTicketsSection tickets={supportTickets} />
          {certificateCards.length > 0 && (
            <section aria-labelledby="certificates">
              <SectionHead id="certificates" title="Certificates" />
              {certificateCards.map((card) => (
                <CertificateSlot key={card.enrolmentId} certificate={card.certificate} />
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
