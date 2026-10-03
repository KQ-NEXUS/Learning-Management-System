/**
 * Licence notice emitter (Phase 14, plan 14-14; LIC-07, D-10, D-15).
 *
 * `emitNotices` turns the notice keys a licence evaluation reports into
 * deduplicated `licence.notice` domain events. Each event id is deterministic,
 * `licence:{licenceId or none}:{noticeKey}`, and is written through
 * `writeDomainEventOnce` (createMany with skipDuplicates), so emitting the same
 * key for the same licence twice writes one event and never aborts the caller's
 * transaction. The Phase 13 drain turns each event into one in-product
 * notification and, except for `expiring-60`, one email per recipient; its own
 * unique layers (Notification recipient + type + sourceEventId, EmailDispatch
 * template + correlationId) are a second and third dedupe. A replacement
 * licence has a new licence id, so its notices renew.
 *
 * Content rule (LIC-07, prohibition P5): the payload is built field by field
 * from an allow-list: licence ID, notice key, state name, preformatted display
 * labels and a day count. Raw licence text, signature, key ID, client or
 * contract detail and the deployment ID never enter an event.
 *
 * Closure rule (D-01): this module is reachable from the scheduled-task
 * closure, so it imports nothing from `next/*`, the permission layer or
 * `getCurrentActor`.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { formatLicenceInstant } from "@/server/licence/display";
import { isKnownNoticeKey } from "@/server/licence/policy";
import type { LicenceStatusSnapshot } from "@/server/licence/types";
import {
  writeDomainEventOnce,
  type DomainEventCreateManyClient,
} from "@/server/services/domain-event-service";

/** The licence id used in an event id when no licence has been activated. */
const NO_LICENCE_ID = "none";

const EXPIRING_BUCKET = /^expiring-(\d{1,3})$/;
const INVALID_CODE = /^invalid-([A-Z_]{1,40})$/;

export type EmitNoticesResult = {
  /** Event ids written by this call. */
  created: string[];
  /** Event ids that already existed (a repeat of an earlier notice). */
  skipped: string[];
};

export type LicenceNoticeServiceDeps = {
  db: DomainEventCreateManyClient;
  now?: () => Date;
};

/** A day count as the short string the notice copy accepts, or null. */
function dayString(value: number | null): string | null {
  return value !== null && Number.isInteger(value) && value >= 0 && value <= 999
    ? String(value)
    : null;
}

/**
 * Builds the event payload field by field. Nothing is spread from the
 * snapshot, so a new snapshot member can never leak into an event.
 */
function buildPayload(
  snapshot: LicenceStatusSnapshot,
  noticeKey: string,
): Record<string, string> {
  const payload: Record<string, string> = {
    licenceId: snapshot.licenceId ?? NO_LICENCE_ID,
    noticeKey,
    state: snapshot.state,
  };

  const expiring = EXPIRING_BUCKET.exec(noticeKey);
  const days =
    expiring !== null
      ? expiring[1]
      : noticeKey === "grace-ending"
        ? dayString(snapshot.daysToGraceEnd)
        : null;
  if (days !== null) payload.days = days;

  if (snapshot.expiresAt !== null) {
    payload.expiry = formatLicenceInstant(snapshot.expiresAt, snapshot.timeZone);
  }
  if (snapshot.graceEndsAt !== null) {
    payload.graceEnd = formatLicenceInstant(snapshot.graceEndsAt, snapshot.timeZone);
  }

  const invalid = INVALID_CODE.exec(noticeKey);
  if (invalid !== null) payload.reasonCode = invalid[1];

  return payload;
}

export function createLicenceNoticeService(deps: LicenceNoticeServiceDeps) {
  const now = deps.now ?? (() => new Date());

  /**
   * Writes one deduplicated event per notice key. An unknown key rejects the
   * whole call before anything is written (T-14-14-04); an empty list writes
   * nothing.
   */
  async function emitNotices(input: {
    snapshot: LicenceStatusSnapshot;
    noticeKeys: string[];
  }): Promise<EmitNoticesResult> {
    const { snapshot, noticeKeys } = input;
    for (const noticeKey of noticeKeys) {
      if (!isKnownNoticeKey(noticeKey)) {
        throw new Error("Unknown licence notice key.");
      }
    }

    const result: EmitNoticesResult = { created: [], skipped: [] };
    const occurredAt = now();
    for (const noticeKey of noticeKeys) {
      const id = `licence:${snapshot.licenceId ?? NO_LICENCE_ID}:${noticeKey}`;
      const written = await writeDomainEventOnce(deps.db, {
        id,
        type: "licence.notice",
        payload: buildPayload(snapshot, noticeKey),
        occurredAt,
      });
      (written ? result.created : result.skipped).push(id);
    }
    return result;
  }

  return { emitNotices };
}

/**
 * Adapts a Prisma client to the structural `DomainEventCreateManyClient` the
 * once-only writer takes. The row is already redacted and shaped by
 * `buildDomainEventRow`; this is the one place it is narrowed to Prisma's input type.
 */
export function prismaCreateManyClient(db: {
  domainEvent: {
    createMany(args: Prisma.DomainEventCreateManyArgs): Promise<{ count: number }>;
  };
}): DomainEventCreateManyClient {
  return {
    domainEvent: {
      createMany: (args) =>
        db.domainEvent.createMany({
          data: args.data as unknown as Prisma.DomainEventCreateManyInput[],
          skipDuplicates: args.skipDuplicates,
        }),
    },
  };
}

export const licenceNoticeService = createLicenceNoticeService({ db: prismaCreateManyClient(prisma) });
