import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getCurrentActor } from "@/server/auth/current-actor";
import { listOwnCohortSessions } from "@/server/services/learner-session-service";
import { SessionCard } from "@/components/learner/SessionCard";

/**
 * `/learn/[enrolmentId]/sessions` (LRN-06, 09-10 Task 2, UI-SPEC 7.4) — the
 * learner's own cohort session list, grouped Upcoming / Past.
 *
 * T-09-01 / DD-20: re-resolves `getCurrentActor()` itself rather than
 * trusting `(learner)/layout.tsx`'s guard (convenience only), and calls
 * `listOwnCohortSessions`, which returns an identical `null` for
 * not-found / not-mine / not-ACTIVE (denial parity) — this route answers
 * every one of those with the same `notFound()`.
 */

// Rendered per request — this reads a real Enrolment/ScheduledSession set
// and the meeting-link gate is time-sensitive, matching the dashboard's own
// `force-dynamic`-equivalent (no explicit export elsewhere in `(learner)`,
// but every sibling page here re-resolves fresh data on every request).
export const dynamic = "force-dynamic";

export default async function SessionsPage({
  params,
}: {
  params: Promise<{ enrolmentId: string }>;
}) {
  const { enrolmentId } = await params;

  // TOP-LEVEL await, BEFORE any streaming boundary — same ownership-check
  // ordering `checkout/[orderId]/page.tsx` and the dashboard page use.
  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  const sessions = await listOwnCohortSessions(actor, enrolmentId);
  if (!sessions) notFound();

  const isEmpty = sessions.upcoming.length === 0 && sessions.past.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href={`/learn/${enrolmentId}`}
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-accent"
        >
          <ChevronLeft aria-hidden className="size-4" />
          Back to course
        </Link>
        <h1 className="text-[25px] leading-[1.2] font-semibold text-foreground">
          Scheduled sessions
        </h1>
      </div>

      {isEmpty ? (
        <p className="text-sm text-muted-foreground">No sessions are scheduled yet</p>
      ) : (
        <>
          {sessions.upcoming.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-[16px] font-semibold text-foreground">Upcoming</h2>
              <div className="flex flex-col gap-3">
                {sessions.upcoming.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    timezone={sessions.timezone}
                    isPast={false}
                  />
                ))}
              </div>
            </section>
          )}

          {sessions.past.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-[16px] font-semibold text-foreground">Past</h2>
              <div className="flex flex-col gap-3">
                {sessions.past.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    timezone={sessions.timezone}
                    isPast={true}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
