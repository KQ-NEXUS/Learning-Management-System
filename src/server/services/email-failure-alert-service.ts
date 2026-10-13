/**
 * Administrator alert when an email reaches FAILED (D-08, T-13-11, T-13-45).
 *
 * Pass 2 of the drain (`domain-event-drain-service.ts`'s `sendQueued`) marks
 * a dispatch FAILED after its final send attempt. This service turns each
 * such failure into an in-product `staff.email_failed` Notification for
 * every global `audit.view` holder — the people who can open the delivery
 * log — resolved with the SAME drain-safe `resolveStaffHolders` the staff
 * mapper group uses (never the request-scoped permission layer, D-20).
 *
 * It NEVER writes an `EmailDispatch` row and NEVER sends mail: alerting
 * about a failed email must not itself become another email that can fail
 * (T-13-45 — no mail loop). The notification's `params` carry only the
 * template id and an 8-character dispatch reference — never a recipient
 * address, email body, or provider error text (T-13-11).
 *
 * `notifyFailed` never throws: a failure resolving holders or writing the
 * notification is caught and logged so one bad alert can never take down a
 * drain run that is already past Pass 2 (belt-and-suspenders alongside the
 * drain's own `onEmailFailed` try/catch in `domain-event-drain-service.ts`).
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { resolveStaffHolders, type StaffRecipientDb } from "@/server/services/staff-recipient-service";
import type { Permission } from "@/server/permissions/catalogue";

/** The one permission that gates the delivery log (`/staff/email-log`) — the
 * audience this alert exists to reach. */
const AUDIT_VIEW_PERMISSION: Permission = "audit.view";

/** One Pass-2 failure — the exact shape `sendQueued`'s `failed` array carries
 * (`email-dispatch-service.ts`). */
export type EmailFailure = { id: string; template: string; userId: string | null };

/** The narrow client shape this service needs: `resolveStaffHolders`'s own
 * `$queryRaw` requirement (`StaffRecipientDb`) plus `notification.createMany`
 * to write the alert rows. The real `PrismaClient` (or a transaction client)
 * satisfies both; a unit test fakes just these two members. */
export type EmailFailureAlertDb = StaffRecipientDb & {
  notification: {
    createMany(args: {
      data: Prisma.NotificationCreateManyInput[];
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
  };
};

export type CreateEmailFailureAlertServiceDeps = {
  db: EmailFailureAlertDb;
  /** Injectable so a test can assert a caught failure was logged without
   * polluting real console output; defaults to `console.error`. */
  log?: (message: string, error: unknown) => void;
};

/** The last 8 characters of a dispatch id — enough for an administrator to
 * correlate the alert with the delivery log row, never the id in full or any
 * other dispatch detail (T-13-11). */
function dispatchRefFor(dispatchId: string): string {
  return dispatchId.slice(-8);
}

export function createEmailFailureAlertService(deps: CreateEmailFailureAlertServiceDeps) {
  const { db } = deps;
  const log = deps.log ?? ((message: string, error: unknown) => console.error(message, error));

  /**
   * Resolves the global `audit.view` holders and creates one
   * `staff.email_failed` notification per holder for this failed dispatch.
   * `sourceEventId` is the dispatch id (not a `DomainEvent` id — there is no
   * such event for a Pass-2 send failure), which is also the dedup key
   * together with `(recipientId, type)` under the `Notification` table's own
   * unique constraint, so a second call for the same dispatch creates no
   * duplicate row (`skipDuplicates`).
   */
  async function notifyFailed(failure: EmailFailure): Promise<void> {
    try {
      const holderIds = await resolveStaffHolders(db, {
        permission: AUDIT_VIEW_PERMISSION,
        scope: {},
      });
      if (holderIds.length === 0) return;

      const dispatchRef = dispatchRefFor(failure.id);
      const data: Prisma.NotificationCreateManyInput[] = holderIds.map((holderId) => ({
        recipientId: holderId,
        type: "staff.email_failed",
        targetType: "STAFF_EMAIL_LOG",
        targetId: failure.id,
        sourceEventId: failure.id,
        params: { template: failure.template, dispatchRef },
      }));

      await db.notification.createMany({ data, skipDuplicates: true });
    } catch (error) {
      log("[email-failure-alert-service] failed to alert administrators of a failed email dispatch", error);
    }
  }

  return { notifyFailed };
}

export const emailFailureAlertService = createEmailFailureAlertService({ db: prisma });
