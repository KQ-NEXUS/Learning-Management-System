/**
 * Proof for the licence diagnostic report allow-list (Phase 14, plan 14-09;
 * D-14, T-14-09-06): the report is built field by field, so no raw licence
 * text, signature, environment value, database URL, stack trace or user data
 * can appear in it.
 *
 * Runs against the Testcontainers database (never the configured
 * DATABASE_URL). PREREQUISITE: Docker must be running; otherwise `beforeAll`
 * fails with a container-start error and every case reports BLOCKED.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LicenceUnavailableError } from "@/server/licence/errors";
import type { TrustSet } from "@/server/licence/trust-set";
import { recordAuditInTransaction } from "@/server/services/audit-service";
import { createLicenceActivationService } from "@/server/services/licence-activation-service";
import { createLicenceService, DIAGNOSTIC_REPORT_KEYS } from "@/server/services/licence-service";
import {
  createFixtureKey,
  FIXTURE_CLIENT,
  FIXTURE_DEPLOYMENT_ID,
  FIXTURE_NOW,
  fixtureTrustSet,
  mintLicence,
  type MintedLicence,
} from "./support/licence-fixtures";
import { LICENCE_STATE_ID, resetLicenceTables, setDeploymentId } from "./support/licence-db";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";

let testDb: TestDatabase;
let actorId: string;

const key = createFixtureKey("diagnostic-key");
const trustSet: TrustSet = fixtureTrustSet([key]);

beforeAll(async () => {
  testDb = await startTestDatabase();
  const actor = await testDb.prisma.user.create({
    data: {
      email: "diagnostic-actor@licence-diagnostic.test",
      name: "Diagnostic Actor",
      status: "ACTIVE",
      emailVerified: new Date(),
      isStaff: true,
    },
  });
  actorId = actor.id;
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

beforeEach(async () => {
  await testDb.prisma
    .$executeRaw`INSERT INTO "DeploymentIdentity" ("id") VALUES ('deployment') ON CONFLICT DO NOTHING`;
  await testDb.prisma
    .$executeRaw`INSERT INTO "LicenceState" ("id", "highWaterAt", "updatedAt") VALUES ('current', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING`;
  await resetLicenceTables(testDb.prisma);
  await setDeploymentId(testDb.prisma, FIXTURE_DEPLOYMENT_ID);
  await setHighWater(FIXTURE_NOW);
});

async function setHighWater(at: Date): Promise<void> {
  await testDb.prisma.licenceState.update({ where: { id: LICENCE_STATE_ID }, data: { highWaterAt: at } });
}

function makeService(options: { now?: () => Date; trustLoader?: () => TrustSet } = {}) {
  return createLicenceService({
    db: testDb.prisma,
    trustSet: options.trustLoader ?? (() => trustSet),
    audit: (event) => recordAuditInTransaction(testDb.prisma, event),
    now: options.now ?? (() => FIXTURE_NOW),
    monotonicNow: () => 0,
    log: () => undefined,
  });
}

async function activate(): Promise<MintedLicence> {
  const minted = mintLicence({ key });
  const activation = createLicenceActivationService({
    db: testDb.prisma,
    trustSet: () => trustSet,
    audit: (event) => recordAuditInTransaction(testDb.prisma, event),
    auditInTransaction: (tx, event) => recordAuditInTransaction(tx, event),
    now: () => FIXTURE_NOW,
  });
  expect((await activation.activateLicence({ actorId, raw: minted.raw })).ok).toBe(true);
  return minted;
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("allow-listed members", () => {
  it("returns exactly the allow-list, with UTC ISO instants and key ids only", async () => {
    const minted = await activate();
    const payload = minted.payload as {
      licenceId: string;
      issuedAt: string;
      expiresAt: string;
      graceEndsAt: string;
    };

    const report = await makeService().buildDiagnosticReport();

    expect(Object.keys(report)).toEqual([...DIAGNOSTIC_REPORT_KEYS]);
    expect(report).toMatchObject({
      reportVersion: 1,
      generatedAt: FIXTURE_NOW.toISOString(),
      state: "ACTIVE",
      reasonCode: null,
      licenceId: payload.licenceId,
      keyId: key.kid,
      schemaVersion: 1,
      deploymentId: FIXTURE_DEPLOYMENT_ID,
      registeredClientId: FIXTURE_CLIENT.id,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
      graceEndsAt: payload.graceEndsAt,
      lastVerificationOutcome: "OK",
    });
    for (const field of [
      "generatedAt",
      "issuedAt",
      "expiresAt",
      "graceEndsAt",
      "lastVerifiedAt",
      "highWaterAt",
    ] as const) {
      expect(report[field]).toMatch(ISO_UTC);
    }
    expect(report.attentionSince).toBeNull();
    expect(Array.isArray(report.trustSetKeyIds)).toBe(true);
    expect(report.trustSetKeyIds).toEqual([key.kid]);
    for (const id of report.trustSetKeyIds) expect(typeof id).toBe("string");
  });

  it("is built field by field: the shaping code never spreads a row or the snapshot", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "src/server/services/licence-service.ts"),
      "utf8",
    );
    const start = source.indexOf("async buildDiagnosticReport");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start);
    expect(body).not.toMatch(/\.\.\.\s*(rows|snapshot|evaluation|state|record)\b/);
  });
});

describe("nothing secret or raw can appear", () => {
  it("excludes the stored raw text, any part of the signature, environment values, the database URL and stack markers", async () => {
    const minted = await activate();
    const [, header, payloadPart, signature] = minted.raw.split(".");
    const previousUrl = process.env.DATABASE_URL;
    const previousVersion = process.env.APP_VERSION;
    process.env.DATABASE_URL = "postgresql://leak-canary-user:leak-canary-pass@db.invalid:5432/leak";
    process.env.APP_VERSION = "9.9.9-test";
    try {
      const report = await makeService().buildDiagnosticReport();
      const serialized = JSON.stringify(report);

      expect(report.appVersion).toBe("9.9.9-test");
      expect(serialized.includes(minted.raw)).toBe(false);
      expect(serialized.includes(signature)).toBe(false);
      expect(serialized.includes(signature.slice(0, 16))).toBe(false);
      expect(serialized.includes(header)).toBe(false);
      expect(serialized.includes(payloadPart)).toBe(false);
      expect(serialized.includes("leak-canary")).toBe(false);
      expect(serialized.includes("postgresql://")).toBe(false);
      expect(serialized.toLowerCase()).not.toContain("password");
      expect(serialized.toLowerCase()).not.toContain("secret");
      expect(serialized).not.toMatch(/\bat\s+\S+[\\/]\S+:\d+/);
      expect(serialized).not.toContain("node_modules");
      // The client's display name and support contacts live in the signed payload only.
      expect(serialized.includes(FIXTURE_CLIENT.name)).toBe(false);
      expect(serialized.includes("provider.example")).toBe(false);
    } finally {
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
      if (previousVersion === undefined) delete process.env.APP_VERSION;
      else process.env.APP_VERSION = previousVersion;
    }
  });

  it("a tampered stored text is reported as INVALID without echoing it", async () => {
    const minted = await activate();
    const licenceId = (minted.payload as { licenceId: string }).licenceId;
    const parts = minted.raw.split(".");
    const mid = Math.floor(parts[2].length / 2);
    parts[2] = `${parts[2].slice(0, mid)}${parts[2][mid] === "A" ? "B" : "A"}${parts[2].slice(mid + 1)}`;
    const edited = parts.join(".");
    await testDb.prisma.licenceRecord.update({ where: { licenceId }, data: { raw: edited } });

    const report = await makeService().buildDiagnosticReport();
    const serialized = JSON.stringify(report);

    expect(report.state).toBe("INVALID");
    expect(["BAD_SIGNATURE", "BAD_FORMAT"]).toContain(report.reasonCode);
    expect(serialized.includes(edited)).toBe(false);
    expect(serialized.includes(minted.raw)).toBe(false);
    expect(serialized.includes(parts[3])).toBe(false);
  });

  it("a trust-set load failure yields an empty key list and does not throw or leak the error", async () => {
    await activate();
    const failing = makeService({
      trustLoader: () => {
        throw new LicenceUnavailableError("trust set could not be loaded from /secret/path");
      },
    });

    const report = await failing.buildDiagnosticReport();

    expect(report.trustSetKeyIds).toEqual([]);
    expect(report.state).toBe("VALIDATION_ATTENTION");
    expect(JSON.stringify(report)).not.toContain("/secret/path");
    expect(Object.keys(report)).toEqual([...DIAGNOSTIC_REPORT_KEYS]);
  });
});

describe("a deployment that never activated", () => {
  it("reports UNLICENSED, nulls for the licence fields and the deployment id", async () => {
    const report = await makeService().buildDiagnosticReport();

    expect(Object.keys(report)).toEqual([...DIAGNOSTIC_REPORT_KEYS]);
    expect(report).toMatchObject({
      state: "UNLICENSED",
      reasonCode: null,
      licenceId: null,
      keyId: null,
      schemaVersion: null,
      registeredClientId: null,
      issuedAt: null,
      expiresAt: null,
      graceEndsAt: null,
      lastVerifiedAt: null,
      lastVerificationOutcome: null,
      attentionSince: null,
      deploymentId: FIXTURE_DEPLOYMENT_ID,
    });
  });
});

describe("clockSkewSeconds", () => {
  it("is the number of seconds the stored high-water mark is ahead of now, clamped at zero", async () => {
    const service = makeService();

    await setHighWater(new Date(FIXTURE_NOW.getTime() + 90_000));
    expect((await service.buildDiagnosticReport()).clockSkewSeconds).toBe(90);

    await setHighWater(new Date(FIXTURE_NOW.getTime() + 90_999));
    expect((await service.buildDiagnosticReport()).clockSkewSeconds).toBe(90);

    await setHighWater(FIXTURE_NOW);
    expect((await service.buildDiagnosticReport()).clockSkewSeconds).toBe(0);

    await setHighWater(new Date(FIXTURE_NOW.getTime() - 5 * 60_000));
    expect((await service.buildDiagnosticReport()).clockSkewSeconds).toBe(0);
  });
});
