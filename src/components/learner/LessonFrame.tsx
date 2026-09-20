import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { BrandMark } from "@/components/shell/BrandMark";

/**
 * LessonFrame — the lesson screen's own chrome, drawn as the mockup's lesson board: a navy
 * course-outline sidebar (from `lg`), a slim header with the way back and overall progress, and
 * a white reading sheet with its top-left corner rounded. Below `lg` the outline moves into a
 * collapsible strip under the header so it is never lost on a phone.
 *
 * Server-safe and hook-free. Without an `outline` (the ended-access notice) the sidebar is
 * omitted and the sheet fills the width.
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
  /** Required lessons complete / total, shown as a slim bar in the header. */
  progress?: { done: number; total: number };
  outline?: ReactNode;
  children: ReactNode;
}) {
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="flex min-h-screen">
      {outline && (
        <aside className="on-navy hidden w-[340px] shrink-0 flex-col overflow-y-auto pb-6 lg:flex">
          <div className="flex h-16 items-center px-6">
            <Link href="/dashboard" className="flex items-center gap-3">
              <BrandMark className="size-6" />
              <span className="text-base font-semibold text-white">KQ Nexus</span>
            </Link>
          </div>
          {outline}
        </aside>
      )}

      <div className="flex min-w-0 grow flex-col">
        <header className="on-navy flex h-16 shrink-0 items-center justify-between gap-4 px-6 lg:px-10">
          <Link
            href={backHref}
            className="flex min-w-0 items-center gap-2 font-medium text-sidebar-fg hover:text-white"
          >
            <ArrowLeft aria-hidden className="size-4 shrink-0" />
            <span className="truncate">{backLabel}</span>
          </Link>
          {progress && (
            <div className="flex shrink-0 items-center gap-4">
              <span className="hidden text-[13px] text-sidebar-soft tabular-nums sm:inline">
                {progress.done} of {progress.total} lessons
              </span>
              <div
                role="progressbar"
                aria-label="Required lessons complete"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1.5 w-24 overflow-hidden rounded-full bg-sidebar-line sm:w-40"
              >
                <div className="h-full rounded-full bg-on-navy-blue" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
        </header>

        {outline && (
          <details className="on-navy border-t border-sidebar-line lg:hidden">
            <summary className="cursor-pointer px-6 py-3 text-sm font-semibold text-sidebar-fg">
              Course outline
            </summary>
            <div className="pb-4">{outline}</div>
          </details>
        )}

        <main className="flex grow justify-center rounded-t-[28px] bg-surface pt-2 lg:rounded-tr-none lg:rounded-tl-[28px]">
          <div className="flex w-full max-w-[768px] flex-col gap-6 px-6 pt-12 pb-16">{children}</div>
        </main>
      </div>
    </div>
  );
}
