import Link from "next/link";
import { SearchX } from "lucide-react";

/**
 * The repository's root 404 (a carried gap in STATE.md until now).
 *
 * It reveals nothing about WHY: the same page serves "no such page", "no such
 * course", "that course is not publicly listed" and "that course is archived"
 * (T-04-68). Next renders this with an HTTP 404 status.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-2 px-6 py-8">
      <div className="flex w-full max-w-2xl flex-col items-center gap-4 rounded-xl border border-border bg-surface px-6 py-10 text-center shadow-card">
        <span
          aria-hidden
          className="flex size-12 items-center justify-center rounded-lg bg-surface-2 text-muted-foreground"
        >
          <SearchX className="size-[22px]" />
        </span>
        <p className="font-mono text-[11px] font-semibold tracking-widest text-muted-foreground">
          404
        </p>
        <h1 className="text-[25px] font-semibold leading-[1.2]">Page not found</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          The page you asked for does not exist, or is not available.
        </p>
        <Link
          href="/"
          className="rounded-md border border-input-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-surface-2"
        >
          Go to the home page
        </Link>
      </div>
    </main>
  );
}
