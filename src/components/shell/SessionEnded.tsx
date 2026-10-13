import Link from "next/link";

/**
 * UX batch B — the one "your session has ended" state for staff pages. It
 * used to be a bare sentence in 19 places with no way forward; this gives the
 * way back to sign in.
 */
export function SessionEnded() {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 border-t border-foreground pt-5">
      <p className="text-base font-semibold text-foreground">Your session has ended</p>
      <p className="text-sm text-muted-foreground">Sign in again to carry on where you left off.</p>
      <Link
        href="/signin"
        className="inline-flex min-h-10 items-center rounded-md bg-accent px-4 text-sm font-semibold text-accent-contrast hover:bg-accent-deep"
      >
        Sign in
      </Link>
    </div>
  );
}
