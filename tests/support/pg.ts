/**
 * Testcontainers Postgres harness (D-32).
 *
 * The two-pass reorder transaction and the `updatedAt` optimistic check are
 * this phase's highest-risk mechanisms, and neither is provable against a
 * mock: the deferred-constraint trap passes small mocked tests and only
 * fails against a real unique index. `startTestDatabase()` spins up a real,
 * throwaway Postgres, applies the checked-in migrations exactly as
 * production would, and hands back a live `PrismaClient` pointed at it.
 *
 * PREREQUISITE: Docker must be running. If it is not, a test using this
 * harness fails with a container-start error, not a test assertion — that
 * failure mode is expected and is not a bug in the code under test.
 *
 * ESLint boundary note: `src/**\/*.{ts,tsx}` is the only path the
 * `no-restricted-imports` rule confines `@prisma/client` to (plus
 * `src/server/db.ts`). This file lives under `tests/`, so that glob does not
 * match it and importing `@prisma/client` directly here is intentional, not
 * an oversight — do not "fix" it by routing this through a service.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";

/**
 * Container start, `prisma migrate deploy`, and a first-run image pull can
 * together exceed Vitest's default 5s hook timeout — and when they do, the
 * resulting failure reads like a bug in the code under test, not a timeout.
 * Every integration test file using this harness must pass this constant as
 * the timeout argument to its `beforeAll`/`afterAll`.
 */
export const TEST_DB_TIMEOUT_MS = 180_000;

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "prisma", "migrations");
const SQL_DIR = path.join(REPO_ROOT, "prisma", "sql");

/** Concatenates every generated migration.sql so a "did we already apply
 * this?" check can look for a marker across the whole migration history. */
function migrationsText(): string {
  let entries: string[];
  try {
    entries = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return "";
  }
  return entries
    .map((name) => {
      try {
        return readFileSync(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
}

/**
 * Applies each `prisma/sql/NNN_*.sql` companion file that is not already
 * pasted into a checked-in migration — the manual-paste-in convention
 * documented in those files' own headers. As of this plan both
 * `001_integrity.sql` and `002_catalogue_integrity.sql` are already pasted
 * into `migration.sql`, so this is a safety net against future drift (a new
 * companion file added without being pasted in), not a step that fires
 * today.
 */
async function applyMissingIntegritySql(prisma: PrismaClient): Promise<void> {
  const combined = migrationsText();
  let files: string[];
  try {
    files = readdirSync(SQL_DIR).filter((f) => f.endsWith(".sql"));
  } catch {
    return;
  }

  for (const file of files) {
    const sql = readFileSync(path.join(SQL_DIR, file), "utf8");
    const marker = /ADD CONSTRAINT (\w+)|CREATE UNIQUE INDEX (\w+)/.exec(sql);
    const name = marker?.[1] ?? marker?.[2];
    if (name && combined.includes(name)) {
      continue; // already applied via a pasted-in migration
    }
    await prisma.$executeRawUnsafe(sql);
  }
}

export type TestDatabase = {
  prisma: PrismaClient;
  url: string;
  stop: () => Promise<void>;
};

/**
 * Starts a throwaway, pinned-image Postgres container, deploys the real,
 * checked-in migrations against it — the point of this harness is that the
 * migrations under test are the ones actually proven, never a schema
 * synchronised by another mechanism — applies any not-yet-pasted-in
 * `prisma/sql/*.sql` companions, and returns a connected `PrismaClient`.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const url = container.getConnectionUri();

  // `npx` resolves to a `.cmd` shim on Windows; execFileSync needs `shell:
  // true` there to find it (a plain execFileSync("npx", ...) throws ENOENT).
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
    shell: true,
    timeout: TEST_DB_TIMEOUT_MS,
  });

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  await applyMissingIntegritySql(prisma);

  return {
    prisma,
    url,
    stop: async () => {
      await prisma.$disconnect();
      await container.stop();
    },
  };
}
