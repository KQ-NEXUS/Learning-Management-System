import Link from "next/link";
import type { LearnerDashboardCard } from "@/server/services/enrolment-dashboard-service";

/**
 * One enrolment as a row: its title, a slim progress bar with the lesson count, and an "Open" link.
 *
 * Shared by the dashboard's "Other courses" list and the "My learning" page. A completed
 * enrolment reads "Completed" on the dashboard (it is no longer something to pick up); pass
 * `openCompleted` where it should stay reachable, as on "My learning".
 */
export function EnrolmentRow({
  card,
  openCompleted = false,
}: {
  card: LearnerDashboardCard;
  openCompleted?: boolean;
}) {
  const completed = card.enrolmentStatus === "COMPLETED";
  const { progress } = card;
  const total = progress.structure === "unpinned" ? 0 : progress.requiredLessonsTotal;
  const done = progress.structure === "unpinned" ? 0 : progress.requiredLessonsComplete;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="flex items-center justify-between gap-6 border-b border-rule py-4">
      <div className="min-w-0 grow">
        <div className="text-base font-semibold text-foreground">{card.cohortTitle}</div>
        {total > 0 && (
          <div className="mt-3 flex items-center gap-4">
            <div
              role="progressbar"
              aria-label={`${card.cohortTitle} progress`}
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2.5 grow overflow-hidden rounded-full bg-rule"
            >
              <div className="h-full rounded-full bg-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[13px] whitespace-nowrap text-muted-foreground tabular-nums">
              {done} of {total} lessons
            </span>
          </div>
        )}
      </div>
      {completed && !openCompleted ? (
        <span className="text-sm text-muted-foreground">Completed</span>
      ) : (
        <div className="flex items-center gap-4">
          {completed && <span className="text-sm text-muted-foreground">Completed</span>}
          <Link
            href={`/learn/${card.enrolmentId}`}
            className="inline-flex min-h-10 items-center rounded-[10px] px-4 text-[14.5px] font-bold text-ink shadow-[inset_0_0_0_2px_var(--ietc-ink)] hover:bg-ink/5"
          >
            Open
          </Link>
        </div>
      )}
    </div>
  );
}
