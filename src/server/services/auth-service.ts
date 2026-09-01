/**
 * Sign-in and session lifecycle.
 *
 * Database sessions rather than a signed token, because IAM-03 requires
 * selective and global revocation — a JWT cannot be withdrawn before it
 * expires. This is also why Auth.js is not used: its Credentials provider
 * forces the JWT strategy.
 */

import { randomBytes } from "node:crypto";
import { prisma } from "@/server/db";
import { verifyPassword } from "@/server/auth/password";
import {
  isLockedOut,
  nextFailureState,
  SESSION_TTL_DAYS,
} from "@/server/auth/lockout";

export type SignInResult =
  | { ok: true; token: string; expires: Date }
  | { ok: false; reason: "INVALID" | "LOCKED" };

export async function signIn(
  email: string,
  password: string,
): Promise<SignInResult> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: {
      id: true,
      passwordHash: true,
      status: true,
      failedLoginAttempts: true,
      lockedUntil: true,
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

  if (!(await verifyPassword(password, user.passwordHash))) {
    await prisma.user.update({
      where: { id: user.id },
      data: nextFailureState(user.failedLoginAttempts),
    });
    return { ok: false, reason: "INVALID" };
  }

  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    }),
    prisma.session.create({
      data: { sessionToken: token, userId: user.id, expires },
    }),
  ]);

  return { ok: true, token, expires };
}

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
