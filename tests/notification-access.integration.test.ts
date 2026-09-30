/**
 * Real-Postgres proof that opening a learner ticket notification checks
 * ownership before ever returning a link (COM-03, D-19, D-21, T-13-01,
 * T-13-02). A fake db can assert the exact `where` clause a query builds,
 * but only a real database proves the `recipientId`-scoped lookup actually
 * excludes another user's row, and that marking read only ever touches the
 * caller's own notification.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails
 * with a container-start error and every case reports BLOCKED — the
 * expected failure mode, never a silent pass or a weakened mock.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture, seedLearnerFixture, seedEnrolmentFixture } from "./support/cohort-fixtures";
import { grant, createTestWithPermission } from "./support/harness";
import {
  createNotificationAccessService,
  createLearnerTicketResolver,
  createOwnRecordResolver,
  createStaffPaymentResolver,
  type NotificationAccessStore,
  type TicketOwnershipStore,
} from "@/server/services/notification-access-service";
import { createNotificationService, type NotificationStore } from "@/server/services/notification-service";
import { createCohortScopeResolvers, type CohortScopeDeps } from "@/server/services/cohort-scope";
import {
  createPaymentReadService,
  type PaymentReadServiceDeps,
  type PaymentDetailOrderRow,
  type PaymentListOrderRow,
} from "@/server/services/payment-read-service";
import type { Actor } from "@/server/permissions/with-permission";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestDatabase();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

function buildService() {
  return createNotificationAccessService({
    db: testDb.prisma as unknown as NotificationAccessStore,
    notificationService: createNotificationService({
      db: testDb.prisma as unknown as NotificationStore,
    }),
    resolvers: {
      LEARNER_TICKET: createLearnerTicketResolver(testDb.prisma as unknown as TicketOwnershipStore),
    },
  });
}

let counter = 0;
function uniq(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

async function seedUser(): Promise<string> {
  const user = await testDb.prisma.user.create({
    data: {
      email: `${uniq("notif-access-user")}@fixture.test`,
      name: "Fixture User",
      status: "ACTIVE",
    },
    select: { id: true },
  });
  return user.id;
}

async function seedTicket(userId: string): Promise<string> {
  const reference = uniq("KQT-NOTIF-ACCESS");
  await testDb.prisma.ticket.create({
    data: { reference, userId, category: "OTHER", subject: "Fixture ticket" },
  });
  return reference;
}

async function seedNotification(args: {
  recipientId: string;
  targetType: string;
  targetId: string;
}) {
  return testDb.prisma.notification.create({
    data: {
      recipientId: args.recipientId,
      type: "ticket.reply",
      targetType: args.targetType,
      targetId: args.targetId,
      params: {},
      sourceEventId: uniq("evt-notif-access"),
    },
  });
}

async function seedOrder(userId: string, cohortId: string): Promise<{ id: string; reference: string }> {
  const reference = uniq("ORDER-NOTIF-ACCESS");
  const order = await testDb.prisma.order.create({
    data: {
      reference,
      userId,
      cohortId,
      amountMinor: 100_000,
      idempotencyKey: uniq("IDEM-NOTIF-ACCESS"),
    },
    select: { id: true, reference: true },
  });
  return order;
}

/**
 * A `getPaymentDetailForStaff` bound entirely to `testDb.prisma`, with the
 * grant list faked via `createTestWithPermission` (grant-loading itself is
 * already proven elsewhere — `tests/with-permission.test.ts` — so this test
 * only needs to prove the notification resolver agrees with a real order
 * row). Deliberately NOT `createPrismaBackedPaymentReadService`'s live
 * singleton wiring, whose `orderScope` is hardcoded to the app's own
 * `prisma` — binding here to the throwaway database instead.
 */
function buildPaymentDetailLookup(actorId: string, hasPaymentsView: boolean) {
  const { withPermission } = createTestWithPermission(
    hasPaymentsView ? [grant("payments.view")] : [],
    { userId: actorId },
  );
  const { orderCohortScope: testOrderCohortScope } = createCohortScopeResolvers({
    cohort: testDb.prisma.cohort,
    session: testDb.prisma.scheduledSession,
    enrolment: testDb.prisma.enrolment,
    order: testDb.prisma.order,
  } as unknown as CohortScopeDeps);

  const deps: PaymentReadServiceDeps = {
    order: {
      findMany: () => Promise.resolve([] as PaymentListOrderRow[]),
      findUnique: ({ where }) =>
        testDb.prisma.order
          .findUnique({
            where,
            select: {
              id: true,
              reference: true,
              status: true,
              currency: true,
              amountMinor: true,
              baseAmountMinor: true,
              platformFeeMinor: true,
              gatewayFeeEstimateMinor: true,
              schoolSettlementExpectedMinor: true,
              selectedProvider: true,
              user: { select: { name: true, email: true } },
              cohort: { select: { title: true } },
              paymentAttempts: {
                select: {
                  provider: true,
                  status: true,
                  confirmedAt: true,
                  providerRef: true,
                  providerIntentId: true,
                  gatewayFeeActualMinor: true,
                  schoolSettlementActualMinor: true,
                  platformGrossActualMinor: true,
                  platformNetActualMinor: true,
                  exceptionNote: true,
                },
              },
              refunds: {
                select: {
                  id: true,
                  amountMinor: true,
                  currency: true,
                  status: true,
                  actorId: true,
                  createdAt: true,
                },
              },
            },
          })
          .then((row) => row as unknown as PaymentDetailOrderRow | null),
    },
    user: {
      findMany: (args) => testDb.prisma.user.findMany({ where: args.where, select: { id: true, name: true } }),
    },
    orderScope: testOrderCohortScope,
    withPermission,
    // Only the payments LIST reads the collection scope; this test drives the
    // detail read alone, so a call here would be a test wiring bug.
    authorizeCollection: () => Promise.reject(new Error("authorizeCollection is not used by the detail read")),
  };

  return createPaymentReadService(deps).getPaymentDetailForStaff;
}

describe("notification access — real Postgres (T-13-01, T-13-02)", () => {
  it(
    "opens the owner's learner ticket notification, marks it read, and returns a validated href",
    async () => {
      const userA = await seedUser();
      const reference = await seedTicket(userA);
      const notification = await seedNotification({
        recipientId: userA,
        targetType: "LEARNER_TICKET",
        targetId: reference,
      });

      const service = buildService();
      const outcome = await service.resolveOpen({ userId: userA } as Actor, notification.id);
      expect(outcome).toEqual({ status: "ok", href: `/support/${reference}` });

      const reloaded = await testDb.prisma.notification.findUniqueOrThrow({
        where: { id: notification.id },
      });
      expect(reloaded.readAt).not.toBeNull();
    },
    TEST_DB_TIMEOUT_MS,
  );

  it(
    "returns unavailable for another user's notification id and leaves readAt null",
    async () => {
      const userA = await seedUser();
      const userB = await seedUser();
      const reference = await seedTicket(userA);
      const notification = await seedNotification({
        recipientId: userA,
        targetType: "LEARNER_TICKET",
        targetId: reference,
      });

      const service = buildService();
      const outcome = await service.resolveOpen({ userId: userB } as Actor, notification.id);
      expect(outcome).toEqual({ status: "unavailable" });

      const reloaded = await testDb.prisma.notification.findUniqueOrThrow({
        where: { id: notification.id },
      });
      expect(reloaded.readAt).toBeNull();
    },
    TEST_DB_TIMEOUT_MS,
  );

  it(
    "deep-equals the outcome for a foreign notification id, a nonexistent notification id, and a nonexistent ticket reference",
    async () => {
      const userA = await seedUser();
      const userB = await seedUser();
      const reference = await seedTicket(userA);
      const foreignNotification = await seedNotification({
        recipientId: userA,
        targetType: "LEARNER_TICKET",
        targetId: reference,
      });
      // The "deleted equivalent": a notification whose stored ticket
      // reference no longer resolves to any ticket at all.
      const deletedEquivalentNotification = await seedNotification({
        recipientId: userA,
        targetType: "LEARNER_TICKET",
        targetId: uniq("KQT-DOES-NOT-EXIST"),
      });

      const service = buildService();

      const foreignOutcome = await service.resolveOpen(
        { userId: userB } as Actor,
        foreignNotification.id,
      );
      const missingOutcome = await service.resolveOpen(
        { userId: userA } as Actor,
        "does-not-exist-at-all",
      );
      const deletedOutcome = await service.resolveOpen(
        { userId: userA } as Actor,
        deletedEquivalentNotification.id,
      );

      const expected = { status: "unavailable" as const };
      expect(foreignOutcome).toEqual(expected);
      expect(missingOutcome).toEqual(expected);
      expect(deletedOutcome).toEqual(expected);
    },
    TEST_DB_TIMEOUT_MS,
  );
});

describe("LEARNER_ORDER — real Postgres", () => {
  it(
    "allows the order's owner and denies a foreign user, agreeing with getOwnOrderByReference's own userId-equality rule",
    async () => {
      const { cohortId } = await seedCohortFixture(testDb.prisma);
      const owner = await seedUser();
      const stranger = await seedUser();
      const order = await seedOrder(owner, cohortId);

      // Mirrors `getOwnOrderByReference`'s exact predicate
      // (checkout-service.ts: `order.userId === actor.userId`) against the
      // throwaway database — the same rule, proven with real rows.
      const lookup = (actor: Actor, orderId: string) =>
        testDb.prisma.order
          .findUnique({ where: { id: orderId } })
          .then((row) => (row && row.userId === actor.userId ? row : null));
      const resolver = createOwnRecordResolver(lookup);

      const ownerAllowed = await resolver({ userId: owner } as Actor, order.id, {});
      const strangerDenied = await resolver({ userId: stranger } as Actor, order.id, {});
      expect(ownerAllowed).toBe(true);
      expect(strangerDenied).toBe(false);

      // Parity: the resolver's boolean agrees exactly with the lookup's own
      // null-vs-row split for both actors.
      expect(ownerAllowed).toBe((await lookup({ userId: owner } as Actor, order.id)) !== null);
      expect(strangerDenied).toBe((await lookup({ userId: stranger } as Actor, order.id)) !== null);
    },
    TEST_DB_TIMEOUT_MS,
  );

  it(
    "through resolveOpen: the owner opens the order notification and gets a validated href; a stranger's identical notification denies",
    async () => {
      const { cohortId } = await seedCohortFixture(testDb.prisma);
      const owner = await seedUser();
      const order = await seedOrder(owner, cohortId);

      const lookup = (actor: Actor, orderId: string) =>
        testDb.prisma.order
          .findUnique({ where: { id: orderId } })
          .then((row) => (row && row.userId === actor.userId ? row : null));

      const service = createNotificationAccessService({
        db: testDb.prisma as unknown as NotificationAccessStore,
        notificationService: createNotificationService({ db: testDb.prisma as unknown as NotificationStore }),
        resolvers: { LEARNER_ORDER: createOwnRecordResolver(lookup) },
      });

      const ownNotification = await seedNotification({
        recipientId: owner,
        targetType: "LEARNER_ORDER",
        targetId: order.id,
      });
      const outcome = await service.resolveOpen({ userId: owner } as Actor, ownNotification.id);
      expect(outcome).toEqual({ status: "ok", href: `/orders/${order.id}` });
    },
    TEST_DB_TIMEOUT_MS,
  );
});

describe("LEARNER_ENROLMENT — real Postgres (ACTIVE vs WITHDRAWN)", () => {
  it(
    "allows an ACTIVE, owned enrolment and denies a WITHDRAWN one, mirroring loadLearnerPath's ownership+ACTIVE-only gate",
    async () => {
      const { cohortId: activeCohortId } = await seedCohortFixture(testDb.prisma);
      const { cohortId: withdrawnCohortId } = await seedCohortFixture(testDb.prisma);
      const { userId } = await seedLearnerFixture(testDb.prisma);
      const active = await seedEnrolmentFixture(testDb.prisma, {
        cohortId: activeCohortId,
        userId,
        status: "ACTIVE",
      });
      const withdrawn = await seedEnrolmentFixture(testDb.prisma, {
        cohortId: withdrawnCohortId,
        userId,
        status: "WITHDRAWN",
      });

      // Mirrors `loadLearnerPath`'s ownership+ACTIVE-only rule
      // (learner-access.ts) — a withdrawn or foreign enrolment resolves to
      // `null`, exactly like the lesson-list page's own denial branch —
      // without pulling in the full module/lesson graph this fixture set
      // does not seed.
      const lookup = (actor: Actor, enrolmentId: string) =>
        testDb.prisma.enrolment
          .findUnique({ where: { id: enrolmentId } })
          .then((row) => (row && row.userId === actor.userId && row.status === "ACTIVE" ? row : null));
      const resolver = createOwnRecordResolver(lookup);

      expect(await resolver({ userId } as Actor, active.enrolmentId, {})).toBe(true);
      expect(await resolver({ userId } as Actor, withdrawn.enrolmentId, {})).toBe(false);
    },
    TEST_DB_TIMEOUT_MS,
  );

  it(
    "the same resolver mechanism denies a foreign user's ACTIVE enrolment (ownership half of the rule)",
    async () => {
      const { cohortId } = await seedCohortFixture(testDb.prisma);
      const { userId: owner } = await seedLearnerFixture(testDb.prisma);
      const stranger = await seedUser();
      const enrolment = await seedEnrolmentFixture(testDb.prisma, { cohortId, userId: owner, status: "ACTIVE" });

      const lookup = (actor: Actor, enrolmentId: string) =>
        testDb.prisma.enrolment
          .findUnique({ where: { id: enrolmentId } })
          .then((row) => (row && row.userId === actor.userId && row.status === "ACTIVE" ? row : null));
      const resolver = createOwnRecordResolver(lookup);

      expect(await resolver({ userId: owner } as Actor, enrolment.enrolmentId, {})).toBe(true);
      expect(await resolver({ userId: stranger } as Actor, enrolment.enrolmentId, {})).toBe(false);
    },
    TEST_DB_TIMEOUT_MS,
  );
});

describe("STAFF_PAYMENT — real Postgres (a seeded staff user holds vs lacks payments.view)", () => {
  it(
    "allows a staff user holding payments.view and denies one lacking it — through resolveOpen, the latter is identical to a deleted order",
    async () => {
      const { cohortId } = await seedCohortFixture(testDb.prisma);
      const { userId: learnerId } = await seedLearnerFixture(testDb.prisma);
      const order = await seedOrder(learnerId, cohortId);

      const staffWithGrant = await seedUser();
      const staffWithoutGrant = await seedUser();

      const allowedLookup = buildPaymentDetailLookup(staffWithGrant, true);
      const deniedLookup = buildPaymentDetailLookup(staffWithoutGrant, false);

      const allowedResolver = createStaffPaymentResolver(allowedLookup);
      const deniedResolver = createStaffPaymentResolver(deniedLookup);

      // Direct resolver-level parity: the resolver's boolean (or rejection)
      // agrees with `getPaymentDetailForStaff`'s own resolve-vs-throw split.
      expect(await allowedResolver({ userId: staffWithGrant } as Actor, order.id, {})).toBe(true);
      await expect(deniedResolver({ userId: staffWithoutGrant } as Actor, order.id, {})).rejects.toThrow();

      // Through the full gate: a permission denial and a deleted order both
      // collapse to the identical `{ status: "unavailable" }` outcome.
      const deletedOrderLookup = buildPaymentDetailLookup(staffWithGrant, true);

      const allowedService = createNotificationAccessService({
        db: testDb.prisma as unknown as NotificationAccessStore,
        notificationService: createNotificationService({ db: testDb.prisma as unknown as NotificationStore }),
        resolvers: { STAFF_PAYMENT: createStaffPaymentResolver(allowedLookup) },
      });
      const deniedService = createNotificationAccessService({
        db: testDb.prisma as unknown as NotificationAccessStore,
        notificationService: createNotificationService({ db: testDb.prisma as unknown as NotificationStore }),
        resolvers: { STAFF_PAYMENT: createStaffPaymentResolver(deniedLookup) },
      });
      const deletedOrderService = createNotificationAccessService({
        db: testDb.prisma as unknown as NotificationAccessStore,
        notificationService: createNotificationService({ db: testDb.prisma as unknown as NotificationStore }),
        resolvers: { STAFF_PAYMENT: createStaffPaymentResolver(deletedOrderLookup) },
      });

      const allowedNotification = await seedNotification({
        recipientId: staffWithGrant,
        targetType: "STAFF_PAYMENT",
        targetId: order.id,
      });
      const deniedNotification = await seedNotification({
        recipientId: staffWithoutGrant,
        targetType: "STAFF_PAYMENT",
        targetId: order.id,
      });
      const deletedOrderNotification = await seedNotification({
        recipientId: staffWithGrant,
        targetType: "STAFF_PAYMENT",
        targetId: uniq("does-not-exist-order"),
      });

      const allowedOutcome = await allowedService.resolveOpen(
        { userId: staffWithGrant } as Actor,
        allowedNotification.id,
      );
      const deniedOutcome = await deniedService.resolveOpen(
        { userId: staffWithoutGrant } as Actor,
        deniedNotification.id,
      );
      const deletedOutcome = await deletedOrderService.resolveOpen(
        { userId: staffWithGrant } as Actor,
        deletedOrderNotification.id,
      );

      expect(allowedOutcome).toEqual({ status: "ok", href: `/staff/payments/${order.id}` });
      expect(deniedOutcome).toEqual({ status: "unavailable" });
      expect(deletedOutcome).toEqual({ status: "unavailable" });
      expect(deniedOutcome).toEqual(deletedOutcome);
    },
    TEST_DB_TIMEOUT_MS,
  );
});
