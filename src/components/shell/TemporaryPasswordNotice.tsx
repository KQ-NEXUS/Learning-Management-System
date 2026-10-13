"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { KeyRound, X } from "lucide-react";

/**
 * A suggestion, never a gate (audit R3-12, owner decisions 2026-10-04): a staff
 * member still signed in with the password an administrator set for them is
 * invited to choose their own. Nothing is blocked while it shows.
 *
 * It is deliberately a passing reminder, not a fixture of the page:
 *   - it hides itself `AUTO_HIDE_MS` after it appears;
 *   - "Dismiss" hides it at once and keeps it hidden on this browser for
 *     `DISMISS_FOR_DAYS`, after which it may remind once more if the temporary
 *     password is still in use.
 * The staff layout does not remount on in-app navigation, so it appears once
 * per sign-in or full page load, not on every page.
 *
 * The link opens the ordinary "forgot password" flow, which is the one place a
 * password is changed: it mails a reset link to the account's own address.
 */

export const AUTO_HIDE_MS = 12_000;
export const DISMISS_FOR_DAYS = 30;
export const DISMISSED_UNTIL_KEY = "kq.temporaryPasswordNotice.dismissedUntil";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Storage can be unavailable (private window, blocked site data); the notice must still work. */
function readDismissedUntil(): number {
  try {
    return Number(window.localStorage.getItem(DISMISSED_UNTIL_KEY)) || 0;
  } catch {
    return 0;
  }
}

function rememberDismissal(now: number): void {
  try {
    window.localStorage.setItem(DISMISSED_UNTIL_KEY, String(now + DISMISS_FOR_DAYS * DAY_MS));
  } catch {
    // Not remembered; it is still hidden for this page view.
  }
}

export function TemporaryPasswordNotice() {
  // Hidden on the server and on first paint: whether it was dismissed is only
  // known in the browser, and showing it for a moment first would be a flash.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (readDismissedUntil() > Date.now()) return;
    const show = window.setTimeout(() => setVisible(true), 0);
    const hide = window.setTimeout(() => setVisible(false), AUTO_HIDE_MS);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, []);

  if (!visible) return null;

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
        className="inline-flex min-h-11 items-center text-sm font-semibold text-white underline underline-offset-2"
      >
        Change password
      </Link>
      <button
        type="button"
        onClick={() => {
          rememberDismissal(Date.now());
          setVisible(false);
        }}
        className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-medium text-sidebar-soft hover:text-white"
      >
        <X aria-hidden className="size-4" />
        Dismiss
      </button>
    </div>
  );
}
