/**
 * The authorization registry for every server action and route handler under
 * `src/app` (Phase 15, plan 15-25; NFR-05, D-09).
 *
 * Pure data, no imports. A server action is a public POST endpoint whatever the
 * UI renders, so the inventory test (`tests/authz-inventory.test.ts`) parses
 * `src/app` and fails when an export is not listed here, an entry is stale, or a
 * public entry is not on the reviewed allow-list. The matrix tests
 * (`tests/authz-bypass*.integration.test.ts`) then call each entry as the wrong
 * people on a real database. Adding an action without deciding who may call it
 * therefore breaks the build.
 *
 * Each entry says who may call it (`class`):
 *   - "permission"          a catalogue permission, checked at `scope`:
 *                             GLOBAL     only a Global grant satisfies it (the scope
 *                                        resolver names no record, or the permission
 *                                        is global-only),
 *                             COLLECTION the permission narrows the rows returned or
 *                                        written (a Programme, Course or Cohort grant
 *                                        reaches only its own),
 *                             RECORD     the scope is resolved from the one record the
 *                                        input names, so a grant on another cohort is
 *                                        refused.
 *                           `permission` is the one the FIRST check names, which is the
 *                           one the `authorization.denied` row records.
 *   - "session-own-record"  any signed-in user, acting only on their own records; a
 *                           visitor with no session is refused.
 *   - "public-signature"    anyone may call it, but the body must carry a valid
 *                           signature (the payment webhooks).
 *   - "public"              anyone may call it. Reviewed one by one: see PUBLIC_ALLOW_LIST.
 *
 * `writes` names the tables (Prisma model names) the code path writes, so the
 * matrix can prove a refusal wrote to none of them. `inputId` selects the builder in
 * `authz-inputs.ts` that produces a schema-valid input for a real record.
 *
 * Entries are kept sorted by file, then export or HTTP method (byte-wise), so
 * results and the evidence file are identical from run to run.
 */

export type AuthzClass = "public" | "public-signature" | "session-own-record" | "permission";

export type PermissionScope = "GLOBAL" | "COLLECTION" | "RECORD";

type EntryCommon = {
  /** Path relative to the repository root, forward slashes. */
  file: string;
  /** The authorization class. */
  class: AuthzClass;
  /** Required when class is "permission": the permission the first check names. */
  permission?: string;
  /** Required when class is "permission". */
  scope?: PermissionScope;
  /** Feature area, for grouping the evidence. */
  domain: string;
  /** Tables the code path writes. Empty for a read. */
  writes: readonly string[];
  /** Selects the input builder in `authz-inputs.ts`. */
  inputId: string;
  /** Why this entry is public, or why a denial leaves no audit row. */
  reason?: string;
  /**
   * Plan 15-26: the record states in which a fully authorised caller must still be
   * refused (for example an archived course, a cancelled enrolment, a paid order, a
   * closed ticket). `tests/authz-scope-state.integration.test.ts` calls the entry once per
   * listed state; `tests/support/authz-scope-fixtures.ts` (`STATE_CASES`) says how each
   * state is built, and the test fails if the two disagree.
   */
  recordStates?: readonly string[];
  /**
   * A staff denial normally leaves an `authorization.denied` row naming the
   * permission. False for the few entries that authorize without the audited
   * choke point, or whose refusal is a quiet empty answer by design; `reason`
   * says why.
   */
  denialAudit?: boolean;
  /** The refusal is a null return (a read that answers "nothing for you"). */
  nullMeansRefused?: boolean;
  /**
   * The action takes no record id: it only ever acts on the signed-in person's own
   * data (or on nothing), so there is no "someone else's record" to name. The matrix
   * then runs the anonymous case only.
   */
  selfOnly?: boolean;
  /**
   * The action takes no input at all, so there is no empty or invalid input to
   * probe (the empty-input case is skipped for it).
   */
  noInput?: boolean;
  /**
   * The unauthenticated refusal is a thrown authentication error rather than a
   * mapped result; true when the action does not catch it (the framework turns it
   * into an error page, and nothing was written).
   */
  throwsWhenDenied?: boolean;
  /**
   * An empty submission is a legitimate request for this entry (an unchecked box
   * submits an empty form, which means "no"), so the privileged empty-input probe,
   * which expects no write, does not apply. `reason` says why.
   */
  emptyInputIsValid?: boolean;
  /**
   * The change is deliberately open to a holder of the (view) permission named in
   * `permission`: no change permission exists for it in the closed catalogue, so
   * the staff-with-only-view-permissions probe does not apply. `reason` records the
   * decision so an owner can revisit it.
   */
  viewPermissionSuffices?: boolean;
  /**
   * A positive control: the persona that IS allowed (`learnerOwner` or
   * `staffGlobal`), run after every refusal case. It proves the entry is not
   * simply refusing everyone (a dead route or an input that never validates). Only
   * set where the call is safe and local: reads, and routes that only presign.
   */
  allowedPersona?: "learnerOwner" | "staffGlobal";
  /**
   * For an entry whose denial writes no audit row: text the refusal message must
   * contain, so the refusal is known to be the authorization one and not an input
   * rejection (the input is valid by construction).
   */
  denialMessage?: string;
  /** For a route with `allowedPersona`: the statuses that count as allowed (default 200, 201, 204, 302). */
  allowedStatuses?: readonly number[];
};

export type ActionRegistryEntry = EntryCommon & {
  /** The exported function name. */
  exportName: string;
};

export type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

export type RouteRegistryEntry = EntryCommon & {
  /** The exported HTTP verb. */
  method: RouteMethod;
  /** The public URL pattern, for the evidence and the reader. */
  route: string;
  /** Statuses that count as a refusal for this route (the denial-parity rule). */
  deniedStatuses: readonly number[];
  /**
   * Further input ids to run through the same matrix: opt-in variants that sit
   * behind the same check (for example `?caption=1`).
   */
  variantInputIds?: readonly string[];
};

/**
 * Entries allowed to be class "public" or "public-signature", keyed
 * `file#exportName` (actions) or `file#METHOD` (routes), each with the reason it
 * is safe. Reviewed individually; the inventory test fails for a public entry that
 * is not listed here, and for a listed key that is not a public entry.
 */
export const PUBLIC_ALLOW_LIST: Readonly<Record<string, string>> = Object.freeze({
  "src/app/(auth)/forgot-password/actions.ts#forgotPasswordAction":
    "Pre-session password reset request; replies with one neutral state whatever the address, rate limited per device.",
  "src/app/(auth)/register/actions.ts#registerAction":
    "Pre-session registration; learner accounts only, rate limited per device, no staff role can be requested.",
  "src/app/(auth)/reset-password/actions.ts#resetPasswordAction":
    "Pre-session password reset; authorized by the single-use emailed token, which the service hashes and checks.",
  "src/app/(auth)/signin/actions.ts#signInAction":
    "Pre-session sign-in; throttled per device and per address, one generic failure message.",
  "src/app/(auth)/verify/actions.ts#resendVerificationAction":
    "Pre-session verification resend; one neutral state whatever the address, per-address cooldown and per-device limit.",
  "src/app/api/health/route.ts#GET":
    "Public uptime probe; no input, answers one of two fixed bodies, reads nothing but SELECT 1.",
  "src/app/api/health/route.ts#HEAD":
    "Public uptime probe; same fixed status as GET with no body.",
  "src/app/api/webhooks/paystack/route.ts#POST":
    "Provider webhook; the HMAC signature over the raw body is verified before anything is recorded or settled.",
  "src/app/api/webhooks/stripe/route.ts#POST":
    "Provider webhook; the Stripe signature over the raw body is verified before anything is recorded or settled.",
  "src/app/staff/certificates/issued/[id]/certificate-record-actions.ts#validateReissueCertificateInput":
    "Pure schema validation exported for tests; parses its argument and returns the result, reads and writes nothing.",
  "src/app/staff/certificates/issued/[id]/certificate-record-actions.ts#validateRevokeCertificateInput":
    "Pure schema validation exported for tests; parses its argument and returns the result, reads and writes nothing.",
});

// ---------------------------------------------------------------------------
// Compact constructors. Pure functions over literals, so the registry stays data.
// ---------------------------------------------------------------------------

type Spec = Omit<EntryCommon, "file">;

const act = (file: string, exportName: string, spec: Spec): ActionRegistryEntry => ({ file, exportName, ...spec });

const route = (
  file: string,
  method: RouteMethod,
  url: string,
  deniedStatuses: readonly number[],
  spec: Spec & { variantInputIds?: readonly string[] },
): RouteRegistryEntry => ({ file, method, route: url, deniedStatuses, ...spec });

const perm = (permission: string, scope: PermissionScope) => ({ class: "permission" as const, permission, scope });
const own = { class: "session-own-record" as const };
const open = { class: "public" as const };

const AUDIT = "AuditEvent";
const EVENT = "DomainEvent";

const EXPORT_QUEUE_WRITES = ["ExportJob", "ExportSnapshotRow", AUDIT] as const;
const RECONCILIATION_TRIAGE_REASON =
  "Phase 8 design: assigning and resolving a reconciliation case is case triage, gated by payments.view at the case's cohort scope (the catalogue has no reconciliation permission and adding one is a product decision). It never moves money or enrolments.";
const EXPORT_NO_DENIAL_ROW =
  "The export service authorizes inside its own transaction from the caller's grants and throws; it does not use the audited choke point, so a refusal writes no authorization.denied row.";

export const ACTION_REGISTRY: readonly ActionRegistryEntry[] = [
  // ---- (auth) ----
  act("src/app/(auth)/forgot-password/actions.ts", "forgotPasswordAction", {
    ...open, domain: "auth", writes: ["VerificationToken", "EmailDispatch", "LoginThrottle"], inputId: "auth.forgotPassword",
    reason: "Pre-session by design.",
  }),
  act("src/app/(auth)/register/actions.ts", "registerAction", {
    ...open, domain: "auth", writes: ["User", "PolicyAcceptance", "VerificationToken", "EmailDispatch", "LoginThrottle"], inputId: "auth.register",
    reason: "Pre-session by design.",
  }),
  act("src/app/(auth)/reset-password/actions.ts", "resetPasswordAction", {
    ...open, domain: "auth", writes: ["User", "VerificationToken", "Session"], inputId: "auth.resetPassword",
    reason: "Pre-session by design.",
  }),
  act("src/app/(auth)/signin/actions.ts", "signInAction", {
    ...open, domain: "auth", writes: ["Session", "User", "LoginThrottle", AUDIT], inputId: "auth.signIn",
    reason: "Pre-session by design.",
  }),
  act("src/app/(auth)/signin/actions.ts", "signOutAction", {
    ...own, domain: "auth", writes: ["Session", AUDIT], inputId: "auth.signOut", selfOnly: true, noInput: true,
  }),
  act("src/app/(auth)/verify/actions.ts", "resendVerificationAction", {
    ...open, domain: "auth", writes: ["VerificationToken", "EmailDispatch", "LoginThrottle"], inputId: "auth.resendVerification",
    reason: "Pre-session by design.",
  }),

  // ---- (checkout) ----
  act("src/app/(checkout)/actions.ts", "enrollAction", {
    ...own, domain: "checkout", writes: ["Order", "Enrolment", "Cohort", AUDIT], inputId: "checkout.enroll", selfOnly: true,
  }),
  act("src/app/(checkout)/checkout/[orderId]/actions.ts", "payAction", {
    ...own, domain: "checkout", writes: ["PaymentAttempt", "Order", "PolicyAcceptance", AUDIT], inputId: "checkout.pay", recordStates: ["order:PAID", "order:CANCELLED"],
  }),

  // ---- (learner) support ----
  act("src/app/(learner)/support/[reference]/actions.ts", "closeTicketAction", {
    ...own, domain: "learner-support", writes: ["Ticket", "TicketEvent", EVENT, AUDIT], inputId: "learnerSupport.close", recordStates: ["ticket:CLOSED", "ticket:OPEN"],
  }),
  act("src/app/(learner)/support/[reference]/actions.ts", "reopenTicketAction", {
    ...own, domain: "learner-support", writes: ["Ticket", "TicketMessage", "TicketEvent", EVENT, AUDIT], inputId: "learnerSupport.reopen", recordStates: ["ticket:CLOSED", "ticket:OPEN"],
  }),
  act("src/app/(learner)/support/[reference]/actions.ts", "replyToTicketAction", {
    ...own, domain: "learner-support", writes: ["Ticket", "TicketMessage", "TicketEvent", EVENT, AUDIT], inputId: "learnerSupport.reply", recordStates: ["ticket:CLOSED", "ticket:RESOLVED"],
  }),
  act("src/app/(learner)/support/new/actions.ts", "createTicketAction", {
    ...own, domain: "learner-support", writes: ["Ticket", "TicketMessage", "TicketEvent", "LoginThrottle", EVENT, AUDIT], inputId: "learnerSupport.create", selfOnly: true,
  }),

  // ---- (lesson) ----
  act("src/app/(lesson)/learn/[enrolmentId]/lessons/[lessonId]/actions.ts", "markLessonCompleteAction", {
    ...own, domain: "learner-lesson", writes: ["LessonProgress", "CompletionRecord", EVENT, AUDIT], inputId: "lesson.markComplete", recordStates: ["enrolment:CANCELLED"],
  }),
  act("src/app/(lesson)/learn/[enrolmentId]/lessons/[lessonId]/actions.ts", "recordWatchProgressAction", {
    ...own, domain: "learner-lesson", writes: ["LessonWatchProgress", "LessonProgress", "CompletionRecord", EVENT, AUDIT], inputId: "lesson.watchProgress", recordStates: ["enrolment:CANCELLED"],
  }),
  act("src/app/(lesson)/learn/[enrolmentId]/lessons/[lessonId]/actions.ts", "undoLessonCompleteAction", {
    ...own, domain: "learner-lesson", writes: ["LessonProgress", "CompletionRecord", EVENT, AUDIT], inputId: "lesson.undoComplete", recordStates: ["enrolment:CANCELLED"],
  }),
  act("src/app/(lesson)/learn/[enrolmentId]/lessons/[lessonId]/assessment-actions.ts", "saveAttemptAnswersAction", {
    ...own, domain: "learner-assessment", writes: ["Attempt"], inputId: "quiz.saveAnswers", recordStates: ["attempt:SUBMITTED"],
  }),
  act("src/app/(lesson)/learn/[enrolmentId]/lessons/[lessonId]/assessment-actions.ts", "startAttemptAction", {
    ...own, domain: "learner-assessment", writes: ["Attempt"], inputId: "quiz.start", recordStates: ["enrolment:CANCELLED"],
  }),
  act("src/app/(lesson)/learn/[enrolmentId]/lessons/[lessonId]/assessment-actions.ts", "submitAttemptAction", {
    ...own, domain: "learner-assessment", writes: ["Attempt", "Grade", "CompletionRecord", EVENT], inputId: "quiz.submit", recordStates: ["attempt:SUBMITTED"],
  }),
  act("src/app/(lesson)/learn/[enrolmentId]/lessons/[lessonId]/submission-actions.ts", "beginSubmissionUploadAction", {
    ...own, domain: "learner-assessment", writes: ["Submission"], inputId: "submission.begin", recordStates: ["enrolment:CANCELLED"],
  }),
  act("src/app/(lesson)/learn/[enrolmentId]/lessons/[lessonId]/submission-actions.ts", "completeSubmissionUploadAction", {
    ...own, domain: "learner-assessment", writes: ["Submission", EVENT], inputId: "submission.complete",
  }),
  act("src/app/(lesson)/learn/[enrolmentId]/lessons/[lessonId]/submission-actions.ts", "failSubmissionUploadAction", {
    ...own, domain: "learner-assessment", writes: ["Submission"], inputId: "submission.fail",
  }),
  act("src/app/(lesson)/learn/[enrolmentId]/lessons/[lessonId]/submission-actions.ts", "loadAssignmentSubmissionView", {
    ...own, domain: "learner-assessment", writes: [], inputId: "submission.loadView", nullMeansRefused: true,
  }),

  // ---- account and notifications ----
  act("src/app/account/actions.ts", "requestEmailChangeAction", {
    ...own, domain: "account", writes: ["User", "VerificationToken", "EmailDispatch", AUDIT], inputId: "account.requestEmailChange", selfOnly: true,
  }),
  act("src/app/account/actions.ts", "setMarketingPreferenceAction", {
    ...own, domain: "account", writes: ["PolicyAcceptance", AUDIT], inputId: "account.setMarketing", selfOnly: true,
    emptyInputIsValid: true,
    reason: "An unchecked marketing box submits an empty form, which is a valid opt-out of the caller's own preference.",
  }),
  act("src/app/account/actions.ts", "updateProfileAction", {
    ...own, domain: "account", writes: ["User", AUDIT], inputId: "account.updateProfile", selfOnly: true,
  }),
  act("src/app/notifications/actions.ts", "markAllNotificationsReadAction", {
    ...own, domain: "notifications", writes: ["Notification"], inputId: "notifications.markAllRead", selfOnly: true, noInput: true,
  }),
  act("src/app/notifications/actions.ts", "openNotificationAction", {
    ...own, domain: "notifications", writes: ["Notification"], inputId: "notifications.open",
  }),
  act("src/app/notifications/actions.ts", "saveEmailPreferencesAction", {
    ...own, domain: "notifications", writes: ["EmailPreference"], inputId: "notifications.savePreferences", selfOnly: true,
  }),

  // ---- staff: audit ----
  act("src/app/staff/audit/actions.ts", "requestAuditExportAction", {
    ...perm("audit.view", "GLOBAL"), domain: "audit", writes: EXPORT_QUEUE_WRITES, inputId: "audit.requestExport",
    denialAudit: false, reason: EXPORT_NO_DENIAL_ROW, denialMessage: "not authorised",
  }),

  // ---- staff: certificates ----
  act("src/app/staff/certificates/certificate-actions.ts", "issueCertificateAction", {
    ...perm("certificates.issue", "RECORD"), domain: "certificates", writes: ["Certificate", "Enrolment", EVENT, AUDIT], inputId: "certificates.issue", recordStates: ["enrolment:CANCELLED", "certificate:ACTIVE"],
  }),
  act("src/app/staff/certificates/issued/[id]/certificate-record-actions.ts", "confirmFlaggedCertificateAction", {
    ...perm("certificates.revoke", "RECORD"), domain: "certificates", writes: ["Certificate", AUDIT], inputId: "certificates.confirmFlagged", recordStates: ["certificate:REVOKED", "certificate:SUPERSEDED"],
  }),
  act("src/app/staff/certificates/issued/[id]/certificate-record-actions.ts", "reissueCertificateAction", {
    ...perm("certificates.issue", "RECORD"), domain: "certificates", writes: ["Certificate", EVENT, AUDIT], inputId: "certificates.reissue",
  }),
  act("src/app/staff/certificates/issued/[id]/certificate-record-actions.ts", "revokeCertificateAction", {
    ...perm("certificates.revoke", "RECORD"), domain: "certificates", writes: ["Certificate", EVENT, AUDIT], inputId: "certificates.revoke", recordStates: ["certificate:REVOKED", "certificate:SUPERSEDED"],
  }),
  act("src/app/staff/certificates/issued/[id]/certificate-record-actions.ts", "validateReissueCertificateInput", {
    ...open, domain: "certificates", writes: [], inputId: "certificates.validateReissue", reason: "Pure validator.",
  }),
  act("src/app/staff/certificates/issued/[id]/certificate-record-actions.ts", "validateRevokeCertificateInput", {
    ...open, domain: "certificates", writes: [], inputId: "certificates.validateRevoke", reason: "Pure validator.",
  }),
  act("src/app/staff/certificates/templates/template-actions.ts", "archiveTemplateAction", {
    ...perm("certificates.manage", "GLOBAL"), domain: "certificates", writes: ["CertificateTemplate", AUDIT], inputId: "templates.archive",
  }),
  act("src/app/staff/certificates/templates/template-actions.ts", "createTemplateAction", {
    ...perm("certificates.manage", "GLOBAL"), domain: "certificates", writes: ["CertificateTemplate", AUDIT], inputId: "templates.create",
  }),
  act("src/app/staff/certificates/templates/template-actions.ts", "saveTemplateLayoutAction", {
    ...perm("certificates.manage", "GLOBAL"), domain: "certificates", writes: ["CertificateTemplate", AUDIT], inputId: "templates.saveLayout",
  }),
  act("src/app/staff/certificates/templates/template-actions.ts", "setDefaultTemplateAction", {
    ...perm("certificates.manage", "GLOBAL"), domain: "certificates", writes: ["CertificateTemplate", AUDIT], inputId: "templates.setDefault", recordStates: ["template:ARCHIVED"],
  }),
  act("src/app/staff/certificates/templates/template-asset-actions.ts", "confirmTemplateAssetUploadAction", {
    ...perm("certificates.manage", "GLOBAL"), domain: "certificates", writes: [], inputId: "templates.confirmAsset",
  }),
  act("src/app/staff/certificates/templates/template-asset-actions.ts", "presignTemplateAssetUploadAction", {
    ...perm("certificates.manage", "GLOBAL"), domain: "certificates", writes: [], inputId: "templates.presignAsset",
  }),

  // ---- staff: cohorts ----
  act("src/app/staff/cohorts/[id]/attendance-actions.ts", "correctAttendanceAction", {
    ...perm("attendance.manage", "RECORD"), domain: "attendance", writes: ["AttendanceRecord", EVENT, AUDIT], inputId: "attendance.correct", recordStates: ["session:CANCELLED"],
  }),
  act("src/app/staff/cohorts/[id]/attendance-actions.ts", "saveAttendanceAction", {
    ...perm("attendance.manage", "RECORD"), domain: "attendance", writes: ["AttendanceRecord", EVENT, AUDIT], inputId: "attendance.save", recordStates: ["session:CANCELLED"],
  }),
  act("src/app/staff/cohorts/[id]/enrolment-actions.ts", "addEnrolmentAction", {
    ...perm("enrolments.manage", "RECORD"), domain: "enrolments", writes: ["Enrolment", "Cohort", EVENT, AUDIT], inputId: "enrolments.add", recordStates: ["cohort:CANCELLED", "cohort:COMPLETED"],
  }),
  act("src/app/staff/cohorts/[id]/enrolment-actions.ts", "addEnrolmentsAction", {
    ...perm("enrolments.manage", "RECORD"), domain: "enrolments", writes: ["Enrolment", "Cohort", EVENT, AUDIT], inputId: "enrolments.addMany", recordStates: ["cohort:CANCELLED", "cohort:COMPLETED"],
  }),
  act("src/app/staff/cohorts/[id]/enrolment-actions.ts", "approveEnrolmentAction", {
    ...perm("enrolments.manage", "RECORD"), domain: "enrolments", writes: ["Enrolment", "Cohort", EVENT, AUDIT], inputId: "enrolments.approve", recordStates: ["enrolment:CANCELLED", "enrolment:WITHDRAWN", "cohort:COMPLETED"],
  }),
  act("src/app/staff/cohorts/[id]/enrolment-actions.ts", "cancelEnrolmentAction", {
    ...perm("enrolments.manage", "RECORD"), domain: "enrolments", writes: ["Enrolment", "Cohort", EVENT, AUDIT], inputId: "enrolments.cancel", recordStates: ["enrolment:CANCELLED", "enrolment:WITHDRAWN"],
  }),
  act("src/app/staff/cohorts/[id]/enrolment-actions.ts", "listEnrolmentCandidatesAction", {
    ...perm("enrolments.manage", "RECORD"), domain: "enrolments", writes: [], inputId: "enrolments.listCandidates", allowedPersona: "staffGlobal",
  }),
  act("src/app/staff/cohorts/[id]/enrolment-actions.ts", "transferEnrolmentAction", {
    ...perm("enrolments.manage", "RECORD"), domain: "enrolments", writes: ["Enrolment", "Cohort", EVENT, AUDIT], inputId: "enrolments.transfer", recordStates: ["enrolment:CANCELLED", "enrolment:WITHDRAWN"],
  }),
  act("src/app/staff/cohorts/[id]/enrolment-actions.ts", "withdrawEnrolmentAction", {
    ...perm("enrolments.manage", "RECORD"), domain: "enrolments", writes: ["Enrolment", "Cohort", EVENT, AUDIT], inputId: "enrolments.withdraw", recordStates: ["enrolment:CANCELLED", "enrolment:WITHDRAWN"],
  }),
  act("src/app/staff/cohorts/[id]/grading-actions.ts", "releaseGradesBatchAction", {
    ...perm("submissions.view", "RECORD"), domain: "grading", writes: ["Grade", EVENT, AUDIT], inputId: "grading.releaseBatch",
  }),
  act("src/app/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/actions.ts", "overrideGradeAction", {
    ...perm("grades.manage", "RECORD"), domain: "grading", writes: ["Grade", "GradeOverride", EVENT, AUDIT], inputId: "grading.override", recordStates: ["grade:DRAFT"],
  }),
  act("src/app/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/actions.ts", "releaseGradeAction", {
    ...perm("grades.manage", "RECORD"), domain: "grading", writes: ["Grade", EVENT, AUDIT], inputId: "grading.release", recordStates: ["grade:RELEASED"],
  }),
  act("src/app/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/actions.ts", "saveDraftGradeAction", {
    ...perm("grades.manage", "RECORD"), domain: "grading", writes: ["Grade", AUDIT], inputId: "grading.saveDraft", recordStates: ["grade:RELEASED"],
  }),
  act("src/app/staff/cohorts/[id]/instructor-actions.ts", "assignInstructorAction", {
    ...perm("cohorts.manage", "RECORD"), domain: "cohorts", writes: ["CohortInstructor", AUDIT], inputId: "instructors.assign",
  }),
  act("src/app/staff/cohorts/[id]/instructor-actions.ts", "listInstructorCandidatesAction", {
    ...perm("cohorts.manage", "RECORD"), domain: "cohorts", writes: [], inputId: "instructors.listCandidates", allowedPersona: "staffGlobal",
  }),
  act("src/app/staff/cohorts/[id]/instructor-actions.ts", "removeInstructorAction", {
    ...perm("cohorts.manage", "RECORD"), domain: "cohorts", writes: ["CohortInstructor", AUDIT], inputId: "instructors.remove",
  }),
  act("src/app/staff/cohorts/[id]/progress-actions.ts", "overrideLessonProgressAction", {
    ...perm("enrolments.manage", "RECORD"), domain: "enrolments", writes: ["LessonProgress", "CompletionRecord", EVENT, AUDIT], inputId: "progress.override", recordStates: ["enrolment:CANCELLED"],
  }),
  act("src/app/staff/cohorts/[id]/publish-actions.ts", "cancelCohortAction", {
    ...perm("cohorts.manage", "RECORD"), domain: "cohorts", writes: ["Cohort", "Enrolment", "ScheduledSession", EVENT, AUDIT], inputId: "cohorts.cancel", recordStates: ["cohort:CANCELLED"],
  }),
  act("src/app/staff/cohorts/[id]/publish-actions.ts", "publishCohortAction", {
    ...perm("cohorts.publish", "RECORD"), domain: "cohorts", writes: ["Cohort", EVENT, AUDIT], inputId: "cohorts.publish", recordStates: ["cohort:CANCELLED", "cohort:COMPLETED"],
  }),
  act("src/app/staff/cohorts/[id]/session-actions.ts", "cancelSessionAction", {
    ...perm("cohorts.manage", "RECORD"), domain: "cohorts", writes: ["ScheduledSession", EVENT, AUDIT], inputId: "sessions.cancel", recordStates: ["session:CANCELLED"],
  }),
  act("src/app/staff/cohorts/[id]/session-actions.ts", "createSessionAction", {
    ...perm("cohorts.manage", "RECORD"), domain: "cohorts", writes: ["ScheduledSession", EVENT, AUDIT], inputId: "sessions.create",
  }),
  act("src/app/staff/cohorts/[id]/session-actions.ts", "repeatWeeklyAction", {
    ...perm("cohorts.manage", "RECORD"), domain: "cohorts", writes: ["ScheduledSession", EVENT, AUDIT], inputId: "sessions.repeatWeekly",
  }),
  act("src/app/staff/cohorts/[id]/session-actions.ts", "updateSessionAction", {
    ...perm("cohorts.manage", "RECORD"), domain: "cohorts", writes: ["ScheduledSession", EVENT, AUDIT], inputId: "sessions.update", recordStates: ["session:CANCELLED"],
  }),
  act("src/app/staff/cohorts/actions.ts", "createCohortAction", {
    ...perm("cohorts.manage", "GLOBAL"), domain: "cohorts", writes: ["Cohort", AUDIT], inputId: "cohorts.create",
  }),
  act("src/app/staff/cohorts/actions.ts", "updateCohortAction", {
    ...perm("cohorts.manage", "RECORD"), domain: "cohorts", writes: ["Cohort", AUDIT], inputId: "cohorts.update",
  }),

  // ---- staff: courses ----
  act("src/app/staff/courses/[id]/arrange/actions.ts", "createModuleAction", {
    ...perm("courses.edit", "RECORD"), domain: "courses", writes: ["Module", AUDIT], inputId: "arrange.createModule",
  }),
  act("src/app/staff/courses/[id]/arrange/actions.ts", "renameModuleAction", {
    ...perm("courses.edit", "RECORD"), domain: "courses", writes: ["Module", AUDIT], inputId: "arrange.renameModule",
  }),
  act("src/app/staff/courses/[id]/arrange/actions.ts", "restoreItemAction", {
    ...perm("courses.edit", "RECORD"), domain: "courses", writes: ["Module", "Lesson", AUDIT], inputId: "arrange.restoreItem",
  }),
  act("src/app/staff/courses/[id]/arrange/actions.ts", "saveLessonArrangementAction", {
    ...perm("courses.edit", "RECORD"), domain: "courses", writes: ["Lesson", "Course", AUDIT], inputId: "arrange.saveLessons",
  }),
  act("src/app/staff/courses/[id]/arrange/actions.ts", "saveModuleOrderAction", {
    ...perm("courses.edit", "RECORD"), domain: "courses", writes: ["Module", "Course", AUDIT], inputId: "arrange.saveModules",
  }),
  act("src/app/staff/courses/[id]/arrange/actions.ts", "withdrawItemAction", {
    ...perm("courses.edit", "RECORD"), domain: "courses", writes: ["Module", "Lesson", AUDIT], inputId: "arrange.withdrawItem",
  }),
  act("src/app/staff/courses/[id]/assessments/actions.ts", "archiveAssessmentAction", {
    ...perm("assessments.edit", "RECORD"), domain: "assessments", writes: ["Assessment", AUDIT], inputId: "assessments.archive",
  }),
  act("src/app/staff/courses/[id]/assessments/actions.ts", "createAssessmentAction", {
    ...perm("assessments.create", "RECORD"), domain: "assessments", writes: ["Assessment", AUDIT], inputId: "assessments.create",
  }),
  act("src/app/staff/courses/[id]/assessments/actions.ts", "publishAssessmentAction", {
    ...perm("assessments.edit", "RECORD"), domain: "assessments", writes: ["Assessment", AUDIT], inputId: "assessments.publish",
  }),
  act("src/app/staff/courses/[id]/assessments/actions.ts", "updateAssessmentAction", {
    ...perm("assessments.edit", "RECORD"), domain: "assessments", writes: ["Assessment", AUDIT], inputId: "assessments.update",
  }),
  act("src/app/staff/courses/[id]/assessments/question-actions.ts", "saveQuizQuestionsAction", {
    ...perm("courses.view", "RECORD"), domain: "assessments", writes: ["QuizQuestion", "QuizOption", "Assessment", AUDIT], inputId: "assessments.saveQuestions",
  }),
  act("src/app/staff/courses/[id]/lessons/[lessonId]/actions.ts", "saveLessonAction", {
    ...perm("courses.edit", "RECORD"), domain: "courses", writes: ["Lesson", AUDIT], inputId: "lessons.save",
  }),
  act("src/app/staff/courses/[id]/lessons/[lessonId]/actions.ts", "withdrawLessonAction", {
    ...perm("courses.edit", "RECORD"), domain: "courses", writes: ["Lesson", AUDIT], inputId: "lessons.withdraw",
  }),
  act("src/app/staff/courses/[id]/publish-actions.ts", "archiveCourseAction", {
    ...perm("courses.edit", "RECORD"), domain: "courses", writes: ["Course", AUDIT], inputId: "coursePublish.archive",
  }),
  act("src/app/staff/courses/[id]/publish-actions.ts", "publishCourseAction", {
    ...perm("courses.publish", "RECORD"), domain: "courses", writes: ["Course", "CoursePublication", "Cohort", EVENT, AUDIT], inputId: "coursePublish.publish", recordStates: ["course:ARCHIVED"],
  }),
  act("src/app/staff/courses/[id]/publish-actions.ts", "setListingAction", {
    ...perm("programmes.publish", "RECORD"), domain: "courses", writes: ["Course", AUDIT], inputId: "coursePublish.setListing",
  }),
  act("src/app/staff/courses/[id]/publish-actions.ts", "unarchiveCourseAction", {
    ...perm("courses.edit", "RECORD"), domain: "courses", writes: ["Course", AUDIT], inputId: "coursePublish.unarchive", recordStates: ["course:PUBLISHED", "course:DRAFT"],
  }),
  act("src/app/staff/courses/[id]/publish-actions.ts", "unpublishCourseAction", {
    ...perm("courses.publish", "RECORD"), domain: "courses", writes: ["Course", AUDIT], inputId: "coursePublish.unpublish",
  }),
  act("src/app/staff/courses/actions.ts", "createCourseAction", {
    ...perm("courses.create", "GLOBAL"), domain: "courses", writes: ["Course", AUDIT], inputId: "courses.create",
  }),
  act("src/app/staff/courses/actions.ts", "updateCourseAction", {
    ...perm("courses.view", "RECORD"), domain: "courses", writes: ["Course", AUDIT], inputId: "courses.update",
  }),

  // ---- staff: email, learner numbers, licence, payments, privacy ----
  act("src/app/staff/email-log/actions.ts", "resendEmailAction", {
    ...perm("users.manage", "GLOBAL"), domain: "email", writes: ["EmailDispatch", AUDIT], inputId: "emailLog.resend",
  }),
  act("src/app/staff/learner-numbers/actions.ts", "backfillLearnerNumbersAction", {
    ...perm("users.manage", "GLOBAL"), domain: "learner-numbers", writes: ["User", "LearnerNumberConfig", AUDIT], inputId: "learnerNumbers.backfill", noInput: true,
  }),
  act("src/app/staff/learner-numbers/actions.ts", "saveLearnerNumberPatternAction", {
    ...perm("users.manage", "GLOBAL"), domain: "learner-numbers", writes: ["LearnerNumberConfig", AUDIT], inputId: "learnerNumbers.savePattern",
  }),
  act("src/app/staff/licence/actions.ts", "activateLicenceAction", {
    ...perm("licence.activate", "GLOBAL"), domain: "licence", writes: ["LicenceRecord", "LicenceState", AUDIT], inputId: "licence.activate",
  }),
  act("src/app/staff/licence/actions.ts", "inspectLicenceAction", {
    ...perm("licence.activate", "GLOBAL"), domain: "licence", writes: [], inputId: "licence.inspect", allowedPersona: "staffGlobal",
  }),
  act("src/app/staff/payments/actions.ts", "confirmManualPaymentAction", {
    ...perm("payments.confirm", "RECORD"), domain: "payments", writes: ["Order", "PaymentAttempt", "Enrolment", EVENT, AUDIT], inputId: "payments.confirmManual", recordStates: ["order:PAID", "order:REFUNDED"],
  }),
  act("src/app/staff/payments/actions.ts", "recordRefundAction", {
    ...perm("refunds.manage", "RECORD"), domain: "payments", writes: ["Refund", "Order", EVENT, AUDIT], inputId: "payments.recordRefund", recordStates: ["order:PENDING", "order:CANCELLED", "order:REFUNDED"],
  }),
  act("src/app/staff/privacy/actions.ts", "anonymiseLearnerAction", {
    ...perm("privacy.manage", "GLOBAL"),
    domain: "privacy",
    writes: ["User", "Session", "Account", "EmailPreference", "Notification", "VerificationToken", "LoginThrottle", AUDIT],
    inputId: "privacy.anonymise", recordStates: ["user:ANONYMISED"],
  }),
  act("src/app/staff/privacy/actions.ts", "requestLearnerExportAction", {
    ...perm("privacy.manage", "GLOBAL"), domain: "privacy", writes: EXPORT_QUEUE_WRITES, inputId: "privacy.requestExport",
  }),

  // ---- staff: programmes ----
  act("src/app/staff/programmes/[id]/arrange/actions.ts", "addCourseAction", {
    ...perm("programmes.manage", "RECORD"), domain: "programmes", writes: ["ProgrammeCourse", AUDIT], inputId: "programmeArrange.addCourse",
  }),
  act("src/app/staff/programmes/[id]/arrange/actions.ts", "removeCourseAction", {
    ...perm("programmes.manage", "RECORD"), domain: "programmes", writes: ["ProgrammeCourse", AUDIT], inputId: "programmeArrange.removeCourse",
  }),
  act("src/app/staff/programmes/[id]/arrange/actions.ts", "saveProgrammeCourseOrderAction", {
    ...perm("programmes.manage", "RECORD"), domain: "programmes", writes: ["ProgrammeCourse", "Programme", AUDIT], inputId: "programmeArrange.saveOrder",
  }),
  act("src/app/staff/programmes/[id]/publish-actions.ts", "archiveProgrammeAction", {
    ...perm("programmes.manage", "RECORD"), domain: "programmes", writes: ["Programme", AUDIT], inputId: "programmePublish.archive",
  }),
  act("src/app/staff/programmes/[id]/publish-actions.ts", "publishProgrammeAction", {
    ...perm("programmes.publish", "RECORD"), domain: "programmes", writes: ["Programme", "ProgrammePublication", "Cohort", EVENT, AUDIT], inputId: "programmePublish.publish", recordStates: ["programme:ARCHIVED"],
  }),
  act("src/app/staff/programmes/[id]/publish-actions.ts", "setProgrammeListingAction", {
    ...perm("programmes.publish", "RECORD"), domain: "programmes", writes: ["Programme", AUDIT], inputId: "programmePublish.setListing",
  }),
  act("src/app/staff/programmes/[id]/publish-actions.ts", "unarchiveProgrammeAction", {
    ...perm("programmes.manage", "RECORD"), domain: "programmes", writes: ["Programme", AUDIT], inputId: "programmePublish.unarchive", recordStates: ["programme:PUBLISHED", "programme:DRAFT"],
  }),
  act("src/app/staff/programmes/[id]/publish-actions.ts", "unpublishProgrammeAction", {
    ...perm("programmes.publish", "RECORD"), domain: "programmes", writes: ["Programme", AUDIT], inputId: "programmePublish.unpublish",
  }),
  act("src/app/staff/programmes/actions.ts", "createProgrammeAction", {
    ...perm("programmes.manage", "GLOBAL"), domain: "programmes", writes: ["Programme", AUDIT], inputId: "programmes.create",
  }),
  act("src/app/staff/programmes/actions.ts", "updateProgrammeAction", {
    ...perm("programmes.manage", "RECORD"), domain: "programmes", writes: ["Programme", AUDIT], inputId: "programmes.update",
  }),

  // ---- staff: reconciliation, reports ----
  act("src/app/staff/reconciliation/actions.ts", "assignReconciliationCasesAction", {
    ...perm("payments.view", "RECORD"), domain: "reconciliation", writes: ["ReconciliationCase", "ReconciliationCaseEvent", AUDIT], inputId: "reconciliation.assign",
    viewPermissionSuffices: true, reason: RECONCILIATION_TRIAGE_REASON,
  }),
  act("src/app/staff/reconciliation/actions.ts", "requestReconciliationRefundExportAction", {
    ...perm("payments.view", "COLLECTION"), domain: "reconciliation", writes: EXPORT_QUEUE_WRITES, inputId: "reconciliation.requestRefundExport",
    denialAudit: false, reason: EXPORT_NO_DENIAL_ROW, denialMessage: "not authorised",
  }),
  act("src/app/staff/reconciliation/actions.ts", "resolveReconciliationCaseAction", {
    ...perm("payments.view", "RECORD"), domain: "reconciliation", writes: ["ReconciliationCase", "ReconciliationCaseEvent", AUDIT], inputId: "reconciliation.resolve", recordStates: ["case:RESOLVED"],
    viewPermissionSuffices: true, reason: RECONCILIATION_TRIAGE_REASON,
  }),
  act("src/app/staff/reports/actions.ts", "permittedSensitiveColumnsAction", {
    ...perm("reports.view", "COLLECTION"), domain: "reports", writes: [], inputId: "reports.sensitiveColumns", allowedPersona: "staffGlobal",
    denialAudit: false,
    reason: "Three collection checks run together; the first refusal wins and the others finish after the call returns, so which denial row exists is not deterministic. The answer is an empty list and confers no authority.",
  }),
  act("src/app/staff/reports/actions.ts", "requestReportExportAction", {
    ...perm("reports.view", "COLLECTION"), domain: "reports", writes: EXPORT_QUEUE_WRITES, inputId: "reports.requestExport",
    denialAudit: false, reason: EXPORT_NO_DENIAL_ROW, denialMessage: "not authorised",
  }),
  act("src/app/staff/reports/actions.ts", "rerunExportAction", {
    ...own, domain: "reports", writes: EXPORT_QUEUE_WRITES, inputId: "reports.rerun", recordStates: ["job:SUCCEEDED"],
  }),
  act("src/app/staff/reports/actions.ts", "retryExportAction", {
    ...own, domain: "reports", writes: EXPORT_QUEUE_WRITES, inputId: "reports.retry", recordStates: ["job:SUCCEEDED"],
  }),
  act("src/app/staff/reports/exports/actions.ts", "rerunHistoryExportAction", {
    ...own, domain: "reports", writes: EXPORT_QUEUE_WRITES, inputId: "reports.rerunHistory",
  }),
  act("src/app/staff/reports/exports/actions.ts", "retryHistoryExportAction", {
    ...own, domain: "reports", writes: EXPORT_QUEUE_WRITES, inputId: "reports.retryHistory",
  }),

  // ---- staff: roles, support, users ----
  act("src/app/staff/roles/actions.ts", "createRoleAction", {
    ...perm("roles.manage", "GLOBAL"), domain: "roles", writes: ["Role", "RoleVersion", AUDIT], inputId: "roles.create", throwsWhenDenied: true,
  }),
  act("src/app/staff/roles/actions.ts", "setRoleActiveAction", {
    ...perm("roles.manage", "GLOBAL"), domain: "roles", writes: ["Role", "RoleVersion", AUDIT], inputId: "roles.setActive", throwsWhenDenied: true,
  }),
  act("src/app/staff/roles/actions.ts", "updateRoleAction", {
    ...perm("roles.manage", "GLOBAL"), domain: "roles", writes: ["Role", "RoleVersion", AUDIT], inputId: "roles.update", throwsWhenDenied: true,
  }),
  act("src/app/staff/support/[reference]/actions.ts", "acceptEscalationAction", {
    ...perm("tickets.manage", "GLOBAL"), domain: "support", writes: ["Ticket", "TicketEvent", EVENT, AUDIT], inputId: "support.acceptEscalation", recordStates: ["ticket:CLOSED"],
  }),
  act("src/app/staff/support/[reference]/actions.ts", "addInternalNoteAction", {
    ...perm("tickets.manage", "GLOBAL"), domain: "support", writes: ["TicketMessage", "Ticket", "TicketEvent", AUDIT], inputId: "support.internalNote", recordStates: ["ticket:CLOSED"],
  }),
  act("src/app/staff/support/[reference]/actions.ts", "assignTicketAction", {
    ...perm("tickets.view", "GLOBAL"), domain: "support", writes: ["Ticket", "TicketEvent", EVENT, AUDIT], inputId: "support.assign", recordStates: ["ticket:CLOSED"],
  }),
  act("src/app/staff/support/[reference]/actions.ts", "changePriorityAction", {
    ...perm("tickets.manage", "GLOBAL"), domain: "support", writes: ["Ticket", "TicketEvent", AUDIT], inputId: "support.changePriority", recordStates: ["ticket:CLOSED"],
  }),
  act("src/app/staff/support/[reference]/actions.ts", "claimTicketAction", {
    ...perm("tickets.manage", "GLOBAL"), domain: "support", writes: ["Ticket", "TicketEvent", EVENT, AUDIT], inputId: "support.claim", recordStates: ["ticket:CLOSED"],
  }),
  act("src/app/staff/support/[reference]/actions.ts", "escalateTicketAction", {
    ...perm("tickets.manage", "GLOBAL"), domain: "support", writes: ["Ticket", "TicketEvent", EVENT, AUDIT], inputId: "support.escalate", recordStates: ["ticket:CLOSED"],
  }),
  act("src/app/staff/support/[reference]/actions.ts", "moveQueueAction", {
    ...perm("tickets.manage", "GLOBAL"), domain: "support", writes: ["Ticket", "TicketEvent", EVENT, AUDIT], inputId: "support.moveQueue", recordStates: ["ticket:CLOSED"],
  }),
  act("src/app/staff/support/[reference]/actions.ts", "resolveTicketAction", {
    ...perm("tickets.manage", "GLOBAL"), domain: "support", writes: ["Ticket", "TicketEvent", EVENT, AUDIT], inputId: "support.resolve", recordStates: ["ticket:CLOSED"],
  }),
  act("src/app/staff/support/[reference]/actions.ts", "sendPublicReplyAction", {
    ...perm("tickets.manage", "GLOBAL"), domain: "support", writes: ["TicketMessage", "Ticket", "TicketEvent", EVENT, AUDIT], inputId: "support.publicReply", recordStates: ["ticket:CLOSED"],
  }),
  act("src/app/staff/users/actions.ts", "createAssignmentAction", {
    ...perm("roles.manage", "COLLECTION"), domain: "users", writes: ["Assignment", AUDIT], inputId: "users.createAssignment", throwsWhenDenied: true,
  }),
  act("src/app/staff/users/actions.ts", "createStaffAccountAction", {
    ...perm("users.manage", "GLOBAL"), domain: "users", writes: ["User", "Assignment", AUDIT], inputId: "users.createStaff", throwsWhenDenied: true,
  }),
  act("src/app/staff/users/actions.ts", "deactivateStaffAccountAction", {
    ...perm("users.manage", "GLOBAL"), domain: "users", writes: ["User", "Session", AUDIT], inputId: "users.deactivate", recordStates: ["user:DEACTIVATED"], throwsWhenDenied: true,
  }),
  act("src/app/staff/users/actions.ts", "reactivateStaffAccountAction", {
    ...perm("users.manage", "GLOBAL"), domain: "users", writes: ["User", AUDIT], inputId: "users.reactivate", throwsWhenDenied: true,
  }),
  act("src/app/staff/users/actions.ts", "revokeAssignmentAction", {
    ...perm("roles.manage", "COLLECTION"), domain: "users", writes: ["Assignment", AUDIT], inputId: "users.revokeAssignment", throwsWhenDenied: true,
  }),
  act("src/app/staff/users/actions.ts", "searchScopeTargetsAction", {
    ...perm("roles.manage", "GLOBAL"), domain: "users", writes: [], inputId: "users.searchScopeTargets", throwsWhenDenied: true, allowedPersona: "staffGlobal",
  }),
  act("src/app/staff/users/actions.ts", "searchStaffUsersAction", {
    ...perm("users.view", "GLOBAL"), domain: "users", writes: [], inputId: "users.searchStaff", throwsWhenDenied: true, allowedPersona: "staffGlobal",
  }),
];

export const ROUTE_REGISTRY: readonly RouteRegistryEntry[] = [
  route("src/app/api/certificates/[id]/download/route.ts", "GET", "/api/certificates/[id]/download", [404], {
    ...perm("certificates.view", "RECORD"), domain: "certificates", writes: [], inputId: "route.certificateDownload", recordStates: ["certificate:REVOKED"],
    reason: "Staff with certificates.view in scope, otherwise the learner who owns the certificate; every denial is an empty 404.",
  }),
  route("src/app/api/health/route.ts", "GET", "/api/health", [], {
    ...open, domain: "operations", writes: [], inputId: "route.health", reason: "Public uptime probe.",
  }),
  route("src/app/api/health/route.ts", "HEAD", "/api/health", [], {
    ...open, domain: "operations", writes: [], inputId: "route.health", reason: "Public uptime probe.",
  }),
  route("src/app/api/lesson-resources/[id]/captions/route.ts", "GET", "/api/lesson-resources/[id]/captions", [404], {
    ...perm("courses.view", "RECORD"), domain: "catalogue", writes: [], inputId: "route.captionRead",
    reason: "Staff with courses.view in scope, otherwise a learner who may open the lesson; every denial is an empty 404.",
    denialAudit: false,
  }),
  route("src/app/api/lesson-resources/[id]/complete/route.ts", "POST", "/api/lesson-resources/[id]/complete", [404], {
    ...perm("courses.edit", "RECORD"), domain: "catalogue", writes: ["LessonResource", AUDIT], inputId: "route.resourceComplete",
    noInput: true,
    reason:
      "The handler never reads the request body: its only input is the resource id in the URL. There is no body to empty, so an authorized caller posting an empty body is making the ordinary, permitted call (which settles the upload row).",
  }),
  route("src/app/api/lesson-resources/[id]/download/route.ts", "GET", "/api/lesson-resources/[id]/download", [404], {
    ...perm("courses.view", "RECORD"), domain: "catalogue", writes: [], inputId: "route.resourceDownload", recordStates: ["resource:UPLOADING"], allowedPersona: "staffGlobal",
    reason: "Staff with courses.view in scope, otherwise a learner with an active enrolment covering the course; every denial is an empty 404.",
  }),
  route("src/app/api/lesson-resources/[id]/route.ts", "DELETE", "/api/lesson-resources/[id]", [404], {
    ...perm("courses.edit", "RECORD"), domain: "catalogue", writes: ["LessonResource", AUDIT], inputId: "route.resourceRemove",
    variantInputIds: ["route.resourceRemoveCaption"],
  }),
  route("src/app/api/lesson-resources/route.ts", "GET", "/api/lesson-resources", [404], {
    ...perm("courses.view", "RECORD"), domain: "catalogue", writes: [], inputId: "route.resourceList", allowedPersona: "staffGlobal",
    variantInputIds: ["route.resourceListCaptions"],
  }),
  route("src/app/api/lesson-resources/upload-intent/route.ts", "POST", "/api/lesson-resources/upload-intent", [404], {
    ...perm("courses.edit", "RECORD"), domain: "catalogue", writes: ["LessonResource", AUDIT], inputId: "route.resourceUploadIntent", allowedPersona: "staffGlobal",
    variantInputIds: ["route.resourceUploadIntentCaption"],
  }),
  route("src/app/api/notifications/preferences/route.ts", "GET", "/api/notifications/preferences", [401], {
    ...own, domain: "notifications", writes: [], inputId: "route.notificationPreferences", selfOnly: true, noInput: true, allowedPersona: "learnerOwner",
  }),
  route("src/app/api/notifications/route.ts", "GET", "/api/notifications", [401], {
    ...own, domain: "notifications", writes: [], inputId: "route.notificationList", selfOnly: true, noInput: true, allowedPersona: "learnerOwner",
  }),
  route("src/app/api/notifications/unread/route.ts", "GET", "/api/notifications/unread", [401], {
    ...own, domain: "notifications", writes: [], inputId: "route.notificationUnread", selfOnly: true, noInput: true, allowedPersona: "learnerOwner",
  }),
  route("src/app/api/staff/licence/diagnostic/route.ts", "GET", "/api/staff/licence/diagnostic", [401, 404], {
    ...perm("licence.view", "GLOBAL"), domain: "licence", writes: [AUDIT], inputId: "route.licenceDiagnostic", noInput: true, allowedPersona: "staffGlobal",
  }),
  route("src/app/api/staff/reports/exports/[jobId]/download/route.ts", "GET", "/api/staff/reports/exports/[jobId]/download", [404], {
    ...own, domain: "reports", writes: ["ExportJob", AUDIT], inputId: "route.exportDownload", recordStates: ["job:EXPIRED", "job:FAILED"], allowedPersona: "staffGlobal",
    reason: "Only the staff member who requested the export, and only while their grants still cover it.",
  }),
  route("src/app/api/submissions/[submissionId]/download/route.ts", "GET", "/api/submissions/[submissionId]/download", [404], {
    ...perm("submissions.view", "RECORD"), domain: "grading", writes: [], inputId: "route.submissionDownload", recordStates: ["submission:UPLOADING"], allowedPersona: "staffGlobal",
  }),
  route("src/app/api/ticket-attachments/[attachmentId]/download/route.ts", "GET", "/api/ticket-attachments/[attachmentId]/download", [404], {
    ...own, domain: "support", writes: [], inputId: "route.ticketAttachmentDownload", recordStates: ["attachment:UPLOADING"], allowedPersona: "learnerOwner",
    reason: "The ticket's requester for a public message, or staff holding the ticket permission; every denial is an empty 404.",
  }),
  route("src/app/api/ticket-attachments/complete/route.ts", "POST", "/api/ticket-attachments/complete", [404], {
    ...own, domain: "support", writes: ["TicketAttachment", AUDIT], inputId: "route.ticketAttachmentComplete",
  }),
  route("src/app/api/ticket-attachments/upload-intent/route.ts", "POST", "/api/ticket-attachments/upload-intent", [404], {
    ...own, domain: "support", writes: ["TicketAttachment", AUDIT], inputId: "route.ticketAttachmentIntent", allowedPersona: "learnerOwner",
  }),
  route("src/app/api/webhooks/paystack/route.ts", "POST", "/api/webhooks/paystack", [400], {
    class: "public-signature", domain: "payments", writes: ["WebhookEvent", "Order", "PaymentAttempt", "Enrolment", EVENT, AUDIT], inputId: "route.paystackWebhook",
    reason: "Signature-verified provider webhook.",
  }),
  route("src/app/api/webhooks/stripe/route.ts", "POST", "/api/webhooks/stripe", [400], {
    class: "public-signature", domain: "payments", writes: ["WebhookEvent", "Order", "PaymentAttempt", "Enrolment", EVENT, AUDIT], inputId: "route.stripeWebhook",
    reason: "Signature-verified provider webhook.",
  }),
  route("src/app/staff/cohorts/[id]/exceptions/csv/route.ts", "GET", "/staff/cohorts/[id]/exceptions/csv", [404], {
    ...perm("attendance.view", "RECORD"), domain: "attendance", writes: [], inputId: "route.exceptionsCsv", allowedPersona: "staffGlobal",
    reason: "Refusal is an empty 404 like every other private download (plan 15-27, ledger P-07); it was a 403 before.",
  }),
];
