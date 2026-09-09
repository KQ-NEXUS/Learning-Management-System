import Link from "next/link";
import { LearnerShell, type LearnerNavItem } from "@/components/shell/LearnerShell";

/**
 * The public catalogue shell (plan 04-15; rebuilt on the shared learner shell
 * per D-23, UI-SPEC 7.3). Deliberately guard-free — no actor lookup and no
 * redirect anywhere in this file — the catalogue must stay reachable without
 * a session. Read-only navigation only — D-10 scopes this phase to an index
 * and a detail page; discovery and checkout hang off these routes in Phase 6.
 */

const NAV: LearnerNavItem[] = [
  { label: "Courses", href: "/courses" },
  { label: "Programmes", href: "/programmes" },
];

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <LearnerShell
      nav={NAV}
      rightSlot={
        <Link
          href="/signin"
          className="rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-2"
        >
          Sign in
        </Link>
      }
    >
      {children}
    </LearnerShell>
  );
}
