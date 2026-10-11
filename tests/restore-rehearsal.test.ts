/**
 * Restore rehearsal, pure parts (plan 15-11; D-04, NFR-08).
 *
 * The rehearsal itself needs Docker and is run by hand (its evidence lives in
 * the phase evidence folder). These tests pin the parts that decide whether it
 * is safe to run and what it reports: argument parsing, the target refusal
 * rules on top of the host guard, the image tag chosen from the source
 * server's version number, and the RTO arithmetic.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertSafeDatabaseUrl } from "../scripts/ops/db-target-guard";
import {
  DEFAULT_TARGET_PORT,
  KEY_TABLES,
  RTO_TARGET_SECONDS,
  assertTargetDiffersFromSource,
  buildTargetUrl,
  compareRowCounts,
  computeDurations,
  connectionParts,
  imageForServerMajor,
  parseArgs,
  parseRowCounts,
  rowCountSql,
  serverMajorFromVersionNum,
} from "../scripts/ops/restore-rehearsal";

const PASSWORD = "s3cretPassw0rd";
const LOCAL_SOURCE = `postgresql://lms:${PASSWORD}@localhost:5434/lms?schema=public`;
const NEON_URL = `postgresql://neondb_owner:${PASSWORD}@ep-quiet-bird-a1b2c3.eu-central-1.aws.neon.tech/neondb?sslmode=require`;

describe("parseArgs", () => {
  it("defaults the source to the shell DATABASE_URL and the target port to 5440", () => {
    const options = parseArgs([], { DATABASE_URL: LOCAL_SOURCE });
    expect(options).toEqual({
      source: LOCAL_SOURCE,
      targetPort: DEFAULT_TARGET_PORT,
      target: "local",
      out: null,
      keepDump: false,
    });
    expect(DEFAULT_TARGET_PORT).toBe(5440);
  });

  it("reads every flag, in spaced and inline form", () => {
    const options = parseArgs(
      ["--source", LOCAL_SOURCE, "--target-port=5441", "--target", "staging", "--out", "evidence/x.json", "--keep-dump"],
      {},
    );
    expect(options).toEqual({
      source: LOCAL_SOURCE,
      targetPort: 5441,
      target: "staging",
      out: "evidence/x.json",
      keepDump: true,
    });
  });

  it("leaves the source null when neither --source nor DATABASE_URL is set (the guard then refuses)", () => {
    const options = parseArgs([], {});
    expect(options.source).toBeNull();
    expect(() => assertSafeDatabaseUrl(options.source)).toThrow(/unset/);
  });

  it("rejects bad ports, bad targets, missing values and unknown flags", () => {
    expect(() => parseArgs(["--target-port", "abc"], {})).toThrow(/--target-port/);
    expect(() => parseArgs(["--target-port", "80"], {})).toThrow(/--target-port/);
    expect(() => parseArgs(["--target-port", "70000"], {})).toThrow(/--target-port/);
    expect(() => parseArgs(["--target", "production"], {})).toThrow(/--target/);
    expect(() => parseArgs(["--out"], {})).toThrow(/needs a value/);
    expect(() => parseArgs(["--source", "--out", "x"], {})).toThrow(/needs a value/);
    expect(() => parseArgs(["--wat"], {})).toThrow(/Unknown argument/);
  });

  it("never echoes a stray positional value (it could be a connection string)", () => {
    expect(() => parseArgs([NEON_URL], {})).toThrow(/value not shown/);
    try {
      parseArgs([NEON_URL], {});
    } catch (error) {
      expect(String(error)).not.toContain(PASSWORD);
      expect(String(error)).not.toContain("neon.tech");
    }
  });
});

describe("target refusal rules", () => {
  const target = buildTargetUrl(5440, "pw");

  it("builds a local target URL on the chosen port that the host guard accepts", () => {
    const parts = connectionParts(target);
    expect(parts).toMatchObject({ host: "localhost", port: 5440, database: "restore_rehearsal", user: "postgres" });
    expect(() => assertSafeDatabaseUrl(target)).not.toThrow();
  });

  it("accepts a fresh container on its own port next to a local source", () => {
    expect(() => assertTargetDiffersFromSource(LOCAL_SOURCE, target)).not.toThrow();
  });

  it("refuses a target that is the source database", () => {
    const source = "postgresql://postgres:pw@127.0.0.1:5440/restore_rehearsal";
    expect(() => assertTargetDiffersFromSource(source, target)).toThrow(/is the source database/);
  });

  it("refuses a target on the source's port, treating every local host name as one machine", () => {
    const source = "postgresql://lms:pw@127.0.0.1:5440/lms";
    expect(() => assertTargetDiffersFromSource(source, target)).toThrow(/source database's port/);
  });

  it("refuses a target database named licence_test", () => {
    const licence = "postgresql://licence_test:pw@localhost:5441/licence_test";
    expect(() => assertTargetDiffersFromSource(LOCAL_SOURCE, licence)).toThrow(/licence_test/);
  });

  it("the host guard still refuses a remote source before any refusal rule runs", () => {
    expect(() => assertSafeDatabaseUrl(NEON_URL)).toThrow(/only local hosts/);
  });

  it("refusal messages never carry a password", () => {
    const source = `postgresql://lms:${PASSWORD}@localhost:5440/restore_rehearsal`;
    try {
      assertTargetDiffersFromSource(source, buildTargetUrl(5440, PASSWORD));
      throw new Error("expected a refusal");
    } catch (error) {
      expect(String(error)).not.toContain(PASSWORD);
    }
  });

  it("drops Prisma-only query parameters that libpq would reject", () => {
    const parts = connectionParts(`${LOCAL_SOURCE}&connection_limit=1&sslmode=require`);
    expect(parts.params).toEqual({ sslmode: "require" });
    expect(parts).toMatchObject({ host: "localhost", port: 5434, database: "lms", user: "lms", password: PASSWORD });
  });
});

describe("image tag from the server version", () => {
  it("maps server_version_num to the matching alpine image", () => {
    expect(serverMajorFromVersionNum("160010")).toBe(16);
    expect(serverMajorFromVersionNum(170005)).toBe(17);
    expect(serverMajorFromVersionNum(" 100023\n")).toBe(10);
    expect(imageForServerMajor(16)).toBe("postgres:16-alpine");
  });

  it("rejects pre-10 servers and garbage", () => {
    expect(() => serverMajorFromVersionNum("90605")).toThrow(/older than 10/);
    expect(() => serverMajorFromVersionNum("16.10")).toThrow(/Unexpected/);
    expect(() => serverMajorFromVersionNum("")).toThrow(/Unexpected/);
  });
});

describe("RTO arithmetic", () => {
  it("measures restore, integrity and RTO from the recorded timestamps", () => {
    const durations = computeDurations({
      startedAt: "2026-10-07T10:00:00.000Z",
      dumpStartedAt: "2026-10-07T10:00:05.000Z",
      dumpFinishedAt: "2026-10-07T10:00:09.500Z",
      restoreFinishedAt: "2026-10-07T10:00:21.000Z",
      integrityFinishedAt: "2026-10-07T10:00:30.000Z",
    });
    expect(durations).toEqual({
      dumpSeconds: 4.5,
      restoreSeconds: 11.5,
      integritySeconds: 9,
      rtoSeconds: 30,
      withinRtoTarget: true,
    });
  });

  it("flags an RTO over eight hours and rejects out-of-order timestamps", () => {
    const late = computeDurations({
      startedAt: "2026-10-07T00:00:00.000Z",
      dumpStartedAt: "2026-10-07T00:00:00.000Z",
      dumpFinishedAt: "2026-10-07T04:00:00.000Z",
      restoreFinishedAt: "2026-10-07T08:00:00.000Z",
      integrityFinishedAt: "2026-10-07T08:00:01.000Z",
    });
    expect(late.rtoSeconds).toBe(RTO_TARGET_SECONDS + 1);
    expect(late.withinRtoTarget).toBe(false);
    expect(() =>
      computeDurations({
        startedAt: "2026-10-07T10:00:00.000Z",
        dumpStartedAt: "2026-10-07T10:00:05.000Z",
        dumpFinishedAt: "2026-10-07T10:00:04.000Z",
        restoreFinishedAt: "2026-10-07T10:00:21.000Z",
        integrityFinishedAt: "2026-10-07T10:00:30.000Z",
      }),
    ).toThrow(/out of order/);
  });
});

describe("row counts", () => {
  it("covers the eight key tables in one query and parses psql -At output", () => {
    expect(KEY_TABLES).toEqual([
      "User",
      "Enrolment",
      "Order",
      "PaymentAttempt",
      "Grade",
      "CompletionRecord",
      "Certificate",
      "AuditEvent",
    ]);
    for (const table of KEY_TABLES) expect(rowCountSql()).toContain(`FROM "${table}"`);
    expect(parseRowCounts("User|11\r\nOrder|3\n\nnoise\n")).toEqual({ User: 11, Order: 3 });
  });

  it("matches only when every pair is present and equal", () => {
    const counts = Object.fromEntries(KEY_TABLES.map((t, i) => [t, i]));
    expect(compareRowCounts(counts, { ...counts }).matches).toBe(true);
    expect(compareRowCounts(counts, { ...counts, Grade: 99 }).matches).toBe(false);
    const missing = Object.fromEntries(Object.entries(counts).filter(([table]) => table !== "Certificate"));
    expect(compareRowCounts(missing, missing).matches).toBe(false);
  });
});

describe("script safety properties", () => {
  const source = readFileSync(path.join(__dirname, "..", "scripts", "ops", "restore-rehearsal.ts"), "utf8");

  it("guards both the source and the target before the first docker command", () => {
    const main = source.slice(source.indexOf("async function main"));
    const guardSource = main.indexOf("assertSafeDatabaseUrl(options.source");
    const guardTarget = main.indexOf("assertSafeDatabaseUrl(targetUrl");
    const firstDocker = main.indexOf('"docker"');
    expect(guardSource).toBeGreaterThan(-1);
    expect(guardTarget).toBeGreaterThan(-1);
    expect(firstDocker === -1 || (guardSource < firstDocker && guardTarget < firstDocker)).toBe(true);
    // sourcePsql (the first docker call) is only reached after the guards.
    expect(main.indexOf("sourcePsql(")).toBeGreaterThan(guardTarget);
  });

  it("removes the container in a finally block and never uses a shell", () => {
    expect(source).toMatch(/finally \{[\s\S]*?"rm", "-f", "-v", container/);
    expect(source).toContain("shell: false");
    expect(source).not.toMatch(/shell:\s*true/);
  });
});
