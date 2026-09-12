import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";
import { signOutAction } from "@/app/(auth)/signin/actions";
import { profileService } from "@/server/services/profile-service";
import { LearnerShell, type LearnerNavItem } from "@/components/shell/LearnerShell";

/**
 * The checkout route-group layout — mirrors `src/app/account/layout.tsx`'s
 * guard and chrome exactly (D-15): a visitor must be signed in to reach any
 * page under `(checkout)/`, there is no unauthenticated "browse the
 * summary" state. Convenience only — each Server Action's own actor
 * resolution is the security boundary, not this layout guard.
 */

const NAV: LearnerNavItem[] = [
  { label: "Catalogue", href: "/courses" },
  { label: "Account", href: "/account" },
];

/** Copied verbatim from `account/layout.tsx` so the avatar chip renders
 * identically across both shells (UI-SPEC 8.18 chrome-persistence rule). */
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

export default async function CheckoutLayout({
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
