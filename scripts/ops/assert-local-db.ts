/**
 * `npx tsx scripts/ops/assert-local-db.ts`
 *
 * Exits 0 only when the shell's DATABASE_URL names a local database
 * (localhost, 127.0.0.1, ::1 or host.docker.internal), and 1 otherwise. Chain
 * it in front of every local schema push and seed in Phase 15, for example:
 *
 *   npx tsx scripts/ops/assert-local-db.ts && npx prisma migrate deploy
 *
 * It reads the shell environment only and deliberately does not load any .env
 * file: `.env` points at the shared Neon database, and the point of this check
 * is to prove the shell itself carries a local URL. Output names the host only.
 */

import { assertSafeDatabaseUrl } from "./db-target-guard";

try {
  const { host } = assertSafeDatabaseUrl(process.env.DATABASE_URL);
  console.log(`database target is local (${host})`);
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Refusing to run: the database target check failed.");
  process.exit(1);
}
