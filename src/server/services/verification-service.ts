/**
 * Single-use, expiring token issuance and consumption (IAM-02, D-02, D-03, D-05).
 *
 * Covers both email verification and password-reset token purposes through
 * one shared `VerificationToken` model. Every entry point here runs before a
 * session exists — this file never imports or applies `withPermission`,
 * which throws `AuthenticationError` when there is no actor.
 */

import { hashToken } from "@/server/auth/token-hash";
import { randomBytes } from "node:crypto";
import { prisma } from "@/server/db";
import { isInCooldown } from "@/server/auth/request-cooldown";
import {
  PASSWORD_RESET_TOKEN_TTL_MS,
  TOKEN_PURPOSE,
  VERIFICATION_TOKEN_TTL_MS,
  type TokenPurpose,
} from "@/lib/identity";
import { emailDispatchService, type DispatchParams } from "@/server/services/email-dispatch-service";
import { sendAuthEmail } from "@/server/services/auth-email-service";
import { recordAudit } from "@/server/services/audit-service";
import type { BusinessAuditEvent } from "@/server/services/audit-service";

export type VerificationTokenRow = {
  userId?: string | null;
  identifier: string;
  token: string;
  purpose: string;
  expires: Date;
  consumedAt: Date | null;
  createdAt: Date;
};

export type IssueTokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: "COOLDOWN" };

export type ConsumeTokenResult = { ok: true } | { ok: false };

type UserForVerification = { id: string; email: string; status: string; passwordHash?: string | null };

/** The narrow slice of the Prisma client this service actually uses. */
export type VerificationStore = {
  session: {
    updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
  };
  verificationToken: {
    findFirst(args: Record<string, unknown>): Promise<VerificationTokenRow | null>;
    updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
    create(args: { data: Record<string, unknown> }): Promise<VerificationTokenRow>;
  };
  user: {
    updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
    findUnique(args: Record<string, unknown>): Promise<UserForVerification | null>;
    // Email-change confirmation filters by both the bound account id and
    // the still-pending address, which is not itself a unique identifier.
    findFirst(args: Record<string, unknown>): Promise<UserForVerification | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<UserForVerification>;
  };
  /** F-14b — a password reset clears the address's sign-in throttle (optional in fakes). */
  loginThrottle?: { deleteMany(args: { where: { email: string } }): Promise<unknown> };
  $transaction<T>(fn: (tx: VerificationStore) => Promise<T>): Promise<T>;
};

export function createVerificationService(deps: {
  store: VerificationStore;
  dispatch: (params: DispatchParams) => Promise<unknown>;
  audit: (event: BusinessAuditEvent) => Promise<void>;
  generateToken?: () => string;
  now?: () => Date;
}) {
  const { store, dispatch, audit } = deps;
  const generateToken = deps.generateToken ?? (() => randomBytes(32).toString("base64url"));
  const now = deps.now ?? (() => new Date());

  async function issueToken(params: {
    userId?: string;
    identifier: string;
    purpose: TokenPurpose;
    ttlMs: number;
  }): Promise<IssueTokenResult> {
    const identifier = params.identifier.toLowerCase().trim();

    const newest = await store.verificationToken.findFirst({
      where: { identifier, purpose: params.purpose },
      orderBy: { createdAt: "desc" },
    });

    if (newest && isInCooldown(newest.createdAt, now())) {
      return { ok: false, reason: "COOLDOWN" };
    }

    const token = generateToken();
    await store.$transaction(async (tx) => {
      // D-03 — stamp consumedAt on every prior unconsumed unexpired row for
      // this identifier+purpose, so only the newest link works.
      await tx.verificationToken.updateMany({
        where: { identifier, purpose: params.purpose, consumedAt: null, expires: { gt: now() } },
        data: { consumedAt: now() },
      });
      await tx.verificationToken.create({
        data: {
          userId: params.userId ?? null,
          identifier,
          purpose: params.purpose,
          token: hashToken(token), // F-14a — the email carries the raw token
          expires: new Date(now().getTime() + params.ttlMs),
          createdAt: now(),
        },
      });
    });

    return { ok: true, token };
  }

  async function consumeToken(
    params: { token: string; purpose: TokenPurpose },
    apply: (tx: VerificationStore, row: VerificationTokenRow) => Promise<void>,
  ): Promise<ConsumeTokenResult> {
    return store.$transaction(async (tx) => {
      // Conditional compare-and-set: the claim and the check happen as one
      // atomic operation, so replay and the check-then-act race are
      // structurally impossible rather than merely unlikely. Strict
      // greater-than is what makes a token expired exactly at its `expires`
      // instant.
      const result = await tx.verificationToken.updateMany({
        where: { token: hashToken(params.token), purpose: params.purpose, consumedAt: null, expires: { gt: now() } },
        data: { consumedAt: now() },
      });

      if (result.count !== 1) {
        return { ok: false };
      }

      const row = await tx.verificationToken.findFirst({
        where: { token: hashToken(params.token), purpose: params.purpose },
      });
      if (!row) return { ok: false };

      await apply(tx, row);
      return { ok: true };
    });
  }

  /**
   * `setPasswordToken` is present only for a CONTESTED registration (F-11): the
   * account was registered more than once before verification, so it has no
   * password. The verifier — the only party who can read this inbox — is sent
   * straight to choose one with a fresh password-reset token.
   */
  async function verifyEmail(
    token: string,
  ): Promise<{ ok: true; setPasswordToken?: string } | { ok: false }> {
    let verifiedUserId: string | null = null;
    let verifiedEmail: string | null = null;
    let needsPassword = false;

    const result = await consumeToken(
      { token, purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION },
      async (tx, row) => {
        const user = await tx.user.findUnique({ where: { email: row.identifier } });
        if (!user || user.status !== "PENDING_VERIFICATION") return;
        const activated = await tx.user.updateMany({
          where: { id: user.id, email: row.identifier, status: "PENDING_VERIFICATION" },
          data: { status: "ACTIVE", emailVerified: now() },
        });
        if (activated.count === 1) {
          verifiedUserId = user.id;
          verifiedEmail = row.identifier;
          // Exactly null: a contested registration wiped it (F-11).
          needsPassword = user.passwordHash === null;
        }
      },
    );

    if (result.ok && verifiedUserId) {
      await audit({
        actorId: verifiedUserId,
        action: "user.verified",
        targetType: "User",
        targetId: verifiedUserId,
        outcome: "SUCCESS",
        scopeType: "GLOBAL",
        scopeId: null,
      });
    }

    if (!result.ok || !verifiedUserId) return { ok: false };

    if (needsPassword && verifiedEmail) {
      const issued = await issueToken({
        userId: verifiedUserId,
        identifier: verifiedEmail,
        purpose: TOKEN_PURPOSE.PASSWORD_RESET,
        ttlMs: PASSWORD_RESET_TOKEN_TTL_MS,
      });
      // In the reset cooldown the account is still verified and safe (it has no
      // password); the page falls back to the normal "forgot password" route.
      if (issued.ok) return { ok: true, setPasswordToken: issued.token };
    }

    return { ok: true };
  }

  /** One single result value in all cases — plans 02 and 03 both consume this entry point. */
  async function resendVerification(email: string): Promise<{ ok: true }> {
    const identifier = email.toLowerCase().trim();
    const user = await store.user.findUnique({ where: { email: identifier } });

    if (user && user.status === "PENDING_VERIFICATION") {
      const issued = await issueToken({
        identifier,
        purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
        ttlMs: VERIFICATION_TOKEN_TTL_MS,
      });
      if (issued.ok) {
        // G-03-3 — best-effort (inside sendAuthEmail): a provider outage must
        // not crash a resend.
        await sendAuthEmail(dispatch, {
          template: "email-verification",
          toEmail: identifier,
          userId: user.id,
          path: "/verify",
          token: issued.token,
          ttlMs: VERIFICATION_TOKEN_TTL_MS,
        });
      }
    }

    return { ok: true };
  }

  return { issueToken, consumeToken, verifyEmail, resendVerification };
}

export const verificationService = createVerificationService({
  store: prisma as unknown as VerificationStore,
  dispatch: (params) => emailDispatchService.dispatch(params),
  audit: recordAudit,
});
