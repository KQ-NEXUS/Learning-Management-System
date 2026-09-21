import Link from "next/link";
import { redirect } from "next/navigation";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";
import { EnrolmentRow } from "@/components/learner/EnrolmentRow";
import { getCurrentActor } from "@/server/auth/current-actor";
import { loadLearnerDashboard } from "@/server/services/enrolment-dashboard-service";

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
    <div className="flex flex-col gap-10">
      <LearnerPageHeader
        size="hero"
        title="My learning"
        subtitle="The courses and programmes you're enrolled on."
      />

      {cards.length === 0 ? (
        <div className="flex flex-col items-start gap-3 border-t border-foreground pt-5">
          <p className="text-[16px] font-semibold text-foreground">You&apos;re not enrolled on anything yet</p>
          <p className="text-sm text-muted-foreground">
            Find a course or programme in the catalogue and it will appear here once you&apos;ve enrolled.
          </p>
          <Link
            href="/courses"
            className="w-fit rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:bg-accent-deep"
          >
            Browse the catalogue
          </Link>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <section aria-label="In progress">
              <h2 className="pb-4 text-[22px] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground">
                In progress
              </h2>
              <div className="border-t border-foreground">
                {active.map((card) => (
                  <EnrolmentRow key={card.enrolmentId} card={card} />
                ))}
              </div>
            </section>
          )}
          {completed.length > 0 && (
            <section aria-label="Completed">
              <h2 className="pb-4 text-[22px] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground">
                Completed
              </h2>
              <div className="border-t border-foreground">
                {completed.map((card) => (
                  <EnrolmentRow key={card.enrolmentId} card={card} openCompleted />
                ))}
              </div>
            </section>
          )}
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
