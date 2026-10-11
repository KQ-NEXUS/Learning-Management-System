/**
 * `npx tsx scripts/ops/staging-checks.ts <command> --target staging ...`
 *
 * Two read-only probes for the staging run (Phase 15, plan 15-30; ledger A15,
 * P-10):
 *
 *   tokens --email ADDRESS --target staging
 *       Prints the number of email-verification tokens stored for that address.
 *       Used before and after a sign-in to an unverified account, to prove that
 *       `next/server` `after()` runs on Netlify (the quiet resend).
 *
 *   connections --every 15 --for SECONDS --out PATH --target staging
 *       Samples the database's connection count every N seconds for the given
 *       time and writes the samples, with their peak, to a JSON file.
 *
 * Both commands only read. `--target staging` is required: these probes exist
 * for the staging branch and refuse to run without it. The database guard runs
 * FIRST, before Prisma is imported, so a shell that carries the shared database
 * URL stops with no connection made (see db-target-guard.ts).
 *
 * Nothing here prints a connection string, a host, a token value or a password.
 * The address given to `tokens` is not echoed either.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertSafeDatabaseUrl } from "./db-target-guard";

export const USAGE = [
  "Usage:",
  "  npx tsx scripts/ops/staging-checks.ts tokens --email ADDRESS --target staging",
  "  npx tsx scripts/ops/staging-checks.ts connections --every 15 --for SECONDS --out PATH --target staging",
].join("\n");

/** The purpose value of an email-verification token (`TOKEN_PURPOSE.EMAIL_VERIFICATION` in src/lib/identity). */
export const EMAIL_VERIFICATION_PURPOSE = "EMAIL_VERIFICATION";

export type TokensArgs = { command: "tokens"; email: string; target: "staging" };
export type ConnectionsArgs = {
  command: "connections";
  everySeconds: number;
  forSeconds: number;
  out: string;
  target: "staging";
};
export type ParsedArgs = TokensArgs | ConnectionsArgs;

function wholeNumber(flag: string, value: string | undefined, min: number, max: number): number {
  const parsed = Number(value);
  if (value === undefined || !/^\d+$/.test(value) || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${flag} must be a whole number from ${min} to ${max}.`);
  }
  return parsed;
}

/** Parses the command line. Throws a plain Error; a value typed by the operator is never echoed. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (command !== "tokens" && command !== "connections") {
    throw new Error('Give a command: "tokens" or "connections".');
  }

  const values = new Map<string, string>();
  const allowed = command === "tokens" ? ["--email", "--target"] : ["--every", "--for", "--out", "--target"];
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (!allowed.includes(flag)) {
      throw new Error(`Unknown argument ${flag.startsWith("--") ? flag : "(value not shown)"} for "${command}".`);
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value.`);
    if (values.has(flag)) throw new Error(`${flag} was given twice.`);
    values.set(flag, value);
    i += 1;
  }

  // These probes exist for the staging run only: no default target, and "local" is refused.
  if (values.get("--target") !== "staging") {
    throw new Error("Refusing to run: staging-checks needs --target staging.");
  }

  if (command === "tokens") {
    const email = (values.get("--email") ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("--email must be an email address.");
    return { command, email, target: "staging" };
  }

  const everySeconds = wholeNumber("--every", values.get("--every") ?? "15", 1, 300);
  const forSeconds = wholeNumber("--for", values.get("--for"), 1, 3600);
  const out = values.get("--out");
  if (!out) throw new Error("--out needs a path for the samples file.");
  return { command, everySeconds, forSeconds, out, target: "staging" };
}

export type ConnectionSample = {
  at: string;
  /** Every row of pg_stat_activity, the server's own background workers included. */
  total: number;
  /** Rows with backend_type "client backend": the connections applications hold. */
  client: number;
  /** Client backends that are running a statement or holding a transaction open. */
  active: number;
};

export type ConnectionSummary = {
  samples: number;
  peakTotal: number;
  peakClient: number;
  peakActive: number;
};

export function summariseConnections(samples: readonly ConnectionSample[]): ConnectionSummary {
  return {
    samples: samples.length,
    peakTotal: samples.reduce((peak, sample) => Math.max(peak, sample.total), 0),
    peakClient: samples.reduce((peak, sample) => Math.max(peak, sample.client), 0),
    peakActive: samples.reduce((peak, sample) => Math.max(peak, sample.active), 0),
  };
}

export type CliDeps = {
  env?: Record<string, string | undefined>;
  /** Counts verification tokens for an address. Loaded lazily, after the guard. */
  countTokens?: (email: string) => Promise<number>;
  /** Takes one connection sample. Loaded lazily, after the guard. */
  sampleConnections?: () => Promise<ConnectionSample>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  write?: (file: string, content: string) => void;
  log?: (line: string) => void;
  /** Called once when the run ends, to close whatever the default probes opened. */
  close?: () => Promise<void>;
};

type Db = {
  verificationToken: { count(args: { where: { identifier: string; purpose: string } }): Promise<number> };
  $queryRawUnsafe<T>(query: string): Promise<T>;
  $disconnect(): Promise<void>;
};

/**
 * Parses, applies the database guard, and only then touches a database.
 * Throws on bad arguments or a refused target; returns what it measured.
 */
export async function runStagingChecks(
  argv: readonly string[],
  deps: CliDeps = {},
): Promise<{ count: number } | (ConnectionSummary & { out: string })> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((line: string) => console.log(line));
  const args = parseArgs(argv);

  // Guard first: nothing below this line runs against a host that is not allow-listed staging.
  assertSafeDatabaseUrl(env.DATABASE_URL, { target: args.target, env });

  let db: Db | undefined;
  const client = async (): Promise<Db> => {
    if (!db) {
      const { PrismaClient } = await import("@prisma/client");
      db = new PrismaClient({ log: ["error"] }) as unknown as Db;
    }
    return db;
  };

  try {
    if (args.command === "tokens") {
      const countTokens =
        deps.countTokens ??
        (async (email: string) =>
          (await client()).verificationToken.count({ where: { identifier: email, purpose: EMAIL_VERIFICATION_PURPOSE } }));
      const count = await countTokens(args.email);
      // The count only: the address is the operator's input and is not repeated.
      log(`staging-checks tokens: ${count}`);
      return { count };
    }

    const sample =
      deps.sampleConnections ??
      (async (): Promise<ConnectionSample> => {
        const rows = await (await client()).$queryRawUnsafe<{ total: number; client: number; active: number }[]>(
          `SELECT count(*)::int AS total,
                  (count(*) FILTER (WHERE backend_type = 'client backend'))::int AS client,
                  (count(*) FILTER (WHERE backend_type = 'client backend' AND state IS DISTINCT FROM 'idle'))::int AS active
           FROM pg_stat_activity`,
        );
        return { at: new Date().toISOString(), total: rows[0].total, client: rows[0].client, active: rows[0].active };
      });
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const now = deps.now ?? (() => Date.now());
    const write =
      deps.write ??
      ((file: string, content: string) => {
        mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
        writeFileSync(file, content, "utf8");
      });

    const samples: ConnectionSample[] = [];
    const startedAt = now();
    const deadline = startedAt + args.forSeconds * 1000;
    const persist = () => {
      const file = {
        startedAt: new Date(startedAt).toISOString(),
        everySeconds: args.everySeconds,
        forSeconds: args.forSeconds,
        query:
          "count(*) of pg_stat_activity (total), of client backends (client) and of client backends not idle (active); the sampler's own connection is included in each",
        ...summariseConnections(samples),
        list: samples,
      };
      write(args.out, `${JSON.stringify(file, null, 2)}\n`);
    };

    for (;;) {
      samples.push(await sample());
      // Written after every sample, so a run that is cut short still leaves its numbers.
      persist();
      const next = startedAt + samples.length * args.everySeconds * 1000;
      if (next > deadline) break;
      await sleep(Math.max(0, next - now()));
    }

    const summary = summariseConnections(samples);
    log(
      `staging-checks connections: ${summary.samples} samples, peak total ${summary.peakTotal}, ` +
        `peak client ${summary.peakClient}, peak active ${summary.peakActive}`,
    );
    return { ...summary, out: args.out };
  } finally {
    if (db) await db.$disconnect();
    if (deps.close) await deps.close();
  }
}

if (/staging-checks\.[cm]?[jt]s$/.test((process.argv[1] ?? "").replace(/\\/g, "/"))) {
  runStagingChecks(process.argv.slice(2)).then(
    // One timer later, so sockets finish closing before the exit (see run-task.ts exitLater).
    () => setTimeout(() => process.exit(0), 150),
    (error: unknown) => {
      const line = error instanceof Error ? error.message.split("\n")[0] : "unknown error";
      console.error(line.replace(/postgres(ql)?:\/\/\S+/gi, "postgresql://***").slice(0, 300));
      if (/^(Give a command|Unknown argument|--\w+ )/.test(line)) console.error(USAGE);
      setTimeout(() => process.exit(1), 150);
    },
  );
}
