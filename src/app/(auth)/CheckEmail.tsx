import Link from "next/link";
import { AuthTitle } from "./AuthPanel";

/**
 * UX batch B — the "check your email" state after forgot-password and
 * registration. It used to be a title only: no way back to sign in, no hint
 * for a missing email, and the form (holding focus) simply vanished. This is
 * announced (role=status) and always offers a next step.
 */
export function CheckEmail({
  subtitle,
  expiresIn,
  retryHref,
  retryLabel,
}: {
  subtitle: string;
  /** Plain words, e.g. "1 hour". */
  expiresIn: string;
  retryHref?: string;
  retryLabel?: string;
}) {
  return (
    <div role="status" className="flex w-full max-w-sm flex-col gap-5">
      <AuthTitle title="Check your email" subtitle={subtitle} />
      <p className="text-sm text-muted-foreground">
        The link works for {expiresIn}. If it hasn&apos;t arrived in a few minutes, check your spam or
        junk folder.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <Link
          href="/signin"
          className="inline-flex min-h-11 items-center rounded-md bg-accent px-5 text-sm font-semibold text-accent-contrast hover:bg-accent-deep"
        >
          Back to sign in
        </Link>
        {retryHref && retryLabel && (
          <Link href={retryHref} className="text-sm font-semibold text-accent underline underline-offset-2">
            {retryLabel}
          </Link>
        )}
      </div>
    </div>
  );
}
