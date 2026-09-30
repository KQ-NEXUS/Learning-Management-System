/**
 * Unit tests for `notification-access-service.ts`: the generic `resolveOpen`
 * gate (T-13-01, T-13-02, D-19) plus every per-target resolver factory
 * (T-13-26 parity with each destination's own rule), using fakes for the db
 * and for each destination lookup.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createNotificationAccessService,
  createLearnerTicketResolver,
  createAlwaysAllowedResolver,
  createOwnRecordResolver,
  createStaffTicketResolver,
  createStaffPaymentResolver,
  createStaffSubmissionResolver,
  createStaffEmailLogResolver,
  type NotificationAccessRow,
  type NotificationAccessResolver,
} from "@/server/services/notification-access-service";
import { AuthorizationError } from "@/server/permissions/with-permission";
import type { Actor } from "@/server/permissions/with-permission";
import type { Permission } from "@/server/permissions/catalogue";
import type { NotificationTargetType } from "@/server/communications/contracts";

const actor: Actor = { userId: "user-1" };

function buildRow(overrides: Partial<NotificationAccessRow> = {}): NotificationAccessRow {
  return {
    id: "notif-1",
    targetType: "LEARNER_TICKET",
    targetId: "KQT-1",
    params: {},
    ...overrides,
  };
}

function buildService(args: {
  row: NotificationAccessRow | null;
  resolver?: NotificationAccessResolver;
}) {
  const findFirst = vi.fn().mockResolvedValue(args.row);
  const markRead = vi.fn().mockResolvedValue(true);
  const service = createNotificationAccessService({
    db: { notification: { findFirst } },
    notificationService: { markRead },
    resolvers: args.resolver ? { LEARNER_TICKET: args.resolver } : {},
  });
  return { service, findFirst, markRead };
}

describe("notificationAccessService.resolveOpen — generic gate", () => {
  it("returns unavailable and changes nothing for a missing notification id", async () => {
    const { service, markRead } = buildService({ row: null });
    const outcome = await service.resolveOpen(actor, "does-not-exist");
    expect(outcome).toEqual({ status: "unavailable" });
    expect(markRead).not.toHaveBeenCalled();
  });

  it("returns unavailable and changes nothing for a foreign notification id (query itself excludes it)", async () => {
    // The db fake stands in for the recipientId-scoped query returning no
    // row for another user's id — indistinguishable from "missing" by
    // design (T-13-01).
    const { service, markRead } = buildService({ row: null });
    const outcome = await service.resolveOpen(actor, "someone-elses-notification");
    expect(outcome).toEqual({ status: "unavailable" });
    expect(markRead).not.toHaveBeenCalled();
  });

  it("returns unavailable but still marks read when the resolver denies", async () => {
    const resolver = vi.fn().mockResolvedValue(false);
    const { service, markRead } = buildService({ row: buildRow(), resolver });
    const outcome = await service.resolveOpen(actor, "notif-1");
    expect(outcome).toEqual({ status: "unavailable" });
    expect(markRead).toHaveBeenCalledWith(actor, "notif-1");
  });

  it("returns unavailable but still marks read when the resolver throws", async () => {
    const resolver = vi.fn().mockRejectedValue(new Error("boom"));
    const { service, markRead } = buildService({ row: buildRow(), resolver });
    const outcome = await service.resolveOpen(actor, "notif-1");
    expect(outcome).toEqual({ status: "unavailable" });
    expect(markRead).toHaveBeenCalledWith(actor, "notif-1");
  });

  it("returns unavailable when no resolver is registered for the row's target type", async () => {
    const { service, markRead } = buildService({ row: buildRow({ targetType: "STAFF_PAYMENT" }) });
    const outcome = await service.resolveOpen(actor, "notif-1");
    expect(outcome).toEqual({ status: "unavailable" });
    expect(markRead).toHaveBeenCalledWith(actor, "notif-1");
  });

  it("returns ok with a validated href and marks read when the resolver allows", async () => {
    const resolver = vi.fn().mockResolvedValue(true);
    const { service, markRead } = buildService({ row: buildRow(), resolver });
    const outcome = await service.resolveOpen(actor, "notif-1");
    expect(outcome).toEqual({ status: "ok", href: "/support/KQT-1" });
    expect(markRead).toHaveBeenCalledWith(actor, "notif-1");
  });

  it("returns unavailable (not a throw or 500-shaped result) when the allowed row's stored id cannot build a valid href", async () => {
    const resolver = vi.fn().mockResolvedValue(true);
    const { service } = buildService({ row: buildRow({ targetId: "../hostile" }), resolver });
    const outcome = await service.resolveOpen(actor, "notif-1");
    expect(outcome).toEqual({ status: "unavailable" });
  });

  it("deep-equals the denial outcome across missing, foreign, resolver-denied and resolver-throw", async () => {
    const missing = await buildService({ row: null }).service.resolveOpen(actor, "x");
    const foreign = await buildService({ row: null }).service.resolveOpen(actor, "y");
    const denied = await buildService({
      row: buildRow(),
      resolver: vi.fn().mockResolvedValue(false),
    }).service.resolveOpen(actor, "notif-1");
    const threw = await buildService({
      row: buildRow(),
      resolver: vi.fn().mockRejectedValue(new Error("boom")),
    }).service.resolveOpen(actor, "notif-1");

    expect(missing).toEqual({ status: "unavailable" });
    expect(foreign).toEqual({ status: "unavailable" });
    expect(denied).toEqual({ status: "unavailable" });
    expect(threw).toEqual({ status: "unavailable" });
    expect([missing, foreign, denied, threw]).toEqual([missing, missing, missing, missing]);
  });
});

describe("createLearnerTicketResolver", () => {
  it("allows when a ticket with that reference belongs to the actor", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "ticket-1" });
    const resolver = createLearnerTicketResolver({ ticket: { findFirst } });
    const allowed = await resolver(actor, "KQT-1", {});
    expect(allowed).toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: actor.userId, reference: "KQT-1" },
      select: { id: true },
    });
  });

  it("denies when no ticket with that reference belongs to the actor (foreign, deleted or nonexistent)", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const resolver = createLearnerTicketResolver({ ticket: { findFirst } });
    expect(await resolver(actor, "KQT-1", {})).toBe(false);
  });
});

describe("createAlwaysAllowedResolver — LEARNER_DASHBOARD", () => {
  it("always allows (resolveOpen already proved ownership of the row)", async () => {
    const resolver = createAlwaysAllowedResolver();
    expect(await resolver(actor, "anything", {})).toBe(true);
  });
});

describe("createOwnRecordResolver — LEARNER_ORDER, LEARNER_ENROLMENT, LEARNER_RESULTS, LEARNER_SESSIONS", () => {
  it("allows when the lookup returns a non-null owned record", async () => {
    const lookup = vi.fn().mockResolvedValue({ id: "order-1" });
    const resolver = createOwnRecordResolver(lookup);
    expect(await resolver(actor, "order-ref-1", {})).toBe(true);
    expect(lookup).toHaveBeenCalledWith(actor, "order-ref-1");
  });

  it("denies when the lookup returns null (foreign, withdrawn/cancelled, or deleted)", async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    const resolver = createOwnRecordResolver(lookup);
    expect(await resolver(actor, "enr-1", {})).toBe(false);
  });

  it("a WITHDRAWN enrolment (lookup returns null) denies while an ACTIVE one (lookup returns a path) allows — same resolver, same call shape as LEARNER_RESULTS/LEARNER_SESSIONS", async () => {
    const activeLookup = vi.fn().mockResolvedValue({ enrolment: { status: "ACTIVE" } });
    const withdrawnLookup = vi.fn().mockResolvedValue(null);
    expect(await createOwnRecordResolver(activeLookup)(actor, "enr-active", {})).toBe(true);
    expect(await createOwnRecordResolver(withdrawnLookup)(actor, "enr-withdrawn", {})).toBe(false);
  });
});

describe("createStaffTicketResolver — STAFF_TICKET", () => {
  it("allows when the staff lookup resolves", async () => {
    const lookup = vi.fn().mockResolvedValue({ reference: "KQT-1" });
    const resolver = createStaffTicketResolver(lookup);
    expect(await resolver(actor, "KQT-1", {})).toBe(true);
  });

  it("denies (by rejecting, same as resolveOpen's generic catch) when the lookup throws AuthorizationError", async () => {
    const lookup = vi.fn().mockRejectedValue(new AuthorizationError("tickets.view" as Permission));
    const resolver = createStaffTicketResolver(lookup);
    await expect(resolver(actor, "KQT-1", {})).rejects.toThrow(AuthorizationError);
  });

  it("a learner opening a STAFF_TICKET notification denies identically to any other outcome through resolveOpen", async () => {
    const lookup = vi.fn().mockRejectedValue(new AuthorizationError("tickets.view" as Permission));
    const service = createNotificationAccessService({
      db: {
        notification: {
          findFirst: vi.fn().mockResolvedValue(buildRow({ targetType: "STAFF_TICKET", targetId: "KQT-1" })),
        },
      },
      notificationService: { markRead: vi.fn().mockResolvedValue(true) },
      resolvers: { STAFF_TICKET: createStaffTicketResolver(lookup) },
    });
    expect(await service.resolveOpen(actor, "notif-1")).toEqual({ status: "unavailable" });
  });
});

describe("createStaffPaymentResolver — STAFF_PAYMENT", () => {
  it("allows when the lookup returns a non-null payment detail", async () => {
    const lookup = vi.fn().mockResolvedValue({ id: "order-1" });
    const resolver = createStaffPaymentResolver(lookup);
    expect(await resolver(actor, "order-1", {})).toBe(true);
  });

  it("denies when the lookup returns null for a deleted order", async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    const resolver = createStaffPaymentResolver(lookup);
    expect(await resolver(actor, "order-1", {})).toBe(false);
  });

  it("a staff user without payments.view (lookup throws) gets the same unavailable result as a deleted order (lookup returns null)", async () => {
    const deniedResolver = createStaffPaymentResolver(
      vi.fn().mockRejectedValue(new AuthorizationError("payments.view" as Permission)),
    );
    const deletedResolver = createStaffPaymentResolver(vi.fn().mockResolvedValue(null));

    const makeService = (resolver: NotificationAccessResolver) =>
      createNotificationAccessService({
        db: {
          notification: {
            findFirst: vi.fn().mockResolvedValue(buildRow({ targetType: "STAFF_PAYMENT", targetId: "order-1" })),
          },
        },
        notificationService: { markRead: vi.fn().mockResolvedValue(true) },
        resolvers: { STAFF_PAYMENT: resolver },
      });

    const deniedOutcome = await makeService(deniedResolver).resolveOpen(actor, "notif-1");
    const deletedOutcome = await makeService(deletedResolver).resolveOpen(actor, "notif-1");
    expect(deniedOutcome).toEqual({ status: "unavailable" });
    expect(deletedOutcome).toEqual({ status: "unavailable" });
    expect(deniedOutcome).toEqual(deletedOutcome);
  });
});

describe("createStaffSubmissionResolver — STAFF_SUBMISSION", () => {
  it("allows when the grading detail's cohort/assessment match the notification's stored params", async () => {
    const lookup = vi.fn().mockResolvedValue({ cohortId: "cohort-1", assessment: { id: "assess-1" } });
    const resolver = createStaffSubmissionResolver(lookup);
    const allowed = await resolver(actor, "sub-1", { cohortId: "cohort-1", assessmentId: "assess-1" });
    expect(allowed).toBe(true);
    expect(lookup).toHaveBeenCalledWith({ submissionId: "sub-1" });
  });

  it("denies when the resolved cohort/assessment do not match the stored params (broader-grant drift, D-05 style)", async () => {
    const lookup = vi.fn().mockResolvedValue({ cohortId: "cohort-OTHER", assessment: { id: "assess-1" } });
    const resolver = createStaffSubmissionResolver(lookup);
    const allowed = await resolver(actor, "sub-1", { cohortId: "cohort-1", assessmentId: "assess-1" });
    expect(allowed).toBe(false);
  });

  it("denies (by rejecting) when the lookup throws submissions.view AuthorizationError", async () => {
    const lookup = vi.fn().mockRejectedValue(new AuthorizationError("submissions.view" as Permission));
    const resolver = createStaffSubmissionResolver(lookup);
    await expect(resolver(actor, "sub-1", { cohortId: "cohort-1", assessmentId: "assess-1" })).rejects.toThrow(
      AuthorizationError,
    );
  });
});

describe("createStaffEmailLogResolver — STAFF_EMAIL_LOG", () => {
  it("allows when can(\"audit.view\", {}) is true", async () => {
    const can = vi.fn().mockResolvedValue(true);
    const resolver = createStaffEmailLogResolver(can);
    expect(await resolver(actor, "anything", {})).toBe(true);
    expect(can).toHaveBeenCalledWith("audit.view", {});
  });

  it("denies when can(\"audit.view\", {}) is false", async () => {
    const can = vi.fn().mockResolvedValue(false);
    const resolver = createStaffEmailLogResolver(can);
    expect(await resolver(actor, "anything", {})).toBe(false);
  });
});

describe("cross-role denial parity through resolveOpen", () => {
  it("a staff member opening another learner's order denies identically to a learner opening a staff target", async () => {
    const orderService = createNotificationAccessService({
      db: {
        notification: {
          findFirst: vi.fn().mockResolvedValue(buildRow({ targetType: "LEARNER_ORDER", targetId: "order-1" })),
        },
      },
      notificationService: { markRead: vi.fn().mockResolvedValue(true) },
      resolvers: { LEARNER_ORDER: createOwnRecordResolver(vi.fn().mockResolvedValue(null)) },
    });
    const ticketService = createNotificationAccessService({
      db: {
        notification: {
          findFirst: vi.fn().mockResolvedValue(buildRow({ targetType: "STAFF_TICKET", targetId: "KQT-1" })),
        },
      },
      notificationService: { markRead: vi.fn().mockResolvedValue(true) },
      resolvers: {
        STAFF_TICKET: createStaffTicketResolver(
          vi.fn().mockRejectedValue(new AuthorizationError("tickets.view" as Permission)),
        ),
      },
    });

    const staffOnLearnerOrder = await orderService.resolveOpen(actor, "notif-1");
    const learnerOnStaffTicket = await ticketService.resolveOpen(actor, "notif-1");
    expect(staffOnLearnerOrder).toEqual({ status: "unavailable" });
    expect(learnerOnStaffTicket).toEqual({ status: "unavailable" });
    expect(staffOnLearnerOrder).toEqual(learnerOnStaffTicket);
  });
});

describe("all ten NOTIFICATION_TARGET_TYPES — at least one allowed and one denied case through resolveOpen", () => {
  function serviceFor(
    targetType: NotificationTargetType,
    targetId: string,
    resolver: NotificationAccessResolver,
    params: Record<string, unknown> = {},
  ) {
    return createNotificationAccessService({
      db: {
        notification: {
          findFirst: vi.fn().mockResolvedValue(buildRow({ targetType, targetId, params })),
        },
      },
      notificationService: { markRead: vi.fn().mockResolvedValue(true) },
      resolvers: { [targetType]: resolver } as Partial<
        Record<NotificationTargetType, NotificationAccessResolver>
      >,
    });
  }

  it("LEARNER_DASHBOARD: always allowed for the row's own recipient; denied when the row is not theirs (generic gate, no resolver call)", async () => {
    const allowed = await serviceFor(
      "LEARNER_DASHBOARD",
      "anything",
      createAlwaysAllowedResolver(),
    ).resolveOpen(actor, "notif-1");
    expect(allowed).toEqual({ status: "ok", href: "/dashboard" });

    const deniedService = createNotificationAccessService({
      db: { notification: { findFirst: vi.fn().mockResolvedValue(null) } },
      notificationService: { markRead: vi.fn() },
      resolvers: { LEARNER_DASHBOARD: createAlwaysAllowedResolver() },
    });
    expect(await deniedService.resolveOpen(actor, "not-mine")).toEqual({ status: "unavailable" });
  });

  it("LEARNER_ORDER: allowed when owned, denied when the lookup returns null", async () => {
    const allowed = await serviceFor(
      "LEARNER_ORDER",
      "order-1",
      createOwnRecordResolver(vi.fn().mockResolvedValue({ id: "order-1" })),
    ).resolveOpen(actor, "notif-1");
    expect(allowed).toEqual({ status: "ok", href: "/orders/order-1" });

    const denied = await serviceFor(
      "LEARNER_ORDER",
      "order-1",
      createOwnRecordResolver(vi.fn().mockResolvedValue(null)),
    ).resolveOpen(actor, "notif-1");
    expect(denied).toEqual({ status: "unavailable" });
  });

  it("LEARNER_ENROLMENT: allowed for an ACTIVE owned path, denied for a withdrawn/foreign one", async () => {
    const allowed = await serviceFor(
      "LEARNER_ENROLMENT",
      "enr-1",
      createOwnRecordResolver(vi.fn().mockResolvedValue({ enrolment: { status: "ACTIVE" } })),
    ).resolveOpen(actor, "notif-1");
    expect(allowed).toEqual({ status: "ok", href: "/learn/enr-1" });

    const denied = await serviceFor(
      "LEARNER_ENROLMENT",
      "enr-1",
      createOwnRecordResolver(vi.fn().mockResolvedValue(null)),
    ).resolveOpen(actor, "notif-1");
    expect(denied).toEqual({ status: "unavailable" });
  });

  it("LEARNER_RESULTS: allowed for an ACTIVE owned path, denied for a withdrawn one", async () => {
    const allowed = await serviceFor(
      "LEARNER_RESULTS",
      "enr-1",
      createOwnRecordResolver(vi.fn().mockResolvedValue({ enrolment: { status: "ACTIVE" } })),
    ).resolveOpen(actor, "notif-1");
    expect(allowed).toEqual({ status: "ok", href: "/learn/enr-1/results" });

    const denied = await serviceFor(
      "LEARNER_RESULTS",
      "enr-1",
      createOwnRecordResolver(vi.fn().mockResolvedValue(null)),
    ).resolveOpen(actor, "notif-1");
    expect(denied).toEqual({ status: "unavailable" });
  });

  it("LEARNER_SESSIONS: allowed for an ACTIVE owned path, denied for a withdrawn one", async () => {
    const allowed = await serviceFor(
      "LEARNER_SESSIONS",
      "enr-1",
      createOwnRecordResolver(vi.fn().mockResolvedValue({ enrolment: { status: "ACTIVE" } })),
    ).resolveOpen(actor, "notif-1");
    expect(allowed).toEqual({ status: "ok", href: "/learn/enr-1/sessions" });

    const denied = await serviceFor(
      "LEARNER_SESSIONS",
      "enr-1",
      createOwnRecordResolver(vi.fn().mockResolvedValue(null)),
    ).resolveOpen(actor, "notif-1");
    expect(denied).toEqual({ status: "unavailable" });
  });

  it("LEARNER_TICKET: allowed when the ticket belongs to the actor, denied otherwise", async () => {
    const allowed = await serviceFor(
      "LEARNER_TICKET",
      "KQT-1",
      createLearnerTicketResolver({ ticket: { findFirst: vi.fn().mockResolvedValue({ id: "t1" }) } }),
    ).resolveOpen(actor, "notif-1");
    expect(allowed).toEqual({ status: "ok", href: "/support/KQT-1" });

    const denied = await serviceFor(
      "LEARNER_TICKET",
      "KQT-1",
      createLearnerTicketResolver({ ticket: { findFirst: vi.fn().mockResolvedValue(null) } }),
    ).resolveOpen(actor, "notif-1");
    expect(denied).toEqual({ status: "unavailable" });
  });

  it("STAFF_TICKET: allowed when the staff lookup resolves, denied when it throws", async () => {
    const allowed = await serviceFor(
      "STAFF_TICKET",
      "KQT-1",
      createStaffTicketResolver(vi.fn().mockResolvedValue({ reference: "KQT-1" })),
    ).resolveOpen(actor, "notif-1");
    expect(allowed).toEqual({ status: "ok", href: "/staff/support/KQT-1" });

    const denied = await serviceFor(
      "STAFF_TICKET",
      "KQT-1",
      createStaffTicketResolver(vi.fn().mockRejectedValue(new AuthorizationError("tickets.view" as Permission))),
    ).resolveOpen(actor, "notif-1");
    expect(denied).toEqual({ status: "unavailable" });
  });

  it("STAFF_PAYMENT: allowed when the lookup returns a payment detail, denied when it returns null", async () => {
    const allowed = await serviceFor(
      "STAFF_PAYMENT",
      "order-1",
      createStaffPaymentResolver(vi.fn().mockResolvedValue({ id: "order-1" })),
    ).resolveOpen(actor, "notif-1");
    expect(allowed).toEqual({ status: "ok", href: "/staff/payments/order-1" });

    const denied = await serviceFor(
      "STAFF_PAYMENT",
      "order-1",
      createStaffPaymentResolver(vi.fn().mockResolvedValue(null)),
    ).resolveOpen(actor, "notif-1");
    expect(denied).toEqual({ status: "unavailable" });
  });

  it("STAFF_SUBMISSION: allowed when cohort/assessment match the stored params, denied when they don't", async () => {
    const params = { cohortId: "cohort-1", assessmentId: "assess-1" };
    const allowed = await serviceFor(
      "STAFF_SUBMISSION",
      "sub-1",
      createStaffSubmissionResolver(
        vi.fn().mockResolvedValue({ cohortId: "cohort-1", assessment: { id: "assess-1" } }),
      ),
      params,
    ).resolveOpen(actor, "notif-1");
    expect(allowed).toEqual({
      status: "ok",
      href: "/staff/cohorts/cohort-1/grading/assess-1/sub-1",
    });

    const denied = await serviceFor(
      "STAFF_SUBMISSION",
      "sub-1",
      createStaffSubmissionResolver(
        vi.fn().mockResolvedValue({ cohortId: "cohort-OTHER", assessment: { id: "assess-1" } }),
      ),
      params,
    ).resolveOpen(actor, "notif-1");
    expect(denied).toEqual({ status: "unavailable" });
  });

  it("STAFF_EMAIL_LOG: allowed when can(\"audit.view\", {}) is true, denied when false", async () => {
    const allowed = await serviceFor(
      "STAFF_EMAIL_LOG",
      "anything",
      createStaffEmailLogResolver(vi.fn().mockResolvedValue(true)),
    ).resolveOpen(actor, "notif-1");
    expect(allowed).toEqual({ status: "ok", href: "/staff/email-log" });

    const denied = await serviceFor(
      "STAFF_EMAIL_LOG",
      "anything",
      createStaffEmailLogResolver(vi.fn().mockResolvedValue(false)),
    ).resolveOpen(actor, "notif-1");
    expect(denied).toEqual({ status: "unavailable" });
  });
});
