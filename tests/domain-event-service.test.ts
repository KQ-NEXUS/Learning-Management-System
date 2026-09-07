import { describe, expect, it } from "vitest";
import {
  buildDomainEventRow,
  writeDomainEvent,
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
