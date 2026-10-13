/**
 * View model for the Licence & System Status screen (Phase 14, plan 14-10;
 * LIC-02, D-11, D-14). Pure builder: a fixed `now` and snapshot literals, no
 * database. Boundary cases are explicit (exact expiry instant, one second either
 * side, leap day 2028-02-29) and each asserts the paired UTC string.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DAY_MS } from "@/server/licence/constants";
import { RESTRICTED_CAPABILITIES } from "@/server/licence/effects";
import {
  EMPTY_STATE_BODY,
  EMPTY_STATE_HEADING,
  NOTHING_BLOCKED,
  PRESERVED_DATA_STATEMENT,
  RENEWAL_FALLBACK,
  RESTRICTED_CONTINUITY_LABEL,
  LICENCE_STATE_LABELS,
} from "@/server/licence/policy";
import { LICENCE_STATES, type LicenceStateName, type LicenceStatusSnapshot } from "@/server/licence/types";
import { buildLicenceStatusView, type LicenceStatusViewModel } from "@/server/licence/view-model";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const OPTIONS = { canActivate: true, canViewReports: true, now: NOW };

function snapshot(overrides: Partial<LicenceStatusSnapshot> = {}): LicenceStatusSnapshot {
  return {
    state: "ACTIVE",
    reasonCode: null,
    isRestricted: false,
    everActivated: true,
    licenceId: "LIC-2026-0001",
    keyId: "secret-key-id-0001",
    schemaVersion: 1,
    clientName: "Fixture Training Academy",
    deploymentId: "fixture-deployment-0001",
    issuedAt: new Date("2026-09-30T12:00:00.000Z"),
    notBefore: new Date("2026-09-30T12:00:00.000Z"),
    expiresAt: new Date("2027-03-31T22:59:59.000Z"),
    graceEndsAt: new Date("2027-04-14T22:59:59.000Z"),
    timeZone: "Africa/Lagos",
    support: {
      renewalEmail: "renewals@provider.example",
      supportEmail: "support@provider.example",
      phone: "+234 800 000 0000",
      hours: "Mon to Fri, 09:00 to 17:00 WAT",
    },
    restrictedAt: null,
    daysRemaining: 182,
    daysToGraceEnd: null,
    underOneDay: false,
    lastVerifiedAt: new Date("2026-10-01T11:00:00.000Z"),
    lastVerificationOutcome: "OK",
    attentionSince: null,
    clockAlertAt: null,
    highWaterAt: new Date("2026-10-01T11:59:00.000Z"),
    evaluatedAt: NOW,
    ...overrides,
  };
}

function fact(vm: LicenceStatusViewModel, id: string) {
  const found = vm.facts.find((entry) => entry.id === id);
  if (!found) throw new Error(`no fact ${id}`);
  return found;
}

/** A snapshot whose signed dates are `expiresAt` and `expiresAt + 14 days` in UTC. */
function atBoundary(expiresAtIso: string): LicenceStatusSnapshot {
  const expiresAt = new Date(expiresAtIso);
  return snapshot({ expiresAt, graceEndsAt: new Date(expiresAt.getTime() + 14 * DAY_MS), timeZone: "Africa/Lagos" });
}

describe("buildLicenceStatusView: tracer, an active licence", () => {
  const vm = buildLicenceStatusView(snapshot(), OPTIONS);

  it("builds the pill, figure, caption and summary for an active licence", () => {
    expect(vm.state).toBe("ACTIVE");
    expect(vm.pill).toEqual({ label: "Active", tone: "success" });
    // 181 full days plus 10 h 59 min 59 s, rounded up by the ceiling rule.
    expect(vm.figure).toBe("182");
    expect(vm.caption).toBe("days remaining");
    expect(vm.summary).toBe("The licence is valid. Everything works normally.");
  });

  it("lists the facts in the UI-SPEC order", () => {
    expect(vm.facts.map((entry) => entry.label)).toEqual([
      "State",
      "Licence ID",
      "Registered client",
      "Deployment ID",
      "Expires",
      "Grace ends",
      "Last verification",
    ]);
  });

  it("shows exact local and UTC instants in the licence zone", () => {
    expect(fact(vm, "expires")).toMatchObject({ value: "31 Mar 2027, 23:59 WAT", utc: "2027-03-31T22:59:59Z" });
    expect(fact(vm, "graceEnds")).toMatchObject({ value: "14 Apr 2027, 23:59 WAT", utc: "2027-04-14T22:59:59Z" });
    expect(fact(vm, "lastVerification")).toMatchObject({
      value: "1 Oct 2026, 12:00 WAT",
      utc: "2026-10-01T11:00:00Z",
      pill: { label: "Passed", tone: "success" },
    });
  });

  it("carries the plain ids and client, and marks only ids as mono", () => {
    expect(fact(vm, "licenceId")).toMatchObject({ value: "LIC-2026-0001", mono: true });
    expect(fact(vm, "client")).toMatchObject({ value: "Fixture Training Academy", mono: false });
    expect(fact(vm, "deploymentId")).toMatchObject({ value: "fixture-deployment-0001", mono: true, copyable: true });
  });

  it("shows the zone name once, under the first date row only", () => {
    expect(vm.facts.filter((entry) => entry.zoneNote !== null).map((entry) => entry.id)).toEqual(["expires"]);
    expect(fact(vm, "expires").zoneNote).toBe("Africa/Lagos");
  });

  it("lists nothing blocked now, with the blocked items repeated under the grace-end heading", () => {
    expect(vm.works).toEqual(RESTRICTED_CAPABILITIES.works.map((entry) => entry.text));
    expect(vm.blocked).toEqual([NOTHING_BLOCKED]);
    expect(vm.afterGrace).toEqual({
      heading: "What happens after 14 Apr 2027, 23:59 WAT",
      items: RESTRICTED_CAPABILITIES.blocked.map((entry) => entry.text),
    });
    expect(vm.preservedData).toBe(PRESERVED_DATA_STATEMENT);
  });

  it("puts the renewal email in the subtitle and no clock note while clockAlertAt is null", () => {
    expect(vm.subtitleEmail).toBe("renewals@provider.example");
    expect(vm.clockNote).toBeNull();
    expect(vm.emptyState).toBeNull();
  });

  it("passes the two permission flags through", () => {
    expect(buildLicenceStatusView(snapshot(), { ...OPTIONS, canActivate: false, canViewReports: false })).toMatchObject({
      canActivate: false,
      canViewReports: false,
    });
  });
});

describe("buildLicenceStatusView: missing values", () => {
  it("gives a null display value (rendered as Not available) for every fact the snapshot lacks", () => {
    const vm = buildLicenceStatusView(
      snapshot({
        licenceId: null,
        clientName: null,
        deploymentId: null,
        expiresAt: null,
        graceEndsAt: null,
        lastVerifiedAt: null,
        lastVerificationOutcome: null,
      }),
      OPTIONS,
    );
    for (const id of ["licenceId", "client", "deploymentId", "expires", "graceEnds"]) {
      expect(fact(vm, id).value, id).toBeNull();
      expect(fact(vm, id).utc, id).toBeNull();
    }
    expect(fact(vm, "deploymentId").copyable).toBe(false);
    expect(fact(vm, "lastVerification")).toMatchObject({
      value: null,
      pill: { label: "Not checked yet", tone: "neutral" },
    });
  });
});

describe("buildLicenceStatusView: the seven states", () => {
  const cases: Record<LicenceStateName, LicenceStatusSnapshot> = {
    UNLICENSED: snapshot({
      state: "UNLICENSED",
      everActivated: false,
      licenceId: null,
      clientName: null,
      expiresAt: null,
      graceEndsAt: null,
      support: null,
      timeZone: null,
      lastVerifiedAt: null,
      lastVerificationOutcome: null,
      daysRemaining: null,
    }),
    ACTIVE: snapshot(),
    EXPIRING_SOON: snapshot({
      state: "EXPIRING_SOON",
      expiresAt: new Date(NOW.getTime() + 20 * DAY_MS),
      graceEndsAt: new Date(NOW.getTime() + 34 * DAY_MS),
      daysRemaining: 20,
    }),
    GRACE: snapshot({
      state: "GRACE",
      expiresAt: new Date(NOW.getTime() - 2 * DAY_MS),
      graceEndsAt: new Date(NOW.getTime() + 12 * DAY_MS),
      daysRemaining: null,
      daysToGraceEnd: 12,
    }),
    RESTRICTED_CONTINUITY: snapshot({
      state: "RESTRICTED_CONTINUITY",
      isRestricted: true,
      expiresAt: new Date(NOW.getTime() - 17 * DAY_MS),
      graceEndsAt: new Date("2026-09-28T22:59:59.000Z"),
      restrictedAt: new Date("2026-09-28T22:59:59.000Z"),
      daysRemaining: null,
    }),
    INVALID: snapshot({
      state: "INVALID",
      isRestricted: true,
      reasonCode: "BAD_SIGNATURE",
      restrictedAt: new Date("2026-09-30T08:00:00.000Z"),
      daysRemaining: null,
      lastVerificationOutcome: "FAILED",
    }),
    VALIDATION_ATTENTION: snapshot({
      state: "VALIDATION_ATTENTION",
      attentionSince: new Date("2026-10-01T06:00:00.000Z"),
      lastVerificationOutcome: "UNAVAILABLE",
      daysRemaining: null,
    }),
  };

  const views = Object.fromEntries(
    LICENCE_STATES.map((state) => [state, buildLicenceStatusView(cases[state], OPTIONS)]),
  ) as Record<LicenceStateName, LicenceStatusViewModel>;

  it("has a distinct pill label for each of the seven states, matching the labels table", () => {
    const labels = LICENCE_STATES.map((state) => views[state].pill.label);
    expect(new Set(labels).size).toBe(7);
    for (const state of LICENCE_STATES) {
      expect(views[state].pill.label).toBe(LICENCE_STATE_LABELS[state]);
      expect(views[state].state).toBe(state);
    }
  });

  it("has a non-empty summary for every state", () => {
    for (const state of LICENCE_STATES) expect(views[state].summary.length, state).toBeGreaterThan(20);
  });

  it("uses the UI-SPEC tone for each state", () => {
    expect(views.UNLICENSED.pill.tone).toBe("neutral");
    expect(views.ACTIVE.pill.tone).toBe("success");
    expect(views.EXPIRING_SOON.pill.tone).toBe("warning");
    expect(views.GRACE.pill.tone).toBe("warning");
    expect(views.RESTRICTED_CONTINUITY.pill.tone).toBe("danger");
    expect(views.INVALID.pill.tone).toBe("danger");
    expect(views.VALIDATION_ATTENTION.pill.tone).toBe("warning");
  });

  it("expiring soon: figure in days and the grace length from the signed dates", () => {
    expect(views.EXPIRING_SOON.figure).toBe("20");
    expect(views.EXPIRING_SOON.summary).toContain("and for 14 days after.");
  });

  it("grace: the figure counts days to the grace end and the summary names both dates", () => {
    expect(views.GRACE.figure).toBe("12");
    expect(views.GRACE.caption).toBe(`days until ${RESTRICTED_CONTINUITY_LABEL.toLowerCase()} begins`);
    expect(views.GRACE.summary).toContain("The licence expired on");
    expect(views.GRACE.blocked).toEqual([NOTHING_BLOCKED]);
    expect(views.GRACE.afterGrace?.items).toHaveLength(RESTRICTED_CAPABILITIES.blocked.length);
  });

  it("restricted: no figure, a since caption, and the blocked capabilities listed", () => {
    expect(views.RESTRICTED_CONTINUITY.figure).toBeNull();
    expect(views.RESTRICTED_CONTINUITY.caption).toBe("Restricted since 28 Sep 2026, 23:59 WAT");
    expect(views.RESTRICTED_CONTINUITY.blocked).toEqual(RESTRICTED_CAPABILITIES.blocked.map((entry) => entry.text));
    expect(views.RESTRICTED_CONTINUITY.afterGrace).toBeNull();
    expect(views.RESTRICTED_CONTINUITY.works).toEqual(RESTRICTED_CAPABILITIES.works.map((entry) => entry.text));
  });

  it("invalid: no figure, an invalid-since caption, the fixed reason sentence and the blocked list", () => {
    expect(views.INVALID.figure).toBeNull();
    expect(views.INVALID.caption).toBe("Invalid since 30 Sep 2026, 09:00 WAT");
    expect(views.INVALID.summary).toContain(
      "The signature on this licence could not be verified. It may have been changed or damaged. Upload the original file.",
    );
    expect(views.INVALID.blocked).toEqual(RESTRICTED_CAPABILITIES.blocked.map((entry) => entry.text));
    expect(fact(views.INVALID, "lastVerification").pill).toEqual({ label: "Failed", tone: "danger" });
  });

  it("check pending: no figure, the deadline is 24 hours after attentionSince, last verification could not complete", () => {
    expect(views.VALIDATION_ATTENTION.figure).toBeNull();
    expect(views.VALIDATION_ATTENTION.caption).toBeNull();
    expect(views.VALIDATION_ATTENTION.summary).toContain("until 2 Oct 2026, 07:00 WAT");
    expect(fact(views.VALIDATION_ATTENTION, "lastVerification").pill).toEqual({
      label: "Could not complete",
      tone: "warning",
    });
  });

  it("check pending keeps the blocked list that matches the last known restriction", () => {
    const restrictedPending = buildLicenceStatusView(
      snapshot({ state: "VALIDATION_ATTENTION", isRestricted: true, attentionSince: new Date("2026-10-01T06:00:00.000Z") }),
      OPTIONS,
    );
    expect(restrictedPending.blocked).toEqual(RESTRICTED_CAPABILITIES.blocked.map((entry) => entry.text));
    expect(restrictedPending.afterGrace).toBeNull();
  });

  it("never activated: empty state, Not activated pill, no figure, no grace list, no renewal block", () => {
    const vm = views.UNLICENSED;
    expect(vm.emptyState).toEqual({ heading: EMPTY_STATE_HEADING, body: EMPTY_STATE_BODY });
    expect(vm.emptyState?.heading).toBe("No licence has been activated");
    expect(vm.pill).toEqual({ label: "Not activated", tone: "neutral" });
    expect(vm.figure).toBeNull();
    expect(vm.caption).toBeNull();
    expect(vm.afterGrace).toBeNull();
    expect(vm.blocked).toEqual([NOTHING_BLOCKED]);
    expect(vm.renewal).toBeNull();
    expect(vm.renewalFallback).toBe(RENEWAL_FALLBACK);
    expect(vm.subtitleEmail).toBeNull();
    for (const id of ["licenceId", "client", "expires", "graceEnds"]) expect(fact(vm, id).value, id).toBeNull();
  });

  it("only a deployment that never activated gets the empty state", () => {
    for (const state of LICENCE_STATES) {
      if (state === "UNLICENSED") continue;
      expect(views[state].emptyState, state).toBeNull();
    }
  });
});

describe("buildLicenceStatusView: boundaries (explicit now, paired UTC string)", () => {
  const EXPIRY = "2026-12-01T00:00:00.000Z";

  it("one second before expiry: Under 24 hours, still before grace", () => {
    const vm = buildLicenceStatusView(atBoundary(EXPIRY), { ...OPTIONS, now: new Date("2026-11-30T23:59:59.000Z") });
    expect(vm.state).toBe("EXPIRING_SOON");
    expect(vm.figure).toBe("Under 24 hours");
    expect(vm.caption).toBe("until the licence expires");
    expect(fact(vm, "expires")).toMatchObject({ value: "1 Dec 2026, 01:00 WAT", utc: "2026-12-01T00:00:00Z" });
  });

  it("at the exact expiry instant: grace with the grace figure", () => {
    const vm = buildLicenceStatusView(atBoundary(EXPIRY), { ...OPTIONS, now: new Date(EXPIRY) });
    expect(vm.state).toBe("GRACE");
    expect(vm.pill.label).toBe("Expired, in grace period");
    expect(vm.figure).toBe("14");
    expect(vm.caption).toBe(`days until ${RESTRICTED_CONTINUITY_LABEL.toLowerCase()} begins`);
    expect(fact(vm, "expires").utc).toBe("2026-12-01T00:00:00Z");
    expect(fact(vm, "graceEnds")).toMatchObject({ value: "15 Dec 2026, 01:00 WAT", utc: "2026-12-15T00:00:00Z" });
  });

  it("one second after expiry: still grace, 14 days to the grace end", () => {
    const vm = buildLicenceStatusView(atBoundary(EXPIRY), { ...OPTIONS, now: new Date("2026-12-01T00:00:01.000Z") });
    expect(vm.state).toBe("GRACE");
    expect(vm.figure).toBe("14");
    expect(fact(vm, "expires").utc).toBe("2026-12-01T00:00:00Z");
  });

  it("at the exact grace end: restricted, no figure, since the grace end", () => {
    const vm = buildLicenceStatusView(atBoundary(EXPIRY), { ...OPTIONS, now: new Date("2026-12-15T00:00:00.000Z") });
    expect(vm.state).toBe("RESTRICTED_CONTINUITY");
    expect(vm.figure).toBeNull();
    expect(vm.caption).toBe("Restricted since 15 Dec 2026, 01:00 WAT");
    expect(vm.blocked).toEqual(RESTRICTED_CAPABILITIES.blocked.map((entry) => entry.text));
    expect(fact(vm, "graceEnds").utc).toBe("2026-12-15T00:00:00Z");
  });

  it("one second before the grace end: grace, Under 24 hours", () => {
    const vm = buildLicenceStatusView(atBoundary(EXPIRY), { ...OPTIONS, now: new Date("2026-12-14T23:59:59.000Z") });
    expect(vm.state).toBe("GRACE");
    expect(vm.figure).toBe("Under 24 hours");
  });

  it("leap day 2028-02-29: exactly one day before a 2028-03-01 expiry is 1 day remaining", () => {
    const vm = buildLicenceStatusView(atBoundary("2028-03-01T00:00:00.000Z"), {
      ...OPTIONS,
      now: new Date("2028-02-29T00:00:00.000Z"),
    });
    expect(vm.figure).toBe("1");
    expect(vm.caption).toBe("day remaining");
    expect(fact(vm, "expires")).toMatchObject({ value: "1 Mar 2028, 01:00 WAT", utc: "2028-03-01T00:00:00Z" });
  });

  it("leap day 2028-02-29: one second inside the final day is Under 24 hours", () => {
    const vm = buildLicenceStatusView(atBoundary("2028-03-01T00:00:00.000Z"), {
      ...OPTIONS,
      now: new Date("2028-02-29T00:00:01.000Z"),
    });
    expect(vm.figure).toBe("Under 24 hours");
  });

  it("leap day 2028-02-29 as the displayed instant keeps its date and its UTC pair", () => {
    const vm = buildLicenceStatusView(atBoundary("2028-02-29T10:00:00.000Z"), OPTIONS);
    expect(fact(vm, "expires")).toMatchObject({ value: "29 Feb 2028, 11:00 WAT", utc: "2028-02-29T10:00:00Z" });
  });

  it("uses the signed zone, and falls back to Africa/Lagos for a missing or unknown zone", () => {
    const london = buildLicenceStatusView(
      snapshot({ timeZone: "Europe/London", expiresAt: new Date("2027-07-01T12:00:00.000Z") }),
      OPTIONS,
    );
    expect(fact(london, "expires")).toMatchObject({ value: "1 Jul 2027, 13:00 BST", zoneNote: "Europe/London" });

    for (const timeZone of [null, "Not/AZone"]) {
      const vm = buildLicenceStatusView(snapshot({ timeZone, expiresAt: new Date("2027-07-01T12:00:00.000Z") }), OPTIONS);
      expect(fact(vm, "expires")).toMatchObject({ value: "1 Jul 2027, 13:00 WAT", zoneNote: "Africa/Lagos" });
    }
  });
});

describe("buildLicenceStatusView: rail and notes", () => {
  it("omits phone and hours when the payload has none, and keeps the two emails", () => {
    const vm = buildLicenceStatusView(
      snapshot({
        support: { renewalEmail: "renewals@provider.example", supportEmail: "support@provider.example", phone: null, hours: null },
      }),
      OPTIONS,
    );
    expect(vm.renewal).toEqual({
      renewalEmail: "renewals@provider.example",
      supportEmail: "support@provider.example",
      phone: null,
      hours: null,
    });
  });

  it("shows the fallback line and no subtitle email when there is no support payload", () => {
    const vm = buildLicenceStatusView(snapshot({ support: null }), OPTIONS);
    expect(vm.renewal).toBeNull();
    expect(vm.subtitleEmail).toBeNull();
    expect(vm.renewalFallback).toBe("Use the support contact on your agreement.");
  });

  it("builds the clock-rollback note only while clockAlertAt is set, naming the date", () => {
    const set = buildLicenceStatusView(snapshot({ clockAlertAt: new Date("2026-09-30T10:00:00.000Z") }), OPTIONS);
    expect(set.clockNote).toBe("The server clock moved backwards on 30 Sep 2026, 11:00 WAT. Check the server's time settings.");
    expect(buildLicenceStatusView(snapshot({ clockAlertAt: null }), OPTIONS).clockNote).toBeNull();
  });

  it("exposes no signing material, key id, schema version or raw text (T-14-10-02)", () => {
    const serialised = JSON.stringify(buildLicenceStatusView(snapshot(), OPTIONS));
    for (const leaked of ["secret-key-id-0001", "keyId", "schemaVersion", "highWaterAt", "private key", "stack"]) {
      expect(serialised, leaked).not.toContain(leaked);
    }
    expect(serialised).not.toMatch(new RegExp(["read", "-", "only"].join(""), "i"));
  });

  it("builds every licence sentence from policy.ts: the view model and component sources type no post-grace phrase or retired wording (D-06)", () => {
    for (const file of [
      "src/server/licence/view-model.ts",
      "src/app/staff/licence/LicenceStatusView.tsx",
      "src/app/staff/licence/page.tsx",
    ]) {
      const source = readFileSync(path.resolve(process.cwd(), file), "utf8");
      expect(source, file).not.toMatch(/restricted continuity/i);
      expect(source, file).not.toMatch(/read[- ]only/i);
    }
  });
});
