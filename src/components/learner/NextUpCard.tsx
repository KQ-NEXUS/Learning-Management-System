import Link from "next/link";
import { PlayCircle, Clock } from "lucide-react";
import { utcToWallParts } from "@/lib/timezone";
import type { NextAction } from "@/server/services/enrolment-dashboard-service";

/**
 * NextUpCard — the dashboard's single most important derivation (DD-5,
 * UI-SPEC section 7.1 "'Next up' card"). Renders exactly one of the four
 * `NextAction` variants, verbatim UI-SPEC 6.1 copy. Server Component, no
 * client JS.
 *
 * `timezone` is not in the plan's originally-sketched two-prop signature —
 * added (Rule 3 auto-fix) because the `session` variant's "{formatted
 * date/time}" copy cannot be produced without the cohort's IANA zone, and
 * Task 3 explicitly forbids `toLocaleString`/the server's local zone. Uses
 * the same `utcToWallParts(...).label` convention
 * `scheduled-session-service.ts` already established for this exact
 * purpose.
 */

export type NextUpCardProps = {
  action: NextAction;
  enrolmentId: string;
  /** The owning Cohort's IANA timezone — only read by the `session` variant. */
  timezone: string;
};

export function NextUpCard({ action, enrolmentId, timezone }: NextUpCardProps) {
  return (
    <div className="flex flex-col gap-3 border-t border-foreground pt-5">
      <h3 className="text-[16px] font-semibold text-foreground">Next up</h3>
      {action.kind === "lesson" && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <PlayCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-semibold text-foreground">{action.lessonTitle}</p>
              <p className="text-sm text-muted-foreground">in {action.moduleTitle}</p>
            </div>
          </div>
          <Link
            href={`/learn/${enrolmentId}/lessons/${action.lessonId}`}
            className="w-fit shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:opacity-90"
          >
            Continue learning
          </Link>
        </div>
      )}

      {action.kind === "session" && (
        <div className="flex items-start gap-3">
          <Clock aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
          <p className="text-sm font-semibold text-foreground">
            {action.title} — {utcToWallParts(action.startsAt, timezone).label}
          </p>
        </div>
      )}

      {action.kind === "complete" && (
        <p className="text-sm text-foreground">
          You&apos;ve completed everything required here. Your certificate, if this course
          issues one, is shown in the Certificate section below.
        </p>
      )}

      {action.kind === "none" && (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-foreground">Nothing to pick up right now</p>
          <p className="text-sm text-muted-foreground">
            Check back once your instructor schedules the next session, or explore what&apos;s
            next in your course.
          </p>
        </div>
      )}
    </div>
  );
}
