/**
 * Per-address verification/reset request cooldown (PRD IAM-06, D-05).
 *
 * Pure functions so the policy is testable without a database. The module
 * takes the last-issue timestamp as a parameter and never queries the
 * database itself — the calling service reads `VerificationToken.createdAt`
 * and passes it in, since `eslint.config.mjs` confines `@prisma/client` to
 * `src/server/services/**` and `src/server/db.ts`.
 */

export const REQUEST_COOLDOWN_MS = 60_000;

export function isInCooldown(
  lastIssuedAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (lastIssuedAt === null) return false;
  const elapsed = now.getTime() - lastIssuedAt.getTime();
  return elapsed < REQUEST_COOLDOWN_MS;
}

export function cooldownRemainingMs(
  lastIssuedAt: Date | null,
  now: Date = new Date(),
): number {
  if (lastIssuedAt === null) return 0;
  const elapsed = now.getTime() - lastIssuedAt.getTime();
  const remaining = REQUEST_COOLDOWN_MS - elapsed;
  return remaining > 0 ? remaining : 0;
}
