import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";
import { signOutAction } from "@/app/(auth)/signin/actions";
import { profileService } from "@/server/services/profile-service";
import { LearnerShell, type LearnerNavItem } from "@/components/shell/LearnerShell";
import { deriveAvatarDisplay } from "@/lib/avatar-display";

/**
 * The `(learner)` route-group layout — `/dashboard` and `/learn/*` (LRN-01
 * through LRN-06).
 *
 * DD-7: one route group, one guard, one nav definition, for both delivery
 * surfaces (`dashboard/`, `learn/`) — mirroring `account/layout.tsx`'s single
 * `LearnerShell` mount for its one surface. The group's parentheses keep the
 * URLs exactly `/dashboard` and `/learn/[enrolmentId]/...`.
 *
 * DD-20: this guard is convenience only, exactly as `account/layout.tsx`'s
 * header states. Every page and Server Action beneath it re-resolves the
 * actor and re-checks ownership; a layout protects rendering, not data.
 *
 * A missing profile row is an anomaly in chrome, not grounds for signing a
 * learner out mid-session — the avatar degrades to a neutral state instead,
 * matching `account/layout.tsx`'s identical handling.
 */

const NAV: LearnerNavItem[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Catalogue", href: "/courses" },
  { label: "Account", href: "/account" },
];

export default async function LearnerDeliveryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  const profile = await profileService.getOwnProfile(actor);
  const display = deriveAvatarDisplay(profile ? { name: profile.name, email: profile.email } : null);

  const rightSlot = (
    <>
      <span
        role="img"
        aria-label={display ? `Signed in as ${display.label}` : "Signed in"}
        title={display?.label ?? "Signed in"}
        className="flex size-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-accent-contrast"
        style={{
          background: "linear-gradient(140deg, var(--color-teal-fill), var(--color-teal-deep))",
        }}
      >
        {display?.initials ?? ""}
      </span>
      <form action={signOutAction}>
        <button
          type="submit"
          className="text-sm font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Sign out
        </button>
      </form>
    </>
  );

  return (
    <LearnerShell nav={NAV} rightSlot={rightSlot}>
      {children}
    </LearnerShell>
  );
}
