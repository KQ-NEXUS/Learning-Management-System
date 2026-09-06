import Link from "next/link";
import { SearchX } from "lucide-react";

/**
 * The public-segment 404. Same properties as the root one — it reveals nothing
 * about why a slug did not resolve, so an unlisted, an archived and a
 * never-existed course are indistinguishable (T-04-68) — with the public
 * navigation instead of the bare shell.
 */
export default function PublicNotFound() {
  return (
    <section className="flex min-h-[60vh] items-center justify-center py-8">
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
          We could not find that page. It may have been removed, or it may never have existed.
        </p>
        <div className="flex flex-wrap justify-center gap-2 pt-1">
          <Link
            href="/courses"
            className="rounded-md border border-input-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-surface-2"
          >
            Browse courses
          </Link>
          <Link
            href="/programmes"
            className="rounded-md border border-input-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-surface-2"
          >
            Browse programmes
          </Link>
        </div>
      </div>
    </section>
  );
}
