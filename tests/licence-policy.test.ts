/**
 * Licence vocabulary and copy (plan 14-06; D-06, D-10, D-14, OQ1 option-a).
 * Expected strings are the UI-SPEC Copywriting Contract, byte for byte.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatLicenceInstant } from "@/server/licence/display";
import { LICENCE_REJECTION_CODES } from "@/server/licence/format";
import * as policy from "@/server/licence/policy";
import {
  ACTIVATE_CONFIRM_BODY,
  ACTIVATION_SUCCESS,
  LICENCE_REFUSAL_MESSAGE,
  LICENCE_STATE_LABELS,
  LICENCE_STATE_TONE,
  RESTRICTED_CONTINUITY_LABEL,
  afterGraceHeading,
  bannerCopy,
  clockRollbackNote,
  daysRemainingDisplay,
  isKnownNoticeKey,
  isLicenceRefusalMessage,
  isNeutralRejection,
  noticeCopy,
  rejectionSentence,
  stateSummary,
} from "@/server/licence/policy";
import { LICENCE_STATES } from "@/server/licence/types";

const POLICY_SOURCE = readFileSync(path.resolve(process.cwd(), "src/server/licence/policy.ts"), "utf8");

const EXPIRY_LAGOS = formatLicenceInstant(new Date("2026-11-30T22:59:59Z"), "Africa/Lagos");
const GRACE_END_LAGOS = formatLicenceInstant(new Date("2026-12-14T22:59:59Z"), "Africa/Lagos");

describe("Task 1 tracer: a grace summary is composed from policy constants and the date formatter", () => {
  it("Test 3: GRACE summary equals the UI-SPEC sentence", () => {
    expect(EXPIRY_LAGOS).toBe("30 Nov 2026, 23:59 WAT");
    expect(GRACE_END_LAGOS).toBe("14 Dec 2026, 23:59 WAT");
    expect(stateSummary("GRACE", { expiry: EXPIRY_LAGOS, graceEnd: GRACE_END_LAGOS })).toBe(
      "The licence expired on 30 Nov 2026, 23:59 WAT. Everything still works until 14 Dec 2026, 23:59 WAT. After that, restricted continuity mode begins.",
    );
  });

  it("D-06: the phrase is typed once; policy.ts holds exactly one string literal of it", () => {
    expect(POLICY_SOURCE.split(`"Restricted continuity mode"`).length - 1).toBe(1);
    // No other spelling of the phrase anywhere in the file, comments included.
    expect((POLICY_SOURCE.match(/restricted continuity mode/gi) ?? []).length).toBe(1);
    expect(RESTRICTED_CONTINUITY_LABEL).toBe("Restricted continuity mode");
  });
});

describe("state labels and tones (UI-SPEC Color table)", () => {
  it("Test 5: labels", () => {
    expect(LICENCE_STATE_LABELS).toEqual({
      UNLICENSED: "Not activated",
      ACTIVE: "Active",
      EXPIRING_SOON: "Expiring soon",
      GRACE: "Expired, in grace period",
      RESTRICTED_CONTINUITY: "Restricted continuity mode",
      INVALID: "Licence invalid",
      VALIDATION_ATTENTION: "Check pending",
    });
  });

  it("Test 5: tones", () => {
    expect(LICENCE_STATE_TONE).toEqual({
      UNLICENSED: "neutral",
      ACTIVE: "success",
      EXPIRING_SOON: "warning",
      GRACE: "warning",
      RESTRICTED_CONTINUITY: "danger",
      INVALID: "danger",
      VALIDATION_ATTENTION: "warning",
    });
  });

  it("D-06: every state has a distinct label and a label and tone entry", () => {
    const labels = LICENCE_STATES.map((state) => LICENCE_STATE_LABELS[state]);
    expect(new Set(labels).size).toBe(LICENCE_STATES.length);
    for (const state of LICENCE_STATES) expect(LICENCE_STATE_TONE[state]).toBeDefined();
  });
});

describe("daysRemainingDisplay (UI-SPEC Days-remaining rule)", () => {
  const base = { daysRemaining: null, daysToGraceEnd: null, underOneDay: false } as const;

  it("Test 4: under a day, exactly one day, many days", () => {
    expect(daysRemainingDisplay({ ...base, state: "ACTIVE", daysRemaining: 1, underOneDay: true })).toEqual({
      figure: "Under 24 hours",
      caption: "until the licence expires",
    });
    expect(daysRemainingDisplay({ ...base, state: "EXPIRING_SOON", daysRemaining: 1 })).toEqual({
      figure: "1",
      caption: "day remaining",
    });
    expect(daysRemainingDisplay({ ...base, state: "ACTIVE", daysRemaining: 45 })).toEqual({
      figure: "45",
      caption: "days remaining",
    });
  });

  it("Test 4: grace captions end with the lowercase phrase, singular, plural and under a day", () => {
    expect(daysRemainingDisplay({ ...base, state: "GRACE", daysToGraceEnd: 9 })).toEqual({
      figure: "9",
      caption: "days until restricted continuity mode begins",
    });
    expect(daysRemainingDisplay({ ...base, state: "GRACE", daysToGraceEnd: 1 })).toEqual({
      figure: "1",
      caption: "day until restricted continuity mode begins",
    });
    expect(daysRemainingDisplay({ ...base, state: "GRACE", daysToGraceEnd: 1, underOneDay: true })).toEqual({
      figure: "Under 24 hours",
      caption: "until restricted continuity mode begins",
    });
  });

  it("Test 4: restricted and invalid carry only a since caption; unlicensed and pending carry nothing", () => {
    expect(daysRemainingDisplay({ ...base, state: "RESTRICTED_CONTINUITY" }, GRACE_END_LAGOS)).toEqual({
      figure: null,
      caption: `Restricted since ${GRACE_END_LAGOS}`,
    });
    expect(daysRemainingDisplay({ ...base, state: "INVALID" }, GRACE_END_LAGOS)).toEqual({
      figure: null,
      caption: `Invalid since ${GRACE_END_LAGOS}`,
    });
    expect(daysRemainingDisplay({ ...base, state: "UNLICENSED" })).toEqual({ figure: null, caption: null });
    expect(daysRemainingDisplay({ ...base, state: "VALIDATION_ATTENTION" })).toEqual({ figure: null, caption: null });
  });

  it("returns nothing when an active state carries no day count", () => {
    expect(daysRemainingDisplay({ ...base, state: "ACTIVE" })).toEqual({ figure: null, caption: null });
  });
});

describe("stateSummary (UI-SPEC Plain-language state summaries; OQ1 option-a)", () => {
  it("renders all seven summaries", () => {
    expect(stateSummary("UNLICENSED")).toBe(
      "No licence is installed. The deployment works normally until the first licence is activated.",
    );
    expect(stateSummary("ACTIVE")).toBe("The licence is valid. Everything works normally.");
    expect(stateSummary("EXPIRING_SOON", { expiry: EXPIRY_LAGOS, graceDays: 14 })).toBe(
      "The licence expires on 30 Nov 2026, 23:59 WAT. Everything works normally until then, and for 14 days after.",
    );
    expect(stateSummary("RESTRICTED_CONTINUITY")).toBe(
      "Restricted continuity mode is active. New commercial activity is blocked; learners, grading, certificates, refunds and exports continue.",
    );
    expect(stateSummary("INVALID", { reasonSentence: rejectionSentence("BAD_SIGNATURE") })).toBe(
      "The installed licence could not be verified: The signature on this licence could not be verified. It may have been changed or damaged. Upload the original file. Restricted continuity mode is active until a valid licence is activated.",
    );
    expect(stateSummary("VALIDATION_ATTENTION", { attentionDeadline: GRACE_END_LAGOS })).toBe(
      "The licence check could not complete. The last known state is kept until 14 Dec 2026, 23:59 WAT; after that restricted continuity mode begins.",
    );
  });

  it("OQ1 option-a: the Not activated summary says the deployment works normally until first activation", () => {
    expect(stateSummary("UNLICENSED")).toContain("works normally until the first licence is activated");
    expect(LICENCE_STATE_TONE.UNLICENSED).toBe("neutral");
    expect(policy.EMPTY_STATE_BODY).toContain("keeps working normally until the first licence is activated");
  });

  it("uses the singular for a one-day grace and never prints a raw placeholder", () => {
    expect(stateSummary("EXPIRING_SOON", { expiry: EXPIRY_LAGOS, graceDays: 1 })).toContain("for 1 day after");
    for (const state of LICENCE_STATES) expect(stateSummary(state)).not.toMatch(/[{}]/);
  });
});

describe("Task 2: rejection sentences", () => {
  it("Test 1: the UI-SPEC sentences", () => {
    expect(rejectionSentence("BAD_FORMAT")).toBe(
      "This is not a licence file. Upload the file exactly as provided, without editing it.",
    );
    expect(rejectionSentence("WRONG_DEPLOYMENT")).toBe(
      "This licence was issued for a different deployment. Compare the deployment ID on this page with your order.",
    );
    expect(rejectionSentence("OLDER_THAN_ACTIVE")).toBe(
      "A newer licence is already active. This older file cannot replace it.",
    );
    expect(rejectionSentence("NOT_YET_VALID", { notBefore: "1 Dec 2026, 00:00 WAT" })).toBe(
      "This licence is not valid yet. It starts on 1 Dec 2026, 00:00 WAT.",
    );
    expect(rejectionSentence("NOT_YET_VALID")).toBe("This licence is not valid yet.");
    expect(rejectionSentence("CONCURRENT_CHANGE")).toBe(
      "The licence status changed while you were working. Nothing was changed. Review the page and try again.",
    );
    expect(rejectionSentence("ALREADY_ACTIVE")).toBe("This licence is already active. No change was made.");
  });

  it("returns a non-empty, distinct sentence for each of the 11 codes", () => {
    const sentences = LICENCE_REJECTION_CODES.map((code) => rejectionSentence(code, { notBefore: "x" }));
    for (const sentence of sentences) expect(sentence.length).toBeGreaterThan(0);
    expect(new Set(sentences).size).toBe(LICENCE_REJECTION_CODES.length);
  });

  it("an unknown code returns the generic sentence and never echoes the code", () => {
    expect(rejectionSentence("NOPE_CODE")).toBe("The licence could not be verified.");
    expect(rejectionSentence("NOPE_CODE")).not.toContain("NOPE_CODE");
  });

  it("only ALREADY_ACTIVE is neutral", () => {
    expect(LICENCE_REJECTION_CODES.filter((code) => isNeutralRejection(code))).toEqual(["ALREADY_ACTIVE"]);
    expect(isNeutralRejection("CONCURRENT_CHANGE")).toBe(false);
  });
});

describe("Task 2: bannerCopy (UI-SPEC Banner copy)", () => {
  const input = {
    daysRemaining: null,
    graceEnd: GRACE_END_LAGOS,
    expiry: EXPIRY_LAGOS,
    renewalEmail: "renewals@provider.example",
    canActivate: false,
  } as const;

  it("Test 2: expiring at 30 days or fewer", () => {
    expect(bannerCopy({ ...input, state: "EXPIRING_SOON", daysRemaining: 30 })).toEqual({
      tone: "warning",
      stateLabel: "Expiring soon",
      message: "Licence expires in 30 days (30 Nov 2026, 23:59 WAT). Contact renewals@provider.example to renew.",
      linkLabel: "View licence",
    });
    expect(bannerCopy({ ...input, state: "EXPIRING_SOON", daysRemaining: 1 })?.message).toContain("in 1 day (");
    expect(bannerCopy({ ...input, state: "EXPIRING_SOON", daysRemaining: 3, renewalEmail: null })?.message).toContain(
      "Use the support contact on your agreement.",
    );
  });

  it("Test 2: no banner above 30 days, for ACTIVE or for UNLICENSED", () => {
    expect(bannerCopy({ ...input, state: "EXPIRING_SOON", daysRemaining: 31 })).toBeNull();
    expect(bannerCopy({ ...input, state: "ACTIVE", daysRemaining: 200 })).toBeNull();
    expect(bannerCopy({ ...input, state: "UNLICENSED" })).toBeNull();
  });

  it("Test 2: grace, restricted, invalid and attention", () => {
    expect(bannerCopy({ ...input, state: "GRACE" })).toEqual({
      tone: "warning",
      stateLabel: "Expired, in grace period",
      message:
        "Licence expired on 30 Nov 2026, 23:59 WAT. Normal operation continues until 14 Dec 2026, 23:59 WAT; then restricted continuity mode begins.",
      linkLabel: "View licence",
    });
    expect(bannerCopy({ ...input, state: "RESTRICTED_CONTINUITY" })).toEqual({
      tone: "danger",
      stateLabel: "Restricted continuity mode",
      message:
        "Restricted continuity mode is active. New enrolments, checkout, publishing and settings changes are blocked. Your data is kept.",
      linkLabel: "View licence",
    });
    expect(bannerCopy({ ...input, state: "RESTRICTED_CONTINUITY", canActivate: true })?.linkLabel).toBe(
      "Activate a licence",
    );
    const invalid = bannerCopy({
      ...input,
      state: "INVALID",
      canActivate: true,
      reasonSentence: rejectionSentence("EXPIRED"),
    });
    expect(invalid).toEqual({
      tone: "danger",
      stateLabel: "Licence invalid",
      message:
        "The licence could not be verified: This licence has expired. Request a new licence. Restricted continuity mode is active.",
      linkLabel: "Activate a licence",
    });
    expect(bannerCopy({ ...input, state: "INVALID" })?.message).toBe(
      "The licence could not be verified. Restricted continuity mode is active.",
    );
    expect(bannerCopy({ ...input, state: "VALIDATION_ATTENTION" })).toEqual({
      tone: "warning",
      stateLabel: "Check pending",
      message: "The licence check could not complete. The last known state is kept for up to 24 hours.",
      linkLabel: "View licence",
    });
  });
});

describe("Task 2: noticeCopy and isKnownNoticeKey (D-10, LIC-07)", () => {
  const vars = { days: "30", expiry: EXPIRY_LAGOS, graceEnd: GRACE_END_LAGOS };

  it("Test 3: expiring keys", () => {
    expect(noticeCopy("expiring-30", vars)).toMatchObject({
      title: "Licence expires in 30 days",
      meta: "Expires 30 Nov 2026, 23:59 WAT",
    });
    expect(noticeCopy("expiring-1", vars)).toMatchObject({ title: "Licence expires tomorrow" });
    // A bucket key with no day figure falls back to the bucket itself.
    expect(noticeCopy("expiring-7").title).toBe("Licence expires in 7 days");
    // A non-numeric day figure is ignored, never echoed.
    expect(noticeCopy("expiring-7", { days: "<b>x</b>" }).title).toBe("Licence expires in 7 days");
  });

  it("Test 3: expired, grace-ending, restricted", () => {
    expect(noticeCopy("expired", vars)).toMatchObject({
      title: "Licence expired: grace period has started",
      meta: "Normal operation continues until 14 Dec 2026, 23:59 WAT",
    });
    expect(noticeCopy("grace-ending", { ...vars, days: "3" })).toMatchObject({
      title: "Grace period ends in 3 days",
      meta: "Restricted continuity mode begins 14 Dec 2026, 23:59 WAT",
    });
    expect(noticeCopy("restricted")).toMatchObject({
      title: "Restricted continuity mode is now active",
      meta: "New enrolments and checkout are blocked",
    });
  });

  it("Test 3: invalid, attention and clock-rollback", () => {
    expect(noticeCopy("invalid-BAD_SIGNATURE")).toMatchObject({
      title: "Licence could not be verified",
      meta: rejectionSentence("BAD_SIGNATURE"),
    });
    expect(noticeCopy("validation-attention-1790000000")).toMatchObject({
      title: "Licence check could not complete",
      meta: "Last known state kept for up to 24 hours",
    });
    expect(noticeCopy("clock-rollback-2026-10-01T14")).toMatchObject({
      title: "Server clock moved backwards",
      meta: "Check the server time settings",
    });
  });

  const KEYS = [
    "expiring-60",
    "expiring-30",
    "expiring-14",
    "expiring-7",
    "expiring-3",
    "expiring-1",
    "expired",
    "grace-ending",
    "restricted",
    "invalid-BAD_SIGNATURE",
    "invalid-RECORD_MISSING",
    "invalid-VALIDATION_WINDOW_EXHAUSTED",
    "validation-attention-1790000000",
    "clock-rollback-2026-10-01T14",
  ];

  it("Test 3: every known key has headline equal to the title and an email detail of at most three sentences", () => {
    for (const key of KEYS) {
      const result = noticeCopy(key, vars);
      expect(result.emailHeadline, key).toBe(result.title);
      expect(result.emailDetail.length, key).toBeGreaterThan(0);
      const sentences = result.emailDetail.split(/(?<=[.!?])\s+/).filter((part) => part.length > 0);
      expect(sentences.length, key).toBeLessThanOrEqual(3);
      // The email carries no signing, contract, key or deployment-ID detail.
      expect(result.emailDetail.toLowerCase(), key).not.toMatch(/deployment id|signature|contract|signing/);
    }
  });

  it("an unknown key renders a generic safe sentence and never echoes the raw key", () => {
    const unknown = noticeCopy("totally-unknown", vars);
    expect(unknown.title).toBe("Licence status update");
    expect(unknown.title).not.toContain("totally-unknown");
    expect(JSON.stringify(unknown)).not.toContain("totally-unknown");
    const badCode = noticeCopy("invalid-NOPE", vars);
    expect(badCode.title).toBe("Licence status update");
    expect(JSON.stringify(badCode)).not.toContain("NOPE");
  });

  it("isKnownNoticeKey accepts the closed set and rejects everything else", () => {
    for (const key of KEYS) expect(isKnownNoticeKey(key), key).toBe(true);
    for (const key of ["expiring-45", "invalid-NOPE", "totally-unknown", "", "expiring-30 ", "expiring-1x", "expired-1"]) {
      expect(isKnownNoticeKey(key), JSON.stringify(key)).toBe(false);
    }
  });

  it("every real invalid reason produced by the state machine is a known key", () => {
    for (const code of LICENCE_REJECTION_CODES) expect(isKnownNoticeKey(`invalid-${code}`)).toBe(true);
  });
});

describe("Task 2: refusal messages (T-14-06-04)", () => {
  it("Test 4: isLicenceRefusalMessage matches only the licence refusal", () => {
    expect(LICENCE_REFUSAL_MESSAGE).toBe(
      "This action is unavailable while the deployment is in restricted continuity mode. Ask an administrator to check the licence status.",
    );
    expect(isLicenceRefusalMessage(LICENCE_REFUSAL_MESSAGE)).toBe(true);
    expect(isLicenceRefusalMessage("Your role does not permit this action.")).toBe(false);
    expect(isLicenceRefusalMessage("")).toBe(false);
  });

  it("holds the UI-SPEC staff, administrator, learner and preserved-data copy", () => {
    expect(policy.RESTRICTED_CONTROL_REASON_STAFF).toBe(
      "Unavailable in restricted continuity mode. Ask an administrator to check the licence status.",
    );
    expect(policy.RESTRICTED_CONTROL_REASON_ADMIN).toBe(
      "Unavailable in restricted continuity mode. Open Licence to see how to restore this.",
    );
    expect(policy.LEARNER_REFUSAL_MESSAGE).toBe("Enrolment is temporarily unavailable. Please contact support.");
    expect(policy.PRESERVED_DATA_STATEMENT).toBe(
      "Your data is kept. Nothing is deleted when a licence expires or the deployment enters restricted continuity mode.",
    );
  });

  it("learner copy never names the licence", () => {
    expect(policy.LEARNER_REFUSAL_MESSAGE.toLowerCase()).not.toContain("licence");
  });
});

describe("Task 2: screen strings", () => {
  it("holds the UI-SPEC text", () => {
    expect(policy.EMPTY_STATE_HEADING).toBe("No licence has been activated");
    expect(policy.EMPTY_STATE_BODY).toBe(
      "This deployment has no licence installed yet. It keeps working normally until the first licence is activated. Activate one below, or ask an administrator who can activate licences.",
    );
    expect(policy.LOAD_ERROR_MESSAGE).toBe("Couldn't load licence status. Reload the page; if it persists, contact support.");
    expect(policy.ACTIVATION_PERMISSION_NOTE).toBe(
      "Activating a licence needs the activate-licence permission. Ask an administrator who holds it.",
    );
    expect(ACTIVATION_SUCCESS("Active")).toBe("Licence activated. This deployment is now Active.");
    expect(policy.ACTIVATION_GENERIC_FAILURE).toBe(
      "Licence not activated. Nothing was changed. Try again; if it persists, contact support.",
    );
    expect(policy.ACTIVATE_CONFIRM_TITLE).toBe("Activate this licence?");
    expect(ACTIVATE_CONFIRM_BODY("L-1", "Acme", "30 Nov 2026, 23:59 WAT")).toBe(
      "Licence L-1 for Acme becomes the active licence for this deployment and is valid until 30 Nov 2026, 23:59 WAT. This is recorded in the audit log.",
    );
    expect(policy.DIAGNOSTIC_ERROR_MESSAGE).toBe("Diagnostic report not downloaded. Try again.");
    expect(policy.RENEWAL_FALLBACK).toBe("Use the support contact on your agreement.");
    expect(policy.WORKS_HEADING).toBe("What works");
    expect(policy.BLOCKED_HEADING).toBe("What is blocked");
    expect(policy.NOTHING_BLOCKED).toBe("Nothing is blocked right now.");
    expect(afterGraceHeading("14 Dec 2026, 23:59 WAT")).toBe("What happens after 14 Dec 2026, 23:59 WAT");
    expect(policy.NOT_AVAILABLE).toBe("Not available");
    expect(policy.LAST_VERIFICATION_LABELS).toEqual({
      OK: "Passed",
      FAILED: "Failed",
      UNAVAILABLE: "Could not complete",
      NOT_CHECKED: "Not checked yet",
    });
    expect(clockRollbackNote("1 Oct 2026, 14:00 WAT")).toBe(
      "The server clock moved backwards on 1 Oct 2026, 14:00 WAT. Check the server's time settings.",
    );
    expect(policy.DIAGNOSTIC_BUTTON_LABEL).toBe("Download diagnostic report");
    expect(policy.DIAGNOSTIC_HELPER).toBe("Contains no signing material, secrets or personal data.");
    expect(policy.EXPORTS_LINK_LABEL).toBe("Open data exports");
    expect(policy.EXPORTS_HELPER).toBe("Exports stay available in restricted continuity mode.");
  });
});

// ---------------------------------------------------------------------------
// Forbidden-words guard. Patterns are assembled from fragments so this file
// does not itself contain the banned wording (UI-SPEC "Words that must never appear").
// ---------------------------------------------------------------------------

const FORBIDDEN_FRAGMENTS: ReadonlyArray<readonly string[]> = [
  ["read", "[-\\s_]?", "only"],
  ["ext", "end"],
  ["gener", "ate"],
  ["create", "\\s+", "licen[cs]e"],
  ["edit", "\\s+", "licen[cs]e"],
  ["un", "lock"],
  ["re", "activat"],
  ["by", "pass"],
  ["signing", "\\s+", "key"],
  ["private", "\\s+", "key"],
  ["stack", "\\s*", "trace"],
];
const FORBIDDEN = FORBIDDEN_FRAGMENTS.map((parts) => new RegExp(parts.join(""), "i"));

/**
 * The UI-SPEC rejection table (verbatim source) says an unrecognised key is reported as
 * "not issued with a recognised signing key". The banned item in the UI-SPEC is a signing
 * key VALUE, so that one fixed sentence is the only permitted occurrence of the phrase.
 */
const PERMITTED_SENTENCE = rejectionSentence("UNKNOWN_KEY");

function violations(text: string): string[] {
  const scrubbed = text.split(PERMITTED_SENTENCE).join("");
  return FORBIDDEN.filter((pattern) => pattern.test(scrubbed)).map(String);
}

/** Every string reachable from an exported value, calling copy functions with sample arguments. */
function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, into);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectStrings(item, into);
}

function sampleOutputs(): string[] {
  const out: string[] = [];
  const d1 = "30 Nov 2026, 23:59 WAT";
  const d2 = "14 Dec 2026, 23:59 WAT";
  for (const state of LICENCE_STATES) {
    collectStrings(stateSummary(state), out);
    collectStrings(stateSummary(state, { expiry: d1, graceEnd: d2, graceDays: 14, reasonSentence: "x.", attentionDeadline: d2 }), out);
    for (const underOneDay of [false, true]) {
      for (const n of [1, 2, 45]) {
        collectStrings(daysRemainingDisplay({ state, daysRemaining: n, daysToGraceEnd: n, underOneDay }, d1), out);
      }
    }
    for (const canActivate of [false, true]) {
      for (const reasonSentence of [null, rejectionSentence("BAD_SIGNATURE")]) {
        collectStrings(
          bannerCopy({ state, daysRemaining: 10, graceEnd: d2, expiry: d1, renewalEmail: "a@b.example", canActivate, reasonSentence }),
          out,
        );
      }
    }
  }
  for (const code of [...LICENCE_REJECTION_CODES, "CONCURRENT_CHANGE", "RECORD_MISSING", "VALIDATION_WINDOW_EXHAUSTED", "NOPE"]) {
    collectStrings(rejectionSentence(code, { notBefore: d1 }), out);
  }
  for (const key of [
    "expiring-60", "expiring-30", "expiring-14", "expiring-7", "expiring-3", "expiring-1", "expired", "grace-ending",
    "restricted", "invalid-BAD_SIGNATURE", "invalid-RECORD_MISSING", "validation-attention-1790000000",
    "clock-rollback-2026-10-01T14", "totally-unknown",
  ]) {
    collectStrings(noticeCopy(key, { days: "3", expiry: d1, graceEnd: d2 }), out);
  }
  collectStrings(ACTIVATION_SUCCESS("Active"), out);
  collectStrings(ACTIVATE_CONFIRM_BODY("L-1", "Acme", d1), out);
  collectStrings(afterGraceHeading(d2), out);
  collectStrings(clockRollbackNote(d1), out);
  return out;
}

describe("Task 2 Test 5: forbidden-words guard (UI-SPEC, T-14-06-01)", () => {
  it("no exported string constant contains a forbidden word", () => {
    const constants: string[] = [];
    for (const value of Object.values(policy)) {
      if (typeof value !== "function") collectStrings(value, constants);
    }
    expect(constants.length).toBeGreaterThan(20);
    for (const text of constants) {
      expect(violations(text), text).toEqual([]);
    }
  });

  it("no output of any exported copy function over sample arguments contains a forbidden word", () => {
    const outputs = sampleOutputs();
    expect(outputs.length).toBeGreaterThan(100);
    for (const text of outputs) {
      expect(violations(text), text).toEqual([]);
    }
  });

  it("the guard is not vacuous: each pattern matches its own banned wording", () => {
    const samples: string[][] = [
      [["read", "-", "only"].join(""), ["Read", " ", "Only"].join(""), ["read", "only"].join("")],
      [["ext", "ended"].join("")],
      [["gener", "ated"].join("")],
      [["create", " licence"].join("")],
      [["edit", " licence"].join("")],
      [["un", "locked"].join("")],
      [["re", "activate"].join("")],
      [["by", "passed"].join("")],
      [["signing", " key"].join("")],
      [["private", " key"].join("")],
      [["stack", " trace"].join("")],
    ];
    expect(FORBIDDEN.length).toBe(samples.length);
    FORBIDDEN.forEach((pattern, index) => {
      for (const sample of samples[index]) expect(pattern.test(sample), String(pattern) + " / " + sample).toBe(true);
    });
  });

  it("the permitted UNKNOWN_KEY sentence is the only licence copy that mentions a signing key", () => {
    expect(violations(PERMITTED_SENTENCE)).toEqual([]);
    expect(violations(["The ", "signing", " key", " is wrong."].join(""))).not.toEqual([]);
  });
});
