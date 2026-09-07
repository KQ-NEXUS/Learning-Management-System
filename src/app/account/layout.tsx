import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";
import { signOutAction } from "@/app/(auth)/signin/actions";
import { profileService } from "@/server/services/profile-service";
import { LearnerShell, type LearnerNavItem } from "@/components/shell/LearnerShell";

/**
 * The Learner account shell — not `staff/layout.tsx`'s sidebar workspace.
 * A Learner has no `Assignment`-based grants to check, just "is this their
 * own record" (profile-service.ts's ownership model), so this guard checks
 * only that a session exists, with no staff-role requirement.
 *
 * Convenience only. The server action's own actor resolution is the
 * security boundary — a layout guard protects rendering, not data.
 */

const NAV: LearnerNavItem[] = [
  { label: "Catalogue", href: "/courses" },
  { label: "Account", href: "/account" },
];

/**
 * Derives the avatar's initials + accessible label.
 *
 * When a display name exists it wins outright. When it does not, initials
 * come from the email local-part (first char, uppercased, plus the first
 * char of a second `.`/`_`/`-`-delimited segment if one exists) and the
 * email itself fills the label slot. The learner shell shows no name or
 * role line beside the avatar (UI-SPEC 8.18 empty) — this is the only
 * identity surface here.
 */
function deriveAvatarDisplay(
  identity: { name: string; email: string } | null,
): { initials: string; label: string } | null {
  if (!identity) return null;
  const trimmedName = identity.name.trim();
  if (trimmedName) {
    const words = trimmedName.split(/\s+/).filter(Boolean);
    const initials =
      words.length > 1
        ? `${words[0][0]}${words[1][0]}`.toUpperCase()
        : words[0].slice(0, 2).toUpperCase();
    return { initials, label: trimmedName };
  }
  const local = identity.email.split("@")[0] ?? "";
  const segments = local.split(/[._-]/).filter(Boolean);
  const initials = `${segments[0]?.[0] ?? ""}${segments[1]?.[0] ?? ""}`.toUpperCase();
  return { initials, label: identity.email };
}

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
