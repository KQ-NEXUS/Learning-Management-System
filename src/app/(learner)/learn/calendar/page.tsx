import { redirect } from "next/navigation";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";
import { SessionCalendar, type CalendarSession } from "@/components/calendar/SessionCalendar";
import { getCurrentActor } from "@/server/auth/current-actor";
import { listOwnActiveEnrolments } from "@/server/services/learner-access";
import { listOwnCohortSessions } from "@/server/services/learner-session-service";
import { civilDateIn } from "@/lib/calendar";

/**
 * `/learn/calendar` — every scheduled session across the courses and programmes the signed-in
 * learner is enrolled on, as one month or week calendar with upcoming sessions highlighted.
 *
 * It adds no new read: it asks `listOwnActiveEnrolments` which enrolments are the caller's own and
 * then calls the same `listOwnCohortSessions` the per-course sessions page uses, once each. Both
 * are keyed on `actor.userId`, so there is no id in the URL for a caller to tamper with.
 *
 * Only a session's title, times, place and cancellation are handed to the calendar. The meeting
 * link is deliberately left behind: it has its own visibility window (D-25), and the per-course
 * sessions page each entry links to is where it appears.
 */

export const metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

export default async function LearnerCalendarPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  const enrolments = await listOwnActiveEnrolments(actor);

  const sessions: CalendarSession[] = [];
  for (const enrolment of enrolments) {
    const own = await listOwnCohortSessions(actor, enrolment.id);
    if (!own) continue;
    for (const session of [...own.upcoming, ...own.past]) {
      const place = session.mode === "in-person" && session.location ? session.location : session.mode === "virtual" ? "Virtual" : null;
      sessions.push({
        id: `${enrolment.id}:${session.id}`,
        title: session.title,
        startsAt: session.startsAt.toISOString(),
        endsAt: session.endsAt.toISOString(),
        timezone: own.timezone,
        cancelled: session.cancelledAt !== null,
        meta: [enrolment.cohort.title, place].filter(Boolean).join(" · "),
        href: `/learn/${enrolment.id}/sessions`,
      });
    }
  }

  // "Today" is read in the timezone the learner's sessions are given in; with none, UTC.
  const today = civilDateIn(new Date(), enrolments[0]?.cohort.timezone || "UTC");

  return (
    <div className="flex flex-col gap-8">
      <LearnerPageHeader
        size="hero"
        title="Calendar"
        subtitle="Your scheduled sessions across everything you're enrolled on."
        back={{ label: "Back to My learning", href: "/learn" }}
      />

      {enrolments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You&apos;re not enrolled on anything yet, so there are no sessions to show.
        </p>
      ) : (
        <>
          {sessions.length === 0 && <p className="text-sm text-muted-foreground">No sessions are scheduled yet.</p>}
          <SessionCalendar sessions={sessions} today={today} />
        </>
      )}
    </div>
  );
}
