/**
 * Staff account lifecycle.
 *
 * Not routed through `createResourceService` — its generic archive writes a
 * status value `UserStatus` does not contain (RESEARCH Pitfall 2).
 *
 * `userScope()` returns an empty `ResourceScope`, so staff-account
 * administration is inherently global — a Programme-scoped `users.manage`
 * grant is technically assignable but would never match an empty-scope User
 * resource.
 *
 * D-40 — "inviting" a staff account means the administrator sets/generates a
 * temporary password at creation time, shown once and relayed out of band.
 * There is no email-link flow this phase (no email sender exists yet).
 */

import { randomBytes } from "node:crypto";
import { prisma } from "@/server/db";
import {
  withPermission,
  assertScopeAllowed,
  ScopeError,
  type Permission,
  type ResourceScope,
  type ScopeType,
} from "@/server/permissions";
import type { createWithPermission } from "@/server/permissions/with-permission";
import { hashPassword } from "@/server/auth/password";
import { signOutAllForUser } from "@/server/services/auth-service";
import { recordAudit } from "@/server/services/audit-service";
import type { BusinessAuditEvent } from "@/server/services/audit-service";
import { assertRoleManagementContinuity } from "@/server/services/continuity-service";
import { MIN_REASON_LENGTH } from "@/server/services/role-service";

type WithPermission = ReturnType<typeof createWithPermission>;

/** An empty resource — reachable only by a GLOBAL grant (Pattern 1). */
export function userScope(): ResourceScope {
  return {};
}

export class DuplicateStaffEmailError extends Error {
  constructor(email: string) {
    super(`${email} is already in use by another account.`);
    this.name = "DuplicateStaffEmailError";
  }
}

/** D-33 — deactivating a staff account demands a reason; reactivation demands none. */
export class StaffAccountReasonRequiredError extends Error {
  constructor() {
    super(`A reason of at least ${MIN_REASON_LENGTH} characters is required.`);
    this.name = "StaffAccountReasonRequiredError";
  }
}

export const TEMPORARY_PASSWORD_BYTES = 12;

/** Mirrors the token generation already in auth-service.ts. */
export function generateTemporaryPassword(): string {
  return randomBytes(TEMPORARY_PASSWORD_BYTES).toString("base64url");
}

export type StaffUserRow = {
  id: string;
  name: string;
  email: string;
  status: string;
  isStaff: boolean;
  passwordHash: string | null;
  createdAt: Date;
  deactivatedAt: Date | null;
  deactivatedById: string | null;
};

export type StaffSearchRow = { id: string; name: string; email: string; status: string };

export type CreateStaffAccountInput = {
  name: string;
  email: string;
  temporaryPassword?: string;
  roleId: string;
  scopeType: ScopeType;
  scopeId: string | null;
  endsAt?: Date | null;
};

/** Returned once, for immediate on-screen display — never audited, logged, or stored in plaintext. */
export type CreatedStaffAccount = { user: StaffUserRow; temporaryPassword: string };

type RoleForAssignment = { id: string; active: boolean; permissions: string[] };

/** The narrow slice of the Prisma client this service actually uses. */
export type StaffAccountStore = {
  user: {
    findUnique(args: Record<string, unknown>): Promise<StaffUserRow | null>;
    findMany(args?: Record<string, unknown>): Promise<StaffUserRow[]>;
    create(args: { data: Record<string, unknown> }): Promise<StaffUserRow>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<StaffUserRow>;
  };
  assignment: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    count(args: { where: unknown }): Promise<number>;
  };
  role: {
    findUnique(args: Record<string, unknown>): Promise<RoleForAssignment | null>;
  };
  $transaction<T>(fn: (tx: StaffAccountStore) => Promise<T>): Promise<T>;
};

export function createStaffAccountService(deps: {
  store: StaffAccountStore;
  withPermission: WithPermission;
  audit: (event: BusinessAuditEvent) => Promise<void>;
  hash: (plaintext: string) => Promise<string>;
  signOutAll: (userId: string) => Promise<number>;
  now?: () => Date;
}) {
  const { store, withPermission: authorize, audit, hash, signOutAll } = deps;
  const now = deps.now ?? (() => new Date());

  // D-17 — the same choke point as every other read; never an unauthenticated
  // or permission-less autocomplete endpoint.
  const searchInternal = authorize<string>("users.view", () => userScope())(
    async (query) => {
      const rows = await store.user.findMany({
        where: {
          isStaff: true,
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
          ],
        },
        orderBy: { name: "asc" },
        take: 10,
      });
      return rows.map(
        (row): StaffSearchRow => ({
          id: row.id,
          name: row.name,
          email: row.email,
          status: row.status,
        }),
      );
    },
  );

  const listInternal = authorize<Record<string, never>>(
    "users.view",
    () => userScope(),
  )(async () =>
    store.user.findMany({
      where: { isStaff: true },
      orderBy: { name: "asc" },
    }),
  );

  const getInternal = authorize<string>("users.view", () => userScope())(
    async (id) => store.user.findUnique({ where: { id } }),
  );

  const createInternal = authorize<CreateStaffAccountInput>(
    "users.manage",
    () => userScope(),
  )(async (input, ctx) => {
    const role = await store.role.findUnique({ where: { id: input.roleId } });
    if (!role || !role.active) {
      throw new Error("Role not found or inactive.");
    }

    // T-02-02 — the first assignment is subject to the same global-only rule
    // Plan 04 enforces.
    for (const permission of role.permissions) {
      assertScopeAllowed(permission as Permission, input.scopeType);
    }

    const email = input.email.toLowerCase().trim();
    const temporaryPassword = input.temporaryPassword ?? generateTemporaryPassword();
    const passwordHash = await hash(temporaryPassword);

    let created: { user: StaffUserRow };
    try {
      // D-22 — one transaction: a User created with zero assignments is a
      // dead-end zero-access account, the exact failure this flow prevents.
      created = await store.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: input.name,
            email,
            passwordHash,
            status: "ACTIVE",
            isStaff: true,
            // An administrator vouched for the address (D-40's temp-password
            // flow), so it is considered verified immediately.
            emailVerified: now(),
          },
        });

        await tx.assignment.create({
          data: {
            userId: user.id,
            roleId: input.roleId,
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            active: true,
            startsAt: now(),
            endsAt: input.endsAt ?? null,
            createdById: ctx.actor.userId,
            reason: "Account's first assignment, granted at creation.",
          },
        });

        return { user };
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new DuplicateStaffEmailError(email);
      }
      throw error;
    }

    await audit({
      actorId: ctx.actor.userId,
      action: "user.created",
      targetType: "User",
      targetId: created.user.id,
      after: created.user,
      reason: null,
      scopeType: "GLOBAL",
      scopeId: null,
      outcome: "SUCCESS",
    });

    await audit({
      actorId: ctx.actor.userId,
      action: "assignment.created",
      targetType: "Assignment",
      targetId: null,
      after: { userId: created.user.id, roleId: input.roleId },
      reason: null,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      outcome: "SUCCESS",
    });

    // Returned exactly once — never handed to the audit sink above, never
    // logged, never persisted.
    return { user: created.user, temporaryPassword };
  });

  const deactivateInternal = authorize<{ userId: string; reason: string }>(
    "users.manage",
    () => userScope(),
  )(async (input, ctx) => {
    const reason = input.reason.trim();
    if (reason.length < MIN_REASON_LENGTH) {
      throw new StaffAccountReasonRequiredError();
    }

    const current = await store.user.findUnique({ where: { id: input.userId } });
    if (!current) {
      throw new Error(`User ${input.userId} not found.`);
    }

    // Already deactivated — same end state either way (edge IAM-04/idempotency).
    if (current.status === "DEACTIVATED") {
      return current;
    }

    const after = await store.$transaction(async (tx) => {
      // D-24d — called unconditionally on every deactivation, not only when
      // the user is known to hold roles.manage: the query is cheap and an
      // unconditional call cannot be forgotten for an edge case.
      await assertRoleManagementContinuity(
        (where) => tx.assignment.count({ where }),
        { kind: "user", userId: input.userId },
      );

      // D-35 — no Assignment row is touched; deny-by-default already denies
      // a deactivated account regardless of its assignments.
      return tx.user.update({
        where: { id: input.userId },
        data: {
          status: "DEACTIVATED",
          deactivatedAt: now(),
          deactivatedById: ctx.actor.userId,
        },
      });
    });

    // D-34 — access ends at deactivation, not whenever a session cookie
    // happens to expire.
    await signOutAll(input.userId);

    // redactForAudit (plan 02) strips passwordHash from these rows at the
    // sink, so the whole User rows can be passed as before/after here.
    await audit({
      actorId: ctx.actor.userId,
      action: "user.deactivated",
      targetType: "User",
      targetId: input.userId,
      before: current,
      after,
      reason,
      scopeType: "GLOBAL",
      scopeId: null,
      outcome: "SUCCESS",
    });

    return after;
  });

  const reactivateInternal = authorize<{ userId: string }>(
    "users.manage",
    () => userScope(),
  )(async (input, ctx) => {
    const current = await store.user.findUnique({ where: { id: input.userId } });
    if (!current) {
      throw new Error(`User ${input.userId} not found.`);
    }

    if (current.status === "ACTIVE") {
      return current;
    }

    // No optimistic-concurrency check (edge IAM-04/concurrency): two
    // administrators racing to flip the same account reach the same end
    // state, unlike the versioned Role edits.
    const after = await store.user.update({
      where: { id: input.userId },
      data: { status: "ACTIVE", deactivatedAt: null, deactivatedById: null },
    });

    // D-36 — no Assignment row touched; the account regains exactly the
    // access it had, with no re-assignment step.
    await audit({
      actorId: ctx.actor.userId,
      action: "user.reactivated",
      targetType: "User",
      targetId: input.userId,
      before: current,
      after,
      reason: null,
      scopeType: "GLOBAL",
      scopeId: null,
      outcome: "SUCCESS",
    });

    return after;
  });

  return {
    search: (query: string) => searchInternal(query),
    list: () => listInternal({}),
    get: (id: string) => getInternal(id),
    create: (input: CreateStaffAccountInput) => createInternal(input),
    deactivate: (input: { userId: string; reason: string }) => deactivateInternal(input),
    reactivate: (input: { userId: string }) => reactivateInternal(input),
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export const staffAccountService = createStaffAccountService({
  store: prisma as unknown as StaffAccountStore,
  withPermission,
  audit: recordAudit,
  hash: hashPassword,
  signOutAll: signOutAllForUser,
});

// ScopeError is re-exported here only for callers that need to catch it
// alongside this service's own error classes without a second import.
export { ScopeError };
