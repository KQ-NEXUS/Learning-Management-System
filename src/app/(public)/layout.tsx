import Link from "next/link";
import { getCurrentActor } from "@/server/auth/current-actor";
import { landingPathFor } from "@/server/auth/landing";
import { LearnerShell, type LearnerNavItem } from "@/components/shell/LearnerShell";

/**
 * The public catalogue shell (plan 04-15; rebuilt on the shared learner shell
 * per D-23, UI-SPEC 7.3). Deliberately guard-free — no redirect anywhere in this
 * file — the catalogue must stay reachable without a session. It does look up the
 * actor, but only to choose the right-hand buttons: a visitor sees Sign in and
 * Register; someone already signed in sees a single link to their own home instead
 * of being offered to sign in again.
 */

const NAV: LearnerNavItem[] = [
  { label: "Courses", href: "/courses" },
  { label: "Programmes", href: "/programmes" },
  { label: "Verify a certificate", href: "/verify-certificate" },
];

const GHOST =
  "inline-flex min-h-10 items-center rounded-md border border-sidebar-line px-4 text-sm font-semibold text-white hover:bg-sidebar-hover";
const PRIMARY =
  "inline-flex min-h-10 items-center rounded-md bg-accent px-4 text-sm font-semibold text-accent-contrast hover:bg-accent-deep";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const actor = await getCurrentActor();

  const rightSlot = actor ? (
    <Link href={landingPathFor(actor)} className={PRIMARY}>
      {actor.isStaff ? "Open workspace" : "My dashboard"}
    </Link>
  ) : (
    <>
      <Link href="/signin" className={GHOST}>
        Sign in
      </Link>
      <Link href="/register" className={PRIMARY}>
        Register
      </Link>
    </>
  );

  return (
    <LearnerShell nav={NAV} rightSlot={rightSlot} homeHref={actor ? landingPathFor(actor) : "/courses"}>
      {children}
    </LearnerShell>
  );
}
