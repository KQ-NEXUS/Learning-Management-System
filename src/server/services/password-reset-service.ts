/**
 * Password reset (IAM-03's remaining gap).
 *
 * A pre-authentication service — no `withPermission` import. Composes
 * `verification-service.ts`'s `issueToken`/`consumeToken` rather than
 * reimplementing token mechanics; the reset token is the highest-value token
 * in the system (it grants account access outright), which is why D-02 caps
 * its lifetime at a quarter of the verification window and D-16 forces a
 * global session revocation on completion.
 */

import { prisma } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { signOutAllForUser } from "@/server/services/auth-service";
import { verificationService, type VerificationStore, type VerificationTokenRow } from "@/server/services/verification-service";
import { emailDispatchService } from "@/server/services/email-dispatch-service";
import { recordAudit } from "@/server/services/audit-service";
import type { BusinessAuditEvent } from "@/server/services/audit-service";
import { MIN_PASSWORD_LENGTH, PASSWORD_RESET_TOKEN_TTL_MS, TOKEN_PURPOSE } from "@/lib/identity";

export type PasswordResetRequestResult = { ok: true };

// Built once as a module-level constant — every requestReset outcome
// (active, unknown, pending, deactivated, cooldown-refused) returns this
// exact object identity.
export const PASSWORD_RESET_ACCEPTED: PasswordResetRequestResult = Object.freeze({ ok: true });

export type ResetPasswordResult =
  | { ok: true }
  | { ok: false; reason: "INVALID_INPUT" }
  | { ok: false; reason: "INVALID_TOKEN" };

export const RESET_INVALID_INPUT: ResetPasswordResult = Object.freeze({
  ok: false,
  reason: "INVALID_INPUT",
});
export const RESET_INVALID_TOKEN: ResetPasswordResult = Object.freeze({
  ok: false,
  reason: "INVALID_TOKEN",
});
export const RESET_ACCEPTED: ResetPasswordResult = Object.freeze({ ok: true });

export type PasswordResetUserRow = { id: string; email: string; status: string };

/** The narrow slice of the Prisma client `requestReset` uses directly. */
export type PasswordResetStore = {
  user: {
    findUnique(args: Record<string, unknown>): Promise<PasswordResetUserRow | null>;
  };
};

function buildResetEmailText(resetUrl: string): string {
  return `Click to reset your password: ${resetUrl}`;
}

export function createPasswordResetService(deps: {
  store: PasswordResetStore;
  issueToken: (params: {
    identifier: string;
    purpose: typeof TOKEN_PURPOSE.PASSWORD_RESET;
    ttlMs: number;
  }) => Promise<{ ok: true; token: string } | { ok: false; reason: "COOLDOWN" }>;
  consumeToken: (
    params: { token: string; purpose: typeof TOKEN_PURPOSE.PASSWORD_RESET },
    apply: (tx: VerificationStore, row: VerificationTokenRow) => Promise<void>,
  ) => Promise<{ ok: true } | { ok: false }>;
  dispatch: (params: {
    template: string;
    toEmail: string;
    userId?: string | null;
    subject: string;
    textContent: string;
  }) => Promise<unknown>;
  audit: (event: BusinessAuditEvent) => Promise<void>;
  hash?: (plaintext: string) => Promise<string>;
  signOutAll?: (userId: string) => Promise<number>;
  now?: () => Date;
}) {
  const { store, issueToken, consumeToken, dispatch, audit } = deps;
  const hash = deps.hash ?? hashPassword;
  const signOutAll = deps.signOutAll ?? signOutAllForUser;

  async function requestReset(email: string): Promise<PasswordResetRequestResult> {
    const identifier = email.toLowerCase().trim();
    const user = await store.user.findUnique({ where: { email: identifier } });

    // Cost symmetry: issueToken (a DB read + transaction) runs unconditionally
    // for every submitted address, active account or not, so an unknown or
    // non-active address does not return measurably sooner than a real one.
    // The token is only ever dispatched below when the account is real and
    // ACTIVE — an orphan token issued for an address with no active account
    // is inert: consumeToken's apply looks up a User by that exact identifier,
    // so it can never affect any account other than one later created or
    // reactivated under that same address, and D-05's cooldown/D-03's
    // invalidate-on-reissue already govern it like any other token.
    const issued = await issueToken({
      identifier,
      purpose: TOKEN_PURPOSE.PASSWORD_RESET,
      ttlMs: PASSWORD_RESET_TOKEN_TTL_MS,
    });

    if (issued.ok && user && user.status === "ACTIVE") {
      const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
      const resetUrl = `${baseUrl}/reset-password?token=${issued.token}`;
      await dispatch({
        template: "password-reset",
        toEmail: identifier,
        userId: user.id,
        subject: "Reset your password",
        textContent: buildResetEmailText(resetUrl),
      });
      await audit({
        actorId: user.id,
        action: "user.password_reset_requested",
        targetType: "User",
        targetId: user.id,
        outcome: "SUCCESS",
        scopeType: "GLOBAL",
        scopeId: null,
      });
    }

    return PASSWORD_RESET_ACCEPTED;
  }

  async function resetPassword(params: { token: string; newPassword: string }): Promise<ResetPasswordResult> {
    if (params.newPassword.length < MIN_PASSWORD_LENGTH) {
      return RESET_INVALID_INPUT;
    }

    // Computed before consumeToken so the scrypt derivation does not hold the
    // claim transaction open.
    const passwordHash = await hash(params.newPassword);

    let resetUserId: string | null = null;
    const claimed = await consumeToken(
      { token: params.token, purpose: TOKEN_PURPOSE.PASSWORD_RESET },
      async (tx, row) => {
        const user = await tx.user.findUnique({ where: { email: row.identifier } });
        if (!user) return;
        await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
        resetUserId = user.id;
      },
    );

    if (!claimed.ok || !resetUserId) {
      return RESET_INVALID_TOKEN;
    }

    // D-16 — any session that predates the reset is no longer trusted.
    await signOutAll(resetUserId);

    await audit({
      actorId: resetUserId,
      action: "user.password_reset",
      targetType: "User",
      targetId: resetUserId,
      outcome: "SUCCESS",
      scopeType: "GLOBAL",
      scopeId: null,
    });

    return RESET_ACCEPTED;
  }

  return { requestReset, resetPassword };
}

export const passwordResetService = createPasswordResetService({
  store: prisma as unknown as PasswordResetStore,
  issueToken: (params) => verificationService.issueToken(params),
  consumeToken: (params, apply) => verificationService.consumeToken(params, apply),
  dispatch: (params) => emailDispatchService.dispatch(params),
  audit: recordAudit,
});
