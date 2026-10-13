/**
 * The shared real-Postgres drain fixture every Phase 13 drain integration
 * test reuses (13-07 onward). `startDrainHarness(db)` wires a real
 * `domainEventDrainService` bound to the injected `PrismaClient`, the real
 * `renderEmail`/template registry, and a `send` spy that never contacts
 * Brevo — every send resolves immediately with a stub provider id, exactly
 * like `EMAIL_TRANSPORT=stub` at runtime, but observable by the test.
 *
 * Env vars are set here (never in the test files themselves) so every test
 * that imports this harness gets the same, valid email identity — Brevo is
 * never actually contacted, live or otherwise (`EMAIL_TRANSPORT=stub`, and
 * `send` here bypasses `sendTransactionalEmail` entirely regardless).
 */

import { vi } from "vitest";
import type { PrismaClient, User } from "@prisma/client";
import {
  createEmailDispatchService,
  createPrismaEmailDispatchStore,
} from "@/server/services/email-dispatch-service";
import { renderEmail } from "@/server/email/templates/registry";
import { describeBrevoFailure, classifyBrevoFailure } from "@/server/email/brevo-client";
import {
  createDomainEventDrainService,
  type DrainAuditEvent,
} from "@/server/services/domain-event-drain-service";
import { buildMapperTable, EVENT_MAPPER_GROUPS } from "@/server/services/event-intent-mappers";
import { writeDomainEvent, type DomainEventType } from "@/server/services/domain-event-service";

export function startDrainHarness(db: PrismaClient) {
  process.env.EMAIL_SENDER_NAME = "Drain Harness Academy";
  process.env.EMAIL_SENDER_ADDRESS = "no-reply@drain-harness.test";
  process.env.SUPPORT_CONTACT_EMAIL = "help@drain-harness.test";
  process.env.APP_BASE_URL = "https://lms.drain-harness.test";
  process.env.EMAIL_TRANSPORT = "stub";

  const sendCalls: { to: string }[] = [];
  const send = vi.fn(async (params: { to: string }) => {
    sendCalls.push({ to: params.to });
    return { providerMessageId: `stub-msg-${sendCalls.length}` };
  });

  const store = createPrismaEmailDispatchStore(db);
  const dispatchService = createEmailDispatchService({
    store,
    send,
    describeFailure: describeBrevoFailure,
    classifyFailure: classifyBrevoFailure,
    render: renderEmail,
  });

  const mapperTable = buildMapperTable(EVENT_MAPPER_GROUPS);
  const auditSpy = vi.fn(async (event: DrainAuditEvent) => {
    void event;
  });

  const drainService = createDomainEventDrainService({
    db,
    mapperTable,
    sendQueued: (params) => dispatchService.sendQueued(params),
    audit: auditSpy,
  });

  return { db, drainService, dispatchService, mapperTable, send, sendCalls, auditSpy };
}

let learnerCounter = 0;

/** Creates an ACTIVE, verified learner — the happy-path recipient every
 * mapper's fan-out ultimately mails and notifies. */
export async function seedVerifiedLearner(
  db: PrismaClient,
  overrides: Partial<{ email: string; name: string }> = {},
): Promise<User> {
  learnerCounter += 1;
  return db.user.create({
    data: {
      email: overrides.email ?? `learner-${Date.now()}-${learnerCounter}@drain-harness.test`,
      name: overrides.name ?? "Drain Harness Learner",
      status: "ACTIVE",
      emailVerified: new Date(),
    },
  });
}

let staffCounter = 0;

/** Creates an ACTIVE staff user holding a GLOBAL-scope role with exactly the
 * given permissions — mirrors `tests/staff-support.integration.test.ts`'s
 * `makeStaff` pattern so later plans' staff-alert mappers can seed a holder
 * of `tickets.manage`, `payments.view`, etc. without inventing a second
 * fixture. Passing no grants creates a plain staff user with no assignment. */
export async function seedStaffUser(db: PrismaClient, grants: string[] = []): Promise<User> {
  staffCounter += 1;
  const user = await db.user.create({
    data: {
      email: `staff-${Date.now()}-${staffCounter}@drain-harness.test`,
      name: "Drain Harness Staff",
      status: "ACTIVE",
      emailVerified: new Date(),
      isStaff: true,
    },
  });
  if (grants.length > 0) {
    const role = await db.role.create({
      data: { name: `DrainHarnessRole-${staffCounter}`, permissions: grants },
    });
    await db.assignment.create({
      data: { userId: user.id, roleId: role.id, scopeType: "GLOBAL", active: true },
    });
  }
  return user;
}

/**
 * Writes a `DomainEvent` through the real `writeDomainEvent` sink, inside a
 * transaction, and hands back the created row. `occurredAt` defaults to
 * "now" but is always resolved to a concrete value BEFORE the write, so the
 * read-back `findFirstOrThrow({ type, occurredAt })` inside the same
 * transaction is an exact match, not a "most recent" guess — callers seeding
 * several events of the same type in a loop should pass distinct
 * `occurredAt` values (e.g. offset by index) to keep this exact.
 */
export async function writeEvent(
  db: PrismaClient,
  type: DomainEventType,
  payload: Record<string, unknown>,
  occurredAt: Date = new Date(),
) {
  return db.$transaction(async (tx) => {
    await writeDomainEvent(tx, { type, payload, occurredAt });
    return tx.domainEvent.findFirstOrThrow({ where: { type, occurredAt } });
  });
}
