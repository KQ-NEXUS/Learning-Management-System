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
import { requestCorrelationId } from "@/server/auth/request-context";
import { recordAudit, type BusinessAuditEvent } from "@/server/services/audit-service";

export type SignInResult =
  | { ok: true; token: string; expires: Date; isStaff: boolean }
  | {
      ok: false;
      reason: "INVALID" | "THROTTLED";
      /**
       * D-16 — set only when the password matched the REAL hash of a
       * PENDING_VERIFICATION account. The action uses it to queue a fresh
       * verification email after the response; it must never change what the
       * requester sees.
       */
      unverified?: true;
    };

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
  /** NFR-07 audit sink; defaults to the redacting, append-only recordAudit. */
  audit?: (event: BusinessAuditEvent) => Promise<void>;
  /** Ties an audit row to the request log; defaults to requestCorrelationId. */
  correlationId?: () => Promise<string>;
}) {
  const store = deps.store;
  const verify = deps.verify ?? verifyPassword;
  const now = deps.now ?? (() => new Date());
  const audit = deps.audit ?? recordAudit;
  const correlationId = deps.correlationId ?? requestCorrelationId;

  /**
   * NFR-07 — one audit row per sign-in outcome and per sign-out. The row
   * never carries the password or the typed address: the target is the user
   * id when an account exists, otherwise nothing. Best-effort: an audit-write
   * failure is logged by error name only and never changes the result the
   * person sees, so it cannot become an oracle or a lock-out.
   */
  async function writeAudit(
    event: Omit<BusinessAuditEvent, "correlationId" | "ipAddress">,
    ip: string | null,
  ): Promise<void> {
    try {
      await audit({ ...event, ipAddress: ip, correlationId: await correlationId() });
    } catch (error) {
      console.error("Auth audit write failed:", error instanceof Error ? error.name : "unknown");
    }
  }

  /** The same single write on every failure path, known account or not. */
  function auditFailure(targetId: string | null, ip: string | null): Promise<void> {
    return writeAudit(
      {
        actorId: null,
        actorType: "SYSTEM",
        action: "auth.sign_in.failed",
        targetType: "User",
        targetId,
        outcome: "DENIED",
      },
      ip,
    );
  }

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
      await writeAudit(
        {
          actorId: null,
          actorType: "SYSTEM",
          action: "auth.sign_in.throttled",
          targetType: "User",
          targetId: null,
          outcome: "DENIED",
        },
        context.ip,
      );
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

    // D-16 (U-11) — an unverified account is checked against its REAL hash,
    // which costs the same as the decoy below and as an active account, so
    // timing reveals nothing. Only a match sets `unverified`; a wrong
    // password for this account is an ordinary failure. Either way the
    // throttle failure is recorded so guessing stays limited.
    if (user && user.status === "PENDING_VERIFICATION" && user.passwordHash) {
      const matches = await verify(password, user.passwordHash);
      await recordFailure(store, keys, at);
      await auditFailure(user.id, context.ip);
      return matches
        ? { ok: false, reason: "INVALID", unverified: true }
        : { ok: false, reason: "INVALID" };
    }

    // Same failure shape — and the same password-verification cost — whether
    // the account is missing, has no password (contested registration, F-11),
    // is deactivated, or the password is wrong (IAM-06).
    if (!user || !user.passwordHash || user.status !== "ACTIVE") {
      await verify(password, await decoyPasswordHash());
      await recordFailure(store, keys, at);
      await auditFailure(user?.id ?? null, context.ip);
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
      await writeAudit(
        {
          actorId: user.id,
          action: "auth.sign_in.succeeded",
          targetType: "User",
          targetId: user.id,
          outcome: "SUCCESS",
        },
        context.ip,
      );
    } else {
      await recordFailure(store, keys, at);
      await auditFailure(user.id, context.ip);
    }
    return result;
  }

  /** Revokes one session (IAM-03) and audits it for the session's user (NFR-07). */
  async function signOut(token: string, context: SignInContext = { ip: null }): Promise<void> {
    const sessionToken = hashToken(token);
    const session = await store.session.findUnique({ where: { sessionToken }, select: { userId: true } });
    const revoked = await store.session.updateMany({
      where: { sessionToken, revokedAt: null },
      data: { revokedAt: now() },
    });
    // Only a session this call actually revoked is audited; an unknown or
    // already-revoked cookie writes nothing.
    if (revoked.count > 0 && session?.userId) {
      await writeAudit(
        {
          actorId: session.userId,
          action: "auth.sign_out",
          targetType: "User",
          targetId: session.userId,
          outcome: "SUCCESS",
        },
        context.ip,
      );
    }
  }

  return { signIn, signOut };
}

const authService = createAuthService({ store: prisma });
export const signIn = authService.signIn;
export const signOut = authService.signOut;

/** Revokes every session for a user. IAM-03. */
export async function signOutAllForUser(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
