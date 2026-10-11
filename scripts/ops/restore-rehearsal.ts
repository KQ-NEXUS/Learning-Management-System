/**
 * `npx tsx scripts/ops/restore-rehearsal.ts [--source <url>] [--target-port 5440] [--target local|staging] [--out file.json] [--keep-dump]`
 *
 * Restore rehearsal, Docker route (Phase 15, plan 15-11; D-04, NFR-08).
 *
 * Proves a recovery route that does not depend on Neon: it dumps a guarded
 * source database with `pg_dump -Fc`, restores the dump into a FRESH throwaway
 * Postgres container, compares row counts for the key tables on both sides,
 * runs the seven integrity checks (scripts/ops/integrity-checks.ts) against
 * the restored copy, and writes the timings to a JSON evidence file.
 *
 *   --source <url>     Database to dump. Defaults to the shell DATABASE_URL.
 *                      Never read from .env (it names the shared database).
 *   --target-port <n>  Host port of the fresh restore container (default 5440).
 *   --target <t>       "local" (default) or "staging"; passed to the guard for
 *                      the SOURCE. Staging also needs STAGING_DATABASE_HOSTS and
 *                      ALLOW_STAGING_DATABASE=1 (see db-target-guard.ts).
 *   --out <file>       Write the evidence JSON to this file (folders created).
 *   --keep-dump        Keep the dump file in dumps/ (default: deleted at the end,
 *                      because it holds personal data).
 *
 * Safety (P1, threat T-15-11-01):
 *   - The source URL and the computed target URL both pass
 *     assertSafeDatabaseUrl before any docker command runs.
 *   - The target is always a new container named restore-rehearsal-<timestamp>
 *     on its own port. A target equal to the source, on the source's port, or
 *     whose database is named licence_test is refused.
 *   - The container is stopped and removed in a finally block.
 *   - Connection strings and passwords are never printed. Credentials reach
 *     docker through inherited environment variables (`-e NAME` with no value),
 *     so they do not appear in the docker command line either.
 *   - Every child process is started with spawn and an argument array (no
 *     shell), so Git Bash path conversion cannot mangle the volume path.
 *
 * Timing model: startedAt stands in for the incident start. RTO is measured as
 * integrityFinishedAt minus startedAt (restore finished plus integrity pass
 * minus incident start). RPO for this route is the gap between the incident
 * and dumpStartedAt, the latest restorable point the dump captures.
 *
 * Exit codes: 0 rehearsal passed; 1 refused by the guard, a step failed, row
 * counts differ or an integrity check did not pass; 2 bad arguments.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertSafeDatabaseUrl, isLocalHost, type DatabaseTarget } from "./db-target-guard";

export const KEY_TABLES = [
  "User",
  "Enrolment",
  "Order",
  "PaymentAttempt",
  "Grade",
  "CompletionRecord",
  "Certificate",
  "AuditEvent",
] as const;

export type KeyTable = (typeof KEY_TABLES)[number];

export const DEFAULT_TARGET_PORT = 5440;
export const RESTORE_DATABASE_NAME = "restore_rehearsal";
export const RESTORE_DATABASE_USER = "postgres";
/** The local licence test database is never a restore target. */
export const FORBIDDEN_TARGET_DATABASES: ReadonlySet<string> = new Set(["licence_test"]);
/** NFR-08 targets. */
export const RPO_TARGET_SECONDS = 24 * 60 * 60;
export const RTO_TARGET_SECONDS = 8 * 60 * 60;

/** Query parameters Prisma understands but libpq (pg_dump, psql) rejects. */
const PRISMA_ONLY_PARAMS = [
  "schema",
  "connection_limit",
  "pool_timeout",
  "pgbouncer",
  "socket_timeout",
  "statement_cache_size",
  "sslaccept",
  "sslidentity",
  "sslpassword",
];

export type RehearsalOptions = {
  source: string | null;
  targetPort: number;
  target: DatabaseTarget;
  out: string | null;
  keepDump: boolean;
};

export const USAGE =
  "Usage: npx tsx scripts/ops/restore-rehearsal.ts [--source <url>] [--target-port 5440] [--target local|staging] [--out file.json] [--keep-dump]";

/** Parses CLI arguments. `--source` falls back to env.DATABASE_URL. Throws on bad input. */
export function parseArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
): RehearsalOptions {
  const options: RehearsalOptions = {
    source: null,
    targetPort: DEFAULT_TARGET_PORT,
    target: "local",
    out: null,
    keepDump: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const flag = arg.startsWith("--") && eq > 0 ? arg.slice(0, eq) : arg;
    const inline = arg.startsWith("--") && eq > 0 ? arg.slice(eq + 1) : undefined;
    const value = () => {
      const next = inline ?? argv[++i];
      if (next === undefined || next.startsWith("--")) throw new Error(`${flag} needs a value.`);
      return next;
    };
    switch (flag) {
      case "--source":
        options.source = value();
        break;
      case "--target-port": {
        const raw = value();
        const port = Number(raw);
        if (!/^\d+$/.test(raw) || !Number.isInteger(port) || port < 1024 || port > 65535) {
          throw new Error("--target-port must be a whole number between 1024 and 65535.");
        }
        options.targetPort = port;
        break;
      }
      case "--target": {
        const target = value();
        if (target !== "local" && target !== "staging") throw new Error('--target must be "local" or "staging".');
        options.target = target;
        break;
      }
      case "--out":
        options.out = value();
        break;
      case "--keep-dump":
        options.keepDump = true;
        break;
      default:
        throw new Error(`Unknown argument ${JSON.stringify(arg.startsWith("--") ? flag : "(value not shown)")}.`);
    }
  }
  if (options.source === null) options.source = env.DATABASE_URL ?? null;
  return options;
}

export type ConnectionParts = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  /** libpq-compatible query parameters (Prisma-only ones removed). */
  params: Record<string, string>;
};

/** Splits a Postgres URL into parts. Call only after the guard accepted it. */
export function connectionParts(url: string): ConnectionParts {
  const parsed = new URL(url.trim());
  const params: Record<string, string> = {};
  for (const [key, value] of parsed.searchParams) {
    if (!PRISMA_ONLY_PARAMS.includes(key)) params[key] = value;
  }
  return {
    host: parsed.hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase(),
    port: parsed.port === "" ? 5432 : Number(parsed.port),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")) || decodeURIComponent(parsed.username),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    params,
  };
}

/** The URL of the fresh restore container, as the host sees it. */
export function buildTargetUrl(port: number, password: string): string {
  return `postgresql://${RESTORE_DATABASE_USER}:${encodeURIComponent(password)}@localhost:${port}/${RESTORE_DATABASE_NAME}?schema=public`;
}

/**
 * Refusal rules on top of the host guard. Throws (naming no credentials) when
 * the target is the source, shares the source's local port, or is a forbidden
 * database such as licence_test.
 */
export function assertTargetDiffersFromSource(sourceUrl: string, targetUrl: string): void {
  const source = connectionParts(sourceUrl);
  const target = connectionParts(targetUrl);
  if (FORBIDDEN_TARGET_DATABASES.has(target.database.toLowerCase())) {
    throw new Error(`Refusing to restore into database "${target.database}": it is reserved and never a restore target.`);
  }
  const sameHost =
    source.host === target.host || (isLocalHost(source.host) && isLocalHost(target.host));
  if (sameHost && source.port === target.port && source.database === target.database) {
    throw new Error("Refusing to restore: the target database is the source database.");
  }
  if (sameHost && source.port === target.port) {
    throw new Error(
      `Refusing to restore: the target port ${target.port} is the source database's port. Choose another --target-port.`,
    );
  }
}

/** Postgres major from SHOW server_version_num (for example "160010" is 16). */
export function serverMajorFromVersionNum(versionNum: string | number): number {
  const raw = String(versionNum).trim();
  if (!/^\d{5,6}$/.test(raw)) throw new Error(`Unexpected server_version_num ${JSON.stringify(raw)}.`);
  const num = Number(raw);
  // From Postgres 10 on, server_version_num is major * 10000 + minor.
  if (num < 100000) {
    throw new Error(`Postgres ${raw} is older than 10; the rehearsal needs a supported server.`);
  }
  return Math.floor(num / 10000);
}

export function imageForServerMajor(major: number): string {
  return `postgres:${major}-alpine`;
}

export type RehearsalTimes = {
  startedAt: string;
  dumpStartedAt: string;
  dumpFinishedAt: string;
  restoreFinishedAt: string;
  integrityFinishedAt: string;
};

function seconds(fromIso: string, toIso: string): number {
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  if (!Number.isFinite(ms) || ms < 0) throw new Error("Timestamps are out of order.");
  return Math.round(ms / 100) / 10;
}

/**
 * restoreSeconds = restore finished minus dump finished (the pg_restore step).
 * rtoSeconds = integrity finished minus started (incident start).
 * RPO is not computed here: in a rehearsal the dump is taken after the
 * "incident", so the evidence records latestRestorablePoint (the dump start)
 * and the real RPO is set by how often production dumps or history are kept.
 */
export function computeDurations(times: RehearsalTimes) {
  const dumpSeconds = seconds(times.dumpStartedAt, times.dumpFinishedAt);
  const restoreSeconds = seconds(times.dumpFinishedAt, times.restoreFinishedAt);
  const integritySeconds = seconds(times.restoreFinishedAt, times.integrityFinishedAt);
  const rtoSeconds = seconds(times.startedAt, times.integrityFinishedAt);
  return {
    dumpSeconds,
    restoreSeconds,
    integritySeconds,
    rtoSeconds,
    withinRtoTarget: rtoSeconds <= RTO_TARGET_SECONDS,
  };
}

/** Row-count pairs; `matches` is true only when every pair is equal. */
export function compareRowCounts(
  source: Record<string, number>,
  restored: Record<string, number>,
): { rowCounts: Record<string, { source: number; restored: number }>; matches: boolean } {
  const rowCounts: Record<string, { source: number; restored: number }> = {};
  let matches = true;
  for (const table of KEY_TABLES) {
    const pair = { source: source[table] ?? -1, restored: restored[table] ?? -1 };
    if (pair.source < 0 || pair.source !== pair.restored) matches = false;
    rowCounts[table] = pair;
  }
  return { rowCounts, matches };
}

export function rowCountSql(): string {
  return KEY_TABLES.map((table) => `SELECT '${table}' AS t, count(*)::bigint AS n FROM "${table}"`).join(" UNION ALL ");
}

export function parseRowCounts(output: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of output.split(/\r?\n/)) {
    const [table, n] = line.trim().split("|");
    if (table && n !== undefined && /^\d+$/.test(n)) counts[table] = Number(n);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Side-effecting part: docker and child processes.
// ---------------------------------------------------------------------------

type RunResult = { code: number; stdout: string; stderr: string };

/** Runs a command with an argument array and no shell. Never logs its env. */
function run(
  command: string,
  args: readonly string[],
  extraEnv: Record<string, string> = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      env: { ...process.env, ...extraEnv, MSYS_NO_PATHCONV: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** Keeps only the first line of a child's stderr and masks anything URL-shaped. */
function safeDetail(text: string, secrets: readonly string[]): string {
  let line = text.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? "";
  for (const secret of secrets) if (secret) line = line.split(secret).join("***");
  return line.replace(/postgres(ql)?:\/\/\S+/gi, "postgresql://***").slice(0, 300);
}

async function mustRun(
  label: string,
  command: string,
  args: readonly string[],
  extraEnv: Record<string, string>,
  secrets: readonly string[],
): Promise<RunResult> {
  const result = await run(command, args, extraEnv);
  if (result.code !== 0) {
    throw new Error(`${label} failed (exit ${result.code}): ${safeDetail(result.stderr || result.stdout, secrets)}`);
  }
  return result;
}

/** Docker args that hand libpq the source connection through inherited env. */
function sourceEnv(source: ConnectionParts, dockerHost: string): Record<string, string> {
  const env: Record<string, string> = {
    PGHOST: dockerHost,
    PGPORT: String(source.port),
    PGDATABASE: source.database,
    PGUSER: source.user,
    PGPASSWORD: source.password,
  };
  if (source.params.sslmode) env.PGSSLMODE = source.params.sslmode;
  return env;
}

function inheritFlags(env: Record<string, string>): string[] {
  return Object.keys(env).flatMap((name) => ["-e", name]);
}

const ADD_HOST = ["--add-host", "host.docker.internal:host-gateway"];

async function sourcePsql(
  image: string,
  env: Record<string, string>,
  sql: string,
  secrets: readonly string[],
): Promise<string> {
  const result = await mustRun(
    "Reading the source database",
    "docker",
    ["run", "--rm", ...ADD_HOST, ...inheritFlags(env), image, "psql", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
    env,
    secrets,
  );
  return result.stdout;
}

async function targetPsql(container: string, sql: string, secrets: readonly string[]): Promise<string> {
  const result = await mustRun(
    "Reading the restored database",
    "docker",
    ["exec", container, "psql", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-U", RESTORE_DATABASE_USER, "-d", RESTORE_DATABASE_NAME, "-c", sql],
    {},
    secrets,
  );
  return result.stdout;
}

async function waitForTarget(container: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // TCP (-h 127.0.0.1) only answers once initdb has finished and the real
    // server is up; the init-time server listens on the socket only.
    const ready = await run("docker", [
      "exec",
      container,
      "pg_isready",
      "-h",
      "127.0.0.1",
      "-U",
      RESTORE_DATABASE_USER,
      "-d",
      RESTORE_DATABASE_NAME,
    ]);
    if (ready.code === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("The restore container did not become ready in time.");
}

type IntegrityCheck = { id: string; label: string; status: string; violationCount: number };

async function runIntegrityChecks(targetUrl: string, secrets: readonly string[]): Promise<IntegrityCheck[]> {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const outFile = path.join(os.tmpdir(), `restore-rehearsal-integrity-${process.pid}-${Date.now()}.json`);
  try {
    await mustRun(
      "Integrity checks on the restored database",
      process.execPath,
      [tsxCli, path.join(repoRoot, "scripts", "ops", "integrity-checks.ts"), "--target", "local", "--out", outFile],
      { DATABASE_URL: targetUrl },
      secrets,
    );
    const report = JSON.parse(readFileSync(outFile, "utf8")) as { checks: IntegrityCheck[] };
    return report.checks.map(({ id, label, status, violationCount }) => ({ id, label, status, violationCount }));
  } finally {
    rmSync(outFile, { force: true });
  }
}

function stamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[restore-rehearsal] ${message}`);
}

async function main(): Promise<number> {
  let options: RehearsalOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    return 2;
  }

  const targetPassword = randomBytes(18).toString("hex");
  const targetUrl = buildTargetUrl(options.targetPort, targetPassword);

  // Guard BOTH ends before any docker command (P1).
  let sourceHost: string;
  try {
    ({ host: sourceHost } = assertSafeDatabaseUrl(options.source, { target: options.target }));
    assertSafeDatabaseUrl(targetUrl, { target: "local" });
    assertTargetDiffersFromSource(options.source as string, targetUrl);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Refusing to run: the database target check failed.");
    return 1;
  }

  const source = connectionParts(options.source as string);
  const secrets = [source.password, targetPassword, options.source as string, targetUrl];
  // A container reaches a database on the developer's machine through
  // host.docker.internal; a staging host is reached by its own name.
  const dockerHost = isLocalHost(source.host) ? "host.docker.internal" : source.host;
  const srcEnv = sourceEnv(source, dockerHost);

  const runId = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  const container = `restore-rehearsal-${runId}`;
  const dumpsDir = path.resolve(__dirname, "..", "..", "dumps");
  const dumpName = `${container}.dump`;
  const dumpPath = path.join(dumpsDir, dumpName);
  mkdirSync(dumpsDir, { recursive: true });

  const startedAt = stamp();
  let containerStarted = false;
  try {
    log(`source host ${sourceHost}; reading server version`);
    const versionNum = (await sourcePsql("postgres:16-alpine", srcEnv, "SHOW server_version_num", secrets)).trim();
    const serverMajor = serverMajorFromVersionNum(versionNum);
    const image = imageForServerMajor(serverMajor);
    log(`server major ${serverMajor}; using ${image}`);

    log(`starting fresh container ${container} on 127.0.0.1:${options.targetPort}`);
    await mustRun(
      "Starting the restore container",
      "docker",
      [
        "run",
        "-d",
        "--name",
        container,
        "-e",
        "POSTGRES_PASSWORD",
        "-e",
        `POSTGRES_DB=${RESTORE_DATABASE_NAME}`,
        "-e",
        `POSTGRES_USER=${RESTORE_DATABASE_USER}`,
        "-p",
        `127.0.0.1:${options.targetPort}:5432`,
        "--mount",
        `type=bind,source=${dumpsDir},target=/dumps,readonly`,
        image,
      ],
      { POSTGRES_PASSWORD: targetPassword },
      secrets,
    );
    containerStarted = true;

    const dumpStartedAt = stamp();
    log("dumping the source with pg_dump -Fc");
    await mustRun(
      "pg_dump",
      "docker",
      [
        "run",
        "--rm",
        ...ADD_HOST,
        ...inheritFlags(srcEnv),
        "--mount",
        `type=bind,source=${dumpsDir},target=/dumps`,
        image,
        "pg_dump",
        "-Fc",
        "-f",
        `/dumps/${dumpName}`,
      ],
      srcEnv,
      secrets,
    );
    const dumpFinishedAt = stamp();
    const dumpBytes = statSync(dumpPath).size;
    log(`dump finished (${dumpBytes} bytes)`);

    await waitForTarget(container);
    log("restoring into the fresh container with pg_restore");
    await mustRun(
      "pg_restore",
      "docker",
      [
        "exec",
        container,
        "pg_restore",
        "--no-owner",
        "--no-privileges",
        "--exit-on-error",
        "-U",
        RESTORE_DATABASE_USER,
        "-d",
        RESTORE_DATABASE_NAME,
        `/dumps/${dumpName}`,
      ],
      {},
      secrets,
    );
    const restoreFinishedAt = stamp();
    log("restore finished; comparing row counts");

    const sql = rowCountSql();
    const sourceCounts = parseRowCounts(await sourcePsql(image, srcEnv, sql, secrets));
    const restoredCounts = parseRowCounts(await targetPsql(container, sql, secrets));
    const { rowCounts, matches } = compareRowCounts(sourceCounts, restoredCounts);

    log("running the integrity checks against the restored database");
    const integrity = await runIntegrityChecks(targetUrl, secrets);
    const integrityFinishedAt = stamp();
    const integrityPassed = integrity.length > 0 && integrity.every((check) => check.status === "passed");

    const durations = computeDurations({
      startedAt,
      dumpStartedAt,
      dumpFinishedAt,
      restoreFinishedAt,
      integrityFinishedAt,
    });
    const passed = matches && integrityPassed;

    const evidence = {
      route: "docker",
      sourceHost,
      sourceTarget: options.target,
      serverMajor,
      image,
      restoreContainerPort: options.targetPort,
      startedAt,
      dumpStartedAt,
      dumpFinishedAt,
      restoreFinishedAt,
      integrityFinishedAt,
      dumpBytes,
      dumpSeconds: durations.dumpSeconds,
      restoreSeconds: durations.restoreSeconds,
      integritySeconds: durations.integritySeconds,
      rtoSeconds: durations.rtoSeconds,
      rtoTargetSeconds: RTO_TARGET_SECONDS,
      withinRtoTarget: durations.withinRtoTarget,
      rpoTargetSeconds: RPO_TARGET_SECONDS,
      latestRestorablePoint: dumpStartedAt,
      rowCountsMatch: matches,
      rowCounts,
      integrityPassed,
      integrity,
      passed,
      notes: [
        "startedAt stands in for the incident start; RTO = integrityFinishedAt - startedAt.",
        "RPO for this route = incident time - latestRestorablePoint (the dump start); the schedule of real dumps sets it.",
        "Neon point-in-time branch restore (route A) and object storage backup are proven separately (plan 15-30 and the launch checklist).",
      ],
    };

    const json = JSON.stringify(evidence, null, 2);
    console.log(json);
    if (options.out) {
      const outPath = path.resolve(options.out);
      mkdirSync(path.dirname(outPath), { recursive: true });
      writeFileSync(outPath, `${json}\n`, "utf8");
      log(`evidence written to ${path.relative(process.cwd(), outPath)}`);
    }
    if (!matches) console.error("Row counts differ between the source and the restored database.");
    if (!integrityPassed) console.error("At least one integrity check did not pass on the restored database.");
    return passed ? 0 : 1;
  } finally {
    if (containerStarted) {
      const removed = await run("docker", ["rm", "-f", "-v", container]);
      log(removed.code === 0 ? `removed container ${container}` : `could not remove container ${container}; run docker rm -f ${container}`);
    }
    if (!options.keepDump) rmSync(dumpPath, { force: true });
  }
}

if (/restore-rehearsal\.ts$/.test(process.argv[1] ?? "")) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`Restore rehearsal failed: ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}`);
      process.exit(1);
    },
  );
}
