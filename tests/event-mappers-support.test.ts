/**
 * Pure unit coverage for the support-ticket mapper group (D-07, D-16,
 * T-13-03) against a fake transaction client — no database needed for the
 * pure branching logic; the real Postgres proof of the drain actually
 * persisting these intents (and the TICKET_UPDATES mute effect / always-sent
 * ticket-created behaviour) lives in `tests/support-drain.integration.test.ts`.
 *
 * Mappers are looked up through `buildMapperTable(EVENT_MAPPER_GROUPS)` —
 * the same path production code and `tests/support/drain-harness.ts` use —
 * rather than importing `support.ts` directly (see
 * `tests/event-mappers-enrolment-payment.test.ts` for the module-cycle
 * rationale).
 */

import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import {
  buildMapperTable,
  EVENT_MAPPER_GROUPS,
  type DrainEvent,
  type EventMapper,
  type MapperContext,
} from "@/server/services/event-intent-mappers";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const mapperTable = buildMapperTable(EVENT_MAPPER_GROUPS);

function requireOneMapper(type: DrainEvent["type"]): EventMapper {
  const mappers = mapperTable[type];
  expect(mappers).toHaveLength(1);
  return mappers[0]!;
}

function makeCtx(ticketFindUnique?: (args: unknown) => Promise<unknown>): MapperContext {
  return {
    tx: {
      ticket: { findUnique: ticketFindUnique ?? (async () => null) },
    } as unknown as Prisma.TransactionClient,
    now: () => NOW,
  };
}

function makeEvent(
  type: DrainEvent["type"],
  payload: Record<string, unknown>,
  id = "evt-1",
): DrainEvent {
  return { id, type, payload, occurredAt: NOW };
}

describe("createSupportMappers registration", () => {
  it("registers exactly one mapper for every event type in this group", () => {
    for (const type of [
      "ticket.public_reply_added",
      "ticket.created",
      "ticket.resolved",
      "ticket.reopened",
      "ticket.closed",
    ] as const) {
      expect(mapperTable[type]).toHaveLength(1);
    }
  });
});

describe("ticket.public_reply_added (Plan 07 precedent)", () => {
  it("mails the recipient the reply template and a ticket.reply notification", async () => {
    const mapper = requireOneMapper("ticket.public_reply_added");
    const intents = await mapper(
      makeEvent("ticket.public_reply_added", {
        ticketId: "ticket-1",
        reference: "KQT-1",
        recipientId: "user-1",
      }),
      makeCtx(),
    );
    expect(intents).toHaveLength(1);
    expect(intents[0]!.email).toEqual({
      template: "ticket-reply",
      params: { reference: "KQT-1", ticketPath: "/support/KQT-1" },
      correlationId: "evt-1",
    });
    expect(intents[0]!.notification!.type).toBe("ticket.reply");
  });
});

describe("ticket.created (D-07)", () => {
  it("mails the requester the created confirmation and a ticket.created notification", async () => {
    const mapper = requireOneMapper("ticket.created");
    const intents = await mapper(
      makeEvent("ticket.created", {
        ticketId: "ticket-2",
        reference: "KQT-2",
        requesterId: "user-2",
      }),
      makeCtx(),
    );
    expect(intents).toHaveLength(1);
    expect(intents[0]!.recipientUserId).toBe("user-2");
    expect(intents[0]!.email).toEqual({
      template: "ticket-created",
      params: { reference: "KQT-2", ticketPath: "/support/KQT-2" },
      correlationId: "evt-1",
    });
    expect(intents[0]!.notification).toEqual({
      type: "ticket.created",
      targetType: "LEARNER_TICKET",
      targetId: "KQT-2",
      params: { reference: "KQT-2" },
    });
  });

  it("hostile extra payload keys are never copied into params", async () => {
    const mapper = requireOneMapper("ticket.created");
    const intents = await mapper(
      makeEvent("ticket.created", {
        ticketId: "ticket-2b",
        reference: "KQT-2B",
        requesterId: "user-2b",
        subject: "SECRET-SUBJECT-LINE",
        category: "SECRET-CATEGORY",
      }),
      makeCtx(),
    );
    expect(JSON.stringify(intents)).not.toContain("SECRET-SUBJECT-LINE");
    expect(JSON.stringify(intents)).not.toContain("SECRET-CATEGORY");
  });
});

describe("ticket.resolved (D-07)", () => {
  it("mails the requester the resolved template and a ticket.resolved notification", async () => {
    const mapper = requireOneMapper("ticket.resolved");
    const intents = await mapper(
      makeEvent("ticket.resolved", {
        ticketId: "ticket-3",
        reference: "KQT-3",
        requesterId: "user-3",
      }),
      makeCtx(),
    );
    expect(intents).toHaveLength(1);
    expect(intents[0]!.email!.template).toBe("ticket-resolved");
    expect(intents[0]!.notification!.type).toBe("ticket.resolved");
  });

  it("never leaks a hostile staff reason present on the payload", async () => {
    const mapper = requireOneMapper("ticket.resolved");
    const intents = await mapper(
      makeEvent("ticket.resolved", {
        ticketId: "ticket-3b",
        reference: "KQT-3B",
        requesterId: "user-3b",
        reason: "SECRET-RESOLUTION-REASON",
      }),
      makeCtx(),
    );
    expect(JSON.stringify(intents)).not.toContain("SECRET-RESOLUTION-REASON");
  });
});

describe("ticket.closed (D-07)", () => {
  it("mails the requester the closed template and a ticket.closed notification", async () => {
    const mapper = requireOneMapper("ticket.closed");
    const intents = await mapper(
      makeEvent("ticket.closed", {
        ticketId: "ticket-4",
        reference: "KQT-4",
        requesterId: "user-4",
      }),
      makeCtx(),
    );
    expect(intents).toHaveLength(1);
    expect(intents[0]!.email!.template).toBe("ticket-closed");
    expect(intents[0]!.notification!.type).toBe("ticket.closed");
  });

  it("mails the requester the same way whether staff or the auto-close job closed it (payload shape is identical)", async () => {
    const mapper = requireOneMapper("ticket.closed");
    const intents = await mapper(
      makeEvent("ticket.closed", {
        ticketId: "ticket-4b",
        reference: "KQT-4B",
        requesterId: "user-4b",
      }),
      makeCtx(),
    );
    expect(intents).toHaveLength(1);
    expect(intents[0]!.recipientUserId).toBe("user-4b");
  });
});

describe("ticket.reopened (D-07, A-04)", () => {
  it("resolves the requester and reference from the Ticket row, not the payload", async () => {
    const mapper = requireOneMapper("ticket.reopened");
    const ctx = makeCtx(async () => ({ userId: "user-5", reference: "KQT-5" }));
    const intents = await mapper(
      makeEvent("ticket.reopened", { ticketId: "ticket-5", ownerId: "assignee-9" }),
      ctx,
    );
    expect(intents).toHaveLength(1);
    expect(intents[0]!.recipientUserId).toBe("user-5");
    expect(intents[0]!.email).toEqual({
      template: "ticket-reopened",
      params: { reference: "KQT-5", ticketPath: "/support/KQT-5" },
      correlationId: "evt-1",
    });
    expect(intents[0]!.notification).toEqual({
      type: "ticket.reopened",
      targetType: "LEARNER_TICKET",
      targetId: "KQT-5",
      params: { reference: "KQT-5" },
    });
  });

  it("still yields one intent for the requester when payload ownerId is null (A-04)", async () => {
    const mapper = requireOneMapper("ticket.reopened");
    const ctx = makeCtx(async () => ({ userId: "user-6", reference: "KQT-6" }));
    const intents = await mapper(
      makeEvent("ticket.reopened", { ticketId: "ticket-6", ownerId: null }),
      ctx,
    );
    expect(intents).toHaveLength(1);
    expect(intents[0]!.recipientUserId).toBe("user-6");
  });

  it("returns no intents when the ticket row does not exist (edge)", async () => {
    const mapper = requireOneMapper("ticket.reopened");
    const ctx = makeCtx(async () => null);
    const intents = await mapper(
      makeEvent("ticket.reopened", { ticketId: "gone", ownerId: null }),
      ctx,
    );
    expect(intents).toEqual([]);
  });
});
