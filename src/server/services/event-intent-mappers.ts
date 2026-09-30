/**
 * The pure event -> intent transform layer the drain runs (COM-01).
 *
 * A mapper never touches Brevo, never sends anything, and never decides
 * whether a recipient should actually receive the mail — it only says WHAT
 * would be sent/notified for a given event, from the event's own payload plus
 * whatever it needs to look up inside the SAME transaction the drain already
 * opened (`MapperContext.tx`). Recipient-state gating (deactivated,
 * unverified, muted) and poison-event handling both live in
 * `domain-event-drain-service.ts`, one layer up.
 *
 * `buildMapperTable` is exhaustive over `DomainEventType` — every member of
 * `DOMAIN_EVENT_TYPE_LIST` gets an entry (an empty array when nothing is
 * registered for it, meaning "process silently, no output"). A future
 * `DomainEventType` addition that nobody wires a mapper for still gets a
 * table entry automatically; it is not a compile error to leave a type
 * unmapped, only to omit it from the table entirely, which
 * `DOMAIN_EVENT_TYPE_LIST` iteration makes impossible.
 *
 * This file lives under `src/server/services/**`, so importing `@prisma/client`
 * for the transaction-client type is within the ESLint import boundary.
 */

import type { Prisma } from "@prisma/client";
import type { DomainEventType } from "@/server/services/domain-event-service";
import type {
  NotificationTargetType,
  NotificationType,
  SkipReason,
  TemplateId,
} from "@/server/communications/contracts";
import { DOMAIN_EVENT_TYPE_LIST } from "@/server/communications/contracts";
import { createSupportMappers } from "@/server/services/event-mappers/support";
import { createEnrolmentPaymentMappers } from "@/server/services/event-mappers/enrolment-payment";
import { createEnrolmentSessionMappers } from "@/server/services/event-mappers/enrolment-session";
import { createLearningMappers } from "@/server/services/event-mappers/learning";
import { createStaffMappers } from "@/server/services/event-mappers/staff";

/** The minimal, already-loaded shape of a claimed `DomainEvent` row a mapper
 * needs. Never the raw Prisma row — payload is narrowed to a plain record. */
export type DrainEvent = {
  id: string;
  type: DomainEventType;
  payload: Record<string, unknown>;
  occurredAt: Date;
};

/** What a mapper is handed alongside the event: the SAME transaction client
 * the drain's own claim/write work runs in (so a mapper's lookups commit or
 * roll back atomically with everything else), and a clock function so a
 * mapper never calls `new Date()` directly (D-12 coalescing needs the same
 * "now" the drain used). */
export type MapperContext = {
  tx: Prisma.TransactionClient;
  now: () => Date;
};

/**
 * One outcome of mapping an event: a recipient, an optional email intent
 * (template + allow-listed params + the dedup correlation key) and/or an
 * optional in-product notification intent, plus an optional mapper-level
 * skip reason (D-04/D-12 superseding, coalescing) that overrides recipient
 * gating entirely.
 *
 * `email.params` and `notification.params` are ALWAYS explicit allow-listed
 * fields a mapper builds by hand — never a spread of the event payload
 * (T-13-03).
 */
export type EventIntent = {
  recipientUserId: string;
  email?: {
    template: TemplateId;
    params: Record<string, unknown>;
    correlationId: string;
  };
  notification?: {
    type: NotificationType;
    targetType: NotificationTargetType;
    targetId: string;
    params: Record<string, string | number>;
  };
  /** Set by the mapper itself (e.g. "this update was coalesced into a later
   * one") — distinct from the drain's own recipient-state gating, but
   * produces the identical SKIPPED-dispatch/no-notification outcome. */
  skipReason?: SkipReason;
};

/** A mapper for exactly one `DomainEventType`. Returns zero or more intents
 * (fan-out to several recipients from one event). Never throws for a
 * business reason it can recover from — a thrown error takes the event down
 * the poison path (D-04), so a mapper should only throw for a genuinely
 * malformed payload (`MalformedEventError`) or an unexpected lookup failure. */
export type EventMapper = (
  event: DrainEvent,
  ctx: MapperContext,
) => Promise<EventIntent[]>;

/** A named bundle of mappers for a subsystem's event types — one file like
 * `event-mappers/support.ts` per subsystem, composed together below. */
export type MapperGroup = Partial<Record<DomainEventType, EventMapper>>;

/** Thrown by `requireString` (and any mapper) for a payload that does not
 * have the shape a mapper expects. Caught by the drain as an ordinary
 * mapping failure — the event's own attempt count increments and it takes
 * the poison path after `MAX_EVENT_ATTEMPTS`, exactly like any other thrown
 * error (D-04). A payload is server-written, but "server-written" does not
 * mean "never malformed": validate anyway. */
export class MalformedEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedEventError";
  }
}

/** Reads a required string field off an event payload, or throws
 * `MalformedEventError` for a missing or non-string value. The one place
 * every mapper reads a payload field through, so a malformed row always
 * fails the same, recognisable way. */
export function requireString(
  payload: Record<string, unknown>,
  key: string,
): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new MalformedEventError(
      `Missing or invalid required field "${key}" on event payload.`,
    );
  }
  return value;
}

/**
 * Merges a list of `MapperGroup`s into one table with an entry for EVERY
 * `DomainEventType` member — never a partial object a lookup could silently
 * miss. A type with nothing registered maps to an empty array (processed
 * with no output); a type registered by more than one group fans out to
 * every mapper that claims it, in group order.
 */
export function buildMapperTable(
  groups: MapperGroup[],
): Record<DomainEventType, EventMapper[]> {
  const table = {} as Record<DomainEventType, EventMapper[]>;
  for (const type of DOMAIN_EVENT_TYPE_LIST) {
    table[type] = [];
  }
  for (const group of groups) {
    for (const entry of Object.entries(group) as [DomainEventType, EventMapper][]) {
      const [type, mapper] = entry;
      table[type] = [...table[type], mapper];
    }
  }
  return table;
}

/**
 * Every mapper group this phase registers. Plan 07 registers the support
 * group's one live mapper (`ticket.public_reply_added`); Plan 08 adds the
 * enrolment/payment group (`enrolment.activated`, `enrolment.approved`,
 * `order.exception`, `payment.failed`, `payment.refunded`); Plan 09 adds the
 * enrolment-session group (`enrolment.withdrawn`, `enrolment.cancelled`,
 * `enrolment.transferred`, `session.cancelled`, `session.updated`,
 * `cohort.cancelled`); Plans 10-11 append their own groups here as they are
 * built. The live drain singleton builds its table from exactly this list via
 * `buildMapperTable(EVENT_MAPPER_GROUPS)`. Plan 10 adds the learning group
 * (`grade.released`, `grade.overridden`, `certificate.issued`,
 * `certificate.revoked`, `certificate.reissued`) and extends the support
 * group with the remaining learner-facing ticket events. Plan 11 adds the
 * staff group (`ticket.created`, `ticket.assigned`, `ticket.escalated`,
 * `order.exception`, `payment.reconciliation_exception`,
 * `submission.created`) — `order.exception` is now mapped by BOTH the
 * enrolment-payment group (learner mail, `illegal_transition` only) and the
 * staff group (every reason), fanning out to both when both apply.
 */
export const EVENT_MAPPER_GROUPS: MapperGroup[] = [
  createSupportMappers(),
  createEnrolmentPaymentMappers(),
  createEnrolmentSessionMappers(),
  createLearningMappers(),
  createStaffMappers(),
];
