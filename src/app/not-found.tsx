import Link from "next/link";
import { SearchX } from "lucide-react";

/**
 * The repository's root 404 (a carried gap in STATE.md until now).
 *
 * It reveals nothing about WHY: the same page serves "no such page", "no such
 * course", "that course is not publicly listed" and "that course is archived"
 * (T-04-68). Next renders this with an HTTP 404 status.
 *
 * Copy is the approved recovery text from 04.1-UI-SPEC §6.2 (verbatim, straight
 * apostrophe per 04.1-MOCKUP-SOURCE.html) — deliberately non-enumerating: it
 * names no record and confirms no existence.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-2 px-6 py-8">
      <div className="flex w-full max-w-2xl flex-col items-center gap-4 rounded-xl border border-border bg-surface px-6 py-12 text-center shadow-card">
        <span
          aria-hidden
          className="flex size-12 items-center justify-center rounded-lg bg-surface-2 text-muted-foreground"
        >
          <SearchX className="size-[22px]" />
        </span>
        <p className="font-mono text-[11px] font-semibold tracking-widest text-muted-foreground">
          404
        </p>
        <h1 className="text-[25px] font-semibold leading-[1.2]">We can&apos;t find that page</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          The course or programme may have been archived, or the link may be out of date.
        </p>
        <Link
          href="/courses"
          className="rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-2"
        >
          Back to the catalogue
        </Link>
      </div>
    </main>
  );
}
