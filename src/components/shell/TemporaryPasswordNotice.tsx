import Link from "next/link";
import { KeyRound } from "lucide-react";

/**
 * A suggestion, never a gate (audit R3-12, owner decision 2026-10-04): a staff
 * member still signed in with the password an administrator set for them is
 * invited to choose their own. Nothing is blocked while it shows, and it goes
 * away once they have reset their password.
 *
 * The link opens the ordinary "forgot password" flow, which is the one place a
 * password is changed: it mails a reset link to the account's own address, so
 * the new password is chosen by whoever controls that inbox.
 */
export function TemporaryPasswordNotice() {
  return (
    <div
      role="status"
      className="on-navy flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-b border-sidebar-line bg-sidebar-hover px-6 py-2 lg:px-8"
    >
      <span className="flex shrink-0 items-center gap-2 text-sm font-semibold text-white">
        <KeyRound aria-hidden className="size-5 shrink-0" />
        Temporary password
      </span>
      <p className="min-w-0 flex-1 basis-64 text-sm text-white">
        You&apos;re still using the password you were given. We recommend choosing your own.
      </p>
      <Link
        href="/forgot-password"
        className="inline-flex min-h-11 w-full items-center text-sm font-semibold text-white underline underline-offset-2 sm:w-auto"
      >
        Change password
      </Link>
    </div>
  );
}
