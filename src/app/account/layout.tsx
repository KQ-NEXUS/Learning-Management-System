import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";
import { signOutAction } from "@/app/(auth)/signin/actions";
import { profileService } from "@/server/services/profile-service";
import { LearnerShell, type LearnerNavItem } from "@/components/shell/LearnerShell";
import { LearnerAccountSlot } from "@/components/shell/LearnerAccountSlot";
import { deriveAvatarDisplay } from "@/lib/avatar-display";

/**
 * The Learner account shell — not `staff/layout.tsx`'s sidebar workspace.
 * A Learner has no `Assignment`-based grants to check, just "is this their
 * own record" (profile-service.ts's ownership model), so this guard checks
 * only that a session exists, with no staff-role requirement.
 *
 * Convenience only. The server action's own actor resolution is the
 * security boundary — a layout guard protects rendering, not data.
 *
 * `deriveAvatarDisplay` now lives in `src/lib/avatar-display.ts` (09-08 Task
 * 1) so this shell and `(learner)/layout.tsx` cannot drift on the initials
 * rule. The learner shell shows no name or role line beside the avatar
 * (UI-SPEC 8.18 empty) — this is the only identity surface here.
 */

const NAV: LearnerNavItem[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Courses", href: "/courses" },
  { label: "Account", href: "/account" },
];

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  // A missing profile row is an anomaly in chrome, not grounds for signing a
  // Learner out mid-session — the avatar degrades to a neutral state instead
  // (UI-SPEC 8.18 empty).
  const profile = await profileService.getOwnProfile(actor);
  const display = deriveAvatarDisplay(profile ? { name: profile.name, email: profile.email } : null);

  const rightSlot = <LearnerAccountSlot display={display} signOut={signOutAction} />;

  return (
    <LearnerShell nav={NAV} homeHref="/dashboard" rightSlot={rightSlot}>
      {children}
    </LearnerShell>
  );
}
