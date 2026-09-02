/**
 * Presentation grouping over the permission catalogue.
 *
 * Dependency-free: imports only the catalogue itself, never a component or a
 * service. `PERMISSION_GROUPS` mirrors the catalogue's own 14 domain comment
 * boundaries (D-01) so the picker and the catalogue can never silently drift
 * apart — `tests/permission-groups.test.ts` proves the union is exhaustive in
 * both directions.
 */

import type { Permission } from "@/server/permissions/catalogue";

export type PermissionGroup = {
  id: string;
  label: string;
  /** The domain noun most of this group's identifiers share as their prefix. */
  noun: string;
  permissions: readonly Permission[];
};

export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  { id: "users", label: "Users", noun: "users", permissions: ["users.view", "users.manage"] },
  { id: "roles", label: "Roles", noun: "roles", permissions: ["roles.view", "roles.manage"] },
  {
    id: "programmes",
    label: "Programmes",
    noun: "programmes",
    permissions: ["programmes.view", "programmes.manage", "programmes.publish"],
  },
  {
    id: "courses",
    label: "Courses",
    noun: "courses",
    permissions: ["courses.view", "courses.create", "courses.edit", "courses.publish"],
  },
  {
    id: "cohorts",
    label: "Cohorts",
    noun: "cohorts",
    permissions: ["cohorts.view", "cohorts.manage", "cohorts.publish"],
  },
  {
    id: "enrolments",
    label: "Enrolments",
    noun: "enrolments",
    permissions: ["enrolments.view", "enrolments.manage"],
  },
  {
    id: "attendance",
    label: "Attendance",
    noun: "attendance",
    permissions: ["attendance.view", "attendance.manage"],
  },
  {
    id: "payments",
    label: "Payments",
    noun: "payments",
    permissions: ["payments.view", "payments.confirm", "refunds.manage"],
  },
  {
    id: "assessment",
    label: "Assessment",
    noun: "assessments",
    permissions: [
      "assessments.create",
      "assessments.edit",
      "submissions.view",
      "grades.manage",
    ],
  },
  {
    id: "certificates",
    label: "Certificates",
    noun: "certificates",
    permissions: ["certificates.view", "certificates.issue", "certificates.revoke"],
  },
  {
    id: "support",
    label: "Support",
    noun: "tickets",
    permissions: ["tickets.view", "tickets.manage"],
  },
  {
    id: "reporting",
    label: "Reporting",
    noun: "reports",
    permissions: ["reports.view", "reports.export"],
  },
  { id: "audit", label: "Audit", noun: "audit", permissions: ["audit.view", "audit.export"] },
  {
    id: "licence",
    label: "Licence",
    noun: "licence",
    permissions: ["licence.view", "licence.activate"],
  },
] as const;

export function groupOf(permission: Permission): PermissionGroup | undefined {
  return PERMISSION_GROUPS.find((group) => group.permissions.includes(permission));
}

export type AccessSummaryLine = { group: string; verbs: string[] };

/**
 * D-04's plain-language rule. An entirely empty selection yields an empty
 * array — the preview component renders the locked "grants no access"
 * sentence for that case instead of 14 repetitive "no access" lines.
 */
export function summariseEffectiveAccess(
  selected: readonly string[],
): AccessSummaryLine[] {
  if (selected.length === 0) return [];

  const selectedSet = new Set(selected);

  return PERMISSION_GROUPS.map((group) => {
    const verbs = group.permissions
      .filter((permission) => selectedSet.has(permission))
      .map((permission) => {
        const [prefix, verb] = permission.split(".");
        return prefix === group.noun ? verb : `${verb} ${prefix}`;
      });

    return { group: group.label, verbs: verbs.length > 0 ? verbs : ["no access"] };
  });
}
