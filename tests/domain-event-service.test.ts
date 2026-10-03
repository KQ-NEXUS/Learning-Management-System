import { describe, expect, it } from "vitest";
import {
  buildDomainEventRow,
  writeDomainEvent,
  writeDomainEventOnce,
  type DomainEventCreateManyClient,
  type DomainEventType,
} from "@/server/services/domain-event-service";
import { AUDIT_REDACTED_KEYS } from "@/server/services/audit-service";

/** A minimal fake standing in for a Prisma transaction client — it exposes
 *  only `domainEvent.create`, nothing else. If `writeDomainEvent` ever tried
 *  to open a nested transaction or touch another model, it would throw here. */
function fakeTx() {
  const calls: { data: Record<string, unknown> }[] = [];
  return {
    calls,
    client: {
      domainEvent: {
        create: async (args: { data: Record<string, unknown> }) => {
          calls.push(args);
          return { id: "evt-1" };
        },
      },
    },
  };
}

describe("buildDomainEventRow", () => {
  it("returns type, payload and occurredAt, with processedAt absent", () => {
    const row = buildDomainEventRow({
      type: "enrolment.created",
      payload: { enrolmentId: "e1" },
    });
    expect(row.type).toBe("enrolment.created");
    expect(row.payload).toEqual({ enrolmentId: "e1" });
    expect(row.occurredAt).toBeInstanceOf(Date);
    expect("processedAt" in row).toBe(false);
  });

  it("honours an explicit occurredAt rather than stamping now()", () => {
    const at = new Date("2026-09-04T00:00:00.000Z");
    const row = buildDomainEventRow({
      type: "attendance.changed",
      payload: {},
      occurredAt: at,
    });
    expect(row.occurredAt).toBe(at);
  });

  it("redacts a credential-shaped key anywhere in the payload", () => {
    const row = buildDomainEventRow({
      type: "enrolment.created",
      payload: {
        userId: "u1",
        token: "super-secret",
        nested: { password: "hunter2" },
      },
    });
    const serialized = JSON.stringify(row.payload);
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("hunter2");
    const payload = row.payload as {
      token: string;
      nested: { password: string };
    };
    expect(payload.token).toBe("[redacted]");
    expect(payload.nested.password).toBe("[redacted]");
  });

  it("redacts every key in AUDIT_REDACTED_KEYS", () => {
    for (const key of AUDIT_REDACTED_KEYS) {
      const row = buildDomainEventRow({
        type: "enrolment.created",
        payload: { [key]: "secret-value" },
      });
      expect((row.payload as Record<string, unknown>)[key]).toBe("[redacted]");
    }
  });

  it("leaves a non-credential payload untouched", () => {
    const row = buildDomainEventRow({
      type: "cohort.published",
      payload: { cohortId: "c1", seatsTaken: 3 },
    });
    expect(row.payload).toEqual({ cohortId: "c1", seatsTaken: 3 });
  });

  it.each([
    "order.created",
    "order.paid",
    "order.exception",
    "enrolment.activated",
  ] satisfies DomainEventType[])(
    "type-checks and redacts the payload for the checkout event %s",
    (type) => {
      const row = buildDomainEventRow({
        type,
        payload: { orderId: "o1", token: "super-secret" },
      });
      expect(row.type).toBe(type);
      const payload = row.payload as { orderId: string; token: string };
      expect(payload.orderId).toBe("o1");
      expect(payload.token).toBe("[redacted]");
    },
  );

  it.each([
    "lesson.completed",
    "course.completed",
    "programme.completed",
  ] satisfies DomainEventType[])(
    "type-checks and redacts the payload for the Phase 9 completion event %s (DD-13)",
    (type) => {
      const row = buildDomainEventRow({
        type,
        payload: { enrolmentId: "enr-1", token: "super-secret" },
      });
      expect(row.type).toBe(type);
      const payload = row.payload as { enrolmentId: string; token: string };
      expect(payload.enrolmentId).toBe("enr-1");
      expect(payload.token).toBe("[redacted]");
    },
  );

  it("type-checks and redacts the payload for the Phase 14 licence.notice event (LIC-07)", () => {
    const row = buildDomainEventRow({
      type: "licence.notice",
      payload: { licenceId: "LIC-1", noticeKey: "expiring-30", token: "super-secret" },
    });
    expect(row.type).toBe("licence.notice");
    const payload = row.payload as { licenceId: string; token: string };
    expect(payload.licenceId).toBe("LIC-1");
    expect(payload.token).toBe("[redacted]");
  });

  it.each([
    "payment.failed",
    "payment.refunded",
  ] satisfies DomainEventType[])(
    "type-checks and redacts the payload for the Phase 13 payment outcome event %s (D-09)",
    (type) => {
      const row = buildDomainEventRow({
        type,
        payload: { orderId: "o1", provider: "STRIPE", amount: 5000, token: "super-secret" },
      });
      expect(row.type).toBe(type);
      const payload = row.payload as { orderId: string; token: string };
      expect(payload.orderId).toBe("o1");
      expect(payload.token).toBe("[redacted]");
    },
  );

  it.each([
    "ticket.created",
    "ticket.public_reply_added",
    "ticket.assigned",
    "ticket.escalated",
    "ticket.resolved",
    "ticket.reopened",
    "ticket.closed",
  ] satisfies DomainEventType[])(
    "type-checks support ticket event %s and stores no private content keys",
    (type) => {
      const row = buildDomainEventRow({
        type,
        payload: {
          ticketId: "ticket-1",
          reference: "KQT-20260921-ABCDEF12",
        },
      });
      expect(row.type).toBe(type);
      expect(JSON.stringify(row.payload)).not.toMatch(/body|reason|filename|storageKey|attachments/);
    },
  );
});

describe("writeDomainEvent", () => {
  it("calls tx.domainEvent.create exactly once with the built row", async () => {
    const tx = fakeTx();
    await writeDomainEvent(tx.client, {
      type: "enrolment.withdrawn",
      payload: { enrolmentId: "e1" },
    });
    expect(tx.calls).toHaveLength(1);
    expect(tx.calls[0].data.type).toBe("enrolment.withdrawn");
    expect(tx.calls[0].data.payload).toEqual({ enrolmentId: "e1" });
    expect(tx.calls[0].data.occurredAt).toBeInstanceOf(Date);
  });

  it("stores a redacted payload in the outbox row", async () => {
    const tx = fakeTx();
    await writeDomainEvent(tx.client, {
      type: "enrolment.created",
      payload: { sessionToken: "abc123" },
    });
    expect(
      (tx.calls[0].data.payload as Record<string, unknown>).sessionToken,
    ).toBe("[redacted]");
  });

  it("resolves to undefined and never opens its own transaction", async () => {
    const tx = fakeTx();
    await expect(
      writeDomainEvent(tx.client, { type: "session.created", payload: {} }),
    ).resolves.toBeUndefined();
  });
});

// Type-level guard: the event-type union is closed. A string outside it must
// be a compile error so a later phase cannot invent an event nobody drains.
// @ts-expect-error "enrolment.frobnicated" is not a member of DomainEventType
const _rejectsUnknownType: DomainEventType = "enrolment.frobnicated";
void _rejectsUnknownType;

describe("writeDomainEventOnce (LIC-07)", () => {
  it("preserves the supplied id and passes skipDuplicates true to createMany", async () => {
    const calls: Array<{ data: Array<Record<string, unknown>>; skipDuplicates: true }> = [];
    const client: DomainEventCreateManyClient = {
      domainEvent: {
        createMany: async (args) => {
          calls.push(args);
          return { count: 1 };
        },
      },
    };
    const created = await writeDomainEventOnce(client, {
      id: "licence-notice-1",
      type: "licence.notice",
      payload: { licenceId: "LIC-1", noticeKey: "expiring-30" },
    });
    expect(created).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].skipDuplicates).toBe(true);
    expect(calls[0].data).toHaveLength(1);
    expect(calls[0].data[0].id).toBe("licence-notice-1");
    expect(calls[0].data[0].type).toBe("licence.notice");
  });

  it("returns false when createMany skipped the duplicate id", async () => {
    const client: DomainEventCreateManyClient = {
      domainEvent: { createMany: async () => ({ count: 0 }) },
    };
    expect(
      await writeDomainEventOnce(client, { id: "dup", type: "licence.notice", payload: {} }),
    ).toBe(false);
  });
});
