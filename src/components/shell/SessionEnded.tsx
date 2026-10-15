import Link from "next/link";

/**
 * UX batch B — the one "your session has ended" state for staff pages. It
 * used to be a bare sentence in 19 places with no way forward; this gives the
 * way back to sign in.
 */
export function SessionEnded() {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 border-t-2 border-ink pt-5">
      <p className="text-base font-semibold text-foreground">Your session has ended</p>
      <p className="text-sm text-muted-foreground">Sign in again to carry on where you left off.</p>
      <Link
        href="/signin"
        className="inline-flex min-h-10 items-center rounded-[10px] bg-ink px-4 text-[14.5px] font-bold text-white hover:bg-ink-hover"
      >
        Sign in
      </Link>
    </div>
  );
}
