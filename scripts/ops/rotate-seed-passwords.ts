/**
 * `npx tsx scripts/ops/rotate-seed-passwords.ts [--target local|staging] [--check]`
 *
 * Removes the development seed password from a database (Phase 15, plan 15-29;
 * RESEARCH Pitfall 10, threat T-15-29-02). `prisma/seed.ts` gives every seeded
 * staff and learner account one well-known password that is written in this
 * public repository. That is fine on a laptop and must never exist on a
 * database a public deploy preview reads.
 *
 * What it does: it reads the development password from `prisma/seed.ts`, finds
 * every account whose stored hash matches it, and gives each one its own fresh
 * random password (scrypt hash, the app's normal format). The new passwords are
 * thrown away: nobody knows them, so those accounts can only be used again
 * through the password reset flow or a staff-set temporary password. Sessions
 * of the rotated accounts are removed. It then checks again and fails if any
 * account still matches.
 *
 * Accounts are found by testing the hash, not by a list of email addresses, so
 * an account added to the seed later is still caught.
 *
 *   --target   "local" (default) or "staging". Staging also needs the host in
 *              STAGING_DATABASE_HOSTS and ALLOW_STAGING_DATABASE=1.
 *   --check    Change nothing; only count the accounts that still match.
 *
 * Output is counts only: no email address, password, hash or connection string.
 *
 * Exit codes: 0 no account has the development password (after rotating, or
 * under --check); 1 refused by the guard, the run failed, or accounts still
 * match; 2 bad arguments.
 *
 * Order matters (P1): the database-target guard runs BEFORE Prisma is imported.
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { assertSafeDatabaseUrl, type DatabaseTarget } from "./db-target-guard";

type CliOptions = { target: DatabaseTarget; check: boolean };

const USAGE = "Usage: npx tsx scripts/ops/rotate-seed-passwords.ts [--target local|staging] [--check]";

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { target: "local", check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    switch (flag) {
      case "--target": {
        const target = eq === -1 ? argv[++i] : arg.slice(eq + 1);
        if (target !== "local" && target !== "staging") throw new Error('--target must be "local" or "staging".');
        options.target = target;
        break;
      }
      case "--check":
        options.check = true;
        break;
      default:
        throw new Error(`Unknown argument ${JSON.stringify(arg.startsWith("--") ? flag : "(value not shown)")}.`);
    }
  }
  return options;
}

/** Reads the development password from the seed, so the two can never drift apart. */
export function readSeedPassword(seedSource: string): string {
  const match = /const DEV_PASSWORD = "([^"\\]+)";/.exec(seedSource);
  if (!match) throw new Error("Could not find DEV_PASSWORD in prisma/seed.ts; update rotate-seed-passwords.ts.");
  return match[1];
}

/**
 * Ids of the accounts whose hash matches `password`. Accounts that share one
 * hash string (the seed hashes once for everyone) are verified once, because
 * scrypt is slow on purpose.
 */
export async function accountsWithPassword(
  users: readonly { id: string; passwordHash: string | null }[],
  password: string,
  verify: (password: string, hash: string) => Promise<boolean>,
): Promise<string[]> {
  const verdicts = new Map<string, boolean>();
  const ids: string[] = [];
  for (const user of users) {
    if (!user.passwordHash) continue;
    let matches = verdicts.get(user.passwordHash);
    if (matches === undefined) {
      matches = await verify(password, user.passwordHash);
      verdicts.set(user.passwordHash, matches);
    }
    if (matches) ids.push(user.id);
  }
  return ids;
}

async function main(): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Bad arguments.");
    console.error(USAGE);
    return 2;
  }

  try {
    assertSafeDatabaseUrl(process.env.DATABASE_URL, { target: options.target });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Refusing to run: the database target check failed.");
    return 1;
  }

  const seedPassword = readSeedPassword(
    readFileSync(path.resolve(__dirname, "..", "..", "prisma", "seed.ts"), "utf8"),
  );

  // Only now is it safe to construct a database client.
  const { PrismaClient } = await import("@prisma/client");
  const { hashPassword, verifyPassword } = await import("../../src/server/auth/password");
  const db = new PrismaClient();
  const matching = async () =>
    accountsWithPassword(
      await db.user.findMany({ where: { passwordHash: { not: null } }, select: { id: true, passwordHash: true } }),
      seedPassword,
      verifyPassword,
    );

  try {
    const found = await matching();
    if (options.check) {
      console.log(`rotate-seed-passwords (${options.target}, check only): ${found.length} account(s) have the development password.`);
      return found.length === 0 ? 0 : 1;
    }

    for (const id of found) {
      // A separate random password and salt per account; the password is never kept.
      const passwordHash = await hashPassword(randomBytes(32).toString("base64url"));
      await db.$transaction([
        db.user.update({ where: { id }, data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null } }),
        db.session.deleteMany({ where: { userId: id } }),
      ]);
    }

    const remaining = (await matching()).length;
    console.log(
      `rotate-seed-passwords (${options.target}): ${found.length} account(s) rotated, ${remaining} still have the development password.`,
    );
    return remaining === 0 ? 0 : 1;
  } finally {
    await db.$disconnect();
  }
}

if (/rotate-seed-passwords\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      const line = error instanceof Error ? error.message.split("\n")[0] : "unknown error";
      console.error(`rotate-seed-passwords failed: ${line.replace(/postgres(ql)?:\/\/\S+/gi, "postgresql://***").slice(0, 200)}`);
      process.exit(1);
    },
  );
}
