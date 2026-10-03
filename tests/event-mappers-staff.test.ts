/**
 * Pure unit coverage for the staff mapper group (D-08, D-20, T-13-03, A-03)
 * against a fake transaction client — no database needed for the pure
 * branching logic. Every audience is resolved through
 * `resolveStaffHolders`'s own `$queryRaw` call, so the fake `tx` fakes
 * `$queryRaw` directly rather than a Prisma delegate; the real-Postgres
 * proof that this SQL actually resolves the right holders (parity with
 * `hasPermission`) lives in `tests/staff-recipient-service.test.ts`, and the
 * proof the drain persists these intents correctly lives in
 * `tests/staff-drain.integration.test.ts`.
 *
 * `createStaffMappers()` is called DIRECTLY (rather than reading off
 * `buildMapperTable(EVENT_MAPPER_GROUPS)`) so these tests stay isolated to
 * exactly the staff mapper under test — `order.exception` is registered by
 * BOTH this group and the enrolment-payment group (`event-intent-mappers.ts`'s
 * own header comment documents the fan-out), so a merged-table lookup would
 * be ambiguous for that one event type.
 *
 * `event-intent-mappers.ts` is imported FIRST, then `createStaffMappers`
 * itself — `event-intent-mappers.ts` and `event-mappers/staff.ts` import
 * each other (the group needs `requireString`/the shared types; the
 * aggregator's `EVENT_MAPPER_GROUPS` calls `createStaffMappers()` eagerly at
 * module scope), so entering the cycle from `event-mappers/staff.ts`'s own
 * side first hits a genuine TDZ (`staff.ts`'s own const mapper functions are
 * not yet initialized when the aggregator's eager call reaches back into
 * them) — the same reasoning `tests/event-mappers-enrolment-payment.test.ts`'s
 * header documents for its own group's cycle.
 */

import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
// A real VALUE import (not `import type`) is what actually forces
// `event-intent-mappers.ts` to evaluate first — a type-only import is erased
// at compile time and would not fix the load-order TDZ described above.
import { buildMapperTable, EVENT_MAPPER_GROUPS } from "@/server/services/event-intent-mappers";
import type { DrainEvent, EventMapper, MapperContext } from "@/server/services/event-intent-mappers";
import { createStaffMappers } from "@/server/services/event-mappers/staff";
import { createEnrolmentPaymentMappers } from "@/server/services/event-mappers/enrolment-payment";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const mapperTable = buildMapperTable(EVENT_MAPPER_GROUPS);
const staffMappers = createStaffMappers();

function requireMapper(type: DrainEvent["type"]): EventMapper {
  const mapper = staffMappers[type];
  if (!mapper) throw new Error(`no staff mapper registered for ${type}`);
  return mapper;
}

function makeEvent(
  type: DrainEvent["type"],
  payload: Record<string, unknown>,
  id = "evt-1",
): DrainEvent {
  return { id, type, payload, occurredAt: NOW };
}

type CtxOverrides = {
  /** Rows `resolveStaffHolders`'s `$queryRaw` call should resolve to for
   * every call this test makes — a fixed holder-id list is enough since each
   * mapper under test calls `resolveStaffHolders` at most once per event. */
  holderIds?: string[];
  ticket?: (args: unknown) => Promise<unknown>;
  order?: (args: unknown) => Promise<unknown>;
  cohort?: (args: unknown) => Promise<unknown>;
  scheduledSession?: (args: unknown) => Promise<unknown>;
  enrolment?: (args: unknown) => Promise<unknown>;
};

function makeCtx(overrides: CtxOverrides = {}): MapperContext {
  const queryRaw = vi.fn(async () => (overrides.holderIds ?? []).map((id) => ({ id })));
  return {
    tx: {
      $queryRaw: queryRaw,
      ticket: { findUnique: overrides.ticket ?? (async () => null) },
      order: { findUnique: overrides.order ?? (async () => null) },
      cohort: { findUnique: overrides.cohort ?? (async () => null) },
      scheduledSession: { findUnique: overrides.scheduledSession ?? (async () => null) },
      enrolment: { findUnique: overrides.enrolment ?? (async () => null) },
    } as unknown as Prisma.TransactionClient,
    now: () => NOW,
  };
}

describe("createStaffMappers registration", () => {
  it("registers exactly the seven documented staff event types", () => {
    expect(Object.keys(staffMappers).sort()).toEqual(
      [
        "order.exception",
        "payment.reconciliation_exception",
        "submission.created",
        "ticket.assigned",
        "ticket.created",
        "ticket.escalated",
        "ticket.reopened",
      ].sort(),
    );
  });

  it("every staff-exclusive event type reaches EVENT_MAPPER_GROUPS through exactly one mapper; ticket.created and order.exception each fan out to two (the support/enrolment-payment groups also register them for their own learner-facing mail)", () => {
    for (const type of [
      "ticket.assigned",
      "ticket.escalated",
      "payment.reconciliation_exception",
      "submission.created",
    ] as const) {
      expect(mapperTable[type]).toHaveLength(1);
    }
    expect(mapperTable["ticket.created"]).toHaveLength(2);
    expect(mapperTable["order.exception"]).toHaveLength(2);
  });
});

describe("ticket.reopened staff alert (A-15)", () => {
  const reopened = (id = "evt-reopen-1") =>
    makeEvent("ticket.reopened", { ticketId: "t-9", reference: "KQT-9", ownerId: "stale-owner" }, id);

  it("tells the ticket's current owner, read from the ticket row rather than the payload, in-product only", async () => {
    const mapper = requireMapper("ticket.reopened");
    const ctx = makeCtx({ ticket: async () => ({ assigneeId: "owner-now", userId: "learner-1" }), holderIds: ["holder-a"] });

    const intents = await mapper(reopened(), ctx);

    expect(intents).toEqual([
      {
        recipientUserId: "owner-now",
        notification: {
          type: "staff.ticket_reopened",
          targetType: "STAFF_TICKET",
          targetId: "KQT-9",
          params: { reference: "KQT-9" },
        },
      },
    ]);
  });

  it("with no owner, tells every ticket manager except the learner who reopened it", async () => {
    const mapper = requireMapper("ticket.reopened");
    const ctx = makeCtx({
      ticket: async () => ({ assigneeId: null, userId: "learner-1" }),
      holderIds: ["holder-a", "holder-b", "learner-1"],
    });

    const intents = await mapper(reopened(), ctx);

    expect(intents.map((intent) => intent.recipientUserId).sort()).toEqual(["holder-a", "holder-b"]);
    for (const intent of intents) {
      expect(intent.email).toBeUndefined();
      expect(intent.notification!.type).toBe("staff.ticket_reopened");
    }
  });

  it("a ticket that no longer exists yields no intents", async () => {
    const mapper = requireMapper("ticket.reopened");
    expect(await mapper(reopened(), makeCtx({ ticket: async () => null, holderIds: ["holder-a"] }))).toEqual([]);
  });

  it("fans out alongside the learner's own reopened mail", () => {
    expect(mapperTable["ticket.reopened"]).toHaveLength(2);
    expect(mapperTable["ticket.reopened"]).toContain(staffMappers["ticket.reopened"]);
  });
});

describe("ticket.created staff alert (D-08)", () => {
  it("alerts every resolved holder except the requester, notification-only", async () => {
    const mapper = requireMapper("ticket.created");
    const ctx = makeCtx({ holderIds: ["holder-1", "holder-2", "requester-1"] });

    const intents = await mapper(
      makeEvent("ticket.created", { ticketId: "t-1", reference: "KQT-1", requesterId: "requester-1" }),
      ctx,
    );

    expect(intents).toHaveLength(2);
    const recipients = intents.map((i) => i.recipientUserId).sort();
    expect(recipients).toEqual(["holder-1", "holder-2"]);
    for (const intent of intents) {
      expect(intent.email).toBeUndefined();
      expect(intent.notification).toEqual({
        type: "staff.ticket_new",
        targetType: "STAFF_TICKET",
        targetId: "KQT-1",
        params: { reference: "KQT-1" },
      });
    }
  });

  it("no holders resolved yields zero intents", async () => {
    const mapper = requireMapper("ticket.created");
    const ctx = makeCtx({ holderIds: [] });
    const intents = await mapper(
      makeEvent("ticket.created", { ticketId: "t-2", reference: "KQT-2", requesterId: "requester-2" }),
      ctx,
    );
    expect(intents).toEqual([]);
  });
});

describe("ticket.assigned staff mail (D-08)", () => {
  it("mails and notifies the assignee named on the payload", async () => {
    const mapper = requireMapper("ticket.assigned");
    const ctx = makeCtx();

    const intents = await mapper(
      makeEvent("ticket.assigned", { ticketId: "t-3", reference: "KQT-3", assigneeId: "assignee-1" }, "evt-assign"),
      ctx,
    );

    expect(intents).toHaveLength(1);
    expect(intents[0]!.recipientUserId).toBe("assignee-1");
    expect(intents[0]!.email).toEqual({
      template: "staff-ticket-assigned",
      params: { reference: "KQT-3", ticketPath: "/staff/support/KQT-3" },
      correlationId: "evt-assign:assignee-1",
    });
    expect(intents[0]!.notification).toEqual({
      type: "staff.ticket_assigned",
      targetType: "STAFF_TICKET",
      targetId: "KQT-3",
      params: { reference: "KQT-3" },
    });
  });
});

describe("ticket.escalated staff alert (D-08, A-03)", () => {
  it("mails and notifies only the Ticket row's assignee when one is set (ignores payload)", async () => {
    const mapper = requireMapper("ticket.escalated");
    const ctx = makeCtx({ ticket: async () => ({ assigneeId: "assignee-2" }) });

    const intents = await mapper(
      makeEvent("ticket.escalated", { ticketId: "t-4", reference: "KQT-4", queue: "FINANCE" }, "evt-esc-1"),
      ctx,
    );

    expect(intents).toHaveLength(1);
    expect(intents[0]!.recipientUserId).toBe("assignee-2");
    expect(intents[0]!.email).toEqual({
      template: "staff-ticket-escalated",
      params: { reference: "KQT-4", queueLabel: "Finance", ticketPath: "/staff/support/KQT-4" },
      correlationId: "evt-esc-1:assignee-2",
    });
    expect(intents[0]!.notification!.type).toBe("staff.ticket_escalated");
  });

  it("notification-only fan-out to every resolved holder when no assignee is set (null-assignee escalation)", async () => {
    const mapper = requireMapper("ticket.escalated");
    const ctx = makeCtx({ ticket: async () => ({ assigneeId: null }), holderIds: ["holder-a", "holder-b"] });

    const intents = await mapper(
      makeEvent("ticket.escalated", { ticketId: "t-5", reference: "KQT-5", queue: "TECHNICAL" }),
      ctx,
    );

    expect(intents).toHaveLength(2);
    for (const intent of intents) {
      expect(intent.email).toBeUndefined();
      expect(intent.notification!.type).toBe("staff.ticket_escalated");
    }
    expect(intents.map((i) => i.recipientUserId).sort()).toEqual(["holder-a", "holder-b"]);
  });

  it("an unmapped-but-string queue value passes through unchanged rather than throwing", async () => {
    const mapper = requireMapper("ticket.escalated");
    const ctx = makeCtx({ ticket: async () => ({ assigneeId: "assignee-3" }) });

    const intents = await mapper(
      makeEvent("ticket.escalated", { ticketId: "t-6", reference: "KQT-6", queue: "SOME_UNKNOWN_QUEUE" }),
      ctx,
    );

    expect(intents[0]!.email!.params).toMatchObject({ queueLabel: "SOME_UNKNOWN_QUEUE" });
  });

  it("a missing (non-string) queue value renders the generic label rather than throwing", async () => {
    const mapper = requireMapper("ticket.escalated");
    const ctx = makeCtx({ ticket: async () => ({ assigneeId: "assignee-4" }) });

    const intents = await mapper(
      makeEvent("ticket.escalated", { ticketId: "t-6b", reference: "KQT-6B" }),
      ctx,
    );

    expect(intents[0]!.email!.params).toMatchObject({ queueLabel: "another queue" });
  });

  it("returns no intents when the ticket row no longer exists (edge)", async () => {
    const mapper = requireMapper("ticket.escalated");
    const ctx = makeCtx({ ticket: async () => null });
    const intents = await mapper(
      makeEvent("ticket.escalated", { ticketId: "gone", reference: "KQT-7", queue: "FINANCE" }),
      ctx,
    );
    expect(intents).toEqual([]);
  });
});

describe("order.exception staff mail (D-08, T-13-03)", () => {
  it("mails and notifies every resolved payments.view holder with named-field params only", async () => {
    const mapper = requireMapper("order.exception");
    const ctx = makeCtx({
      order: async () => ({ reference: "KQO-1", cohortId: "cohort-1" }),
      cohort: async () => ({ id: "cohort-1", programmeId: null, courseId: "course-1", cohortCourses: [] }),
      holderIds: ["payments-holder-1"],
    });

    const intents = await mapper(
      makeEvent("order.exception", { orderId: "order-1", reason: "amount_or_currency_mismatch" }, "evt-oe-1"),
      ctx,
    );

    expect(intents).toHaveLength(1);
    expect(intents[0]!.recipientUserId).toBe("payments-holder-1");
    expect(intents[0]!.email).toEqual({
      template: "staff-order-exception",
      params: {
        orderReference: "KQO-1",
        reasonLabel: "Amount or currency mismatch",
        paymentPath: "/staff/payments/order-1",
      },
      correlationId: "evt-oe-1:payments-holder-1",
    });
    expect(intents[0]!.notification).toEqual({
      type: "staff.order_exception",
      targetType: "STAFF_PAYMENT",
      targetId: "order-1",
      params: { orderReference: "KQO-1" },
    });
  });

  it("an unknown reason code renders the generic label, never the raw code (edge)", async () => {
    const mapper = requireMapper("order.exception");
    const ctx = makeCtx({
      order: async () => ({ reference: "KQO-2", cohortId: "cohort-2" }),
      cohort: async () => ({ id: "cohort-2", programmeId: null, courseId: "course-2", cohortCourses: [] }),
      holderIds: ["payments-holder-2"],
    });

    const intents = await mapper(
      makeEvent("order.exception", { orderId: "order-2", reason: "SECRET-UNMAPPED-REASON" }),
      ctx,
    );

    expect(intents[0]!.email!.params).toMatchObject({ reasonLabel: "Payment needs review" });
    expect(JSON.stringify(intents)).not.toContain("SECRET-UNMAPPED-REASON");
  });

  it("payment_after_restriction renders the fixed neutral label, never naming licence, restriction or expiry (D-08, T-14-13-05)", async () => {
    const mapper = requireMapper("order.exception");
    const ctx = makeCtx({
      order: async () => ({ reference: "KQO-9", cohortId: "cohort-9" }),
      cohort: async () => ({ id: "cohort-9", programmeId: null, courseId: "course-9", cohortCourses: [] }),
      holderIds: ["payments-holder-9"],
    });

    const intents = await mapper(
      makeEvent("order.exception", { orderId: "order-9", reason: "payment_after_restriction" }, "evt-oe-9"),
      ctx,
    );

    expect(intents).toHaveLength(1);
    const label = (intents[0]!.email!.params as { reasonLabel: string }).reasonLabel;
    expect(label).toBe("Payment received while new enrolments were unavailable");
    expect(label).not.toMatch(/licen[cs]e|restricted|expir/i);
    // The raw coded reason never reaches the rendered intent either.
    expect(JSON.stringify(intents)).not.toContain("payment_after_restriction");
    // The generic fallback is unchanged for a genuinely unknown reason.
    const unknown = await mapper(
      makeEvent("order.exception", { orderId: "order-9", reason: "payment_after_restrictionX" }),
      ctx,
    );
    expect(unknown[0]!.email!.params).toMatchObject({ reasonLabel: "Payment needs review" });
  });

  it("the learner order-exception mapper stays silent for payment_after_restriction (no learner email, only illegal_transition mails)", async () => {
    const learnerMapper = createEnrolmentPaymentMappers()["order.exception"];
    if (!learnerMapper) throw new Error("enrolment-payment group has no order.exception mapper");
    const ctx = makeCtx({
      order: async () => ({ reference: "KQO-9", userId: "user-9", cohort: { title: "July cohort" } }),
    });

    const intents = await learnerMapper(
      makeEvent("order.exception", { orderId: "order-9", reason: "payment_after_restriction" }),
      ctx,
    );
    expect(intents).toEqual([]);
  });

  it("returns no intents when the order no longer exists (edge)", async () => {
    const mapper = requireMapper("order.exception");
    const ctx = makeCtx({ order: async () => null });
    const intents = await mapper(makeEvent("order.exception", { orderId: "gone", reason: "no_order" }), ctx);
    expect(intents).toEqual([]);
  });
});

describe("payment.reconciliation_exception staff mail (D-08, T-13-03)", () => {
  it("mails and notifies the same payments.view audience, never reading exceptionNote", async () => {
    const mapper = requireMapper("payment.reconciliation_exception");
    const ctx = makeCtx({
      order: async () => ({ reference: "KQO-3", cohortId: "cohort-3" }),
      cohort: async () => ({ id: "cohort-3", programmeId: null, courseId: "course-3", cohortCourses: [] }),
      holderIds: ["payments-holder-3"],
    });

    const intents = await mapper(
      makeEvent(
        "payment.reconciliation_exception",
        {
          orderId: "order-3",
          paymentAttemptId: "attempt-3",
          provider: "STRIPE",
          exceptionNote: "SECRET-INTERNAL-NOTE-do-not-leak",
        },
        "evt-recon-1",
      ),
      ctx,
    );

    expect(intents).toHaveLength(1);
    expect(intents[0]!.recipientUserId).toBe("payments-holder-3");
    expect(intents[0]!.email).toEqual({
      template: "staff-reconciliation-exception",
      params: { orderReference: "KQO-3", paymentPath: "/staff/payments/order-3" },
      correlationId: "evt-recon-1:payments-holder-3",
    });
    expect(intents[0]!.notification).toEqual({
      type: "staff.reconciliation_exception",
      targetType: "STAFF_PAYMENT",
      targetId: "order-3",
      params: { orderReference: "KQO-3" },
    });
    expect(JSON.stringify(intents)).not.toContain("SECRET-INTERNAL-NOTE-do-not-leak");
  });

  it("returns no intents when the order no longer exists (edge)", async () => {
    const mapper = requireMapper("payment.reconciliation_exception");
    const ctx = makeCtx({ order: async () => null });
    const intents = await mapper(
      makeEvent("payment.reconciliation_exception", { orderId: "gone", paymentAttemptId: "a", provider: "STRIPE" }),
      ctx,
    );
    expect(intents).toEqual([]);
  });
});

describe("submission.created staff alert (D-08, D-20)", () => {
  it("notifies every resolved submissions.view holder, notification-only", async () => {
    const mapper = requireMapper("submission.created");
    const ctx = makeCtx({
      enrolment: async () => ({ cohortId: "cohort-4" }),
      cohort: async () => ({ id: "cohort-4", programmeId: null, courseId: "course-4", cohortCourses: [] }),
      holderIds: ["grader-1"],
    });

    const intents = await mapper(
      makeEvent("submission.created", {
        submissionId: "sub-1",
        assessmentId: "assess-1",
        enrolmentId: "enr-1",
        attemptNumber: 1,
        isLate: false,
      }),
      ctx,
    );

    expect(intents).toHaveLength(1);
    expect(intents[0]!.recipientUserId).toBe("grader-1");
    expect(intents[0]!.email).toBeUndefined();
    expect(intents[0]!.notification).toEqual({
      type: "staff.submission_new",
      targetType: "STAFF_SUBMISSION",
      targetId: "sub-1",
      params: { cohortId: "cohort-4", assessmentId: "assess-1" },
    });
  });

  it("returns no intents when the enrolment no longer exists (edge)", async () => {
    const mapper = requireMapper("submission.created");
    const ctx = makeCtx({ enrolment: async () => null });
    const intents = await mapper(
      makeEvent("submission.created", {
        submissionId: "sub-2",
        assessmentId: "assess-2",
        enrolmentId: "gone",
        attemptNumber: 1,
        isLate: false,
      }),
      ctx,
    );
    expect(intents).toEqual([]);
  });
});
