/**
 * Sign-in and session lifecycle.
 *
 * Database sessions rather than a signed token, because IAM-03 requires
 * selective and global revocation — a JWT cannot be withdrawn before it
 * expires. This is also why Auth.js is not used: its Credentials provider
 * forces the JWT strategy.
 */

import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { verifyPassword } from "@/server/auth/password";
import {
  isLockedOut,
  nextFailureState,
  SESSION_TTL_DAYS,
} from "@/server/auth/lockout";

export type SignInResult =
  | { ok: true; token: string; expires: Date; isStaff: boolean }
  | { ok: false; reason: "INVALID" | "LOCKED" };

export function createAuthService(deps: {
  store: Pick<PrismaClient, "user" | "session" | "$transaction">;
  verify?: typeof verifyPassword;
}) {
  const store = deps.store;
  const verify = deps.verify ?? verifyPassword;
  async function signIn(
    email: string,
    password: string,
  ): Promise<SignInResult> {
    const user = await store.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: {
        id: true,
        passwordHash: true,
        status: true,
        failedLoginAttempts: true,
        lockedUntil: true,
        // Presentation hint only, used to choose the post-sign-in redirect
        // (D-15) — never an authorization input. Authority still comes
        // exclusively from Assignment rows resolved through withPermission.
        isStaff: true,
      },
    });

    // Same failure shape whether the account is missing, unverified, or the
    // password is wrong — the response must not reveal which (IAM-06).
    if (!user || !user.passwordHash || user.status !== "ACTIVE") {
      return { ok: false, reason: "INVALID" };
    }

    if (isLockedOut(user)) {
      return { ok: false, reason: "LOCKED" };
    }

    // Expensive password verification stays outside the lock. Revalidate its
    // inputs under the same user-row lock used by password updates.
    const validPassword = await verify(password, user.passwordHash);
    return store.$transaction(async (tx): Promise<SignInResult> => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: user.id } });
      if (!current || current.status !== "ACTIVE" ||
          current.email !== email.toLowerCase().trim() ||
          current.passwordHash !== user.passwordHash) {
        return { ok: false, reason: "INVALID" };
      }
      if (isLockedOut(current)) return { ok: false, reason: "LOCKED" };
      if (!validPassword) {
        await tx.user.update({
          where: { id: user.id },
          data: nextFailureState(current.failedLoginAttempts),
        });
        return { ok: false, reason: "INVALID" };
      }
      const token = randomBytes(32).toString("base64url");
      const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
      await tx.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
      await tx.session.create({ data: { sessionToken: token, userId: user.id, expires } });
      return { ok: true, token, expires, isStaff: current.isStaff };
    });
  }

  return { signIn };
}

export const signIn = createAuthService({ store: prisma }).signIn;

/** Revokes one session. IAM-03. */
export async function signOut(token: string): Promise<void> {
  await prisma.session.updateMany({
    where: { sessionToken: token, revokedAt: null },
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
