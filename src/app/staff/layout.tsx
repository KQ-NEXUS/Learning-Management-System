import { TemporaryPasswordNotice } from "@/components/shell/TemporaryPasswordNotice";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";
import { can, canAnywhere } from "@/server/permissions";
import { signOutAction } from "@/app/(auth)/signin/actions";
import { LEARNER_LANDING_PATH } from "@/server/auth/landing";
import { profileService } from "@/server/services/profile-service";
import { notificationService } from "@/server/services/notification-service";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { licenceService } from "@/server/services/licence-service";
import { LicenceBanner } from "@/components/licence/LicenceBanner";
import type { LicenceRestrictionValue } from "@/components/licence/LicenceRestrictionProvider";
import { formatLicenceInstant } from "@/server/licence/display";
import { LICENCE_STATE_LABELS, bannerCopy, rejectionSentence } from "@/server/licence/policy";
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
  { label: "Overview", href: "/staff" },
  { label: "Cohorts", href: "/staff/cohorts", group: "Delivery" },
  { label: "Enrolments", href: "/staff/enrolments", group: "Delivery" },
  { label: "Payments", href: "/staff/payments", group: "Delivery" },
  { label: "Reconciliation", href: "/staff/reconciliation", group: "Finance" },
  { label: "Reports", href: "/staff/reports", group: "Finance" },
  { label: "Courses", href: "/staff/courses", group: "Catalogue" },
  { label: "Programmes", href: "/staff/programmes", group: "Catalogue" },
  { label: "Certificates", href: "/staff/certificates", group: "Catalogue" },
  { label: "Support", href: "/staff/support", group: "Operations" },
  { label: "Users", href: "/staff/users", group: "Administration" },
  { label: "Roles", href: "/staff/roles", group: "Administration" },
  { label: "Learner numbers", href: "/staff/learner-numbers", group: "Administration" },
  { label: "Audit", href: "/staff/audit", group: "Administration" },
  { label: "Email log", href: "/staff/email-log", group: "Administration" },
  { label: "Licence", href: "/staff/licence", group: "Administration" },
];

/** The view permission each section needs; a section is shown only to staff who hold it. */
const NAV_PERMISSION: Record<string, Parameters<typeof can>[0]> = {
  "/staff/cohorts": "cohorts.view",
  "/staff/enrolments": "enrolments.view",
  "/staff/payments": "payments.view",
  "/staff/reconciliation": "payments.view",
  "/staff/reports": "reports.view",
  "/staff/courses": "courses.view",
  "/staff/programmes": "programmes.view",
  "/staff/certificates": "certificates.view",
  "/staff/support": "tickets.view",
  "/staff/users": "users.view",
  "/staff/roles": "roles.view",
  "/staff/audit": "audit.view",
  "/staff/email-log": "audit.view",
  // licence.view is Global only, so it is deliberately absent from SCOPE_AWARE_SECTIONS.
  "/staff/licence": "licence.view",
  "/staff/learner-numbers": "users.manage",
};

/** Sections whose list pages filter to the caller's scope (integration warning #1). */
const SCOPE_AWARE_SECTIONS = new Set(["/staff/cohorts", "/staff/enrolments", "/staff/payments"]);

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
        className="rounded-md px-2 py-2 text-sm font-medium text-sidebar-soft hover:text-white"
      >
        Sign out
      </button>
    </form>
  );

  // A database blip must never remove the header chrome (UI-SPEC chrome
  // persistence, D-22) — the bell falls back to a 0 badge, never a crash.
  let unread = 0;
  try {
    unread = await notificationService.unreadCount(actor);
  } catch {
    unread = 0;
  }
  const bell = <NotificationBell initialUnread={unread} variant="staff" />;

  // Licence banner and restriction mirror (14-19, D-15, D-09). Same chrome-persistence
  // discipline as the bell: a failed licence read leaves no banner and an unrestricted
  // context, never a failed shell. The banner is for holders of licence.view only; other
  // staff learn that an action is unavailable, not the licence detail (T-14-19-01).
  let bannerCopyValue: ReturnType<typeof bannerCopy> = null;
  let licenceRestriction: LicenceRestrictionValue | undefined;
  try {
    const snapshot = await licenceService.getStatusSnapshot();
    const canViewLicence = await can("licence.view", {});
    licenceRestriction = {
      restricted: snapshot.isRestricted,
      canViewLicence,
      stateLabel: canViewLicence ? LICENCE_STATE_LABELS[snapshot.state] : null,
    };
    if (canViewLicence) {
      const canActivate = await can("licence.activate", {});
      const zone = snapshot.timeZone;
      bannerCopyValue = bannerCopy({
        state: snapshot.state,
        daysRemaining: snapshot.daysRemaining,
        expiry: snapshot.expiresAt ? formatLicenceInstant(snapshot.expiresAt, zone) : null,
        graceEnd: snapshot.graceEndsAt ? formatLicenceInstant(snapshot.graceEndsAt, zone) : null,
        renewalEmail: snapshot.support?.renewalEmail ?? null,
        canActivate,
        reasonSentence:
          snapshot.state === "INVALID" && snapshot.reasonCode ? rejectionSentence(snapshot.reasonCode) : null,
      });
    }
  } catch {
    bannerCopyValue = null;
    licenceRestriction = undefined;
  }
  // JSX is built outside the try block: a failed render is not catchable there, only the read is.
  const licenceBanner = bannerCopyValue ? <LicenceBanner {...bannerCopyValue} href="/staff/licence" /> : null;

  // R3-12 — a suggestion only. Same chrome discipline as the bell: a failed read shows nothing.
  let suggestPasswordChange = false;
  try {
    suggestPasswordChange = await profileService.isUsingTemporaryPassword(actor);
  } catch {
    suggestPasswordChange = false;
  }
  // The licence banner is passed through untouched unless the notice is shown with it.
  const banner = suggestPasswordChange ? (
    <>
      {licenceBanner}
      <TemporaryPasswordNotice />
    </>
  ) : (
    licenceBanner
  );

  // Hide sections this person cannot open, instead of offering a link that lands on a denial.
  // Overview is every staff member's home; each section is checked against its own view permission.
  // Integration warning #1 — the delivery lists follow the caller's scope, so
  // they appear for a grant at ANY scope (a cohort-scoped instructor sees
  // Cohorts). Every other section's page still needs a GLOBAL grant.
  const allowed = await Promise.all(
    NAV.map((item) => {
      const permission = NAV_PERMISSION[item.href];
      if (!permission) return true;
      return SCOPE_AWARE_SECTIONS.has(item.href) ? canAnywhere(permission) : can(permission, {});
    }),
  );
  const visibleNav = NAV.filter((_, i) => allowed[i]);

  return (
    <StaffShell
      nav={visibleNav}
      identity={identity}
      signOut={signOut}
      bell={bell}
      banner={banner}
      licenceRestriction={licenceRestriction}
    >
      {children}
    </StaffShell>
  );
}
