/**
 * The approved permission catalogue.
 *
 * Transcribed from PRD Revision 3 §17.2 (operational domains) and §18.4
 * (licence). This list is closed: PRD RBAC-03 requires that unknown
 * permission strings be rejected, so `Permission` is derived from this
 * tuple and an identifier outside it is a compile error at every call site.
 *
 * Adding an identifier here is a product decision, not an implementation
 * one — it requires the approval path in PRD §1.3.
 */
export const PERMISSIONS = Object.freeze([
  // Users — PRD §17.2
  "users.view",
  "users.manage",

  // Roles — PRD §17.2. roles.manage is subject to the continuity
  // safeguard in RBAC-07.
  "roles.view",
  "roles.manage",

  // Programmes — PRD §17.2
  "programmes.view",
  "programmes.manage",
  "programmes.publish",

  // Courses — PRD §17.2
  "courses.view",
  "courses.create",
  "courses.edit",
  "courses.publish",

  // Cohorts — PRD §17.2
  "cohorts.view",
  "cohorts.manage",
  "cohorts.publish",

  // Enrolments — PRD §17.2
  "enrolments.view",
  "enrolments.manage",

  // Attendance — PRD §17.2
  "attendance.view",
  "attendance.manage",

  // Payments — PRD §17.2. These three stay separate permissions:
  // PRD §19.4 requires viewing, confirming, and refunding to be
  // independently grantable.
  "payments.view",
  "payments.confirm",
  "refunds.manage",

  // Assessment — PRD §17.2
  "assessments.create",
  "assessments.edit",
  "submissions.view",
  "grades.manage",

  // Certificates — PRD §17.2
  "certificates.view",
  "certificates.issue",
  "certificates.revoke",

  // Support — PRD §17.2. SUP-03 requires ticket handling without
  // Administrator status.
  "tickets.view",
  "tickets.manage",

  // Reporting — PRD §17.2
  "reports.view",
  "reports.export",

  // Audit — PRD §17.2
  "audit.view",
  "audit.export",

  // Licence — PRD §18.4. The licence module is deferred, but PXR §11.5
  // lists these as catalogue additions and an unused identifier is free.
  "licence.view",
  "licence.activate",
] as const);

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

/**
 * Runtime guard for values crossing a trust boundary — role definition
 * JSON, imported configuration, request payloads. Inside the codebase the
 * `Permission` type already prevents unknown identifiers.
 */
export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/**
 * Permissions that may only be granted globally, never at Programme,
 * Course, or Cohort scope (PRD §18.4).
 */
export const GLOBAL_ONLY_PERMISSIONS: ReadonlySet<Permission> = new Set([
  "licence.view",
  "licence.activate",
] as const);

export function isGlobalOnly(permission: Permission): boolean {
  return GLOBAL_ONLY_PERMISSIONS.has(permission);
}
