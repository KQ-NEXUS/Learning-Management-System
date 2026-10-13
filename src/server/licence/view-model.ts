/**
 * Display-ready view model for the Licence & System Status screen (Phase 14,
 * plan 14-10; D-11, D-14, LIC-02).
 *
 * `buildLicenceStatusView` turns the allow-listed `LicenceStatusSnapshot` into
 * plain strings and flags the page component renders as-is. Because it reads only
 * the snapshot DTO (which carries no raw licence text, signing material or error
 * detail) and builds every sentence from `policy.ts`, nothing secret can reach
 * the rendered HTML (T-14-10-02) and no licence sentence is typed twice (D-06).
 *
 * PURE MODULE: no Prisma, no Next.js, no wall-clock read. `now` is an argument.
 * The time-derived states (Active, Expiring soon, Expired in grace and the
 * post-grace state) are re-derived against `now` from the signed `expiresAt` and
 * `graceEndsAt` with the same `deriveState` the service uses, so a page rendered
 * at an exact boundary shows that boundary's state and figure. States that do not
 * come from the clock (not activated, invalid, check pending) are taken from the
 * snapshot unchanged.
 */

import { UNAVAILABLE_WINDOW_MS } from "./constants";
import { DEFAULT_DISPLAY_ZONE, formatLicenceInstant, formatUtcInstant } from "./display";
import { RESTRICTED_CAPABILITIES } from "./effects";
import {
  EMPTY_STATE_BODY,
  EMPTY_STATE_HEADING,
  LAST_VERIFICATION_LABELS,
  LICENCE_STATE_LABELS,
  LICENCE_STATE_TONE,
  NOTHING_BLOCKED,
  PRESERVED_DATA_STATEMENT,
  RENEWAL_FALLBACK,
  afterGraceHeading,
  clockRollbackNote,
  daysRemainingDisplay,
  rejectionSentence,
  stateSummary,
  type LicenceTone,
} from "./policy";
import { daysUntil, deriveState, type DerivedState } from "./state";
import type { LicenceStateName, LicenceStatusSnapshot } from "./types";

export interface LicenceFactView {
  id: "state" | "licenceId" | "client" | "deploymentId" | "expires" | "graceEnds" | "lastVerification";
  label: string;
  /** Display value; null renders "Not available" (never a blank). */
  value: string | null;
  /** The exact UTC instant shown in mono beside a local date. */
  utc: string | null;
  /** The IANA zone name, set on the first date row only (muted, shown once). */
  zoneNote: string | null;
  mono: boolean;
  /** A status pill shown in place of or beside the value (State, Last verification). */
  pill: { label: string; tone: LicenceTone } | null;
  /** True only for the deployment ID when it has a value (Copy button). */
  copyable: boolean;
}

export interface LicenceRenewalView {
  renewalEmail: string;
  supportEmail: string;
  /** Rows with no value in the signed payload are omitted, never blank. */
  phone: string | null;
  hours: string | null;
}

export interface LicenceStatusViewModel {
  state: LicenceStateName;
  pill: { label: string; tone: LicenceTone };
  /** The single display figure ("182", "Under 24 hours") or null (restricted, invalid, not activated). */
  figure: string | null;
  caption: string | null;
  summary: string;
  facts: LicenceFactView[];
  /** The clock-rollback warning, present only while `clockAlertAt` is set. */
  clockNote: string | null;
  works: string[];
  blocked: string[];
  /** "What happens after {graceEnd}" list, present only while nothing is blocked yet and a grace end exists. */
  afterGrace: { heading: string; items: string[] } | null;
  preservedData: string;
  renewal: LicenceRenewalView | null;
  renewalFallback: string;
  /** Present only for a deployment that never activated a licence (OQ1 option-a). */
  emptyState: { heading: string; body: string } | null;
  /** The renewal email shown under the page title, when one exists. */
  subtitleEmail: string | null;
  canActivate: boolean;
  canViewReports: boolean;
}

export interface LicenceViewOptions {
  canActivate: boolean;
  canViewReports: boolean;
  now: Date;
}

const TIME_DERIVED_STATES: ReadonlySet<LicenceStateName> = new Set([
  "ACTIVE",
  "EXPIRING_SOON",
  "GRACE",
  "RESTRICTED_CONTINUITY",
]);

/** The IANA zone to show beside dates: the signed zone when the runtime knows it, else Africa/Lagos. */
function displayZoneName(zone: string | null): string {
  if (zone === null) return DEFAULT_DISPLAY_ZONE;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_DISPLAY_ZONE;
  }
}

/** The state, restriction flag and day figures at `now`; the clock-derived states are re-derived. */
function effectiveDerived(snapshot: LicenceStatusSnapshot, now: Date): DerivedState {
  if (TIME_DERIVED_STATES.has(snapshot.state) && snapshot.expiresAt && snapshot.graceEndsAt) {
    return deriveState({
      everActivated: true,
      record: { expiresAt: snapshot.expiresAt, graceEndsAt: snapshot.graceEndsAt },
      verification: { kind: "OK" },
      attentionSince: null,
      lastGoodRestricted: false,
      now,
    });
  }
  return {
    state: snapshot.state,
    reasonCode: snapshot.reasonCode,
    isRestricted: snapshot.isRestricted,
    restrictedAt: snapshot.restrictedAt,
    daysRemaining: snapshot.daysRemaining,
    daysToGraceEnd: snapshot.daysToGraceEnd,
    underOneDay: snapshot.underOneDay,
  };
}

export function buildLicenceStatusView(
  snapshot: LicenceStatusSnapshot,
  options: LicenceViewOptions,
): LicenceStatusViewModel {
  const { canActivate, canViewReports, now } = options;
  const derived = effectiveDerived(snapshot, now);
  const state = derived.state;
  const zone = snapshot.timeZone;
  const local = (date: Date): string => formatLicenceInstant(date, zone);

  const expiry = snapshot.expiresAt ? local(snapshot.expiresAt) : null;
  const graceEnd = snapshot.graceEndsAt ? local(snapshot.graceEndsAt) : null;
  const graceDays =
    snapshot.expiresAt && snapshot.graceEndsAt ? daysUntil(snapshot.graceEndsAt, snapshot.expiresAt) : null;

  // The "since" instant for the restricted and invalid captions.
  const sinceInstant =
    derived.restrictedAt ?? (state === "RESTRICTED_CONTINUITY" ? snapshot.graceEndsAt : null);
  const display = daysRemainingDisplay(derived, sinceInstant ? local(sinceInstant) : null);

  const reasonSentence = rejectionSentence(derived.reasonCode ?? "", {
    notBefore: snapshot.notBefore ? local(snapshot.notBefore) : undefined,
  });
  const attentionDeadline = snapshot.attentionSince
    ? local(new Date(snapshot.attentionSince.getTime() + UNAVAILABLE_WINDOW_MS))
    : null;
  const summary = stateSummary(state, { expiry, graceEnd, graceDays, reasonSentence, attentionDeadline });

  const pill = { label: LICENCE_STATE_LABELS[state], tone: LICENCE_STATE_TONE[state] };

  // The zone name appears once, under the first date row that has a value.
  let zoneNoteUsed = false;
  const takeZoneNote = (hasDate: boolean): string | null => {
    if (!hasDate || zoneNoteUsed) return null;
    zoneNoteUsed = true;
    return displayZoneName(zone);
  };
  const dateFact = (
    id: "expires" | "graceEnds",
    label: string,
    date: Date | null,
  ): LicenceFactView => ({
    id,
    label,
    value: date ? local(date) : null,
    utc: date ? formatUtcInstant(date) : null,
    zoneNote: takeZoneNote(date !== null),
    mono: false,
    pill: null,
    copyable: false,
  });

  const verification = snapshot.lastVerificationOutcome ?? "NOT_CHECKED";
  const verificationTone: Record<typeof verification, LicenceTone> = {
    OK: "success",
    FAILED: "danger",
    UNAVAILABLE: "warning",
    NOT_CHECKED: "neutral",
  };

  const plainFact = (
    id: "licenceId" | "client" | "deploymentId",
    label: string,
    value: string | null,
    mono: boolean,
  ): LicenceFactView => ({
    id,
    label,
    value,
    utc: null,
    zoneNote: null,
    mono,
    pill: null,
    copyable: id === "deploymentId" && value !== null,
  });

  const facts: LicenceFactView[] = [
    { id: "state", label: "State", value: null, utc: null, zoneNote: null, mono: false, pill, copyable: false },
    plainFact("licenceId", "Licence ID", snapshot.licenceId, true),
    plainFact("client", "Registered client", snapshot.clientName, false),
    plainFact("deploymentId", "Deployment ID", snapshot.deploymentId, true),
    dateFact("expires", "Expires", snapshot.expiresAt),
    dateFact("graceEnds", "Grace ends", snapshot.graceEndsAt),
    {
      id: "lastVerification",
      label: "Last verification",
      value: snapshot.lastVerifiedAt ? local(snapshot.lastVerifiedAt) : null,
      utc: snapshot.lastVerifiedAt ? formatUtcInstant(snapshot.lastVerifiedAt) : null,
      zoneNote: takeZoneNote(snapshot.lastVerifiedAt !== null),
      mono: false,
      pill: { label: LAST_VERIFICATION_LABELS[verification], tone: verificationTone[verification] },
      copyable: false,
    },
  ];

  const works = RESTRICTED_CAPABILITIES.works.map((capability) => capability.text);
  const blockedTexts = RESTRICTED_CAPABILITIES.blocked.map((capability) => capability.text);
  // The blocked list follows the restriction flag, so the screen never promises more than enforcement allows.
  const blocked = derived.isRestricted ? blockedTexts : [NOTHING_BLOCKED];
  const afterGrace =
    !derived.isRestricted && graceEnd !== null
      ? { heading: afterGraceHeading(graceEnd), items: blockedTexts }
      : null;

  const support = snapshot.support;
  const renewal: LicenceRenewalView | null = support
    ? {
        renewalEmail: support.renewalEmail,
        supportEmail: support.supportEmail,
        phone: support.phone || null,
        hours: support.hours || null,
      }
    : null;

  const neverActivated = !snapshot.everActivated && snapshot.licenceId === null;

  return {
    state,
    pill,
    figure: display.figure,
    caption: display.caption,
    summary,
    facts,
    clockNote: snapshot.clockAlertAt ? clockRollbackNote(local(snapshot.clockAlertAt)) : null,
    works,
    blocked,
    afterGrace,
    preservedData: PRESERVED_DATA_STATEMENT,
    renewal,
    renewalFallback: RENEWAL_FALLBACK,
    emptyState: neverActivated ? { heading: EMPTY_STATE_HEADING, body: EMPTY_STATE_BODY } : null,
    subtitleEmail: renewal ? renewal.renewalEmail : null,
    canActivate,
    canViewReports,
  };
}
