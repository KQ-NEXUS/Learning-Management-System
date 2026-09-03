/**
 * Single-use, expiring token issuance and consumption (IAM-02, D-02, D-03, D-05).
 *
 * Covers both email verification and password-reset token purposes through
 * one shared `VerificationToken` model. Every entry point here runs before a
 * session exists — this file never imports or applies `withPermission`,
 * which throws `AuthenticationError` when there is no actor.
 */

import { randomBytes } from "node:crypto";
import { prisma } from "@/server/db";
import { isInCooldown } from "@/server/auth/request-cooldown";
import { TOKEN_PURPOSE, VERIFICATION_TOKEN_TTL_MS, type TokenPurpose } from "@/lib/identity";
import { emailDispatchService } from "@/server/services/email-dispatch-service";
import { recordAudit } from "@/server/services/audit-service";
import type { BusinessAuditEvent } from "@/server/services/audit-service";

export type VerificationTokenRow = {
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

type UserForVerification = { id: string; email: string; status: string };

/** The narrow slice of the Prisma client this service actually uses. */
export type VerificationStore = {
  verificationToken: {
    findFirst(args: Record<string, unknown>): Promise<VerificationTokenRow | null>;
    updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
    create(args: { data: Record<string, unknown> }): Promise<VerificationTokenRow>;
  };
  user: {
    findUnique(args: Record<string, unknown>): Promise<UserForVerification | null>;
    // findFirst (not just findUnique) is needed by profile-service.ts's
    // confirmEmailChange apply: User.pendingEmail carries no unique
    // constraint (two accounts may legitimately hold the same pending
    // address until one confirms), so it cannot be queried via findUnique.
    findFirst(args: Record<string, unknown>): Promise<UserForVerification | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<UserForVerification>;
  };
  $transaction<T>(fn: (tx: VerificationStore) => Promise<T>): Promise<T>;
};

function buildVerificationEmailText(verifyUrl: string): string {
  return `Click to verify: ${verifyUrl}`;
}

export function createVerificationService(deps: {
  store: VerificationStore;
  dispatch: (params: {
    template: string;
    toEmail: string;
    userId?: string | null;
    subject: string;
    textContent: string;
  }) => Promise<unknown>;
  audit: (event: BusinessAuditEvent) => Promise<void>;
  generateToken?: () => string;
  now?: () => Date;
}) {
  const { store, dispatch, audit } = deps;
  const generateToken = deps.generateToken ?? (() => randomBytes(32).toString("base64url"));
  const now = deps.now ?? (() => new Date());

  async function issueToken(params: {
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
          identifier,
          purpose: params.purpose,
          token,
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
        where: { token: params.token, purpose: params.purpose, consumedAt: null, expires: { gt: now() } },
        data: { consumedAt: now() },
      });

      if (result.count !== 1) {
        return { ok: false };
      }

      const row = await tx.verificationToken.findFirst({
        where: { token: params.token, purpose: params.purpose },
      });
      if (!row) return { ok: false };

      await apply(tx, row);
      return { ok: true };
    });
  }

  async function verifyEmail(token: string): Promise<{ ok: true } | { ok: false }> {
    let verifiedUserId: string | null = null;

    const result = await consumeToken(
      { token, purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION },
      async (tx, row) => {
        const user = await tx.user.findUnique({ where: { email: row.identifier } });
        if (!user) return;
        await tx.user.update({
          where: { id: user.id },
          data: { status: "ACTIVE", emailVerified: now() },
        });
        verifiedUserId = user.id;
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

    return result.ok ? { ok: true } : { ok: false };
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
        const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
        const verifyUrl = `${baseUrl}/verify?token=${issued.token}`;
        await dispatch({
          template: "email-verification",
          toEmail: identifier,
          userId: user.id,
          subject: "Verify your account",
          textContent: buildVerificationEmailText(verifyUrl),
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
