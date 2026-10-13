/**
 * Unit proof for the licence service's pure helpers and its closure rule
 * (Phase 14, plan 14-07; LIC-01, D-01, D-13). No database: the activation
 * transaction itself is proven on a real Postgres in
 * tests/licence-activation.integration.test.ts.
 */

import path from "node:path";
import type { LicenceRecord, LicenceState } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { DAY_MS } from "@/server/licence/constants";
import { LicenceUnavailableError } from "@/server/licence/errors";
import {
  assessActivation,
  buildStatusSnapshot,
  computeDerived,
  type ActivationRows,
  type LicenceRows,
} from "@/server/services/licence-service";
import { runtimeClosureFrom, runtimeImports } from "./import-graph";
import {
  FIXTURE_DEPLOYMENT_ID,
  FIXTURE_NOW,
  mintLicence,
  type MintedLicence,
} from "./support/licence-fixtures";

function emptyState(overrides: Partial<LicenceState> = {}): LicenceState {
  return {
    id: "current",
    activeRecordId: null,
    registeredClientId: null,
    everActivated: false,
    state: "UNLICENSED",
    restrictedAt: null,
    reasonCode: null,
    lastVerifiedAt: null,
    lastVerificationOutcome: null,
    lastGoodAt: null,
    attentionSince: null,
    highWaterAt: FIXTURE_NOW,
    clockAlertAt: null,
    version: 0,
    updatedAt: FIXTURE_NOW,
    ...overrides,
  };
}

function recordFor(minted: MintedLicence, overrides: Partial<LicenceRecord> = {}): LicenceRecord {
  const p = minted.payload as {
    licenceId: string;
    issuedAt: string;
    expiresAt: string;
    graceEndsAt: string;
    client: { id: string };
  };
  return {
    id: "record-1",
    licenceId: p.licenceId,
    raw: minted.raw,
    keyId: minted.key.kid,
    schemaVersion: 1,
    clientId: p.client.id,
    issuedAt: new Date(p.issuedAt),
    expiresAt: new Date(p.expiresAt),
    graceEndsAt: new Date(p.graceEndsAt),
    activatedAt: FIXTURE_NOW,
    activatedById: null,
    ...overrides,
  };
}

function activeRows(minted: MintedLicence, overrides: Partial<LicenceRows> = {}): LicenceRows {
  const record = recordFor(minted);
  return {
    state: emptyState({
      activeRecordId: record.id,
      registeredClientId: record.clientId,
      everActivated: true,
      state: "ACTIVE",
      version: 1,
    }),
    record,
    deploymentId: FIXTURE_DEPLOYMENT_ID,
    ...overrides,
  };
}

function unlicensedRows(): ActivationRows {
  return { state: emptyState(), record: null, deploymentId: FIXTURE_DEPLOYMENT_ID, history: [] };
}

describe("licence service closure (D-01)", () => {
  const services = ["licence-service.ts", "licence-activation-service.ts"].map((file) =>
    path.resolve(process.cwd(), "src", "server", "services", file),
  );

  it("reaches no request-only import from either service", () => {
    const closure = runtimeClosureFrom(services);
    const offenders = closure.flatMap((filePath) =>
      runtimeImports(filePath)
        .filter(
          ({ specifier, importsCurrentActor }) =>
            specifier === "next" ||
            specifier.startsWith("next/") ||
            specifier === "@/server/permissions" ||
            specifier.startsWith("@/server/permissions/") ||
            importsCurrentActor,
        )
        .map(({ specifier }) => ({ file: path.relative(process.cwd(), filePath), specifier })),
    );
    expect(offenders).toEqual([]);
  });

  it("is not vacuous: the closure includes the verifier and the audit sink", () => {
    const closure = runtimeClosureFrom(services).map((f) => f.replace(/\\/g, "/"));
    expect(closure.some((f) => f.endsWith("src/server/licence/verify.ts"))).toBe(true);
    expect(closure.some((f) => f.endsWith("src/server/services/audit-service.ts"))).toBe(true);
  });
});

describe("buildStatusSnapshot", () => {
  const SNAPSHOT_KEYS = [
    "state",
    "reasonCode",
    "isRestricted",
    "everActivated",
    "licenceId",
    "keyId",
    "schemaVersion",
    "clientName",
    "deploymentId",
    "issuedAt",
    "notBefore",
    "expiresAt",
    "graceEndsAt",
    "timeZone",
    "support",
    "restrictedAt",
    "daysRemaining",
    "daysToGraceEnd",
    "underOneDay",
    "lastVerifiedAt",
    "lastVerificationOutcome",
    "attentionSince",
    "clockAlertAt",
    "highWaterAt",
    "evaluatedAt",
  ].sort();

  it("an unlicensed deployment reads UNLICENSED, unrestricted, with the seeded deployment id", () => {
    const minted = mintLicence();
    const rows = unlicensedRows();
    const snapshot = buildStatusSnapshot(rows, computeDerived(rows, FIXTURE_NOW, minted.trustSet), FIXTURE_NOW);
    expect(snapshot.state).toBe("UNLICENSED");
    expect(snapshot.isRestricted).toBe(false);
    expect(snapshot.everActivated).toBe(false);
    expect(snapshot.licenceId).toBeNull();
    expect(snapshot.deploymentId).toBe(FIXTURE_DEPLOYMENT_ID);
    expect(Object.keys(snapshot).sort()).toEqual(SNAPSHOT_KEYS);
  });

  it("an active licence has exactly the snapshot contract keys and no raw text", () => {
    const minted = mintLicence();
    const rows = activeRows(minted);
    const snapshot = buildStatusSnapshot(rows, computeDerived(rows, FIXTURE_NOW, minted.trustSet), FIXTURE_NOW);
    expect(snapshot.state).toBe("ACTIVE");
    expect(snapshot.licenceId).toBe(rows.record?.licenceId);
    expect(snapshot.clientName).toBe("Fixture Training Academy");
    expect(snapshot.support?.supportEmail).toBe("support@provider.example");
    expect(Object.keys(snapshot).sort()).toEqual(SNAPSHOT_KEYS);
    expect("raw" in snapshot).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain(minted.raw);
  });
});

describe("computeDerived (D-01, D-13: re-verify stored text on every read)", () => {
  it("takes dates from the signed payload, never from the stored columns", () => {
    const minted = mintLicence();
    const rows = activeRows(minted);
    // A database edit pushing the denormalised dates around must not matter.
    const edited: LicenceRows = {
      ...rows,
      record: rows.record
        ? {
            ...rows.record,
            expiresAt: new Date(FIXTURE_NOW.getTime() - DAY_MS),
            graceEndsAt: new Date(FIXTURE_NOW.getTime() - DAY_MS),
          }
        : null,
    };
    const derived = computeDerived(edited, FIXTURE_NOW, minted.trustSet);
    expect(derived.state).toBe("ACTIVE");
    expect(derived.daysRemaining).toBe(90);
  });

  it("rejects an altered raw text as INVALID and restricted", () => {
    const minted = mintLicence();
    const other = mintLicence({ key: minted.key });
    const rows = activeRows(minted);
    // other.raw is validly signed by the same key but is a different licence.
    const swapped: LicenceRows = rows.record
      ? { ...rows, record: { ...rows.record, raw: other.raw } }
      : rows;
    const derived = computeDerived(swapped, FIXTURE_NOW, minted.trustSet);
    expect(derived.state).toBe("INVALID");
    expect(derived.reasonCode).toBe("BAD_SIGNATURE");
    expect(derived.isRestricted).toBe(true);
    // Display falls back to stored identifiers, not the swapped text.
    const snapshot = buildStatusSnapshot(swapped, derived, FIXTURE_NOW);
    expect(snapshot.clientName).toBeNull();
    expect(snapshot.licenceId).toBe(rows.record?.licenceId);
  });

  it("maps a wrong deployment to INVALID WRONG_DEPLOYMENT", () => {
    const minted = mintLicence();
    const rows = activeRows(minted, { deploymentId: "some-other-deployment" });
    const derived = computeDerived(rows, FIXTURE_NOW, minted.trustSet);
    expect(derived.state).toBe("INVALID");
    expect(derived.reasonCode).toBe("WRONG_DEPLOYMENT");
  });

  it("maps a trust-set load failure to VALIDATION_ATTENTION (D-04), not INVALID", () => {
    const minted = mintLicence();
    const rows = activeRows(minted);
    const derived = computeDerived(rows, FIXTURE_NOW, () => {
      throw new LicenceUnavailableError();
    });
    expect(derived.state).toBe("VALIDATION_ATTENTION");
    expect(derived.verification).toEqual({ kind: "UNAVAILABLE" });
  });

  it("an activated deployment with no readable record is INVALID RECORD_MISSING", () => {
    const minted = mintLicence();
    const rows = activeRows(minted, { record: null });
    const derived = computeDerived(rows, FIXTURE_NOW, minted.trustSet);
    expect(derived.state).toBe("INVALID");
    expect(derived.reasonCode).toBe("RECORD_MISSING");
  });
});

describe("assessActivation check order", () => {
  it("accepts a first licence and previews it without a replaces entry", () => {
    const minted = mintLicence();
    const result = assessActivation(unlicensedRows(), minted.raw, FIXTURE_NOW, minted.trustSet);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preview.replaces).toBeNull();
      expect(result.preview.deploymentId).toBe(FIXTURE_DEPLOYMENT_ID);
    }
  });

  it("returns the verifier code for a wrong deployment before any other rule", () => {
    const minted = mintLicence();
    const rows: ActivationRows = { ...unlicensedRows(), deploymentId: "elsewhere" };
    expect(assessActivation(rows, minted.raw, FIXTURE_NOW, minted.trustSet)).toEqual({
      ok: false,
      code: "WRONG_DEPLOYMENT",
    });
  });

  it("returns EXPIRED when now is at or after expiresAt", () => {
    const minted = mintLicence();
    const expiresAt = new Date(String((minted.payload as { expiresAt: string }).expiresAt));
    expect(assessActivation(unlicensedRows(), minted.raw, expiresAt, minted.trustSet)).toEqual({
      ok: false,
      code: "EXPIRED",
    });
    const justBefore = new Date(expiresAt.getTime() - 1);
    expect(assessActivation(unlicensedRows(), minted.raw, justBefore, minted.trustSet).ok).toBe(true);
  });

  it("returns ALREADY_ACTIVE for the active licence id and OLDER_THAN_ACTIVE for equal issuedAt", () => {
    const active = mintLicence();
    const rows: ActivationRows = {
      ...activeRows(active),
      history: [
        {
          id: "record-1",
          licenceId: String((active.payload as { licenceId: string }).licenceId),
          issuedAt: new Date(String((active.payload as { issuedAt: string }).issuedAt)),
        },
      ],
    };
    expect(assessActivation(rows, active.raw, FIXTURE_NOW, active.trustSet)).toEqual({
      ok: false,
      code: "ALREADY_ACTIVE",
    });
    const sameInstant = mintLicence({
      key: active.key,
      payload: { issuedAt: (active.payload as { issuedAt: string }).issuedAt },
    });
    expect(assessActivation(rows, sameInstant.raw, FIXTURE_NOW, active.trustSet)).toEqual({
      ok: false,
      code: "OLDER_THAN_ACTIVE",
    });
  });
});
