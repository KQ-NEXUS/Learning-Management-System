/**
 * The licence mapper group (Phase 14, plan 14-14; LIC-07, D-15, prohibition
 * P5): `licence.notice` becomes one in-product notification for every active
 * staff member holding a Global `licence.view` grant, and, except for the
 * `expiring-60` heads-up, one staff email.
 *
 * Recipients come only from `resolveStaffHolders` with an empty scope, so a
 * learner, a staff member without the permission and a deactivated staff
 * member are never notified. Text comes from the closed `noticeCopy` set; the
 * notification and email params are built field by field and never spread from
 * the payload, so no signing, key, contract or deployment detail can reach a
 * recipient (T-14-14-02). An unknown or missing notice key is a malformed
 * event: it takes the drain's poison path and never produces a notification
 * (T-14-14-04).
 */

import {
  MalformedEventError,
  requireString,
  type EventMapper,
  type MapperGroup,
} from "@/server/services/event-intent-mappers";
import { buildCorrelationId } from "@/server/communications/contracts";
import { LICENCE_PATH } from "@/server/communications/links";
import { isKnownNoticeKey, noticeCopy } from "@/server/licence/policy";
import { resolveStaffHolders } from "@/server/services/staff-recipient-service";

/** The one notice that is in-product only (UI-SPEC: early heads-up, no email). */
const NOTIFICATION_ONLY_KEY = "expiring-60";

/** The licence id used when no licence was ever activated. */
const NO_LICENCE_ID = "none";

function optionalString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

const licenceNoticeMapper: EventMapper = async (event, ctx) => {
  const noticeKey = requireString(event.payload, "noticeKey");
  if (!isKnownNoticeKey(noticeKey)) {
    throw new MalformedEventError("Unknown licence notice key on event payload.");
  }

  const licenceId = optionalString(event.payload, "licenceId") ?? NO_LICENCE_ID;
  const days = optionalString(event.payload, "days");
  const expiry = optionalString(event.payload, "expiry");
  const graceEnd = optionalString(event.payload, "graceEnd");

  const copy = noticeCopy(noticeKey, { days, expiry, graceEnd });

  const params: Record<string, string> = { noticeKey };
  if (days !== null) params.days = days;
  if (expiry !== null) params.expiry = expiry;
  if (graceEnd !== null) params.graceEnd = graceEnd;

  const holderIds = await resolveStaffHolders(ctx.tx, {
    permission: "licence.view",
    scope: {},
  });

  return holderIds.map((holderId) => ({
    recipientUserId: holderId,
    ...(noticeKey === NOTIFICATION_ONLY_KEY
      ? {}
      : {
          email: {
            template: "staff-licence-notice" as const,
            params: {
              headline: copy.emailHeadline,
              detail: copy.emailDetail,
              licencePath: LICENCE_PATH,
            },
            correlationId: buildCorrelationId(event.id, holderId),
          },
        }),
    notification: {
      type: "staff.licence_notice" as const,
      targetType: "STAFF_LICENCE" as const,
      targetId: licenceId,
      params: { ...params },
    },
  }));
};

export function createLicenceMappers(): MapperGroup {
  return {
    "licence.notice": licenceNoticeMapper,
  };
}
