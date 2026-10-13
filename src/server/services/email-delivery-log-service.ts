/**
 * Read-only delivery log over `EmailDispatch`, plus an audited Resend (D-06).
 *
 * `listDispatches` is gated on `audit.view` with an empty `ResourceScope`
 * (global only), mirroring `audit-read-service.ts`'s Pattern 1. It never
 * projects `templateParams` — only the stored classification string
 * (`error`/`skipReason`) ever reaches the caller (T-13-11). `resendDispatch`
 * is gated on `users.manage` (also global only) and delegates the actual
 * requeue + audit write to `email-dispatch-service.ts`'s `resend`, which
 * already does the compare-and-set and the same-transaction audit entry
 * (T-13-08). This service adds only the permission gate and the
 * server-enforced reason minimum — eligibility (status, category, stored
 * params, recipient ACTIVE) stays owned by `resend` so there is exactly one
 * place that decides whether a row may be resent.
 */

import { prisma } from "@/server/db";
import { withPermission } from "@/server/permissions";
import type { createWithPermission } from "@/server/permissions/with-permission";
import {
  emailDispatchService,
  ResendNotAllowedError,
  type EmailDispatchRow,
} from "@/server/services/email-dispatch-service";
import { TEMPLATE_CATEGORY, MAX_SEND_ATTEMPTS, TEMPLATE_IDS } from "@/server/communications/contracts";
import type { TemplateId } from "@/server/communications/contracts";

export { ResendNotAllowedError };

type WithPermission = ReturnType<typeof createWithPermission>;

export const EMAIL_LOG_PAGE_LIMIT = 100;

export type EmailDeliveryLogFilter = {
  status?: string | null;
  template?: string | null;
};

/** The projection EmailLogTable renders. Deliberately excludes
 * `templateParams` — it never leaves this service (T-13-11). */
export type EmailDeliveryLogRow = {
  id: string;
  template: string;
  toEmail: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date | null;
  error: string | null;
  skipReason: string | null;
  createdAt: Date;
  sentAt: Date | null;
  isStub: boolean;
  canResend: boolean;
};

/** The narrow slice of the raw EmailDispatch row this service reads. */
export type RawEmailDispatchRow = {
  id: string;
  template: string;
  toEmail: string;
  status: string;
  attempts: number;
  nextAttemptAt: Date | null;
  error: string | null;
  skipReason: string | null;
  createdAt: Date;
  sentAt: Date | null;
  providerMessageId: string | null;
  templateParams: Record<string, unknown> | null;
};

/** The narrow slice of persistence this service actually uses. */
export type EmailDeliveryLogStore = {
  emailDispatch: {
    findMany(args: Record<string, unknown>): Promise<RawEmailDispatchRow[]>;
  };
};

function isKnownTemplate(template: string): template is TemplateId {
  return (TEMPLATE_IDS as readonly string[]).includes(template);
}

/** A row whose provider message id starts with `stub:` was sent through a
 * stub transport left on — surfaced so that is never silently invisible
 * (T-13-14). */
function isStubMessageId(providerMessageId: string | null): boolean {
  return typeof providerMessageId === "string" && providerMessageId.startsWith("stub:");
}

/** Courtesy projection only — `resend`'s own eligibility check (including
 * the recipient's live ACTIVE status) is the real gate; this only decides
 * whether the Resend control renders at all. */
function computeCanResend(row: RawEmailDispatchRow): boolean {
  if (row.status !== "FAILED" && row.status !== "SENT") return false;
  if (row.templateParams === null || row.templateParams === undefined) return false;
  if (!isKnownTemplate(row.template)) return false;
  if (TEMPLATE_CATEGORY[row.template] === "AUTH") return false;
  return true;
}

function toRow(row: RawEmailDispatchRow): EmailDeliveryLogRow {
  return {
    id: row.id,
    template: row.template,
    toEmail: row.toEmail,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: MAX_SEND_ATTEMPTS,
    nextAttemptAt: row.nextAttemptAt,
    error: row.error,
    skipReason: row.skipReason,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
    isStub: isStubMessageId(row.providerMessageId),
    canResend: computeCanResend(row),
  };
}

export function buildEmailDeliveryLogWhere(filter: EmailDeliveryLogFilter): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (filter.status) where.status = filter.status;
  if (filter.template) where.template = filter.template;
  return where;
}

const MIN_RESEND_REASON_LENGTH = 10;

export function createEmailDeliveryLogService(deps: {
  store: EmailDeliveryLogStore;
  withPermission: WithPermission;
  resendDispatch: (params: { dispatchId: string; actorId: string; reason: string }) => Promise<EmailDispatchRow>;
}) {
  const { store, withPermission: authorize, resendDispatch: resend } = deps;

  const listInternal = authorize<EmailDeliveryLogFilter>("audit.view", () => ({}))(
    async (filter) => {
      const where = buildEmailDeliveryLogWhere(filter);
      const rows = await store.emailDispatch.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: EMAIL_LOG_PAGE_LIMIT,
      });
      return rows.map(toRow);
    },
  );

  const resendInternal = authorize<{ dispatchId: string; reason: string }>(
    "users.manage",
    () => ({}),
    { licence: "continuity", reason: "Transactional email resend stays available (D-07)" },
  )(async ({ dispatchId, reason }, ctx) => {
    const trimmed = reason.trim();
    // A reason shorter than the minimum is refused with the exact same
    // generic message as an ineligible row — neither the length gate nor the
    // eligibility gate becomes an oracle a caller can probe (T-13-08).
    if (trimmed.length < MIN_RESEND_REASON_LENGTH) {
      throw new ResendNotAllowedError();
    }
    await resend({ dispatchId, actorId: ctx.actor.userId, reason: trimmed });
  });

  return {
    listDispatches: (filter: EmailDeliveryLogFilter = {}) => listInternal(filter),
    resendDispatch: (params: { dispatchId: string; reason: string }) => resendInternal(params),
  };
}

export const emailDeliveryLogService = createEmailDeliveryLogService({
  store: prisma as unknown as EmailDeliveryLogStore,
  withPermission,
  resendDispatch: (params) => emailDispatchService.resend(params),
});
