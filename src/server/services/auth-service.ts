/**
 * Sign-in and session lifecycle.
 *
 * Database sessions rather than a signed token, because IAM-03 requires
 * selective and global revocation — a JWT cannot be withdrawn before it
 * expires. This is also why Auth.js is not used: its Credentials provider
 * forces the JWT strategy.
 */

import { hashToken } from "@/server/auth/token-hash";
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { SESSION_TTL_DAYS } from "@/server/auth/lockout";
import {
  clearAddressKeys,
  isThrottled,
  readThrottle,
  recordFailure,
  throttleKeysFor,
  type ThrottleStore,
} from "@/server/auth/sign-in-throttle";

export type SignInResult =
  | { ok: true; token: string; expires: Date; isStaff: boolean }
  | { ok: false; reason: "INVALID" | "THROTTLED" };

/** Where the attempt came from — the client IP from a trusted header, or null. */
export type SignInContext = { ip: string | null };

/**
 * F-14b — a real scrypt hash of a throwaway value, so a sign-in for an
 * unknown or inactive address pays the same password-verification cost as a
 * real one and response time reveals nothing. Computed once, lazily.
 */
let decoyHash: Promise<string> | null = null;
function decoyPasswordHash(): Promise<string> {
  decoyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return decoyHash;
}

export function createAuthService(deps: {
  store: Pick<PrismaClient, "user" | "session" | "$transaction"> & ThrottleStore;
  verify?: typeof verifyPassword;
  now?: () => Date;
}) {
  const store = deps.store;
  const verify = deps.verify ?? verifyPassword;
  const now = deps.now ?? (() => new Date());

  async function signIn(
    email: string,
    password: string,
    context: SignInContext = { ip: null },
  ): Promise<SignInResult> {
    const address = email.toLowerCase().trim();
    const keys = throttleKeysFor(context.ip, address);
    const at = now();

    // F-14b — decided before the account is even looked up, so a throttled
    // answer is identical for real and unknown addresses.
    if (isThrottled(keys, await readThrottle(store, keys), at)) {
      return { ok: false, reason: "THROTTLED" };
    }

    const user = await store.user.findUnique({
      where: { email: address },
      select: {
        id: true,
        passwordHash: true,
        status: true,
        // Presentation hint only, used to choose the post-sign-in redirect
        // (D-15) — never an authorization input. Authority still comes
        // exclusively from Assignment rows resolved through withPermission.
        isStaff: true,
      },
    });

    // Same failure shape — and the same password-verification cost — whether
    // the account is missing, unverified, or the password is wrong (IAM-06).
    if (!user || !user.passwordHash || user.status !== "ACTIVE") {
      await verify(password, await decoyPasswordHash());
      await recordFailure(store, keys, at);
      return { ok: false, reason: "INVALID" };
    }

    // Expensive password verification stays outside the lock. Revalidate its
    // inputs under the same user-row lock used by password updates.
    const validPassword = await verify(password, user.passwordHash);
    const result = await store.$transaction(async (tx): Promise<SignInResult> => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: user.id } });
      if (!current || current.status !== "ACTIVE" ||
          current.email !== address ||
          current.passwordHash !== user.passwordHash) {
        return { ok: false, reason: "INVALID" };
      }
      if (!validPassword) return { ok: false, reason: "INVALID" };
      const token = randomBytes(32).toString("base64url");
      const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
      // F-14a — the cookie carries the raw token; only its hash is stored.
      await tx.session.create({ data: { sessionToken: hashToken(token), userId: user.id, expires } });
      return { ok: true, token, expires, isStaff: current.isStaff };
    });

    if (result.ok) {
      await clearAddressKeys(store, keys);
    } else {
      await recordFailure(store, keys, at);
    }
    return result;
  }

  return { signIn };
}

export const signIn = createAuthService({ store: prisma }).signIn;

/** Revokes one session. IAM-03. */
export async function signOut(token: string): Promise<void> {
  await prisma.session.updateMany({
    where: { sessionToken: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revokes every session for a user. IAM-03. */
export async function signOutAllForUser(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
