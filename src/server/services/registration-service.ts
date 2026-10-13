/**
 * Learner self-registration (IAM-01).
 *
 * A pre-authentication service — no `withPermission` wrapper, matching
 * `auth-service.ts`'s shape. The three account-state branches (brand-new,
 * already-pending, already-active) plus a lost-insert-race fallback all
 * return one identical, frozen success value (D-08, IAM-06) — this is the
 * phase's primary enumeration surface, so the branches must be externally
 * indistinguishable in value, shape, and cost.
 */

import { prisma } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import {
  MIN_PASSWORD_LENGTH,
  POLICY_TYPE,
  POLICY_VERSIONS,
  TOKEN_PURPOSE,
  VERIFICATION_TOKEN_TTL_MS,
} from "@/lib/identity";
import { verificationService } from "@/server/services/verification-service";
import { emailDispatchService, type DispatchParams } from "@/server/services/email-dispatch-service";
import { sendAuthEmail } from "@/server/services/auth-email-service";
import { recordAudit } from "@/server/services/audit-service";
import type { BusinessAuditEvent } from "@/server/services/audit-service";
import { licenceService } from "@/server/services/licence-service";
import { LicenceWriteBlockedError } from "@/server/licence/errors";
import { issueLearnerNumber, type LearnerNumberTx } from "@/server/services/learner-number-service";

export type RegistrationInput = {
  email: string;
  password: string;
  name: string;
  phone?: string | null;
  acceptedTerms: boolean;
  acceptedPrivacy: boolean;
};

export type RegisteredUserRow = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  status: string;
  passwordHash: string | null;
};

export type RegistrationResult =
  | { ok: true }
  | { ok: false; reason: "INVALID_INPUT" }
  | { ok: false; reason: "UNAVAILABLE" };

// Built once as module-level constants — three hand-written near-identical
// objects is precisely how the response shape drifts apart (Pitfall 5). All
// three account-state branches and the lost-race fallback return the exact
// same `REGISTRATION_ACCEPTED` object identity, not structurally-similar clones.
export const REGISTRATION_ACCEPTED: RegistrationResult = Object.freeze({ ok: true });
export const REGISTRATION_INVALID_INPUT: RegistrationResult = Object.freeze({
  ok: false,
  reason: "INVALID_INPUT",
});
/**
 * Phase 14 (D-06, A12) — new registration is refused in restricted continuity
 * mode. One frozen value for every email, so the refusal is never an
 * enumeration oracle (IAM-06): it is returned before any store call.
 */
export const REGISTRATION_UNAVAILABLE: RegistrationResult = Object.freeze({
  ok: false,
  reason: "UNAVAILABLE",
});

/** The narrow slice of the Prisma client this service actually uses. */
export type RegistrationStore = {
  user: {
    findUnique(args: Record<string, unknown>): Promise<RegisteredUserRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<RegisteredUserRow>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
  policyAcceptance: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: RegistrationStore) => Promise<T>): Promise<T>;
};

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export function createRegistrationService(deps: {
  store: RegistrationStore;
  issueToken: (params: {
    identifier: string;
    purpose: typeof TOKEN_PURPOSE.EMAIL_VERIFICATION;
    ttlMs: number;
  }) => Promise<{ ok: true; token: string } | { ok: false; reason: "COOLDOWN" }>;
  resendVerification: (email: string) => Promise<{ ok: true }>;
  dispatch: (params: DispatchParams) => Promise<unknown>;
  audit: (event: BusinessAuditEvent) => Promise<void>;
  hash?: (plaintext: string) => Promise<string>;
  now?: () => Date;
  /**
   * Takes the next learner number inside the registration transaction, or
   * returns null when numbers are switched off. Optional: absent means a
   * learner is created without one.
   */
  issueLearnerNumber?: (tx: unknown, at: Date) => Promise<string | null>;
  /**
   * D-09 — explicit restricted-state guard (this service does not run through
   * `withPermission`). Optional: absent means registration behaves as before.
   */
  licence?: {
    assertWriteAllowed(input: { operation: string; actorId?: string | null }): Promise<void>;
  };
}) {
  const registeredAt = deps.now ?? (() => new Date());
  const { store, issueToken, resendVerification, dispatch, audit } = deps;
  const hash = deps.hash ?? hashPassword;

  /** Resends verification for an already-pending account and audits it — shared by
   * the found-PENDING_VERIFICATION branch and the lost-insert-race fallback.
   *
   * F-11 — a second registration for a still-unverified address is CONTESTED:
   * nobody has proven they own the inbox, so neither submitted password may
   * survive. The stored hash is wiped (only while still pending), and whoever
   * verifies from the inbox is sent to set their own password
   * (`verifyEmail` → `setPasswordToken`). Without this, an attacker who
   * registered the address first keeps their password through the owner's
   * verification (account pre-hijacking). */
  async function resendForPending(email: string): Promise<void> {
    await store.user.updateMany({
      where: { email, status: "PENDING_VERIFICATION" },
      data: { passwordHash: null },
    });
    const user = await store.user.findUnique({ where: { email } });
    await resendVerification(email);
    if (user) {
      await audit({
        actorId: user.id,
        action: "user.verification_resent",
        targetType: "User",
        targetId: user.id,
        outcome: "SUCCESS",
        scopeType: "GLOBAL",
        scopeId: null,
      });
    }
  }

  /** Returns one single value regardless of internal branch (D-08, IAM-06). */
  async function registerLearner(input: RegistrationInput): Promise<RegistrationResult> {
    const name = input.name.trim();
    const email = input.email.toLowerCase().trim();

    // Validation first, before any store call — an invalid submission never
    // reveals anything about the address by the work it triggers. Safe to
    // distinguish because it depends only on what the visitor typed.
    if (
      !name ||
      !email ||
      input.password.length < MIN_PASSWORD_LENGTH ||
      !input.acceptedTerms ||
      !input.acceptedPrivacy
    ) {
      return REGISTRATION_INVALID_INPUT;
    }

    // D-06 / A12 / D-09 — restricted continuity mode refuses every new
    // registration, after validation and before any store call, so the result
    // does not depend on whether the email exists (IAM-06). Only the neutral
    // licence refusal is mapped; any other failure propagates unchanged.
    if (deps.licence) {
      try {
        await deps.licence.assertWriteAllowed({ operation: "registration", actorId: null });
      } catch (error) {
        if (error instanceof LicenceWriteBlockedError) return REGISTRATION_UNAVAILABLE;
        throw error;
      }
    }

    // Cost symmetry: hash before the branch decision so every post-validation
    // path pays the same dominant cost, even the arms that discard the result.
    const passwordHash = await hash(input.password);

    const existing = await store.user.findUnique({ where: { email } });

    if (existing) {
      if (existing.status === "PENDING_VERIFICATION") {
        await resendForPending(email);
      }
      // Any other status (ACTIVE, DEACTIVATED, ...): do nothing at all —
      // no account-mutating audit event.
      return REGISTRATION_ACCEPTED;
    }

    let user: RegisteredUserRow;
    try {
      user = await store.$transaction(async (tx) => {
        // Taken in this same transaction: if the account is not created, the
        // counter's increment rolls back with it and no number is skipped.
        const learnerNumber = (await deps.issueLearnerNumber?.(tx, registeredAt())) ?? null;
        const created = await tx.user.create({
          data: {
            email,
            name,
            phone: input.phone ?? null,
            passwordHash,
            status: "PENDING_VERIFICATION",
            ...(learnerNumber ? { learnerNumber } : {}),
          },
        });

        await tx.policyAcceptance.create({
          data: {
            userId: created.id,
            policyType: POLICY_TYPE.TERMS,
            version: POLICY_VERSIONS[POLICY_TYPE.TERMS],
            accepted: input.acceptedTerms,
            orderId: null,
          },
        });

        await tx.policyAcceptance.create({
          data: {
            userId: created.id,
            policyType: POLICY_TYPE.PRIVACY,
            version: POLICY_VERSIONS[POLICY_TYPE.PRIVACY],
            accepted: input.acceptedPrivacy,
            orderId: null,
          },
        });

        return created;
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        // Two visitors raced on the same brand-new address: the winner
        // created the account, our insert lost to User.email's unique
        // constraint. The loser's request must still look identical to the
        // winner's from the outside.
        await resendForPending(email);
        return REGISTRATION_ACCEPTED;
      }
      throw error;
    }

    // T-03-52 — the audit write moves to immediately after the transaction
    // commits, before token issuance and before the send. Not wrapped, moved:
    // the User row is committed by now, and a committed account with no
    // audit row is a repudiation gap. The send below is the most
    // failure-prone step in this function and must not sit between the
    // commit and its audit.
    await audit({
      actorId: user.id,
      action: "user.created",
      targetType: "User",
      targetId: user.id,
      after: user,
      outcome: "SUCCESS",
      scopeType: "GLOBAL",
      scopeId: null,
    });

    const issued = await issueToken({
      identifier: email,
      purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
      ttlMs: VERIFICATION_TOKEN_TTL_MS,
    });

    if (issued.ok) {
      // G-03-3 — routed through the best-effort wrapper (inside
      // sendAuthEmail): a provider outage must degrade delivery, never leave
      // a committed, audited account behind a framework error page. The
      // result is discarded — no caller-visible value may depend on whether
      // the send happened.
      await sendAuthEmail(dispatch, {
        template: "email-verification",
        toEmail: email,
        userId: user.id,
        path: "/verify",
        token: issued.token,
        ttlMs: VERIFICATION_TOKEN_TTL_MS,
      });
    }

    return REGISTRATION_ACCEPTED;
  }

  return { registerLearner };
}

export const registrationService = createRegistrationService({
  store: prisma as unknown as RegistrationStore,
  issueToken: (params) => verificationService.issueToken(params),
  resendVerification: (email) => verificationService.resendVerification(email),
  dispatch: (params) => emailDispatchService.dispatch(params),
  audit: recordAudit,
  licence: licenceService,
  issueLearnerNumber: (tx, at) => issueLearnerNumber(tx as LearnerNumberTx, at),
});
