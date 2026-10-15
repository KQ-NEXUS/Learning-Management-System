import Link from "next/link";
import { redirect } from "next/navigation";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";
import { EnrolmentRow } from "@/components/learner/EnrolmentRow";
import { getCurrentActor } from "@/server/auth/current-actor";
import { loadLearnerDashboard } from "@/server/services/enrolment-dashboard-service";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "My learning" };

/**
 * `/learn` — "My learning": every course and programme cohort the signed-in learner is enrolled
 * on, in progress first, then completed. The dashboard leads with the one thing to do next; this
 * page is the full list, and the learner nav's "My learning" lands here.
 *
 * Re-resolves the actor itself (DD-20) and calls `loadLearnerDashboard(actor)`, which takes no id,
 * so there is nothing here for a caller to tamper with.
 */
export default async function MyLearningPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  const { cards } = await loadLearnerDashboard(actor);
  const active = cards.filter((c) => c.enrolmentStatus !== "COMPLETED");
  const completed = cards.filter((c) => c.enrolmentStatus === "COMPLETED");

  return (
    <div data-primary-content className="flex flex-col gap-10">
      <LearnerPageHeader
        size="hero"
        title="My learning"
        subtitle="The courses and programmes you're enrolled on."
      />

      {cards.length === 0 ? (
        <div className="flex flex-col items-start gap-3 border-t-2 border-ink pt-5">
          <p className="text-[16px] font-semibold text-foreground">You&apos;re not enrolled on anything yet</p>
          <p className="text-sm text-muted-foreground">
            Find a course or programme in the catalogue and it will appear here once you&apos;ve enrolled.
          </p>
          <Link
            href="/courses"
            className="w-fit inline-flex min-h-10 items-center justify-center rounded-[10px] bg-ink px-4 text-[14.5px] font-bold text-white hover:bg-ink-hover"
          >
            Browse the catalogue
          </Link>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <section aria-label="In progress">
              <h2 className="pb-4 ietc-display text-[25px] leading-none md:text-[28px]">
                In progress
              </h2>
              <div className="border-t-2 border-ink">
                {active.map((card) => (
                  <EnrolmentRow key={card.enrolmentId} card={card} />
                ))}
              </div>
            </section>
          )}
          {completed.length > 0 && (
            <section aria-label="Completed">
              <h2 className="pb-4 ietc-display text-[25px] leading-none md:text-[28px]">
                Completed
              </h2>
              <div className="border-t-2 border-ink">
                {completed.map((card) => (
                  <EnrolmentRow key={card.enrolmentId} card={card} openCompleted />
                ))}
              </div>
            </section>
          )}
          <p className="text-sm text-muted-foreground">
            <Link href="/learn/calendar" className="font-semibold text-accent hover:underline">
              See your sessions on a calendar
            </Link>
          </p>
          <p className="text-sm text-muted-foreground">
            Looking for something else?{" "}
            <Link href="/courses" className="font-semibold text-accent hover:underline">
              Browse the catalogue
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
