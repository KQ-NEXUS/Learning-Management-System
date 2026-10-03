/**
 * Licence vocabulary and copy (Phase 14, plan 14-06; D-06, D-10, D-14).
 *
 * One module owns every licence sentence so the status screen, banner,
 * notifications, emails, refusal messages and tests cannot drift (research
 * Pitfall 12). The post-grace state phrase lives in exactly one exported
 * constant, `RESTRICTED_CONTINUITY_LABEL`; every other string here that needs it
 * is composed from that constant (or its lowercase form), so the phrase is
 * typed once and the state is never given another name anywhere in code, copy,
 * audit text or tests (D-06).
 *
 * Text is the byte-for-byte UI-SPEC Copywriting Contract. Closed sets (rejection
 * codes, notice keys) never echo caller-supplied text: an unknown key or code
 * renders a generic safe sentence (T-14-06-01).
 *
 * PURE MODULE: no Prisma, no Next.js request API, no wall-clock read. Dates are
 * preformatted by the caller with `formatLicenceInstant` (display.ts).
 */

import { LICENCE_REJECTION_CODES, type LicenceRejectionCode } from "./format";
import type { DerivedState } from "./state";
import type { LicenceStateName, LicenceVerificationOutcome } from "./types";

// ---------------------------------------------------------------------------
// The single owner of the post-grace state phrase
// ---------------------------------------------------------------------------

/** D-06: the one definition of the post-grace state name. */
export const RESTRICTED_CONTINUITY_LABEL = "Restricted continuity mode";

/** Module-private lowercase form for mid-sentence use. */
const RESTRICTED_LOWER = RESTRICTED_CONTINUITY_LABEL.toLowerCase();

// ---------------------------------------------------------------------------
// States: labels and pill tones (UI-SPEC Color table)
// ---------------------------------------------------------------------------

export type LicenceTone = "neutral" | "success" | "warning" | "danger";

export const LICENCE_STATE_LABELS: Readonly<Record<LicenceStateName, string>> = {
  UNLICENSED: "Not activated",
  ACTIVE: "Active",
  EXPIRING_SOON: "Expiring soon",
  GRACE: "Expired, in grace period",
  RESTRICTED_CONTINUITY: RESTRICTED_CONTINUITY_LABEL,
  INVALID: "Licence invalid",
  VALIDATION_ATTENTION: "Check pending",
};

export const LICENCE_STATE_TONE: Readonly<Record<LicenceStateName, LicenceTone>> = {
  UNLICENSED: "neutral",
  ACTIVE: "success",
  EXPIRING_SOON: "warning",
  GRACE: "warning",
  RESTRICTED_CONTINUITY: "danger",
  INVALID: "danger",
  VALIDATION_ATTENTION: "warning",
};

// ---------------------------------------------------------------------------
// Refusals and the preserved-data statement
// ---------------------------------------------------------------------------

const ASK_ADMIN_SENTENCE = "Ask an administrator to check the licence status.";

/** Server refusal for a staff action blocked by the licence state. */
export const LICENCE_REFUSAL_MESSAGE = `This action is unavailable while the deployment is in ${RESTRICTED_LOWER}. ${ASK_ADMIN_SENTENCE}`;

/** Learner-facing refusal (OQ8, A12): never names the licence. */
export const LEARNER_REFUSAL_MESSAGE = "Enrolment is temporarily unavailable. Please contact support.";

/** Inline reason beside a disabled write control, staff without licence.view. */
export const RESTRICTED_CONTROL_REASON_STAFF = `Unavailable in ${RESTRICTED_LOWER}. ${ASK_ADMIN_SENTENCE}`;

/** Inline reason beside a disabled write control, holders of licence.view. */
export const RESTRICTED_CONTROL_REASON_ADMIN = `Unavailable in ${RESTRICTED_LOWER}. Open Licence to see how to restore this.`;

export const PRESERVED_DATA_STATEMENT = `Your data is kept. Nothing is deleted when a licence expires or the deployment enters ${RESTRICTED_LOWER}.`;

/** True only for the licence refusal sentence, so the UI never confuses it with a role denial. */
export function isLicenceRefusalMessage(message: string): boolean {
  return message === LICENCE_REFUSAL_MESSAGE;
}

// ---------------------------------------------------------------------------
// Rejection sentences (closed set)
// ---------------------------------------------------------------------------

const GENERIC_REJECTION_SENTENCE = "The licence could not be verified.";

/** Reason codes the state machine adds on top of the file rejection codes (state.ts). */
const STATE_REASON_SENTENCES: Readonly<Record<string, string>> = {
  RECORD_MISSING: "The installed licence record could not be read.",
  VALIDATION_WINDOW_EXHAUSTED: "The licence check could not complete within 24 hours.",
};

const REJECTION_SENTENCES: Readonly<Record<LicenceRejectionCode | "CONCURRENT_CHANGE", string>> = {
  BAD_FORMAT: "This is not a licence file. Upload the file exactly as provided, without editing it.",
  UNSUPPORTED_SCHEMA: "This licence uses a format this version does not support. Contact support.",
  UNKNOWN_KEY: "This licence was not issued with a recognised signing key. Contact support.",
  KEY_REVOKED: "The key that signed this licence is no longer trusted. Request a new licence.",
  BAD_SIGNATURE:
    "The signature on this licence could not be verified. It may have been changed or damaged. Upload the original file.",
  WRONG_DEPLOYMENT:
    "This licence was issued for a different deployment. Compare the deployment ID on this page with your order.",
  WRONG_CLIENT: "This licence was issued to a different client. Request the correct file.",
  NOT_YET_VALID: "This licence is not valid yet. It starts on {notBefore}.",
  EXPIRED: "This licence has expired. Request a new licence.",
  OLDER_THAN_ACTIVE: "A newer licence is already active. This older file cannot replace it.",
  ALREADY_ACTIVE: "This licence is already active. No change was made.",
  CONCURRENT_CHANGE:
    "The licence status changed while you were working. Nothing was changed. Review the page and try again.",
};

const REJECTION_CODE_SET: ReadonlySet<string> = new Set(LICENCE_REJECTION_CODES);

/**
 * The fixed sentence for a rejection code. `{notBefore}` is replaced from `vars`
 * (a preformatted instant); an unknown code returns the generic sentence and
 * never echoes the code.
 */
export function rejectionSentence(code: string, vars: { notBefore?: string } = {}): string {
  if (code === "NOT_YET_VALID") {
    return vars.notBefore
      ? REJECTION_SENTENCES.NOT_YET_VALID.replace("{notBefore}", vars.notBefore)
      : "This licence is not valid yet.";
  }
  if (code === "CONCURRENT_CHANGE" || REJECTION_CODE_SET.has(code)) {
    return REJECTION_SENTENCES[code as LicenceRejectionCode | "CONCURRENT_CHANGE"];
  }
  return STATE_REASON_SENTENCES[code] ?? GENERIC_REJECTION_SENTENCE;
}

/** ALREADY_ACTIVE is shown with a neutral note, not a danger note. */
export function isNeutralRejection(code: string): boolean {
  return code === "ALREADY_ACTIVE";
}

/** Sentence for an `invalid-{code}` reason: rejection codes plus the two state-machine codes. */
function isKnownInvalidReason(code: string): boolean {
  return REJECTION_CODE_SET.has(code) || Object.hasOwn(STATE_REASON_SENTENCES, code);
}

// ---------------------------------------------------------------------------
// State summaries and the days-remaining display (UI-SPEC)
// ---------------------------------------------------------------------------

export interface StateSummaryVars {
  expiry?: string | null;
  graceEnd?: string | null;
  graceDays?: number | string | null;
  reasonSentence?: string | null;
  attentionDeadline?: string | null;
}

export const NOT_AVAILABLE = "Not available";

function orNotAvailable(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? NOT_AVAILABLE : String(value);
}

function dayCount(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return NOT_AVAILABLE;
  return `${value} ${String(value) === "1" ? "day" : "days"}`;
}

function withoutTrailingPeriod(sentence: string): string {
  return sentence.replace(/\.\s*$/, "");
}

/** One plain-language sentence for a state, with preformatted values substituted. */
export function stateSummary(state: LicenceStateName, vars: StateSummaryVars = {}): string {
  switch (state) {
    case "UNLICENSED":
      // OQ1 option-a (14-DECISIONS.md): fully operational until the first activation.
      return "No licence is installed. The deployment works normally until the first licence is activated.";
    case "ACTIVE":
      return "The licence is valid. Everything works normally.";
    case "EXPIRING_SOON":
      return `The licence expires on ${orNotAvailable(vars.expiry)}. Everything works normally until then, and for ${dayCount(vars.graceDays)} after.`;
    case "GRACE":
      return `The licence expired on ${orNotAvailable(vars.expiry)}. Everything still works until ${orNotAvailable(vars.graceEnd)}. After that, ${RESTRICTED_LOWER} begins.`;
    case "RESTRICTED_CONTINUITY":
      return `${RESTRICTED_CONTINUITY_LABEL} is active. New commercial activity is blocked; learners, grading, certificates, refunds and exports continue.`;
    case "INVALID": {
      const reason = withoutTrailingPeriod(vars.reasonSentence ?? GENERIC_REJECTION_SENTENCE);
      return `The installed licence could not be verified: ${reason}. ${RESTRICTED_CONTINUITY_LABEL} is active until a valid licence is activated.`;
    }
    case "VALIDATION_ATTENTION":
      return `The licence check could not complete. The last known state is kept until ${orNotAvailable(vars.attentionDeadline)}; after that ${RESTRICTED_LOWER} begins.`;
  }
}

export interface DaysRemainingDisplay {
  figure: string | null;
  caption: string | null;
}

const UNDER_A_DAY_FIGURE = "Under 24 hours";

/**
 * The single display figure and its caption (UI-SPEC Days-remaining rule): a
 * pure function of the derived state. `formattedDate` is the preformatted
 * restriction or invalid instant for the "since" captions.
 */
export function daysRemainingDisplay(
  derived: Pick<DerivedState, "state" | "daysRemaining" | "daysToGraceEnd" | "underOneDay">,
  formattedDate: string | null = null,
): DaysRemainingDisplay {
  const none: DaysRemainingDisplay = { figure: null, caption: null };
  switch (derived.state) {
    case "ACTIVE":
    case "EXPIRING_SOON": {
      if (derived.daysRemaining === null) return none;
      if (derived.underOneDay) {
        return { figure: UNDER_A_DAY_FIGURE, caption: "until the licence expires" };
      }
      return derived.daysRemaining === 1
        ? { figure: "1", caption: "day remaining" }
        : { figure: String(derived.daysRemaining), caption: "days remaining" };
    }
    case "GRACE": {
      if (derived.daysToGraceEnd === null) return none;
      const tail = `until ${RESTRICTED_LOWER} begins`;
      if (derived.underOneDay) return { figure: UNDER_A_DAY_FIGURE, caption: tail };
      return derived.daysToGraceEnd === 1
        ? { figure: "1", caption: `day ${tail}` }
        : { figure: String(derived.daysToGraceEnd), caption: `days ${tail}` };
    }
    case "RESTRICTED_CONTINUITY":
      return { figure: null, caption: formattedDate ? `Restricted since ${formattedDate}` : "Restricted" };
    case "INVALID":
      return { figure: null, caption: formattedDate ? `Invalid since ${formattedDate}` : "Invalid" };
    case "UNLICENSED":
    case "VALIDATION_ATTENTION":
      return none;
  }
}

// ---------------------------------------------------------------------------
// Banner copy (UI-SPEC Banner copy table)
// ---------------------------------------------------------------------------

export const RENEWAL_FALLBACK = "Use the support contact on your agreement.";

const LINK_VIEW = "View licence";
const LINK_ACTIVATE = "Activate a licence";

export interface BannerInput {
  state: LicenceStateName;
  daysRemaining: number | null;
  graceEnd: string | null;
  expiry: string | null;
  renewalEmail: string | null;
  canActivate: boolean;
  /** Fixed sentence from `rejectionSentence`, used only for the invalid state. */
  reasonSentence?: string | null;
}

export interface BannerCopy {
  tone: "warning" | "danger";
  stateLabel: string;
  message: string;
  linkLabel: string;
}

/** The persistent banner content, or null when no banner is shown (UI-SPEC). */
export function bannerCopy(input: BannerInput): BannerCopy | null {
  const stateLabel = LICENCE_STATE_LABELS[input.state];
  switch (input.state) {
    case "EXPIRING_SOON": {
      if (input.daysRemaining === null || input.daysRemaining > 30) return null;
      const contact = input.renewalEmail ? `Contact ${input.renewalEmail} to renew.` : RENEWAL_FALLBACK;
      return {
        tone: "warning",
        stateLabel,
        message: `Licence expires in ${dayCount(input.daysRemaining)} (${orNotAvailable(input.expiry)}). ${contact}`,
        linkLabel: LINK_VIEW,
      };
    }
    case "GRACE":
      return {
        tone: "warning",
        stateLabel,
        message: `Licence expired on ${orNotAvailable(input.expiry)}. Normal operation continues until ${orNotAvailable(input.graceEnd)}; then ${RESTRICTED_LOWER} begins.`,
        linkLabel: LINK_VIEW,
      };
    case "RESTRICTED_CONTINUITY":
      return {
        tone: "danger",
        stateLabel,
        message: `${RESTRICTED_CONTINUITY_LABEL} is active. New enrolments, checkout, publishing and settings changes are blocked. Your data is kept.`,
        linkLabel: input.canActivate ? LINK_ACTIVATE : LINK_VIEW,
      };
    case "INVALID": {
      // The reason is a complete sentence from the closed set, so it supplies its own full stop.
      const lead = input.reasonSentence
        ? `The licence could not be verified: ${input.reasonSentence}`
        : "The licence could not be verified.";
      return {
        tone: "danger",
        stateLabel,
        message: `${lead} ${RESTRICTED_CONTINUITY_LABEL} is active.`,
        linkLabel: input.canActivate ? LINK_ACTIVATE : LINK_VIEW,
      };
    }
    case "VALIDATION_ATTENTION":
      return {
        tone: "warning",
        stateLabel,
        message: "The licence check could not complete. The last known state is kept for up to 24 hours.",
        linkLabel: LINK_VIEW,
      };
    case "ACTIVE":
    case "UNLICENSED":
      return null;
  }
}

// ---------------------------------------------------------------------------
// Notice copy (UI-SPEC Notification text and Email; closed key set, D-10)
// ---------------------------------------------------------------------------

export interface NoticeVars {
  days?: string | null;
  expiry?: string | null;
  graceEnd?: string | null;
}

export interface NoticeCopy {
  title: string;
  meta: string | null;
  emailHeadline: string;
  emailDetail: string;
}

type ParsedNoticeKey =
  | { kind: "expiring"; bucket: number }
  | { kind: "expiring-1" }
  | { kind: "expired" }
  | { kind: "grace-ending" }
  | { kind: "restricted" }
  | { kind: "invalid"; code: string }
  | { kind: "validation-attention" }
  | { kind: "clock-rollback" };

const EXPIRING_KEY = /^expiring-(60|30|14|7|3)$/;
const INVALID_KEY = /^invalid-([A-Z_]{1,40})$/;
const ATTENTION_KEY = /^validation-attention(?:-\d{1,12})?$/;
const ROLLBACK_KEY = /^clock-rollback(?:-\d{4}-\d{2}-\d{2}T\d{2})?$/;

function parseNoticeKey(noticeKey: string): ParsedNoticeKey | null {
  const expiring = EXPIRING_KEY.exec(noticeKey);
  if (expiring) return { kind: "expiring", bucket: Number(expiring[1]) };
  if (noticeKey === "expiring-1") return { kind: "expiring-1" };
  if (noticeKey === "expired") return { kind: "expired" };
  if (noticeKey === "grace-ending") return { kind: "grace-ending" };
  if (noticeKey === "restricted") return { kind: "restricted" };
  const invalid = INVALID_KEY.exec(noticeKey);
  if (invalid && isKnownInvalidReason(invalid[1])) return { kind: "invalid", code: invalid[1] };
  if (ATTENTION_KEY.test(noticeKey)) return { kind: "validation-attention" };
  if (ROLLBACK_KEY.test(noticeKey)) return { kind: "clock-rollback" };
  return null;
}

/** True only for the closed set of notice keys `noticeCopy` can render. */
export function isKnownNoticeKey(noticeKey: string): boolean {
  return parseNoticeKey(noticeKey) !== null;
}

function safeDays(value: string | null | undefined, fallback: number): string {
  return value && /^\d{1,3}$/.test(value) ? value : String(fallback);
}

function metaOrNull(prefix: string, value: string | null | undefined): string | null {
  return value ? `${prefix} ${value}` : null;
}

const OPEN_LICENCE_DATES = "Open Licence to see the dates and renewal contact.";

function copy(title: string, meta: string | null, emailDetail: string): NoticeCopy {
  return { title, meta, emailHeadline: title, emailDetail };
}

/**
 * Title, meta and email text for a notice key. Only keys accepted by
 * `isKnownNoticeKey` get specific text; anything else renders the generic
 * sentence and never echoes the key (T-14-06-01).
 */
export function noticeCopy(noticeKey: string, vars: NoticeVars = {}): NoticeCopy {
  const parsed = parseNoticeKey(noticeKey);
  if (parsed === null) {
    return copy(
      "Licence status update",
      null,
      "The licence status for this deployment changed. Open Licence to review the current status.",
    );
  }
  switch (parsed.kind) {
    case "expiring": {
      const days = safeDays(vars.days, parsed.bucket);
      return copy(
        `Licence expires in ${dayCount(days)}`,
        metaOrNull("Expires", vars.expiry),
        `The licence for this deployment expires soon. Everything keeps working until then and through the grace period. ${OPEN_LICENCE_DATES}`,
      );
    }
    case "expiring-1":
      return copy(
        "Licence expires tomorrow",
        metaOrNull("Expires", vars.expiry),
        `The licence for this deployment expires tomorrow. Everything keeps working until then and through the grace period. ${OPEN_LICENCE_DATES}`,
      );
    case "expired":
      return copy(
        "Licence expired: grace period has started",
        metaOrNull("Normal operation continues until", vars.graceEnd),
        `The licence has expired and the grace period has started. Everything still works until the grace period ends. ${OPEN_LICENCE_DATES}`,
      );
    case "grace-ending":
      return copy(
        `Grace period ends in ${dayCount(safeDays(vars.days, 3))}`,
        metaOrNull(`${RESTRICTED_CONTINUITY_LABEL} begins`, vars.graceEnd),
        `The grace period is about to end. After it ends, ${RESTRICTED_LOWER} begins and new enrolments, publishing and settings changes are blocked. ${OPEN_LICENCE_DATES}`,
      );
    case "restricted":
      return copy(
        `${RESTRICTED_CONTINUITY_LABEL} is now active`,
        "New enrolments and checkout are blocked",
        `${RESTRICTED_CONTINUITY_LABEL} is now active. New enrolments, checkout, publishing and settings changes are blocked, while learners, grading, certificates, refunds and exports continue. Open Licence to see how to restore full operation.`,
      );
    case "invalid":
      return copy(
        "Licence could not be verified",
        rejectionSentence(parsed.code),
        `The installed licence could not be verified. ${RESTRICTED_CONTINUITY_LABEL} is active until a valid licence is activated. Open Licence for the reason and the next step.`,
      );
    case "validation-attention":
      return copy(
        "Licence check could not complete",
        "Last known state kept for up to 24 hours",
        "The licence check could not complete. The last known state is kept for up to 24 hours. Open Licence to review the status.",
      );
    case "clock-rollback":
      return copy(
        "Server clock moved backwards",
        "Check the server time settings",
        "The server clock moved backwards. Licence dates are always checked against the current clock, so no status was changed. Check the server's time settings, then open Licence to review the status.",
      );
  }
}

// ---------------------------------------------------------------------------
// Screen strings (plans 14-10 and 14-15 import these; no later plan types a licence sentence)
// ---------------------------------------------------------------------------

export const EMPTY_STATE_HEADING = "No licence has been activated";
// OQ1 option-a (14-DECISIONS.md): the deployment keeps working until the first activation.
export const EMPTY_STATE_BODY =
  "This deployment has no licence installed yet. It keeps working normally until the first licence is activated. Activate one below, or ask an administrator who can activate licences.";
export const LOAD_ERROR_MESSAGE = "Couldn't load licence status. Reload the page; if it persists, contact support.";
export const ACTIVATION_PERMISSION_NOTE =
  "Activating a licence needs the activate-licence permission. Ask an administrator who holds it.";
export const ACTIVATION_GENERIC_FAILURE =
  "Licence not activated. Nothing was changed. Try again; if it persists, contact support.";
export const ACTIVATE_CONFIRM_TITLE = "Activate this licence?";
export const DIAGNOSTIC_ERROR_MESSAGE = "Diagnostic report not downloaded. Try again.";
export const WORKS_HEADING = "What works";
export const BLOCKED_HEADING = "What is blocked";
export const NOTHING_BLOCKED = "Nothing is blocked right now.";
export const DIAGNOSTIC_BUTTON_LABEL = "Download diagnostic report";
export const DIAGNOSTIC_HELPER = "Contains no signing material, secrets or personal data.";
export const EXPORTS_LINK_LABEL = "Open data exports";
export const EXPORTS_HELPER = `Exports stay available in ${RESTRICTED_LOWER}.`;

/** Last verification pill text, keyed by the stored outcome (NOT_CHECKED when none yet). */
export const LAST_VERIFICATION_LABELS: Readonly<Record<LicenceVerificationOutcome | "NOT_CHECKED", string>> = {
  OK: "Passed",
  FAILED: "Failed",
  UNAVAILABLE: "Could not complete",
  NOT_CHECKED: "Not checked yet",
};

export function ACTIVATION_SUCCESS(stateLabel: string): string {
  return `Licence activated. This deployment is now ${stateLabel}.`;
}

export function ACTIVATE_CONFIRM_BODY(licenceId: string, client: string, expiry: string): string {
  return `Licence ${licenceId} for ${client} becomes the active licence for this deployment and is valid until ${expiry}. This is recorded in the audit log.`;
}

export function afterGraceHeading(graceEnd: string): string {
  return `What happens after ${graceEnd}`;
}

export function clockRollbackNote(date: string): string {
  return `The server clock moved backwards on ${date}. Check the server's time settings.`;
}
