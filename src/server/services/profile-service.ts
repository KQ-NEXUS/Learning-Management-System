/**
 * Self-service profile and preference editing (IAM-05).
 *
 * Authorization here is an ownership comparison, not a permission check —
 * and that is the intended model, not a gap. The closed permission catalogue
 * in `src/server/permissions/catalogue.ts` has no "profile" or "self"
 * entry: a Learner editing their own record is not an RBAC concern. No entry
 * point below accepts a target user id parameter; every one derives the
 * target exclusively from `actor.userId`. A signature that cannot name
 * another user's record cannot be tricked into editing one. This file
 * imports no authorization wrapper — that is deliberate, not an oversight.
 */

import { prisma } from "@/server/db";
import { verifyPassword } from "@/server/auth/password";
import type { Actor } from "@/server/permissions/with-permission";
import {
  EMAIL_CHANGE_TOKEN_TTL_MS,
  POLICY_TYPE,
  POLICY_VERSIONS,
  TOKEN_PURPOSE,
} from "@/lib/identity";
import { type VerificationStore, type VerificationTokenRow } from "@/server/services/verification-service";
import { verificationService } from "@/server/services/verification-service";
import { emailDispatchService, dispatchBestEffort, type DispatchParams } from "@/server/services/email-dispatch-service";
import { recordAudit } from "@/server/services/audit-service";
import type { BusinessAuditEvent } from "@/server/services/audit-service";

export type ProfileUserRow = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  pendingEmail: string | null;
  passwordHash: string | null;
  emailVerified?: Date | null;
};

export type ProfileSnapshot = {
  name: string;
  phone: string | null;
  email: string;
  pendingEmail: string | null;
  marketingOptIn: boolean;
};

export type UpdateProfileResult =
  | { ok: true; profile: ProfileSnapshot }
  | { ok: false; reason: "INVALID_INPUT" };

export type EmailChangeResult = { ok: true } | { ok: false; reason: "STEP_UP_FAILED" };

// Collision, same-address, and the happy path all return this exact object —
// a caller cannot use requestEmailChange to discover which addresses are
// registered. The step-up failure is a DIFFERENT, distinguishable value: it
// depends only on the caller's own current password, never on the target
// email's existence, so it is safe to distinguish.
export const EMAIL_CHANGE_ACCEPTED: EmailChangeResult = Object.freeze({ ok: true });
export const EMAIL_CHANGE_STEP_UP_FAILED: EmailChangeResult = Object.freeze({
  ok: false,
  reason: "STEP_UP_FAILED",
});

export type ConfirmEmailChangeResult = { ok: true } | { ok: false };

/** The narrow slice of the Prisma client this service actually uses. */
export type ProfileStore = {
  user: {
    findUnique(args: Record<string, unknown>): Promise<ProfileUserRow | null>;
    findFirst(args: Record<string, unknown>): Promise<ProfileUserRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<ProfileUserRow>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
  policyAcceptance: {
    findFirst(args: Record<string, unknown>): Promise<{ id: string; accepted: boolean } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: ProfileStore) => Promise<T>): Promise<T>;
};

function buildEmailChangeText(confirmUrl: string): string {
  return `Click to confirm your new email address: ${confirmUrl}`;
}

async function readMarketingOptIn(
  store: Pick<ProfileStore, "policyAcceptance">,
  userId: string,
): Promise<boolean> {
  const row = await store.policyAcceptance.findFirst({
    where: { userId, policyType: POLICY_TYPE.MARKETING },
  });
  return row?.accepted ?? false;
}

export function createProfileService(deps: {
  store: ProfileStore;
  issueToken: (params: {
    identifier: string;
    purpose: typeof TOKEN_PURPOSE.EMAIL_CHANGE;
    ttlMs: number;
  }) => Promise<{ ok: true; token: string } | { ok: false; reason: "COOLDOWN" }>;
  consumeToken: (
    params: { token: string; purpose: typeof TOKEN_PURPOSE.EMAIL_CHANGE },
    apply: (tx: VerificationStore, row: VerificationTokenRow) => Promise<void>,
  ) => Promise<{ ok: true } | { ok: false }>;
  dispatch: (params: DispatchParams) => Promise<unknown>;
  audit: (event: BusinessAuditEvent) => Promise<void>;
  verify?: (password: string, stored: string) => Promise<boolean>;
  now?: () => Date;
}) {
  const { store, issueToken, consumeToken, dispatch, audit } = deps;
  const verify = deps.verify ?? verifyPassword;

  async function getOwnProfile(actor: Actor): Promise<ProfileSnapshot | null> {
    const user = await store.user.findUnique({ where: { id: actor.userId } });
    if (!user) return null;
    const marketingOptIn = await readMarketingOptIn(store, user.id);
    return {
      name: user.name,
      phone: user.phone,
      email: user.email,
      pendingEmail: user.pendingEmail,
      marketingOptIn,
    };
  }

  async function updateOwnProfile(
    actor: Actor,
    input: { name: string; phone: string | null },
  ): Promise<UpdateProfileResult> {
    const name = input.name.trim();
    if (!name) {
      return { ok: false, reason: "INVALID_INPUT" };
    }
    const phone = input.phone?.trim() || null;

    const before = await store.user.findUnique({ where: { id: actor.userId } });
    const after = await store.user.update({
      where: { id: actor.userId },
      data: { name, phone },
    });

    await audit({
      actorId: actor.userId,
      action: "user.profile_updated",
      targetType: "User",
      targetId: actor.userId,
      before,
      after,
      outcome: "SUCCESS",
      scopeType: "GLOBAL",
      scopeId: null,
    });

    const marketingOptIn = await readMarketingOptIn(store, actor.userId);
    return {
      ok: true,
      profile: {
        name: after.name,
        phone: after.phone,
        email: after.email,
        pendingEmail: after.pendingEmail,
        marketingOptIn,
      },
    };
  }

  async function requestEmailChange(
    actor: Actor,
    input: { currentPassword: string; newEmail: string },
  ): Promise<EmailChangeResult> {
    const user = await store.user.findUnique({ where: { id: actor.userId } });
    if (!user || !user.passwordHash) {
      return EMAIL_CHANGE_STEP_UP_FAILED;
    }

    // D-10 — the step-up gate. Ships before anything is written; a stolen
    // session must not be able to redirect account-recovery to a new address.
    if (!(await verify(input.currentPassword, user.passwordHash))) {
      return EMAIL_CHANGE_STEP_UP_FAILED;
    }

    const newEmail = input.newEmail.toLowerCase().trim();

    if (newEmail === user.email) {
      return EMAIL_CHANGE_ACCEPTED;
    }

    const collision = await store.user.findFirst({ where: { email: newEmail } });
    if (collision) {
      return EMAIL_CHANGE_ACCEPTED;
    }

    // findFirst is how confirmEmailChange resolves the pending account (it
    // must be: pendingEmail carries no @unique — see the design note above
    // requestEmailChange in the plan, and the comment in
    // verification-service.ts's VerificationStore type). findFirst can only
    // ever resolve unambiguously if at most one row holds a given pending
    // address, so clear it from every other row before claiming it here.
    // This is the row-level analogue of D-03 (issueToken already
    // invalidates the prior unconsumed token for this identifier+purpose,
    // so a superseded request's link is already dead — this just makes the
    // User rows agree with the tokens instead of leaving a stale pending
    // address behind that a later findFirst could resolve to the wrong
    // account). The alternative, a unique constraint on the column, was
    // rejected: requestEmailChange has no constraint-violation handling and
    // would surface a database error for a contested address while
    // returning the frozen accepted value for an uncontested one.
    await store.user.updateMany({
      where: { pendingEmail: newEmail },
      data: { pendingEmail: null },
    });

    await store.user.update({
      where: { id: actor.userId },
      data: { pendingEmail: newEmail },
    });

    const issued = await issueToken({
      identifier: newEmail,
      purpose: TOKEN_PURPOSE.EMAIL_CHANGE,
      ttlMs: EMAIL_CHANGE_TOKEN_TTL_MS,
    });

    if (issued.ok) {
      const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
      const confirmUrl = `${baseUrl}/confirm-email-change?token=${issued.token}`;
      // G-03-3 — best-effort: a provider outage must not crash an
      // already-authenticated learner's email-change request.
      await dispatchBestEffort(dispatch, {
        template: "email-change-confirmation",
        toEmail: newEmail,
        userId: actor.userId,
        subject: "Confirm your new email address",
        textContent: buildEmailChangeText(confirmUrl),
      });
      await audit({
        actorId: actor.userId,
        action: "user.email_change_requested",
        targetType: "User",
        targetId: actor.userId,
        outcome: "SUCCESS",
        scopeType: "GLOBAL",
        scopeId: null,
      });
    }

    return EMAIL_CHANGE_ACCEPTED;
  }

  async function confirmEmailChange(token: string): Promise<ConfirmEmailChangeResult> {
    let confirmedUserId: string | null = null;

    const result = await consumeToken(
      { token, purpose: TOKEN_PURPOSE.EMAIL_CHANGE },
      async (tx, row) => {
        // findFirst, not findUnique — pendingEmail carries no @unique (see
        // the comment on VerificationStore's user slice in
        // verification-service.ts). requestEmailChange's clearing write
        // guarantees at most one row can match, so this resolves
        // unambiguously to the account that actually requested the change.
        const user = await tx.user.findFirst({ where: { pendingEmail: row.identifier } });
        if (!user) return;

        // Re-check inside the claim transaction: the address may have been
        // claimed by a registration or another change between the request
        // and this confirmation. Refusing cleanly here beats letting the
        // unique constraint reject the update and surface a database error.
        const collision = await tx.user.findFirst({ where: { email: row.identifier } });
        if (collision) return;

        await tx.user.update({
          where: { id: user.id },
          data: { email: row.identifier, pendingEmail: null, emailVerified: new Date() },
        });
        confirmedUserId = user.id;
      },
    );

    if (!result.ok || !confirmedUserId) {
      return { ok: false };
    }

    await audit({
      actorId: confirmedUserId,
      action: "user.email_changed",
      targetType: "User",
      targetId: confirmedUserId,
      outcome: "SUCCESS",
      scopeType: "GLOBAL",
      scopeId: null,
    });

    return { ok: true };
  }

  async function setMarketingPreference(actor: Actor, accepted: boolean): Promise<{ ok: true }> {
    const existing = await store.policyAcceptance.findFirst({
      where: { userId: actor.userId, policyType: POLICY_TYPE.MARKETING },
    });

    if (existing) {
      await store.policyAcceptance.update({
        where: { id: existing.id },
        data: { accepted, version: POLICY_VERSIONS[POLICY_TYPE.MARKETING] },
      });
    } else {
      await store.policyAcceptance.create({
        data: {
          userId: actor.userId,
          policyType: POLICY_TYPE.MARKETING,
          version: POLICY_VERSIONS[POLICY_TYPE.MARKETING],
          accepted,
          orderId: null,
        },
      });
    }

    await audit({
      actorId: actor.userId,
      action: "user.marketing_preference_updated",
      targetType: "User",
      targetId: actor.userId,
      after: { marketingOptIn: accepted },
      outcome: "SUCCESS",
      scopeType: "GLOBAL",
      scopeId: null,
    });

    return { ok: true };
  }

  return {
    getOwnProfile,
    updateOwnProfile,
    requestEmailChange,
    confirmEmailChange,
    setMarketingPreference,
  };
}

export const profileService = createProfileService({
  store: prisma as unknown as ProfileStore,
  issueToken: (params) => verificationService.issueToken(params),
  consumeToken: (params, apply) => verificationService.consumeToken(params, apply),
  dispatch: (params) => emailDispatchService.dispatch(params),
  audit: recordAudit,
});
