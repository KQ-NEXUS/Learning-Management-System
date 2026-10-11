/**
 * `npx tsx scripts/ops/integrity-checks.ts [--target local|staging] [--out file.json] [--fail-on-violation]`
 *
 * Runs the read-only data integrity checks (NFR-14) against the database named
 * by the shell's DATABASE_URL and prints the results as JSON.
 *
 *   --target             "local" (default) or "staging". Staging also needs
 *                        STAGING_DATABASE_HOSTS to list the host and
 *                        ALLOW_STAGING_DATABASE=1 (see db-target-guard.ts).
 *   --out <file>         Also write the JSON to this file (folders are created).
 *   --fail-on-violation  Exit 1 when any check reports violations or an error.
 *
 * Exit codes: 0 ran (and, with --fail-on-violation, everything passed);
 * 1 refused by the guard, a check did not pass under --fail-on-violation, or
 * the run failed; 2 bad arguments.
 *
 * Order matters (P1): the database-target guard runs BEFORE the integrity
 * service is imported, because importing it constructs the Prisma client. The
 * service import is therefore dynamic and comes after the guard call.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertSafeDatabaseUrl, type DatabaseTarget } from "./db-target-guard";

type CliOptions = { target: DatabaseTarget; out: string | null; failOnViolation: boolean };

const USAGE =
  "Usage: npx tsx scripts/ops/integrity-checks.ts [--target local|staging] [--out file.json] [--fail-on-violation]";

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { target: "local", out: null, failOnViolation: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    const value = () => {
      const next = inline ?? argv[++i];
      if (next === undefined || next.startsWith("--")) throw new Error(`${flag} needs a value.`);
      return next;
    };
    switch (flag) {
      case "--target": {
        const target = value();
        if (target !== "local" && target !== "staging") throw new Error(`--target must be "local" or "staging".`);
        options.target = target;
        break;
      }
      case "--out":
        options.out = value();
        break;
      case "--fail-on-violation":
        options.failOnViolation = true;
        break;
      default:
        throw new Error(`Unknown argument ${JSON.stringify(arg)}.`);
    }
  }
  return options;
}

async function main(): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    return 2;
  }

  let host: string;
  try {
    ({ host } = assertSafeDatabaseUrl(process.env.DATABASE_URL, { target: options.target }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Refusing to run: the database target check failed.");
    return 1;
  }

  // Only now is it safe to construct a database client.
  const { integrityCheckService } = await import("../../src/server/services/integrity-check-service");
  const { prisma } = await import("../../src/server/db");

  try {
    const checks = await integrityCheckService.runIntegrityChecks();
    const passed = checks.every((check) => check.status === "passed");
    const report = {
      ranAt: new Date().toISOString(),
      target: options.target,
      databaseHost: host,
      passed,
      checks,
    };
    const json = JSON.stringify(report, null, 2);
    console.log(json);
    if (options.out) {
      const outPath = path.resolve(options.out);
      mkdirSync(path.dirname(outPath), { recursive: true });
      writeFileSync(outPath, `${json}\n`, "utf8");
    }
    return options.failOnViolation && !passed ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`Integrity checks failed to run: ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}`);
    process.exit(1);
  },
);
