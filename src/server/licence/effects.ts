/**
 * Permission effect classification and the works/blocked capability lists
 * (Phase 14, plan 14-06; D-06, D-07, D-09).
 *
 * Every permission in the closed catalogue is classified as one of:
 * - "read": a view permission. Never affected by the licence state.
 * - "continuity": work that must keep running in the restricted state (grading,
 *   attendance, refunds, exports, support tickets, certificate issuance and
 *   revocation, licence activation). The recovery route, `licence.activate`, is
 *   continuity so it can never be blocked (T-14-06-03).
 * - "write": any other permission. The default is write, so a permission added to
 *   the catalogue later is enforced unless someone consciously classifies it
 *   otherwise: `LICENCE_PERMISSION_EFFECT` is a total `Record<Permission, ...>`
 *   (a new permission fails to compile until classified) and `effectForPermission`
 *   returns "write" for any string it does not know (D-09).
 *
 * Call sites whose permission spans both kinds of operation (the enrolments.manage
 * progress override, the users.manage deactivate action and the email-log resend)
 * override this map per call site in plan 14-17; this map is the permission-level
 * default, not the last word.
 *
 * `Permission` is imported with `import type` only, so the runtime import graph of
 * worker closures stays free of the permission layer. The works/blocked lists
 * below are the same classification rendered for the status screen, and a test
 * ties them together so the screen cannot promise what enforcement does not do.
 */

import type { Permission } from "@/server/permissions/catalogue";

export type LicenceEffect = "read" | "write" | "continuity";

export const LICENCE_PERMISSION_EFFECT: Readonly<Record<Permission, LicenceEffect>> = {
  // Read: every view permission.
  "users.view": "read",
  "roles.view": "read",
  "programmes.view": "read",
  "courses.view": "read",
  "cohorts.view": "read",
  "enrolments.view": "read",
  "attendance.view": "read",
  "payments.view": "read",
  "submissions.view": "read",
  "certificates.view": "read",
  "tickets.view": "read",
  "reports.view": "read",
  "audit.view": "read",
  "licence.view": "read",

  // Continuity: delivery, money-out and recovery work that must keep running (A9, A11).
  "attendance.manage": "continuity",
  "payments.confirm": "continuity",
  "refunds.manage": "continuity",
  "grades.manage": "continuity",
  "certificates.issue": "continuity",
  "certificates.revoke": "continuity",
  "tickets.manage": "continuity",
  "reports.export": "continuity",
  "audit.export": "continuity",
  "licence.activate": "continuity",

  // Write: everything else is blocked in the restricted state.
  "users.manage": "write",
  "roles.manage": "write",
  "programmes.manage": "write",
  "programmes.publish": "write",
  "courses.create": "write",
  "courses.edit": "write",
  "courses.publish": "write",
  "cohorts.manage": "write",
  "cohorts.publish": "write",
  "enrolments.manage": "write",
  "assessments.create": "write",
  "assessments.edit": "write",
  "certificates.manage": "write",
};

/** The effect for a permission string; an unknown string is "write" so new resources inherit enforcement (D-09). */
export function effectForPermission(permission: string): LicenceEffect {
  return Object.hasOwn(LICENCE_PERMISSION_EFFECT, permission)
    ? LICENCE_PERMISSION_EFFECT[permission as Permission]
    : "write";
}

/** One line of the "what works" or "what is blocked" list and the permissions it stands for. */
export interface Capability {
  id: string;
  text: string;
  permissions: readonly Permission[];
}

/**
 * The works/blocked lists the status screen renders in the restricted state
 * (UI-SPEC, reconciled by 14-DECISIONS.md A9, A11, A12). Items with no
 * permissions describe flows that are not permission-gated (learner coursework,
 * sign-in, notifications, registration).
 */
export const RESTRICTED_CAPABILITIES: {
  readonly works: readonly Capability[];
  readonly blocked: readonly Capability[];
} = {
  works: [
    {
      id: "learner-learning",
      text: "Learners continue coursework, quizzes, assignments and progress",
      permissions: [],
    },
    {
      id: "staff-delivery",
      text: "Attendance, grading and certificate issuance",
      permissions: ["attendance.manage", "grades.manage", "certificates.issue", "certificates.revoke"],
    },
    {
      id: "security",
      text: "Sign-in, password reset and security administration",
      permissions: [],
    },
    {
      id: "payments",
      text: "Payment webhooks, refunds and reversals; payments started before the restriction still complete",
      permissions: ["refunds.manage", "payments.confirm"],
    },
    {
      id: "exports-activation",
      text: "Data exports and licence activation",
      permissions: ["reports.export", "audit.export", "licence.activate"],
    },
    {
      id: "notifications",
      text: "Email and in-product notifications",
      permissions: [],
    },
    {
      id: "support",
      text: "Support tickets and the support queue",
      permissions: ["tickets.manage"],
    },
  ],
  blocked: [
    {
      id: "new-enrolments",
      text: "New enrolments and new checkout sessions",
      permissions: ["enrolments.manage"],
    },
    {
      id: "content-publishing",
      text: "Publishing and content changes",
      permissions: [
        "courses.create",
        "courses.edit",
        "courses.publish",
        "programmes.manage",
        "programmes.publish",
        "cohorts.manage",
        "cohorts.publish",
        "assessments.create",
        "assessments.edit",
      ],
    },
    {
      id: "staff-roles",
      text: "Staff, role and permission changes",
      permissions: ["users.manage", "roles.manage"],
    },
    {
      id: "settings",
      text: "Settings changes and other administrative edits",
      permissions: ["certificates.manage"],
    },
    {
      id: "registration",
      text: "New learner registration",
      permissions: [],
    },
  ],
};
