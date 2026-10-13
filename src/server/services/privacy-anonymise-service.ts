/**
 * Learner anonymisation, the write half of the D-12 privacy tool (NFR-11).
 *
 * Staff with `privacy.manage` (Global only, approved in 15-DECISIONS.md) can
 * anonymise one learner account IN PLACE: the person's identifying fields on
 * the `User` row are overwritten, every session is revoked and a short list of
 * ancillary rows is removed. The `User` row itself is never deleted, and orders,
 * payment records, enrolments, grades, completion records, certificates,
 * tickets, submissions, policy acceptances and audit events are left exactly as
 * they were (P3). Hard deletion stays blocked until the owner approves a
 * retention schedule and a legal-hold process; `tests/privacy-no-hard-delete.test.ts`
 * enforces that mechanically for every `privacy-*.ts` service.
 *
 * `ANONYMISE_POLICY` is the single description of what changes, what is removed
 * and what is kept. The staff privacy screen (plan 15-22) renders it, so the
 * screen cannot drift from what this service does; the integration test pins
 * the service's behaviour to the same lists.
 *
 * The action is a licence "write" (blocked in restricted continuity mode) and
 * is audited as `privacy.learner_anonymised` with actor, target, reason, outcome
 * and correlationId. The audit row holds SHA-256 hashes of the old email and
 * name, never the text itself, so the audit log does not keep what the tool
 * erased.
 */

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { requestCorrelationId } from "@/server/auth/request-context";
import { withPermission } from "@/server/permissions";
import type { createWithPermission } from "@/server/permissions/with-permission";
import { recordAuditInTransaction, type BusinessAuditEvent } from "@/server/services/audit-service";

type WithPermission = ReturnType<typeof createWithPermission>;

/** The name every anonymised account carries. */
export const ANONYMISED_NAME = "Anonymised learner";

/** Fewest characters a staff member's reason may have (after trimming). */
export const MIN_ANONYMISE_REASON_LENGTH = 20;

/** The unique, unroutable address an anonymised account is given. */
export function anonymisedEmailFor(userId: string): string {
  return `anonymised-${userId}@invalid.example`;
}

/**
 * What anonymisation changes, removes and keeps, in plain language. One constant
 * drives the service description, the staff screen's "What changes" and "What is
 * kept" lists, and the launch checklist (15-DECISIONS.md, retention parameters).
 */
export const ANONYMISE_POLICY: {
  readonly changes: readonly string[];
  readonly removes: readonly string[];
  readonly keeps: readonly string[];
} = Object.freeze({
  changes: Object.freeze([
    `Name becomes "${ANONYMISED_NAME}"`,
    "Email address becomes a unique placeholder that cannot receive mail",
    "Phone number is cleared",
    "Any pending email change is cleared",
    "Password is cleared, so nobody can sign in to the account",
    "Account status becomes Deactivated",
    "Every signed-in session is ended",
  ]),
  removes: Object.freeze([
    "Email preferences",
    "In-app notifications",
    "Verification tokens for the old email address",
    "Sign-in attempt counters for the old email address",
  ]),
  keeps: Object.freeze([
    "Orders",
    "Payment attempts",
    "Refunds",
    "Payment webhook events",
    "Enrolments",
    "Attendance",
    "Grades",
    "Completion records",
    "Certificates, including the printed learner name, so issued credentials stay verifiable",
    "Support tickets and their attachments",
    "Submissions",
    "The learner number",
    "Policy acceptances",
    "Audit events (the audit log is append-only and is never rewritten)",
  ]),
});

/**
 * Refusal for every case the caller must not be able to tell apart: a reason
 * that is too short, an unknown id, a staff account and an account that is
 * already anonymised. One message, so the tool is not an oracle for which ids
 * exist or who is staff.
 */
export class AnonymiseNotAllowedError extends Error {
  constructor() {
    super("This account cannot be anonymised.");
    this.name = "AnonymiseNotAllowedError";
  }
}

/**
 * The account changed between the check and the write (two staff members
 * anonymising the same learner at once). Nothing was changed by the losing call.
 */
export class AnonymiseConflictError extends Error {
  constructor() {
    super("The account changed while it was being anonymised. Reload and check its status.");
    this.name = "AnonymiseConflictError";
  }
}

/** The narrow slice of persistence this service uses. */
export type PrivacyAnonymiseStore = {
  $transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
};

export type AnonymiseLearnerInput = { userId: string; reason: string };

export type AnonymiseLearnerResult = { userId: string; anonymisedAt: Date };

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createPrivacyAnonymiseService(deps: {
  store: PrivacyAnonymiseStore;
  withPermission: WithPermission;
  /** Writes the audit row inside the anonymising transaction. */
  auditInTransaction?: (tx: Prisma.TransactionClient, event: BusinessAuditEvent) => Promise<void>;
  /** Ties the audit row to the request log. */
  correlationId?: () => Promise<string>;
  now?: () => Date;
}) {
  const { store, withPermission: authorize } = deps;
  const writeAudit = deps.auditInTransaction ?? recordAuditInTransaction;
  const correlationId = deps.correlationId ?? requestCorrelationId;
  const now = deps.now ?? (() => new Date());

  // Global scope: an empty ResourceScope matches only a Global grant, and
  // privacy.manage is Global-only in the catalogue.
  const anonymiseInternal = authorize<AnonymiseLearnerInput>("privacy.manage", () => ({}))(
    async (input, ctx): Promise<AnonymiseLearnerResult> => {
      const reason = input.reason.trim();
      if (reason.length < MIN_ANONYMISE_REASON_LENGTH) throw new AnonymiseNotAllowedError();

      const actorId = ctx.actor.userId;
      const auditCorrelationId = await correlationId();

      return store.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: input.userId },
          select: {
            id: true,
            email: true,
            name: true,
            pendingEmail: true,
            isStaff: true,
            anonymisedAt: true,
            deactivatedAt: true,
            deactivatedById: true,
          },
        });
        if (!user || user.isStaff || user.anonymisedAt !== null) throw new AnonymiseNotAllowedError();

        // A learner who also holds any role assignment is a staff member for
        // this purpose, whatever the isStaff hint says.
        const assignments = await tx.assignment.count({ where: { userId: user.id } });
        if (assignments > 0) throw new AnonymiseNotAllowedError();

        const anonymisedAt = now();

        // Compare-and-set: only the call that still sees anonymisedAt IS NULL
        // writes. A concurrent loser blocks on the row lock, re-evaluates this
        // predicate after the winner commits, and gets a count of 0.
        const updated = await tx.user.updateMany({
          where: { id: user.id, anonymisedAt: null, isStaff: false },
          data: {
            name: ANONYMISED_NAME,
            email: anonymisedEmailFor(user.id),
            phone: null,
            pendingEmail: null,
            passwordHash: null,
            status: "DEACTIVATED",
            deactivatedAt: user.deactivatedAt ?? anonymisedAt,
            deactivatedById: user.deactivatedById ?? actorId,
            anonymisedAt,
            anonymisedById: actorId,
          },
        });
        if (updated.count !== 1) throw new AnonymiseConflictError();

        // Access ends now, not whenever a session cookie would have expired.
        await tx.session.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: anonymisedAt },
        });

        // Ancillary rows the policy lists, and only those.
        const oldAddresses = [user.email, user.pendingEmail].filter((value): value is string => value !== null);
        await tx.account.deleteMany({ where: { userId: user.id } });
        await tx.emailPreference.deleteMany({ where: { userId: user.id } });
        await tx.notification.deleteMany({ where: { recipientId: user.id } });
        await tx.verificationToken.deleteMany({
          where: {
            OR: [
              { userId: user.id },
              ...oldAddresses.map((address) => ({ identifier: { equals: address, mode: "insensitive" as const } })),
            ],
          },
        });
        await tx.loginThrottle.deleteMany({
          where: { email: { equals: user.email, mode: "insensitive" } },
        });

        await writeAudit(tx, {
          actorId,
          action: "privacy.learner_anonymised",
          targetType: "User",
          targetId: user.id,
          scopeType: "GLOBAL",
          scopeId: null,
          // Hashes only: the audit log must not keep what this tool erased.
          before: { emailSha256: sha256Hex(user.email.trim().toLowerCase()), nameSha256: sha256Hex(user.name.trim()) },
          after: { status: "DEACTIVATED", anonymisedAt: anonymisedAt.toISOString() },
          reason,
          outcome: "SUCCESS",
          correlationId: auditCorrelationId,
        });

        return { userId: user.id, anonymisedAt };
      });
    },
  );

  return {
    anonymiseLearner: (input: AnonymiseLearnerInput) => anonymiseInternal(input),
  };
}

export const privacyAnonymiseService = createPrivacyAnonymiseService({
  store: prisma as unknown as PrivacyAnonymiseStore,
  withPermission,
});
