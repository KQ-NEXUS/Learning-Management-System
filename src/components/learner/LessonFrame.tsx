import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { SiteBrand } from "@/components/site/SiteHeader";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/shell/SkipLink";
import { BRAND } from "@/lib/brand";

/**
 * LessonFrame — the lesson screen's own chrome (IETC redesign, design/mockups/learner-lesson.html):
 * a white top bar with the IETC shield, the way back to the course and overall progress; the
 * black course outline down the left (from `lg`); the lesson itself on the page ground; and the
 * quiet footer. Below `lg` the outline folds into a strip under the bar so it is never lost.
 *
 * Server-safe and hook-free. Without an `outline` (the ended-access notice) the outline column
 * is omitted and the lesson fills the width.
 */
export function LessonFrame({
  backHref,
  backLabel,
  progress,
  outline,
  children,
}: {
  backHref: string;
  backLabel: string;
  /** Required lessons complete / total, shown as a bar in the top bar. */
  progress?: { done: number; total: number };
  outline?: ReactNode;
  children: ReactNode;
}) {
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="flex min-h-screen flex-col bg-ground">
      <SkipLink />
      <header className="flex items-center gap-6 border-b border-rule bg-paper px-5 py-3 md:px-14 md:py-4 lg:gap-10">
        <span className="max-md:hidden">
          <SiteBrand href="/dashboard" />
        </span>
        <Link href={backHref} className="flex min-w-0 items-center gap-2 font-bold text-ink hover:underline hover:underline-offset-4">
          <ArrowLeft aria-hidden className="size-[19px] shrink-0" strokeWidth={2.3} />
          <span className="truncate">{backLabel}</span>
        </Link>
        {progress && (
          <div className="ml-auto flex shrink-0 items-center gap-4">
            <div
              role="progressbar"
              aria-label="Required lessons complete"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2.5 w-20 overflow-hidden rounded-full bg-rule sm:w-[150px]"
            >
              <div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
            </div>
            <span className="hidden text-sm font-semibold text-ink-soft tabular-nums sm:inline">
              {progress.done} of {progress.total} lessons
            </span>
          </div>
        )}
      </header>

      {outline && (
        <details className="bg-ink lg:hidden">
          <summary className="cursor-pointer px-5 py-3.5 font-bold text-white">Course outline</summary>
          <div className="pb-4">{outline}</div>
        </details>
      )}

      <div className="flex grow">
        {outline && <aside className="hidden w-[340px] shrink-0 overflow-y-auto bg-ink pb-6 lg:block">{outline}</aside>}
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex min-w-0 grow justify-center focus:outline-none">
          <div className="flex w-full max-w-[820px] flex-col gap-6 px-5 pt-8 pb-16 md:px-14 md:pt-10">{children}</div>
        </main>
      </div>

      <footer className="flex flex-col justify-between gap-4 border-t border-rule px-5 py-[22px] text-sm text-ink-soft md:flex-row md:px-14">
        <span>
          © {new Date().getFullYear()} {BRAND.name}
        </span>
        <span>{BRAND.poweredBy}</span>
      </footer>
    </div>
  );
}
