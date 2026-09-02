/**
 * RBAC-07 continuity safeguard.
 *
 * The only place role-management continuity is evaluated. A future
 * contributor adding a fifth open-coded variant instead of importing
 * `assertRoleManagementContinuity` from here is the exact failure mode this
 * module exists to prevent.
 *
 * Called from the four D-24 trigger points: revoking an assignment that
 * grants `roles.manage`, removing `roles.manage` from a role's permission
 * set, deactivating a role that grants `roles.manage`, and deactivating the
 * last user account holding it.
 *
 * Concurrency: transaction-scoped count only (checkpoint decision, this
 * plan). Each call site passes `tx.assignment.count` from inside its own
 * `prisma.$transaction`, co-locating the check with the write it guards. The
 * residual READ COMMITTED race — two simultaneous revocations of the last two
 * administrators both succeeding — is accepted as a recorded, low-severity
 * risk (T-02-10) rather than closed with a row-level lock.
 */

export const CONTINUITY_BLOCK_MESSAGE =
  "This change would leave no user with role-management access. Choose a different action.";

export class ContinuityError extends Error {
  constructor() {
    super(CONTINUITY_BLOCK_MESSAGE);
    this.name = "ContinuityError";
  }
}

export type ContinuityExclusion =
  | { kind: "assignment"; assignmentId: string }
  | { kind: "role"; roleId: string }
  | { kind: "user"; userId: string };

/**
 * Simulates the post-action state rather than protecting the initiator: an
 * administrator may remove their own last global grant as long as at least
 * one other active global holder would remain afterwards (edge RBAC-07/empty).
 */
export function buildContinuityWhere(
  exclude: ContinuityExclusion,
  now: Date,
): Record<string, unknown> {
  const where: Record<string, unknown> = {
    // D-25 — GLOBAL-scope grants only; a Programme/Course/Cohort-scoped
    // roles.manage holder never counts toward the remaining-administrator
    // total.
    scopeType: "GLOBAL",
    active: true,
    revokedAt: null,
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    ],
    role: { active: true, permissions: { has: "roles.manage" } },
    // RESEARCH Pitfall 1 — the single most important clause in this query.
    // loadGrantsForUser omits this safely because getActorBySessionToken has
    // already rejected a non-ACTIVE current actor by the time it runs; this
    // query counts *other* users and has no such boundary, so a deactivated
    // administrator whose assignment rows D-35 leaves intact would otherwise
    // be counted as a remaining administrator.
    user: { status: "ACTIVE" },
  };

  switch (exclude.kind) {
    case "assignment":
      where.id = { not: exclude.assignmentId };
      break;
    case "role":
      where.roleId = { not: exclude.roleId };
      break;
    case "user":
      where.userId = { not: exclude.userId };
      break;
  }

  return where;
}

export type ContinuityCount = (where: Record<string, unknown>) => Promise<number>;

/**
 * Throws `ContinuityError` when the hypothetical post-action count of other
 * active GLOBAL roles.manage holders is zero. `count` is injected so a call
 * site inside its own `prisma.$transaction` can pass `tx.assignment.count`.
 */
export async function assertRoleManagementContinuity(
  count: ContinuityCount,
  exclude: ContinuityExclusion,
  now: Date = new Date(),
): Promise<void> {
  const where = buildContinuityWhere(exclude, now);
  const remaining = await count(where);
  if (remaining === 0) {
    throw new ContinuityError();
  }
}
