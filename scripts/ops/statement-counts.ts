/**
 * Statement counts per page render (Phase 15, plan 15-28; D-01, NFR-02).
 *
 *   npx tsx scripts/ops/statement-counts.ts --base http://localhost:3010 \
 *       --check staff:/staff:25 \
 *       --check learner:/learn/{enrolmentId}/lessons/{lessonId}:20 \
 *       [--tokens perf/results/tokens.json] [--out file.json]
 *
 * For every --check (persona:path:budget) the script resets pg_stat_statements,
 * fetches the page once with the lms.session cookie of a seeded load account, and
 * counts the SQL statements the database ran for that one render. It needs a
 * database whose server has pg_stat_statements preloaded (the rehearsal container
 * from plan 15-28) and a local production server started against the same database.
 *
 * Method (fixed in code): one warm-up fetch first, so one-time caches do not count;
 * then reset, fetch, read. The "cold" figure is the first fetch after the reset
 * that follows a server start and is reported next to the gated warm figure.
 * "statements" is the sum of `calls` for every statement except the extension's own
 * queries; transaction control (BEGIN, COMMIT, ROLLBACK, SET) is counted too and
 * also reported separately, so the budget is not met by hiding it.
 *
 * Safety (P1, T-15-28-01): assertSafeDatabaseUrl runs FIRST, before Prisma is
 * imported, so a shell carrying the shared Neon URL never opens a connection.
 * Query text in the output is cut to 120 characters and holds statement shapes
 * only (bind values are parameters, not text). Session tokens are read from the
 * gitignored tokens file, sent as a cookie, and never printed or written.
 *
 * Exit codes: 0 all within budget; 1 a budget exceeded, a refusal or a failure;
 * 2 bad arguments.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertSafeDatabaseUrl } from "./db-target-guard";

export type Persona = "learner" | "staff";

export type CheckSpec = { persona: Persona; path: string; budget: number };

export type CliOptions = {
  base: string;
  tokens: string;
  out: string | null;
  checks: CheckSpec[];
};

export type TopQuery = { calls: number; query: string };

export type StatementCountResult = {
  url: string;
  persona: Persona;
  budget: number;
  statements: number;
  coldStatements: number | null;
  transactionControl: number;
  withinBudget: boolean;
  topQueries: TopQuery[];
};

export const USAGE =
  "Usage: npx tsx scripts/ops/statement-counts.ts --base <url> --check <staff|learner>:<path>:<budget> [--check ...] [--tokens file] [--out file.json]";

const QUERY_TEXT_LIMIT = 120;
const TOP_QUERY_COUNT = 10;

/** Parses `persona:path:budget`. The path may hold colons; the budget is after the last one. */
export function parseCheck(value: string): CheckSpec {
  const first = value.indexOf(":");
  const last = value.lastIndexOf(":");
  if (first <= 0 || last <= first) {
    throw new Error(`--check needs persona:path:budget, got ${JSON.stringify(value)}.`);
  }
  const persona = value.slice(0, first);
  if (persona !== "learner" && persona !== "staff") {
    throw new Error(`--check persona must be "learner" or "staff", got ${JSON.stringify(persona)}.`);
  }
  const pathPart = value.slice(first + 1, last);
  if (!pathPart.startsWith("/")) throw new Error(`--check path must start with "/", got ${JSON.stringify(pathPart)}.`);
  const budget = Number(value.slice(last + 1));
  if (!Number.isInteger(budget) || budget < 1) {
    throw new Error(`--check budget must be a whole number of at least 1, got ${JSON.stringify(value.slice(last + 1))}.`);
  }
  return { persona, path: pathPart, budget };
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { base: "", tokens: path.join("perf", "results", "tokens.json"), out: null, checks: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const [flag, inline] = eq === -1 ? [arg, undefined] : [arg.slice(0, eq), arg.slice(eq + 1)];
    const value = () => {
      const next = inline ?? argv[++i];
      if (next === undefined || next.startsWith("--")) throw new Error(`${flag} needs a value.`);
      return next;
    };
    switch (flag) {
      case "--base":
        options.base = value().replace(/\/+$/, "");
        break;
      case "--tokens":
        options.tokens = value();
        break;
      case "--out":
        options.out = value();
        break;
      case "--check":
        options.checks.push(parseCheck(value()));
        break;
      default:
        throw new Error(`Unknown argument ${JSON.stringify(arg)}.`);
    }
  }
  if (options.base === "") throw new Error("--base is required (the local server to fetch from).");
  if (options.checks.length === 0) throw new Error("At least one --check is required.");
  return options;
}

/** True when the count is within the budget (a budget is a maximum, so equal passes). */
export function withinBudget(statements: number, budget: number): boolean {
  return statements <= budget;
}

/** Cuts statement text to a fixed length and collapses whitespace so it prints on one line. */
export function truncateQuery(query: string, limit: number = QUERY_TEXT_LIMIT): string {
  const flat = query.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 3)}...`;
}

const TRANSACTION_CONTROL = /^\s*(begin|commit|rollback|start transaction|set |savepoint|release savepoint)/i;

/** Statements that only manage a transaction or a session setting. */
export function isTransactionControl(query: string): boolean {
  return TRANSACTION_CONTROL.test(query);
}

export type StatRow = { calls: number; query: string };

/** Sums calls, reports the transaction-control share, and the 10 most called statements. */
export function summariseRows(rows: readonly StatRow[]): {
  statements: number;
  transactionControl: number;
  topQueries: TopQuery[];
} {
  const statements = rows.reduce((total, row) => total + row.calls, 0);
  const transactionControl = rows.filter((row) => isTransactionControl(row.query)).reduce((total, row) => total + row.calls, 0);
  const topQueries = [...rows]
    .sort((a, b) => b.calls - a.calls)
    .slice(0, TOP_QUERY_COUNT)
    .map((row) => ({ calls: row.calls, query: truncateQuery(row.query) }));
  return { statements, transactionControl, topQueries };
}

/** Fills {enrolmentId} and {lessonId} from the first seeded learner context. */
export function resolvePath(template: string, tokens: { learnerContext?: { enrolmentId: string; lessonIds: string[] }[] }): string {
  const context = tokens.learnerContext?.[0];
  return template.replace(/\{(enrolmentId|lessonId)\}/g, (_match, name: string) => {
    const resolved = name === "enrolmentId" ? context?.enrolmentId : context?.lessonIds?.[0];
    if (!resolved) throw new Error(`The tokens file has no ${name}. Run scripts/load/seed-load.ts first.`);
    return resolved;
  });
}

type TokensFile = {
  learners: string[];
  staff: string[];
  learnerContext?: { enrolmentId: string; lessonIds: string[] }[];
};

/** First non-empty line of an error message (Prisma messages start with a blank line). */
function firstLine(message: string): string {
  return message.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "failed";
}

async function fetchPage(base: string, pagePath: string, token: string): Promise<number> {
  const response = await fetch(`${base}${pagePath}`, {
    redirect: "manual",
    headers: { cookie: `lms.session=${token}` },
  });
  // Drain the stream: a streamed page keeps running queries until the body is read.
  const body = await response.text();
  if (response.status !== 200) throw new Error(`${pagePath} answered HTTP ${response.status} (expected 200).`);
  if (body.includes("data-dgst")) throw new Error(`${pagePath} rendered an error (digest marker in the document).`);
  return response.status;
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
    host = assertSafeDatabaseUrl(process.env.DATABASE_URL).host;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Refusing to run: the database target check failed.");
    return 1;
  }

  // Only now is it safe to construct a database client.
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const tokens = JSON.parse(readFileSync(path.resolve(options.tokens), "utf8")) as TokensFile;

  const readRows = async (): Promise<StatRow[]> => {
    const rows = await db.$queryRawUnsafe<{ calls: bigint; query: string }[]>(
      `SELECT calls, query FROM pg_stat_statements
        WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND query NOT ILIKE '%pg_stat_statements%'`,
    );
    return rows.map((row) => ({ calls: Number(row.calls), query: row.query }));
  };

  const results: StatementCountResult[] = [];
  try {
    for (const check of options.checks) {
      const pagePath = resolvePath(check.path, tokens);
      const token = (check.persona === "staff" ? tokens.staff : tokens.learners)[0];
      if (!token) throw new Error(`The tokens file has no ${check.persona} session.`);

      // Cold: the first render after a reset on a server that may not have served this URL yet.
      await db.$queryRawUnsafe("SELECT count(*)::int AS n FROM (SELECT pg_stat_statements_reset()) AS reset");
      await fetchPage(options.base, pagePath, token);
      const cold = summariseRows(await readRows()).statements;

      // Warm: one more render after a fresh reset. This is the gated figure.
      await fetchPage(options.base, pagePath, token); // settle any lazy work from the cold render
      await db.$queryRawUnsafe("SELECT count(*)::int AS n FROM (SELECT pg_stat_statements_reset()) AS reset");
      await fetchPage(options.base, pagePath, token);
      const summary = summariseRows(await readRows());

      results.push({
        url: pagePath,
        persona: check.persona,
        budget: check.budget,
        statements: summary.statements,
        coldStatements: cold,
        transactionControl: summary.transactionControl,
        withinBudget: withinBudget(summary.statements, check.budget),
        topQueries: summary.topQueries,
      });
    }
  } catch (error) {
    console.error(error instanceof Error ? firstLine(error.message) : "statement-counts failed.");
    return 1;
  } finally {
    await db.$disconnect();
  }

  for (const result of results) {
    console.log(
      `${result.url}: ${result.statements} statements (budget ${result.budget}, cold ${result.coldStatements}, transaction control ${result.transactionControl}) ${result.withinBudget ? "ok" : "OVER BUDGET"}`,
    );
  }
  if (options.out) {
    const outPath = path.resolve(options.out);
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
    console.log(`measured on ${host}; wrote ${options.out}`);
  }
  return results.every((result) => result.withinBudget) ? 0 : 1;
}

const invokedDirectly = /statement-counts\.[cm]?[jt]s$/.test(process.argv[1] ?? "");
if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? firstLine(error.message) : "statement-counts failed.");
      process.exit(1);
    },
  );
}
