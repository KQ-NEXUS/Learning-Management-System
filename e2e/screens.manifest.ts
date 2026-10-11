/**
 * Every screen and state the accessibility and responsive sweeps visit
 * (Phase 15, plan 15-19; D-13, NFR-09, NFR-10).
 *
 * Pure data and one pure function: no Playwright, no Prisma, no server imports,
 * so `tests/screens-manifest.test.ts` (Vitest) can read it and `e2e/*.spec.ts`
 * can drive it. The guard test lists `src/app/**\/page.tsx`, derives each page's
 * route template with `routeTemplateFor`, and fails when a page has neither a
 * SCREENS entry nor an EXCLUDED_PAGES reason, so a new page cannot be forgotten.
 *
 * A route parameter is filled from a named fixture (`FixtureKey`), resolved
 * against the guarded local database by `e2e/support/a11y.ts`, or given as a
 * literal with a leading "=" (for example `"=terms"`).
 */

/** Who looks at the screen. Staff personas are the seeded accounts; "learner" is a seeded learner with an active enrolment. */
export type Persona = "anonymous" | "learner" | "admin" | "finance" | "instructor" | "pm";

/** Names the fixture resolver in `e2e/support/a11y.ts` knows how to fill. */
export const FIXTURE_KEYS = [
  "courseSlug",
  "programmeSlug",
  "verificationRef",
  "cohortId",
  "draftCohortId",
  "openCohortId",
  "sessionId",
  "gradingCohortId",
  "gradingAssessmentId",
  "submissionId",
  "gradingEnrolmentId",
  "courseId",
  "lessonId",
  "moduleId",
  "assessmentId",
  "programmeId",
  "orderId",
  "caseId",
  "roleId",
  "userId",
  "templateId",
  "certificateId",
  "ownEnrolmentId",
  "ownLessonId",
  "ownOrderReference",
  "pendingOrderId",
  "ownTicketReference",
  "staffTicketReference",
  "privacyUserId",
] as const;

export type FixtureKey = (typeof FIXTURE_KEYS)[number];

/** Actions that put a screen into a key state before axe runs. Implemented in `e2e/support/a11y.ts`. */
export const STATE_ACTION_IDS = [
  "signin-failed",
  "signin-empty",
  "signin-throttled",
  "register-limited",
  "forgot-limited",
  "verify-resend-limited",
  "cert-check-limited",
  "ticket-limited",
  "submit-invalid",
  "ops-all-clear",
  "ops-with-failures",
  "privacy-anonymise-modal",
  "privacy-anonymised",
] as const;

export type StateActionId = (typeof STATE_ACTION_IDS)[number];

export type ScreenState = {
  id: string;
  label: string;
  /** Overrides the screen's persona for this state (for example a role that is refused). */
  persona?: Persona;
  /** Appended to the route, including the leading "?". */
  query?: string;
  /** Query parameters filled from fixtures (for example the module a new lesson is added to). */
  queryFrom?: Record<string, FixtureKey>;
  /** The state is the not-found page on purpose (a refusal that must look like an unknown record). */
  expectNotFound?: boolean;
  action?: StateActionId;
  /** The final path may differ from the route (a deliberate redirect). Default: the same path. */
  redirectsTo?: string;
  /** Expected HTTP status of the navigation. Default 200. */
  status?: number;
};

export type Screen = {
  /** Unique, short, readable. */
  id: string;
  /** Route template as the App Router derives it from the file path. */
  route: string;
  /** The page file, relative to src/app. */
  page: string;
  persona: Persona;
  params?: Record<string, FixtureKey | `=${string}`>;
  states: ScreenState[];
  /** One of the primary forms and content screens that plan 15-20 also sweeps for reflow and keyboard use. */
  primary?: boolean;
};

export type ExcludedPage = {
  /** The page file, relative to src/app. */
  page: string;
  reason: string;
};

/** Derives the route template from a page file path relative to src/app ("(auth)/signin/page.tsx" -> "/signin"). */
export function routeTemplateFor(pageFile: string): string {
  const segments = pageFile
    .replace(/\\/g, "/")
    .replace(/(^|\/)page\.tsx$/, "")
    .split("/")
    .filter((segment) => segment !== "" && !/^\(.*\)$/.test(segment));
  return `/${segments.join("/")}`;
}

export const WIDTHS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;

const DEFAULT: ScreenState = { id: "default", label: "Default" };

function state(id: string, label: string, extra: Partial<ScreenState> = {}): ScreenState {
  return { id, label, ...extra };
}

/** A tab of the tabbed detail pages. */
function tab(id: string, label: string): ScreenState {
  return state(id, label, { query: `?tab=${id}` });
}

const BAD_TOKEN = "?token=not-a-real-token";

export const SCREENS: Screen[] = [
  // ---------------------------------------------------------------- public
  {
    id: "home",
    route: "/",
    page: "page.tsx",
    persona: "anonymous",
    states: [state("catalogue-redirect", "Sends a visitor to the catalogue", { redirectsTo: "/courses" })],
  },
  { id: "public-courses", route: "/courses", page: "(public)/courses/page.tsx", persona: "anonymous", primary: true, states: [DEFAULT] },
  {
    id: "public-course",
    route: "/courses/[slug]",
    page: "(public)/courses/[slug]/page.tsx",
    persona: "anonymous",
    params: { slug: "courseSlug" },
    primary: true,
    states: [DEFAULT],
  },
  { id: "public-programmes", route: "/programmes", page: "(public)/programmes/page.tsx", persona: "anonymous", states: [DEFAULT] },
  {
    id: "public-programme",
    route: "/programmes/[slug]",
    page: "(public)/programmes/[slug]/page.tsx",
    persona: "anonymous",
    params: { slug: "programmeSlug" },
    states: [DEFAULT],
  },
  {
    id: "policy",
    route: "/policies/[policy]",
    page: "(public)/policies/[policy]/page.tsx",
    persona: "anonymous",
    params: { policy: "=terms" },
    states: [DEFAULT],
  },
  {
    id: "verify-certificate",
    route: "/verify-certificate",
    page: "verify-certificate/page.tsx",
    persona: "anonymous",
    primary: true,
    states: [DEFAULT],
  },
  {
    id: "verify-certificate-ref",
    route: "/verify/[verificationRef]",
    page: "verify/[verificationRef]/page.tsx",
    persona: "anonymous",
    params: { verificationRef: "verificationRef" },
    primary: true,
    states: [DEFAULT, state("limited", "Rate-limit message (S5)", { action: "cert-check-limited" })],
  },

  // ------------------------------------------------------------------ auth
  {
    id: "signin",
    route: "/signin",
    page: "(auth)/signin/page.tsx",
    persona: "anonymous",
    primary: true,
    states: [
      DEFAULT,
      state("failed", "Failed sign-in (S4)", { action: "signin-failed" }),
      state("empty", "Empty fields (S4)", { action: "signin-empty" }),
      state("throttled", "Rate-limit message (S5)", { action: "signin-throttled" }),
    ],
  },
  {
    id: "register",
    route: "/register",
    page: "(auth)/register/page.tsx",
    persona: "anonymous",
    primary: true,
    states: [
      DEFAULT,
      state("invalid", "Submitted empty", { action: "submit-invalid" }),
      state("limited", "Rate-limit message (S5)", { action: "register-limited" }),
    ],
  },
  {
    id: "forgot-password",
    route: "/forgot-password",
    page: "(auth)/forgot-password/page.tsx",
    persona: "anonymous",
    primary: true,
    states: [DEFAULT, state("limited", "Rate-limit message (S5)", { action: "forgot-limited" })],
  },
  {
    id: "verify",
    route: "/verify",
    page: "(auth)/verify/page.tsx",
    persona: "anonymous",
    primary: true,
    states: [DEFAULT, state("resend-limited", "Rate-limit message (S5)", { action: "verify-resend-limited" })],
  },
  {
    id: "reset-password",
    route: "/reset-password",
    page: "(auth)/reset-password/page.tsx",
    persona: "anonymous",
    states: [DEFAULT, state("invalid-link", "Link that is not valid", { query: BAD_TOKEN })],
  },
  {
    id: "confirm-email-change",
    route: "/confirm-email-change",
    page: "(auth)/confirm-email-change/page.tsx",
    persona: "anonymous",
    states: [DEFAULT, state("invalid-link", "Link that is not valid", { query: BAD_TOKEN })],
  },

  // ----------------------------------------------------- checkout (learner)
  {
    id: "checkout",
    route: "/checkout/[orderId]",
    page: "(checkout)/checkout/[orderId]/page.tsx",
    persona: "learner",
    params: { orderId: "pendingOrderId" },
    primary: true,
    states: [DEFAULT],
  },
  {
    id: "checkout-confirming",
    route: "/checkout/[orderId]/confirming",
    page: "(checkout)/checkout/[orderId]/confirming/page.tsx",
    persona: "learner",
    params: { orderId: "pendingOrderId" },
    states: [DEFAULT],
  },
  {
    id: "enrol",
    route: "/enrol/[cohortId]",
    page: "(checkout)/enrol/[cohortId]/page.tsx",
    persona: "learner",
    params: { cohortId: "openCohortId" },
    states: [
      state("cross-site", "Opened from outside the site: Continue to checkout button", { query: "?currency=NGN" }),
    ],
  },

  // --------------------------------------------------------------- learner
  { id: "dashboard", route: "/dashboard", page: "(learner)/dashboard/page.tsx", persona: "learner", primary: true, states: [DEFAULT] },
  { id: "learn", route: "/learn", page: "(learner)/learn/page.tsx", persona: "learner", primary: true, states: [DEFAULT] },
  { id: "learn-calendar", route: "/learn/calendar", page: "(learner)/learn/calendar/page.tsx", persona: "learner", states: [DEFAULT] },
  {
    id: "course-home",
    route: "/learn/[enrolmentId]",
    page: "(learner)/learn/[enrolmentId]/page.tsx",
    persona: "learner",
    params: { enrolmentId: "ownEnrolmentId" },
    primary: true,
    states: [DEFAULT],
  },
  {
    id: "course-results",
    route: "/learn/[enrolmentId]/results",
    page: "(learner)/learn/[enrolmentId]/results/page.tsx",
    persona: "learner",
    params: { enrolmentId: "ownEnrolmentId" },
    states: [DEFAULT],
  },
  {
    id: "course-sessions",
    route: "/learn/[enrolmentId]/sessions",
    page: "(learner)/learn/[enrolmentId]/sessions/page.tsx",
    persona: "learner",
    params: { enrolmentId: "ownEnrolmentId" },
    states: [DEFAULT],
  },
  {
    id: "lesson",
    route: "/learn/[enrolmentId]/lessons/[lessonId]",
    page: "(lesson)/learn/[enrolmentId]/lessons/[lessonId]/page.tsx",
    persona: "learner",
    params: { enrolmentId: "ownEnrolmentId", lessonId: "ownLessonId" },
    primary: true,
    states: [DEFAULT],
  },
  { id: "support", route: "/support", page: "(learner)/support/page.tsx", persona: "learner", states: [DEFAULT] },
  {
    id: "support-new",
    route: "/support/new",
    page: "(learner)/support/new/page.tsx",
    persona: "learner",
    primary: true,
    states: [
      DEFAULT,
      state("invalid", "Submitted empty", { action: "submit-invalid" }),
      state("limited", "Rate-limit message (S5)", { action: "ticket-limited" }),
    ],
  },
  {
    id: "support-ticket",
    route: "/support/[reference]",
    page: "(learner)/support/[reference]/page.tsx",
    persona: "learner",
    params: { reference: "ownTicketReference" },
    states: [DEFAULT],
  },
  { id: "account", route: "/account", page: "account/page.tsx", persona: "learner", states: [DEFAULT] },
  {
    id: "order-receipt",
    route: "/orders/[reference]",
    page: "orders/[reference]/page.tsx",
    persona: "learner",
    params: { reference: "ownOrderReference" },
    states: [DEFAULT],
  },

  // ----------------------------------------------------------------- staff
  {
    id: "staff-overview",
    route: "/staff",
    page: "staff/page.tsx",
    persona: "admin",
    primary: true,
    states: [
      DEFAULT,
      state("instructor", "Signed in as an instructor", { persona: "instructor" }),
      state("finance", "Signed in as finance", { persona: "finance" }),
      state("programme-manager", "Signed in as a programme manager", { persona: "pm" }),
    ],
  },
  { id: "staff-audit", route: "/staff/audit", page: "staff/audit/page.tsx", persona: "admin", states: [DEFAULT] },
  { id: "staff-certificates", route: "/staff/certificates", page: "staff/certificates/page.tsx", persona: "admin", states: [DEFAULT] },
  { id: "staff-certificates-issued", route: "/staff/certificates/issued", page: "staff/certificates/issued/page.tsx", persona: "admin", states: [DEFAULT] },
  {
    id: "staff-certificate-issued",
    route: "/staff/certificates/issued/[id]",
    page: "staff/certificates/issued/[id]/page.tsx",
    persona: "admin",
    params: { id: "certificateId" },
    states: [DEFAULT],
  },
  { id: "staff-certificate-templates", route: "/staff/certificates/templates", page: "staff/certificates/templates/page.tsx", persona: "admin", states: [DEFAULT] },
  {
    id: "staff-certificate-template",
    route: "/staff/certificates/templates/[id]",
    page: "staff/certificates/templates/[id]/page.tsx",
    persona: "admin",
    params: { id: "templateId" },
    states: [DEFAULT],
  },
  { id: "staff-certificate-template-new", route: "/staff/certificates/templates/new", page: "staff/certificates/templates/new/page.tsx", persona: "admin", states: [DEFAULT] },
  {
    id: "staff-certificate-template-from-design",
    route: "/staff/certificates/templates/from-design",
    page: "staff/certificates/templates/from-design/page.tsx",
    persona: "admin",
    states: [DEFAULT],
  },
  { id: "staff-cohorts", route: "/staff/cohorts", page: "staff/cohorts/page.tsx", persona: "admin", primary: true, states: [DEFAULT] },
  {
    id: "staff-cohorts-new",
    route: "/staff/cohorts/new",
    page: "staff/cohorts/new/page.tsx",
    persona: "admin",
    states: [state("empty", "Empty new-cohort form")],
  },
  {
    id: "staff-cohort",
    route: "/staff/cohorts/[id]",
    page: "staff/cohorts/[id]/page.tsx",
    persona: "admin",
    params: { id: "cohortId" },
    primary: true,
    states: [
      tab("overview", "Overview tab"),
      tab("sessions", "Sessions tab"),
      tab("roster", "Roster tab"),
      tab("exceptions", "Exceptions tab"),
      tab("grading", "Grading tab"),
    ],
  },
  {
    id: "staff-cohort-edit",
    route: "/staff/cohorts/[id]/edit",
    page: "staff/cohorts/[id]/edit/page.tsx",
    persona: "admin",
    params: { id: "draftCohortId" },
    states: [DEFAULT],
  },
  {
    id: "staff-grading-queue",
    route: "/staff/cohorts/[id]/grading/[assessmentId]",
    page: "staff/cohorts/[id]/grading/[assessmentId]/page.tsx",
    persona: "admin",
    params: { id: "gradingCohortId", assessmentId: "gradingAssessmentId" },
    primary: true,
    states: [DEFAULT],
  },
  {
    id: "staff-grading-entry",
    route: "/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]",
    page: "staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/page.tsx",
    persona: "admin",
    params: { id: "gradingCohortId", assessmentId: "gradingAssessmentId", submissionId: "submissionId" },
    primary: true,
    states: [DEFAULT],
  },
  {
    id: "staff-cohort-learner",
    route: "/staff/cohorts/[id]/learners/[enrolmentId]",
    page: "staff/cohorts/[id]/learners/[enrolmentId]/page.tsx",
    persona: "admin",
    params: { id: "gradingCohortId", enrolmentId: "gradingEnrolmentId" },
    states: [DEFAULT],
  },
  {
    id: "staff-attendance",
    route: "/staff/cohorts/[id]/sessions/[sessionId]/attendance",
    page: "staff/cohorts/[id]/sessions/[sessionId]/attendance/page.tsx",
    persona: "admin",
    params: { id: "cohortId", sessionId: "sessionId" },
    states: [DEFAULT],
  },
  { id: "staff-courses", route: "/staff/courses", page: "staff/courses/page.tsx", persona: "admin", states: [DEFAULT] },
  {
    id: "staff-courses-new",
    route: "/staff/courses/new",
    page: "staff/courses/new/page.tsx",
    persona: "admin",
    primary: true,
    states: [state("empty", "Empty new-course form")],
  },
  {
    id: "staff-course",
    route: "/staff/courses/[id]",
    page: "staff/courses/[id]/page.tsx",
    persona: "admin",
    params: { id: "courseId" },
    states: [DEFAULT],
  },
  {
    id: "staff-course-edit",
    route: "/staff/courses/[id]/edit",
    page: "staff/courses/[id]/edit/page.tsx",
    persona: "admin",
    params: { id: "courseId" },
    states: [DEFAULT],
  },
  {
    id: "staff-course-arrange",
    route: "/staff/courses/[id]/arrange",
    page: "staff/courses/[id]/arrange/page.tsx",
    persona: "admin",
    params: { id: "courseId" },
    states: [DEFAULT],
  },
  {
    id: "staff-course-assessments",
    route: "/staff/courses/[id]/assessments",
    page: "staff/courses/[id]/assessments/page.tsx",
    persona: "admin",
    params: { id: "courseId" },
    states: [DEFAULT],
  },
  {
    id: "staff-course-assessments-new",
    route: "/staff/courses/[id]/assessments/new",
    page: "staff/courses/[id]/assessments/new/page.tsx",
    persona: "admin",
    params: { id: "courseId" },
    states: [state("empty", "Empty new-assessment form")],
  },
  {
    id: "staff-course-assessment",
    route: "/staff/courses/[id]/assessments/[assessmentId]",
    page: "staff/courses/[id]/assessments/[assessmentId]/page.tsx",
    persona: "admin",
    params: { id: "courseId", assessmentId: "assessmentId" },
    states: [DEFAULT],
  },
  {
    id: "staff-course-lessons-new",
    route: "/staff/courses/[id]/lessons/new",
    page: "staff/courses/[id]/lessons/new/page.tsx",
    persona: "admin",
    params: { id: "courseId" },
    states: [state("empty", "Empty new-lesson form", { queryFrom: { moduleId: "moduleId" } })],
  },
  {
    id: "staff-course-lesson",
    route: "/staff/courses/[id]/lessons/[lessonId]",
    page: "staff/courses/[id]/lessons/[lessonId]/page.tsx",
    persona: "admin",
    params: { id: "courseId", lessonId: "lessonId" },
    states: [DEFAULT],
  },
  {
    id: "staff-course-preview",
    route: "/staff/courses/[id]/preview",
    page: "staff/courses/[id]/preview/page.tsx",
    persona: "admin",
    params: { id: "courseId" },
    states: [DEFAULT],
  },
  {
    id: "staff-course-preview-lesson",
    route: "/staff/courses/[id]/preview/lessons/[lessonId]",
    page: "staff/courses/[id]/preview/lessons/[lessonId]/page.tsx",
    persona: "admin",
    params: { id: "courseId", lessonId: "lessonId" },
    states: [DEFAULT],
  },
  { id: "staff-email-log", route: "/staff/email-log", page: "staff/email-log/page.tsx", persona: "admin", states: [DEFAULT] },
  { id: "staff-enrolments", route: "/staff/enrolments", page: "staff/enrolments/page.tsx", persona: "admin", primary: true, states: [DEFAULT] },
  { id: "staff-learner-numbers", route: "/staff/learner-numbers", page: "staff/learner-numbers/page.tsx", persona: "admin", states: [DEFAULT] },
  { id: "staff-licence", route: "/staff/licence", page: "staff/licence/page.tsx", persona: "admin", states: [DEFAULT] },
  {
    id: "staff-operations",
    route: "/staff/operations",
    page: "staff/operations/page.tsx",
    persona: "admin",
    primary: true,
    states: [
      state("all-clear", "All clear (S1)", { action: "ops-all-clear" }),
      state("with-failures", "With failures (S1)", { action: "ops-with-failures" }),
      state("denied-instructor", "Refused: an instructor has no audit permission", { persona: "instructor" }),
    ],
  },
  { id: "staff-payments", route: "/staff/payments", page: "staff/payments/page.tsx", persona: "admin", primary: true, states: [DEFAULT] },
  {
    id: "staff-payment",
    route: "/staff/payments/[orderId]",
    page: "staff/payments/[orderId]/page.tsx",
    persona: "admin",
    params: { orderId: "orderId" },
    states: [DEFAULT],
  },
  {
    id: "staff-privacy",
    route: "/staff/privacy",
    page: "staff/privacy/page.tsx",
    persona: "admin",
    primary: true,
    states: [DEFAULT, state("denied-instructor", "Refused: an instructor cannot manage learner privacy", { persona: "instructor" })],
  },
  {
    id: "staff-privacy-record",
    route: "/staff/privacy/[userId]",
    page: "staff/privacy/[userId]/page.tsx",
    persona: "admin",
    params: { userId: "privacyUserId" },
    primary: true,
    states: [
      state("before", "Before anonymisation (S3)"),
      state("modal", "Anonymise confirmation open (S3)", { action: "privacy-anonymise-modal" }),
      state("after", "After anonymisation (S3)", { action: "privacy-anonymised" }),
      state("denied-instructor", "Refused: an instructor gets the not-found page", { persona: "instructor", expectNotFound: true }),
    ],
  },
  { id: "staff-programmes", route: "/staff/programmes", page: "staff/programmes/page.tsx", persona: "admin", states: [DEFAULT] },
  { id: "staff-programmes-new", route: "/staff/programmes/new", page: "staff/programmes/new/page.tsx", persona: "admin", states: [state("empty", "Empty new-programme form")] },
  {
    id: "staff-programme",
    route: "/staff/programmes/[id]",
    page: "staff/programmes/[id]/page.tsx",
    persona: "admin",
    params: { id: "programmeId" },
    states: [DEFAULT],
  },
  {
    id: "staff-programme-arrange",
    route: "/staff/programmes/[id]/arrange",
    page: "staff/programmes/[id]/arrange/page.tsx",
    persona: "admin",
    params: { id: "programmeId" },
    states: [DEFAULT],
  },
  { id: "staff-reconciliation", route: "/staff/reconciliation", page: "staff/reconciliation/page.tsx", persona: "admin", states: [DEFAULT] },
  {
    id: "staff-reconciliation-case",
    route: "/staff/reconciliation/[caseId]",
    page: "staff/reconciliation/[caseId]/page.tsx",
    persona: "admin",
    params: { caseId: "caseId" },
    states: [DEFAULT],
  },
  { id: "staff-reports", route: "/staff/reports", page: "staff/reports/page.tsx", persona: "admin", states: [DEFAULT] },
  { id: "staff-report-exports", route: "/staff/reports/exports", page: "staff/reports/exports/page.tsx", persona: "admin", states: [DEFAULT] },
  {
    id: "staff-report",
    route: "/staff/reports/[dataset]",
    page: "staff/reports/[dataset]/page.tsx",
    persona: "admin",
    params: { dataset: "=registrations" },
    states: [DEFAULT],
  },
  { id: "staff-roles", route: "/staff/roles", page: "staff/roles/page.tsx", persona: "admin", states: [DEFAULT] },
  { id: "staff-roles-new", route: "/staff/roles/new", page: "staff/roles/new/page.tsx", persona: "admin", states: [state("empty", "Empty new-role form")] },
  {
    id: "staff-role",
    route: "/staff/roles/[id]",
    page: "staff/roles/[id]/page.tsx",
    persona: "admin",
    params: { id: "roleId" },
    states: [DEFAULT],
  },
  { id: "staff-support", route: "/staff/support", page: "staff/support/page.tsx", persona: "admin", primary: true, states: [DEFAULT] },
  {
    id: "staff-support-ticket",
    route: "/staff/support/[reference]",
    page: "staff/support/[reference]/page.tsx",
    persona: "admin",
    params: { reference: "staffTicketReference" },
    states: [DEFAULT],
  },
  { id: "staff-users", route: "/staff/users", page: "staff/users/page.tsx", persona: "admin", states: [DEFAULT] },
  { id: "staff-users-new", route: "/staff/users/new", page: "staff/users/new/page.tsx", persona: "admin", states: [state("empty", "Empty new-user form")] },
  {
    id: "staff-user",
    route: "/staff/users/[id]",
    page: "staff/users/[id]/page.tsx",
    persona: "admin",
    params: { id: "userId" },
    states: [DEFAULT],
  },
];

/**
 * Pages left out of the sweep, each with the reason. The list is empty on purpose:
 * the pages that need a single-use token (reset password, change of email address,
 * verify email) are swept in their "link that is not valid" state, which is the only
 * state reachable without a token.
 */
export const EXCLUDED_PAGES: ExcludedPage[] = [];

/**
 * Checks the manifest against the pages on disk. Returns one line per problem, empty when
 * it is complete: a page with neither a screen nor an exclusion, an entry whose page no
 * longer exists, a page listed twice or both ways, an exclusion without a reason, a route
 * template that does not match its page, a route parameter without a fixture, and
 * duplicate screen or state ids.
 */
export function manifestProblems(
  pageFiles: readonly string[],
  screens: readonly Screen[],
  excluded: readonly ExcludedPage[],
): string[] {
  const problems: string[] = [];
  const pages = new Set(pageFiles);
  const screenPages = new Map<string, number>();
  for (const screen of screens) screenPages.set(screen.page, (screenPages.get(screen.page) ?? 0) + 1);
  const excludedPages = new Map<string, number>();
  for (const entry of excluded) excludedPages.set(entry.page, (excludedPages.get(entry.page) ?? 0) + 1);

  for (const page of pages) {
    if (!screenPages.has(page) && !excludedPages.has(page)) {
      problems.push(`page without a screen or an exclusion: ${page}`);
    }
  }
  for (const [page, count] of screenPages) {
    if (!pages.has(page)) problems.push(`screen for a page that no longer exists: ${page}`);
    if (count > 1) problems.push(`page listed as ${count} screens: ${page}`);
    if (excludedPages.has(page)) problems.push(`page is both a screen and excluded: ${page}`);
  }
  for (const [page, count] of excludedPages) {
    if (!pages.has(page)) problems.push(`exclusion for a page that no longer exists: ${page}`);
    if (count > 1) problems.push(`page excluded ${count} times: ${page}`);
  }
  for (const entry of excluded) {
    if (entry.reason.trim() === "") problems.push(`excluded page without a reason: ${entry.page}`);
  }

  const ids = new Set<string>();
  for (const screen of screens) {
    if (ids.has(screen.id)) problems.push(`duplicate screen id: ${screen.id}`);
    ids.add(screen.id);
    if (screen.states.length === 0) problems.push(`screen without a state: ${screen.id}`);
    const stateIds = new Set<string>();
    for (const entry of screen.states) {
      if (stateIds.has(entry.id)) problems.push(`duplicate state id ${entry.id} in screen ${screen.id}`);
      stateIds.add(entry.id);
    }
    const expectedRoute = routeTemplateFor(screen.page);
    if (screen.route !== expectedRoute) {
      problems.push(`screen ${screen.id}: route ${screen.route} does not match its page (${expectedRoute})`);
    }
    const wanted = [...screen.route.matchAll(/\[(\w+)\]/g)].map((match) => match[1]).sort();
    const given = Object.keys(screen.params ?? {}).sort();
    if (wanted.join(",") !== given.join(",")) {
      problems.push(
        `screen ${screen.id}: route parameter(s) [${wanted.join(", ")}] need a fixture, manifest gives [${given.join(", ")}]`,
      );
    }
  }
  return problems;
}
