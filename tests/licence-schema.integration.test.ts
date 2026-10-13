/**
 * Real-Postgres proof for the licence stored state (Phase 14, plan 14-03,
 * D-13, LIC-04): a database built only from the checked-in migrations holds the
 * seeded singleton rows, the OQ1 option-a defaults (UNLICENSED, everActivated
 * false), and enforces every CHECK constraint. The migration is additive only.
 *
 * PREREQUISITE: Docker must be running (`tests/support/pg.ts` starts the
 * container). If it is not, `beforeAll` fails with a container-start error —
 * every case reports BLOCKED, never a silent pass.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { resetLicenceTables, setDeploymentId } from "./support/licence-db";

const MIGRATION_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "prisma",
  "migrations",
  "20261001120000_licence_deployment_control",
  "migration.sql",
);

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestDatabase();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

function insertLicenceRecord(licenceId: string, raw: string) {
  return testDb.prisma.$executeRawUnsafe(
    `INSERT INTO "LicenceRecord"
       ("id", "licenceId", "raw", "keyId", "schemaVersion", "clientId", "issuedAt", "expiresAt", "graceEndsAt")
     VALUES ($1, $2, $3, 'key-1', 1, 'client-1', NOW(), NOW(), NOW())`,
    `rec-${licenceId}`,
    licenceId,
    raw,
  );
}

describe("licence seed rows", () => {
  it("seeds exactly one DeploymentIdentity row with a generated identifier", async () => {
    const rows = await testDb.prisma.deploymentIdentity.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("deployment");
    expect(typeof rows[0].deploymentId).toBe("string");
    expect(rows[0].deploymentId.length).toBeGreaterThanOrEqual(32);
  });

  it("seeds exactly one LicenceState row with the never-activated defaults", async () => {
    const rows = await testDb.prisma.licenceState.findMany();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.id).toBe("current");
    expect(row.state).toBe("UNLICENSED");
    expect(row.everActivated).toBe(false);
    expect(row.version).toBe(0);
    expect(row.activeRecordId).toBeNull();
    expect(row.highWaterAt).toBeInstanceOf(Date);
  });
});

describe("licence CHECK constraints", () => {
  beforeEach(async () => {
    await resetLicenceTables(testDb.prisma);
  });

  it("rejects a second DeploymentIdentity row", async () => {
    await expect(
      testDb.prisma.$executeRawUnsafe(
        `INSERT INTO "DeploymentIdentity" ("id", "deploymentId") VALUES ('other', 'abc')`,
      ),
    ).rejects.toThrow(/DeploymentIdentity_singleton_check/);
  });

  it("rejects a second LicenceState row", async () => {
    await expect(
      testDb.prisma.$executeRawUnsafe(
        `INSERT INTO "LicenceState" ("id", "updatedAt") VALUES ('other', NOW())`,
      ),
    ).rejects.toThrow(/LicenceState_singleton_check/);
  });

  it("rejects an unknown state value", async () => {
    await expect(
      testDb.prisma.$executeRawUnsafe(`UPDATE "LicenceState" SET "state" = 'BOGUS' WHERE "id" = 'current'`),
    ).rejects.toThrow(/LicenceState_state_check/);
  });

  it("accepts every state in the seven-value vocabulary", async () => {
    for (const state of [
      "UNLICENSED",
      "ACTIVE",
      "EXPIRING_SOON",
      "GRACE",
      "RESTRICTED_CONTINUITY",
      "INVALID",
      "VALIDATION_ATTENTION",
    ]) {
      await expect(
        testDb.prisma.$executeRawUnsafe(`UPDATE "LicenceState" SET "state" = '${state}' WHERE "id" = 'current'`),
      ).resolves.toBe(1);
    }
  });

  it("rejects a negative version", async () => {
    await expect(
      testDb.prisma.$executeRawUnsafe(`UPDATE "LicenceState" SET "version" = -1 WHERE "id" = 'current'`),
    ).rejects.toThrow(/LicenceState_version_nonnegative_check/);
  });

  it("rejects raw licence text longer than 8192 characters and accepts exactly 8192", async () => {
    await expect(insertLicenceRecord("lic-too-long", "a".repeat(8193))).rejects.toThrow(
      /LicenceRecord_raw_length_check/,
    );
    await expect(insertLicenceRecord("lic-max-length", "a".repeat(8192))).resolves.toBe(1);
  });

  it("rejects two LicenceRecord rows with the same licenceId", async () => {
    await insertLicenceRecord("lic-dup", "raw-1");
    await expect(
      testDb.prisma.$executeRawUnsafe(
        `INSERT INTO "LicenceRecord"
           ("id", "licenceId", "raw", "keyId", "schemaVersion", "clientId", "issuedAt", "expiresAt", "graceEndsAt")
         VALUES ('rec-dup-2', 'lic-dup', 'raw-2', 'key-1', 1, 'client-1', NOW(), NOW(), NOW())`,
      ),
    ).rejects.toThrow(/23505|already exists/);
  });
});

describe("licence test helpers", () => {
  it("resetLicenceTables clears records and restores the singleton without deleting it", async () => {
    await insertLicenceRecord("lic-reset", "raw");
    await testDb.prisma.licenceState.update({
      where: { id: "current" },
      data: { activeRecordId: "rec-lic-reset", everActivated: true, state: "ACTIVE", version: 3 },
    });

    await resetLicenceTables(testDb.prisma);

    expect(await testDb.prisma.licenceRecord.count()).toBe(0);
    const state = await testDb.prisma.licenceState.findUniqueOrThrow({ where: { id: "current" } });
    expect(state.state).toBe("UNLICENSED");
    expect(state.everActivated).toBe(false);
    expect(state.version).toBe(0);
    expect(state.activeRecordId).toBeNull();
    expect(await testDb.prisma.deploymentIdentity.count()).toBe(1);
  });

  it("setDeploymentId rebinds the singleton identifier", async () => {
    await setDeploymentId(testDb.prisma, "deployment-test-0001");
    const row = await testDb.prisma.deploymentIdentity.findUniqueOrThrow({ where: { id: "deployment" } });
    expect(row.deploymentId).toBe("deployment-test-0001");
  });
});

describe("licence migration hygiene", () => {
  it("is additive only: the migration SQL contains no DROP keyword", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(/\bDROP\b/i.test(sql)).toBe(false);
  });

  it("holds every named constraint and both idempotent seed inserts", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    for (const name of [
      "DeploymentIdentity_singleton_check",
      "LicenceState_singleton_check",
      "LicenceState_state_check",
      "LicenceState_version_nonnegative_check",
      "LicenceRecord_raw_length_check",
    ]) {
      expect(sql).toContain(name);
    }
    expect(sql).toMatch(/INSERT INTO "DeploymentIdentity"[\s\S]*?ON CONFLICT DO NOTHING/);
    expect(sql).toMatch(/INSERT INTO "LicenceState"[\s\S]*?ON CONFLICT DO NOTHING/);
  });
});
