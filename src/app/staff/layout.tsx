import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";
import { signOutAction } from "@/app/(auth)/signin/actions";
import { LEARNER_LANDING_PATH } from "@/server/auth/landing";
import { profileService } from "@/server/services/profile-service";
import { StaffShell, type StaffIdentity, type StaffNavItem } from "./StaffShell";

/**
 * The admin workspace shell entry point.
 *
 * Rebuilt around the navy sidebar (D-19, D-20) — see `StaffShell.tsx` for the
 * chrome itself. This file stays a plain async Server Component so the guard
 * below runs, in order, before anything renders.
 *
 * Nav items without a route are no longer rendered at all (D-20): the nav
 * shows only routes that exist, so nothing here promises a page the product
 * cannot open.
 */

const NAV: StaffNavItem[] = [
  { label: "Courses", href: "/staff/courses" },
  { label: "Programmes", href: "/staff/programmes" },
  { label: "Users", href: "/staff/users" },
  { label: "Roles", href: "/staff/roles" },
  { label: "Audit", href: "/staff/audit" },
];

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Convenience only. The server action's own check is the security —
  // a layout guard protects rendering, not data (RBAC-06). The staffness
  // check below is the same kind of defence in depth: it only stops a
  // Learner from rendering a shell whose child components would throw
  // (D-18) — the root cause is the branched sign-in redirect (D-15).
  // G-03-7: the non-staff branch sends an already-authenticated actor to
  // their own landing path rather than /signin — the actor is signed in,
  // so sending them to sign-in reads as an unexpected sign-out, and they
  // would only re-authenticate into the same destination this branch can
  // send them to directly, never learning why they were bounced.
  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");
  if (!actor.isStaff) redirect(LEARNER_LANDING_PATH);

  // A missing profile row is an anomaly in chrome, not grounds for signing a
  // staff user out mid-session — the chip degrades to a neutral state
  // instead (UI-SPEC 8.17 empty).
  const profile = await profileService.getOwnProfile(actor);
  const identity: StaffIdentity = profile
    ? { name: profile.name, email: profile.email }
    : null;

  const signOut = (
    <form action={signOutAction}>
      <button
        type="submit"
        className="text-xs font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Sign out
      </button>
    </form>
  );

  return (
    <StaffShell nav={NAV} identity={identity} signOut={signOut}>
      {children}
    </StaffShell>
  );
}
