/**
 * The licence enforcement registry (Phase 14, plan 14-17; D-09).
 *
 * D-09 requires that "a boundary test must prove no write path is left
 * unguarded". ESLint confines `@prisma/client` to `src/server/services/**` and
 * `src/server/db.ts`, so the service files are the complete database write
 * surface and a per-file registry is the right unit. Every service file that
 * performs a database write (found by the AST scan in
 * `tests/support/licence-write-scan.ts`) must appear here with a kind and a
 * one-sentence reason, and `tests/licence-enforcement-boundary.test.ts` fails
 * for an unregistered writer, a stale entry, or a classification that does not
 * match the file's structure. A new permission, service file or write path
 * therefore cannot ship until it is classified, so new resources inherit
 * enforcement by default.
 *
 * Kinds:
 * - `withPermission`: writes are reached through the permission choke point,
 *   which applies the restricted-state guard by permission effect
 *   (`LICENCE_PERMISSION_EFFECT`, default write). A call site whose permission
 *   spans blocked and continuity operations carries a reviewed override.
 * - `guard`: an entry point outside the choke point that calls
 *   `assertWriteAllowed` explicitly; `guardOperations` lists the operation
 *   strings the file must contain.
 * - `continuity`: learner or identity work that must keep running in the
 *   restricted state (D-06, D-07); documented exemption.
 * - `system`: actorless task, webhook, worker or outbox code allowed by
 *   D-07 and D-08; documented exemption that never imports the permission layer.
 * - `licence`: the licence module's own writes.
 * - `not-a-db-write`: a false positive of the scan (a library call that shares
 *   a write method name).
 *
 * File paths are relative to the repository root with forward slashes. This
 * file is pure data: it imports nothing, so it stays inside the licence
 * purity rules and can be read by tests and, later, by documentation.
 */

export type RegistryKind =
  | "withPermission"
  | "guard"
  | "continuity"
  | "system"
  | "licence"
  | "not-a-db-write";

export type RegistryEntry = {
  file: string;
  kind: RegistryKind;
  reason: string;
  /** Kind `guard` only: operation strings the file must pass to assertWriteAllowed. */
  readonly guardOperations?: readonly string[];
  /** Kind `withPermission` only: a read-effect wrapper that fronts continuity writes. */
  readFrontedWrites?: string;
};

const S = "src/server/services/";

export const LICENCE_SERVICE_REGISTRY: readonly RegistryEntry[] = [
  // ---------------------------------------------------------------- guard
  {
    file: `${S}checkout-service.ts`,
    kind: "guard",
    reason:
      "New checkout sessions are blocked once the deployment is restricted (D-08); retireOpenPaymentAttempts and reads stay allowed",
    guardOperations: ["checkout.start", "checkout.initiate_stripe", "checkout.initiate_paystack"],
  },
  {
    file: `${S}registration-service.ts`,
    kind: "guard",
    reason:
      "New learner registration is blocked (A12); sign-in, verification and reset stay allowed",
    guardOperations: ["registration"],
  },

  // -------------------------------------------------------- withPermission
  {
    file: `${S}assessment-service.ts`,
    kind: "withPermission",
    reason:
      "Assessment authoring runs behind assessments.edit, a content change that is blocked once the deployment is restricted (D-06).",
  },
  {
    file: `${S}assignment-service.ts`,
    kind: "withPermission",
    reason:
      "Role assignment runs behind roles.manage, a staff and permission change that is blocked once the deployment is restricted (D-06).",
  },
  {
    file: `${S}attendance-service.ts`,
    kind: "withPermission",
    reason:
      "attendance.manage is continuity because attendance feeds completion and certificates (A9); attendance.view is a read.",
  },
  {
    file: `${S}certificate-service.ts`,
    kind: "withPermission",
    reason:
      "certificates.issue and certificates.revoke are continuity (D-06 certificate issuance, revoke is corrective); certificates.view is a read.",
  },
  {
    file: `${S}certificate-template-service.ts`,
    kind: "withPermission",
    reason:
      "certificates.manage template authoring is a settings change and stays blocked once the deployment is restricted.",
  },
  {
    file: `${S}cohort-service.ts`,
    kind: "withPermission",
    reason:
      "cohorts.manage and cohorts.publish change settings and publishing and are blocked once the deployment is restricted (D-06).",
  },
  {
    file: `${S}email-delivery-log-service.ts`,
    kind: "withPermission",
    reason:
      "The email-log resend is gated on users.manage (default write) and carries a reviewed continuity override because transactional email must keep flowing (D-07); the file delegates the write to email-dispatch-service.",
  },
  {
    file: `${S}enrolment-service.ts`,
    kind: "withPermission",
    reason:
      "enrolments.manage add, approve, transfer, withdraw and cancel are new-enrolment work and stay blocked; refunds still revoke access internally.",
  },
  {
    file: `${S}grade-override-service.ts`,
    kind: "withPermission",
    reason: "grades.manage is continuity because grading continues in restricted mode (D-06).",
  },
  {
    file: `${S}grading-service.ts`,
    kind: "withPermission",
    reason:
      "grades.manage is continuity because grading continues in restricted mode (D-06); submissions.view is a read.",
  },
  {
    file: `${S}learner-number-service.ts`,
    kind: "withPermission",
    reason:
      "Saving the learner number pattern goes through users.manage, a settings write blocked in restricted mode. Issuing a number is a step of registration, which the registration guard already refuses there.",
  },
  {
    file: `${S}lesson-progress-service.ts`,
    kind: "withPermission",
    reason:
      "The staff progress override is tagged continuity at its call site (A9) and the learner progress functions are not wrapped and are continuity (D-06).",
  },
  {
    file: `${S}lesson-resource-service.ts`,
    kind: "withPermission",
    reason:
      "Lesson resource changes run behind courses.edit, a content change that is blocked once the deployment is restricted (D-06).",
  },
  {
    file: `${S}lesson-service.ts`,
    kind: "withPermission",
    reason:
      "Lesson authoring runs behind courses.edit, a content change that is blocked once the deployment is restricted (D-06).",
  },
  {
    file: `${S}manual-payment-service.ts`,
    kind: "withPermission",
    reason:
      "payments.confirm is continuity because an offline payment already owed can still be confirmed (D-07); the created-before-restriction rule is enforced in settlement (OQ4, A13).",
  },
  {
    file: `${S}module-service.ts`,
    kind: "withPermission",
    reason:
      "Module authoring runs behind courses.edit, a content change that is blocked once the deployment is restricted (D-06).",
  },
  {
    file: `${S}programme-service.ts`,
    kind: "withPermission",
    reason:
      "programmes.manage changes content and settings and is blocked once the deployment is restricted (D-06).",
  },
  {
    file: `${S}publish-service.ts`,
    kind: "withPermission",
    reason:
      "Publishing and unpublishing run behind courses.publish, programmes.publish and the edit permissions, which are blocked once the deployment is restricted (D-06); the terminal-action factory forwards a configured permission.",
  },
  {
    file: `${S}reconciliation-case-service.ts`,
    kind: "withPermission",
    reason:
      "Reconciliation cases are payments work that is continuity by design (D-07, D-08).",
    readFrontedWrites:
      "authorizeCase uses the payments.view read effect to front assignment and resolution, which are continuity (D-07, D-08), so the guard is deliberately not evaluated for them.",
  },
  {
    file: `${S}refund-service.ts`,
    kind: "withPermission",
    reason: "refunds.manage is continuity because refunds and reversals keep working (D-07).",
  },
  {
    file: `${S}reorder-service.ts`,
    kind: "withPermission",
    reason:
      "Reordering content runs behind courses.edit and programmes.manage, which are blocked once the deployment is restricted (D-06).",
  },
  {
    file: `${S}resource-service.ts`,
    kind: "withPermission",
    reason:
      "The generic resource factory forwards the caller-supplied view, create and edit permissions, each classified by effectForPermission at runtime with unclassified strings defaulting to write (D-09).",
  },
  {
    file: `${S}role-service.ts`,
    kind: "withPermission",
    reason:
      "Role edits run behind roles.manage, a staff and permission change that is blocked once the deployment is restricted (D-06); roles.view is a read.",
  },
  {
    file: `${S}scheduled-session-service.ts`,
    kind: "withPermission",
    reason:
      "Session create, update and cancel run behind cohorts.manage, which is blocked once the deployment is restricted (D-06).",
  },
  {
    file: `${S}staff-account-service.ts`,
    kind: "withPermission",
    reason:
      "Staff creation and reactivation stay blocked behind users.manage while deactivation is tagged continuity at its call site as security administration (A10).",
  },
  {
    file: `${S}ticket-service.ts`,
    kind: "withPermission",
    reason:
      "tickets.manage is continuity so support stays available in restricted mode (A11) and the learner ticket functions are not wrapped and are continuity.",
  },

  // ---------------------------------------------------------------- system
  {
    file: `${S}checkout-webhook-system-service.ts`,
    kind: "system",
    reason:
      "Webhook settlement is always recorded and activates only an order initiated before the restriction plus tolerance (D-08, OQ4), with no permission layer.",
  },
  {
    file: `${S}payment-reconciliation-service.ts`,
    kind: "system",
    reason:
      "Scheduled financial reconciliation is actorless and allowed in restricted mode (D-07, D-08).",
  },
  {
    file: `${S}hold-release-system-service.ts`,
    kind: "system",
    reason:
      "The scheduled seat-hold release is actorless cleanup that must keep running (D-07, D-08).",
  },
  {
    file: `${S}upload-cleanup-system-service.ts`,
    kind: "system",
    reason: "The scheduled stale-upload cleanup is actorless housekeeping allowed in restricted mode (D-07).",
  },
  {
    file: `${S}ticket-auto-close-system-service.ts`,
    kind: "system",
    reason: "Scheduled ticket auto-close is actorless support housekeeping (D-07, A11).",
  },
  {
    file: `${S}seat-accounting.ts`,
    kind: "system",
    reason:
      "Seat accounting is a transactional helper called by guarded entry points and by system sweeps, so it carries no guard of its own (D-07, D-08).",
  },
  {
    file: `${S}email-dispatch-service.ts`,
    kind: "system",
    reason: "Email dispatch is transactional outbox delivery that must keep flowing (D-07).",
  },
  {
    file: `${S}email-failure-alert-service.ts`,
    kind: "system",
    reason: "The email failure alert is actorless operational notification (D-07).",
  },
  {
    file: `${S}domain-event-drain-service.ts`,
    kind: "system",
    reason: "The domain-event drain turns outbox rows into notifications and must keep running (D-07).",
  },
  {
    file: `${S}domain-event-service.ts`,
    kind: "system",
    reason:
      "The append-only outbox writer runs inside the caller's transaction and is never blockable (D-07).",
  },
  {
    file: `${S}export-worker-service.ts`,
    kind: "system",
    reason: "The export worker produces already-authorised exports in the background (D-07).",
  },

  // ------------------------------------------------------------ continuity
  {
    file: `${S}attempt-service.ts`,
    kind: "continuity",
    reason: "Learner quiz attempts are coursework that continues in restricted mode (D-06).",
  },
  {
    file: `${S}submission-service.ts`,
    kind: "continuity",
    reason: "Learner submissions are coursework that continues in restricted mode (D-06).",
  },
  {
    file: `${S}assessment-lesson-completion.ts`,
    kind: "continuity",
    reason:
      "Completing a quiz or assignment lesson follows the learner's own attempt or submission, inside that transaction, and continues in restricted mode (D-06).",
  },
  {
    file: `${S}completion-service.ts`,
    kind: "continuity",
    reason: "Completion tracking follows learner progress and continues in restricted mode (D-06).",
  },
  {
    file: `${S}certificate-issuance-service.ts`,
    kind: "continuity",
    reason: "Certificate issuance for earned completion continues in restricted mode (D-06).",
  },
  {
    file: `${S}certificate-file-service.ts`,
    kind: "continuity",
    reason: "Certificate file generation and storage back issued certificates and continue (D-06).",
  },
  {
    file: `${S}auth-service.ts`,
    kind: "continuity",
    reason: "Sign-in and session handling are identity and security work that must stay available (D-07).",
  },
  {
    file: `${S}session-service.ts`,
    kind: "continuity",
    reason: "Session resolution and revocation are identity and security work (D-07).",
  },
  {
    file: `${S}verification-service.ts`,
    kind: "continuity",
    reason: "Email verification stays available in restricted mode (A12, D-07).",
  },
  {
    file: `${S}password-reset-service.ts`,
    kind: "continuity",
    reason: "Password reset stays available in restricted mode (A12, D-07).",
  },
  {
    file: `${S}profile-service.ts`,
    kind: "continuity",
    reason: "Self-service profile edits are an ownership-checked identity concern with no permission wrapper and continue in restricted mode (D-07).",
  },
  {
    file: `${S}email-preference-service.ts`,
    kind: "continuity",
    reason: "Notification preferences are identity-level settings that continue (D-07).",
  },
  {
    file: `${S}notification-service.ts`,
    kind: "continuity",
    reason: "In-product notifications keep working (D-07).",
  },
  {
    file: `${S}ticket-attachment-service.ts`,
    kind: "continuity",
    reason:
      "Ticket attachments belong to support that stays available (A11); it imports the permission layer only for a capability check, not to wrap a write.",
  },
  {
    file: `${S}ticket-context-service.ts`,
    kind: "continuity",
    reason:
      "Ticket context capture belongs to support that stays available (A11); it imports the permission layer only to narrow a read scope, not to wrap a write.",
  },
  {
    file: `${S}export-service.ts`,
    kind: "continuity",
    reason:
      "Report exports are continuity (D-07) and authorise through getCurrentActor and the permission layer's own grant checks instead of withPermission.",
  },
  {
    file: `${S}export-download-service.ts`,
    kind: "continuity",
    reason: "Export downloads are continuity (D-07).",
  },
  {
    file: `${S}audit-service.ts`,
    kind: "continuity",
    reason: "The audit sink must always write, including in restricted mode (D-07).",
  },

  // --------------------------------------------------------------- licence
  {
    file: `${S}licence-service.ts`,
    kind: "licence",
    reason: "The licence module owns the licence state writes and the enforcement gate itself.",
  },
  {
    file: `${S}licence-activation-service.ts`,
    kind: "licence",
    reason:
      "Activation is the recovery route and is reachable only through the licence.activate wrapper in licence-staff-service.",
  },
  {
    file: `${S}licence-notice-service.ts`,
    kind: "licence",
    reason: "Licence notices write outbox events for the licence lifecycle.",
  },

  // -------------------------------------------------------- not-a-db-write
  {
    file: `${S}certificate-pdf-renderer.ts`,
    kind: "not-a-db-write",
    reason: "The only write-named call is the PDF library's PDFDocument.create, which touches no database.",
  },
];

/**
 * The reviewed allowlist of call-site licence overrides (Pitfall 1). Each row
 * is a (file, permission) pair whose permission spans blocked and continuity
 * operations, with the reason carried by the call site. The boundary test
 * compares this list with the scan of the real tree and with a copy hard-coded
 * in the test, so any change must be made in three places on purpose.
 */
export const CONTINUITY_TAG_SNAPSHOT: ReadonlyArray<{
  file: string;
  permission: string;
  reason: string;
}> = [
  {
    file: `${S}lesson-progress-service.ts`,
    permission: "enrolments.manage",
    reason: "Progress recording for existing enrolments continues (D-06, A9)",
  },
  {
    file: `${S}staff-account-service.ts`,
    permission: "users.manage",
    reason: "Deactivation is security administration and stays available (D-07, A10)",
  },
  {
    file: `${S}email-delivery-log-service.ts`,
    permission: "users.manage",
    reason: "Transactional email resend stays available (D-07)",
  },
];

/**
 * Files allowed to pass a non-literal permission to the permission choke point.
 * Each forwards a caller-supplied permission string that resolves through
 * `effectForPermission` at runtime, where any unclassified string defaults to
 * write (D-09).
 */
export const DYNAMIC_PERMISSION_FILES: ReadonlyArray<{ file: string; reason: string }> = [
  {
    file: `${S}resource-service.ts`,
    reason:
      "The generic resource factory forwards the permissions configured by each resource; they resolve through effectForPermission at runtime and any unclassified string defaults to write.",
  },
  {
    file: `${S}publish-service.ts`,
    reason:
      "The terminal-action factory forwards its configured permission; it resolves through effectForPermission at runtime and any unclassified string defaults to write.",
  },
];
