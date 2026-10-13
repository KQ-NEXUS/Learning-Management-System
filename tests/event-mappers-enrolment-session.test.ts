/**
 * Pure unit coverage for the enrolment-session mapper group (D-07, D-11,
 * D-12, T-13-03, T-13-40) against a fake transaction client — no database
 * needed for the pure branching logic; the real Postgres proof of the
 * `FOR UPDATE SKIP LOCKED` claim order, the raw-SQL supersession/coalescing
 * queries, and `createMany({ skipDuplicates: true })` lives in
 * `tests/enrolment-session-drain.integration.test.ts`.
 *
 * Mappers are looked up through `buildMapperTable(EVENT_MAPPER_GROUPS)` —
 * the same path production code and `tests/support/drain-harness.ts` use —
 * rather than importing `enrolment-session.ts` directly (see
 * `tests/event-mappers-enrolment-payment.test.ts` for the module-cycle
 * rationale).
 */

import { describe, expect, it, vi } from "vitest";
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

type CtxOverrides = {
  enrolment?: {
    findUnique?: (args: unknown) => Promise<unknown>;
    findMany?: (args: unknown) => Promise<unknown[]>;
  };
  cohort?: { findUnique?: (args: unknown) => Promise<unknown> };
  scheduledSession?: { findUnique?: (args: unknown) => Promise<unknown> };
  queryRaw?: (query: unknown) => Promise<unknown[]>;
};

function makeCtx(overrides: CtxOverrides = {}, now: Date = NOW): MapperContext {
  return {
    tx: {
      enrolment: {
        findUnique: overrides.enrolment?.findUnique ?? (async () => null),
        findMany: overrides.enrolment?.findMany ?? (async () => []),
      },
      cohort: {
        findUnique: overrides.cohort?.findUnique ?? (async () => null),
      },
      scheduledSession: {
        findUnique: overrides.scheduledSession?.findUnique ?? (async () => null),
      },
      $queryRaw: overrides.queryRaw ?? (async () => []),
    } as unknown as Prisma.TransactionClient,
    now: () => now,
  };
}

function makeEvent(
  type: DrainEvent["type"],
  payload: Record<string, unknown>,
  occurredAt: Date = NOW,
  id = "evt-1",
): DrainEvent {
  return { id, type, payload, occurredAt };
}

describe("createEnrolmentSessionMappers registration", () => {
  it("registers exactly one mapper for every event type in this group", () => {
    for (const type of [
      "enrolment.withdrawn",
      "enrolment.cancelled",
      "enrolment.transferred",
      "session.cancelled",
      "session.updated",
      "cohort.cancelled",
    ] as const) {
      expect(mapperTable[type]).toHaveLength(1);
    }
  });
});

describe("enrolment.withdrawn / enrolment.cancelled (D-07, T-13-03)", () => {
  it("a withdrawal with a hostile reason mails the learner once and never leaks the reason", async () => {
    const mapper = requireOneMapper("enrolment.withdrawn");
    const ctx = makeCtx({
      enrolment: {
        findUnique: async () => ({
          id: "enr-1",
          userId: "user-1",
          cohort: { title: "March cohort" },
        }),
      },
      // No cohort.cancelled peer exists.
      queryRaw: async () => [],
    });

    const intents = await mapper(
      makeEvent("enrolment.withdrawn", {
        enrolmentId: "enr-1",
        cohortId: "cohort-1",
        actorId: "staff-1",
        reason: "SECRET-REASON",
      }),
      ctx,
    );

    expect(intents).toHaveLength(1);
    expect(intents[0]!.recipientUserId).toBe("user-1");
    expect(intents[0]!.email).toEqual({
      template: "enrolment-withdrawn",
      params: { cohortTitle: "March cohort" },
      correlationId: "evt-1",
    });
    expect(intents[0]!.notification).toEqual({
      type: "enrolment.withdrawn",
      targetType: "LEARNER_DASHBOARD",
      targetId: "enr-1",
      params: { cohortTitle: "March cohort" },
    });
    expect(intents[0]!.skipReason).toBeUndefined();
    const serialized = JSON.stringify(intents[0]);
    expect(serialized).not.toContain("SECRET-REASON");
  });

  it("a cancellation yields the enrolment-cancelled template and notification type", async () => {
    const mapper = requireOneMapper("enrolment.cancelled");
    const ctx = makeCtx({
      enrolment: {
        findUnique: async () => ({
          id: "enr-2",
          userId: "user-2",
          cohort: { title: "April cohort" },
        }),
      },
    });

    const intents = await mapper(
      makeEvent("enrolment.cancelled", {
        enrolmentId: "enr-2",
        cohortId: "cohort-2",
        actorId: "staff-2",
        reason: "no longer needed",
      }),
      ctx,
    );

    expect(intents).toHaveLength(1);
    expect(intents[0]!.email!.template).toBe("enrolment-cancelled");
    expect(intents[0]!.notification!.type).toBe("enrolment.cancelled");
  });

  it("returns no intents when the enrolment no longer exists (edge)", async () => {
    const mapper = requireOneMapper("enrolment.withdrawn");
    const ctx = makeCtx({ enrolment: { findUnique: async () => null } });
    const intents = await mapper(
      makeEvent("enrolment.withdrawn", {
        enrolmentId: "gone",
        cohortId: "cohort-x",
        actorId: "staff-1",
        reason: "n/a",
      }),
      ctx,
    );
    expect(intents).toEqual([]);
  });

  it("supersedes the mail with superseded_by_cohort_cancellation and no notification when a matching cohort.cancelled peer exists (Task 3)", async () => {
    const mapper = requireOneMapper("enrolment.withdrawn");
    const queryRaw = vi.fn(async () => [{ id: "cohort-evt-1" }]);
    const ctx = makeCtx({
      enrolment: {
        findUnique: async () => ({
          id: "enr-3",
          userId: "user-3",
          cohort: { title: "May cohort" },
        }),
      },
      queryRaw,
    });

    const intents = await mapper(
      makeEvent("enrolment.withdrawn", {
        enrolmentId: "enr-3",
        cohortId: "cohort-3",
        actorId: "staff-3",
        reason: "cohort cancelled",
      }),
      ctx,
    );

    expect(intents).toHaveLength(1);
    expect(intents[0]!.skipReason).toBe("superseded_by_cohort_cancellation");
    expect(intents[0]!.notification).toBeUndefined();
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it("a single staff withdrawal with no cohort.cancelled peer is mailed normally (D-07 edge)", async () => {
    const mapper = requireOneMapper("enrolment.withdrawn");
    const ctx = makeCtx({
      enrolment: {
        findUnique: async () => ({
          id: "enr-4",
          userId: "user-4",
          cohort: { title: "June cohort" },
        }),
      },
      queryRaw: async () => [],
    });

    const intents = await mapper(
      makeEvent("enrolment.withdrawn", {
        enrolmentId: "enr-4",
        cohortId: "cohort-4",
        actorId: "staff-4",
        reason: "individual withdrawal",
      }),
      ctx,
    );

    expect(intents).toHaveLength(1);
    expect(intents[0]!.skipReason).toBeUndefined();
    expect(intents[0]!.notification).toBeDefined();
  });
});

describe("enrolment.transferred (D-07)", () => {
  it("mails the source enrolment's learner once with both cohort titles and the target enrolment path", async () => {
    const mapper = requireOneMapper("enrolment.transferred");
    const ctx = makeCtx({
      enrolment: {
        findUnique: async () => ({
          userId: "user-5",
          cohort: { title: "July cohort" },
        }),
      },
      cohort: { findUnique: async () => ({ title: "August cohort" }) },
    });

    const intents = await mapper(
      makeEvent("enrolment.transferred", {
        sourceEnrolmentId: "src-enr",
        targetEnrolmentId: "tgt-enr",
        sourceCohortId: "cohort-src",
        targetCohortId: "cohort-tgt",
        actorId: "staff-5",
      }),
      ctx,
    );

    expect(intents).toHaveLength(1);
    expect(intents[0]!.recipientUserId).toBe("user-5");
    expect(intents[0]!.email).toEqual({
      template: "enrolment-transferred",
      params: {
        fromCohortTitle: "July cohort",
        toCohortTitle: "August cohort",
        enrolmentPath: "/learn/tgt-enr",
      },
      correlationId: "evt-1",
    });
    expect(intents[0]!.notification).toEqual({
      type: "enrolment.transferred",
      targetType: "LEARNER_ENROLMENT",
      targetId: "tgt-enr",
      params: { fromCohortTitle: "July cohort", toCohortTitle: "August cohort" },
    });
  });

  it("returns no intents when the source enrolment no longer exists (edge)", async () => {
    const mapper = requireOneMapper("enrolment.transferred");
    const ctx = makeCtx({ enrolment: { findUnique: async () => null } });
    const intents = await mapper(
      makeEvent("enrolment.transferred", {
        sourceEnrolmentId: "gone",
        targetEnrolmentId: "tgt-enr",
        sourceCohortId: "cohort-src",
        targetCohortId: "cohort-tgt",
        actorId: "staff-5",
      }),
      ctx,
    );
    expect(intents).toEqual([]);
  });
});

describe("session.cancelled (D-11)", () => {
  it("mails every ACTIVE learner once and none of the others", async () => {
    const mapper = requireOneMapper("session.cancelled");
    const ctx = makeCtx({
      scheduledSession: {
        findUnique: async () => ({
          title: "Kickoff session",
          startsAt: new Date("2026-02-01T10:00:00.000Z"),
          cohort: { title: "September cohort" },
        }),
      },
      enrolment: {
        findMany: async () => [
          { id: "enr-a", userId: "user-a" },
          { id: "enr-b", userId: "user-b" },
        ],
      },
    });

    const intents = await mapper(
      makeEvent("session.cancelled", {
        sessionId: "sess-1",
        cohortId: "cohort-9",
        actorId: "staff-6",
        reason: "instructor unavailable",
      }),
      ctx,
    );

    expect(intents).toHaveLength(2);
    expect(intents.map((i) => i.recipientUserId).sort()).toEqual(["user-a", "user-b"]);
    expect(intents[0]!.email!.template).toBe("session-cancelled");
    expect(intents[0]!.email!.params).toEqual({
      sessionTitle: "Kickoff session",
      cohortTitle: "September cohort",
      startsAtIso: "2026-02-01T10:00:00.000Z",
      sessionsPath: `/learn/${intents[0]!.notification!.targetId}/sessions`,
    });
    expect(intents[0]!.email!.correlationId).toBe(`evt-1:${intents[0]!.recipientUserId}`);
    expect(intents[0]!.notification!.type).toBe("session.cancelled");
    expect(intents[0]!.notification!.targetType).toBe("LEARNER_SESSIONS");
  });

  it("returns no intents when the session no longer exists (edge)", async () => {
    const mapper = requireOneMapper("session.cancelled");
    const ctx = makeCtx({ scheduledSession: { findUnique: async () => null } });
    const intents = await mapper(
      makeEvent("session.cancelled", {
        sessionId: "gone",
        cohortId: "cohort-9",
        actorId: "staff-6",
        reason: "n/a",
      }),
      ctx,
    );
    expect(intents).toEqual([]);
  });

  it("never leaks the cancellation reason", async () => {
    const mapper = requireOneMapper("session.cancelled");
    const ctx = makeCtx({
      scheduledSession: {
        findUnique: async () => ({
          title: "Kickoff session",
          startsAt: new Date("2026-02-01T10:00:00.000Z"),
          cohort: { title: "September cohort" },
        }),
      },
      enrolment: { findMany: async () => [{ id: "enr-a", userId: "user-a" }] },
    });
    const intents = await mapper(
      makeEvent("session.cancelled", {
        sessionId: "sess-1",
        cohortId: "cohort-9",
        actorId: "staff-6",
        reason: "SECRET-CANCEL-REASON",
      }),
      ctx,
    );
    expect(JSON.stringify(intents)).not.toContain("SECRET-CANCEL-REASON");
  });

  it("returns no intents for a cohort with no ACTIVE enrolments (D-11)", async () => {
    const mapper = requireOneMapper("session.cancelled");
    const ctx = makeCtx({
      scheduledSession: {
        findUnique: async () => ({
          title: "Kickoff session",
          startsAt: new Date("2026-02-01T10:00:00.000Z"),
          cohort: { title: "September cohort" },
        }),
      },
      enrolment: { findMany: async () => [] },
    });
    const intents = await mapper(
      makeEvent("session.cancelled", {
        sessionId: "sess-1",
        cohortId: "cohort-9",
        actorId: "staff-6",
        reason: "n/a",
      }),
      ctx,
    );
    expect(intents).toEqual([]);
  });
});

describe("session.updated (A-01, D-12)", () => {
  const baseSession = {
    title: "Week 2 session",
    startsAt: new Date("2026-03-01T10:00:00.000Z"),
    endsAt: new Date("2026-03-01T12:00:00.000Z"),
    location: null as string | null,
    cancelledAt: null as Date | null,
    cohortId: "cohort-10",
    cohort: { title: "October cohort" },
  };

  it("returns one session-updated intent per ACTIVE learner reading the session's current details", async () => {
    const mapper = requireOneMapper("session.updated");
    const ctx = makeCtx({
      scheduledSession: { findUnique: async () => baseSession },
      enrolment: { findMany: async () => [{ id: "enr-c", userId: "user-c" }] },
      queryRaw: async () => [], // no cancellation event, no newer pending update
    });

    const intents = await mapper(
      makeEvent("session.updated", { sessionId: "sess-2", changedFields: ["startsAt"] }, new Date("2026-01-01T00:00:00.000Z"), "evt-A"),
      ctx,
    );

    expect(intents).toHaveLength(1);
    expect(intents[0]!.email!.template).toBe("session-updated");
    expect(intents[0]!.email!.params).toEqual({
      sessionTitle: "Week 2 session",
      cohortTitle: "October cohort",
      startsAtIso: "2026-03-01T10:00:00.000Z",
      endsAtIso: "2026-03-01T12:00:00.000Z",
      sessionsPath: "/learn/enr-c/sessions",
    });
    expect(intents[0]!.skipReason).toBeUndefined();
    expect(intents[0]!.notification!.type).toBe("session.updated");
  });

  it("includes location only when the session has one", async () => {
    const mapper = requireOneMapper("session.updated");
    const ctx = makeCtx({
      scheduledSession: { findUnique: async () => ({ ...baseSession, location: "Room 4B" }) },
      enrolment: { findMany: async () => [{ id: "enr-c", userId: "user-c" }] },
      queryRaw: async () => [],
    });
    const intents = await mapper(makeEvent("session.updated", { sessionId: "sess-2" }), ctx);
    expect(intents[0]!.email!.params).toMatchObject({ location: "Room 4B" });
  });

  it("returns no intents when the session no longer exists (edge)", async () => {
    const mapper = requireOneMapper("session.updated");
    const ctx = makeCtx({ scheduledSession: { findUnique: async () => null } });
    const intents = await mapper(makeEvent("session.updated", { sessionId: "gone" }), ctx);
    expect(intents).toEqual([]);
  });

  it("returns no intents when there are no ACTIVE enrolments (D-11)", async () => {
    const mapper = requireOneMapper("session.updated");
    const ctx = makeCtx({
      scheduledSession: { findUnique: async () => baseSession },
      enrolment: { findMany: async () => [] },
    });
    const intents = await mapper(makeEvent("session.updated", { sessionId: "sess-2" }), ctx);
    expect(intents).toEqual([]);
  });

  it("is coalesced_into_later_update when a newer unprocessed session.updated exists for the same session, with no notification", async () => {
    const mapper = requireOneMapper("session.updated");
    const queryRaw = vi.fn(async (q: unknown) => {
      const text = String((q as { sql?: string; strings?: string[] }).sql ?? (q as { strings?: string[] }).strings?.join(""));
      if (text.includes("session.cancelled")) return [];
      return [{ id: "evt-newer" }];
    });
    const ctx = makeCtx({
      scheduledSession: { findUnique: async () => baseSession },
      enrolment: { findMany: async () => [{ id: "enr-c", userId: "user-c" }] },
      queryRaw,
    });

    const intents = await mapper(makeEvent("session.updated", { sessionId: "sess-2" }), ctx);

    expect(intents).toHaveLength(1);
    expect(intents[0]!.skipReason).toBe("coalesced_into_later_update");
    expect(intents[0]!.notification).toBeUndefined();
    expect(intents[0]!.recipientUserId).toBe("user-c");
  });

  it("is superseded_by_session_cancellation when the session row's cancelledAt is set, taking precedence over coalescing", async () => {
    const mapper = requireOneMapper("session.updated");
    const queryRaw = vi.fn(async () => [{ id: "evt-newer" }]); // would ALSO look coalesced
    const ctx = makeCtx({
      scheduledSession: {
        findUnique: async () => ({ ...baseSession, cancelledAt: new Date("2026-03-02T00:00:00.000Z") }),
      },
      enrolment: { findMany: async () => [{ id: "enr-c", userId: "user-c" }] },
      queryRaw,
    });

    const intents = await mapper(makeEvent("session.updated", { sessionId: "sess-2" }), ctx);

    expect(intents).toHaveLength(1);
    expect(intents[0]!.skipReason).toBe("superseded_by_session_cancellation");
    expect(intents[0]!.notification).toBeUndefined();
    // cancelledAt alone is enough to short-circuit; the coalescing lookup
    // (and even the session.cancelled event lookup) never runs at all.
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("never leaks a changedFields payload value into persisted params", async () => {
    const mapper = requireOneMapper("session.updated");
    const ctx = makeCtx({
      scheduledSession: { findUnique: async () => baseSession },
      enrolment: { findMany: async () => [{ id: "enr-c", userId: "user-c" }] },
      queryRaw: async () => [],
    });
    const intents = await mapper(
      makeEvent("session.updated", { sessionId: "sess-2", changedFields: ["SECRET-INTERNAL-FIELD"] }),
      ctx,
    );
    expect(JSON.stringify(intents)).not.toContain("SECRET-INTERNAL-FIELD");
  });
});

describe("cohort.cancelled (D-07, Pitfall 4, T-13-39)", () => {
  it("mails one distinct user per superseded enrolment id, never the reason", async () => {
    const mapper = requireOneMapper("cohort.cancelled");
    const queryRaw = vi.fn(async () => [{ enrolmentId: "enr-x" }, { enrolmentId: "enr-y" }]);
    const ctx = makeCtx({
      queryRaw,
      enrolment: {
        findMany: async () => [
          { id: "enr-x", userId: "user-x" },
          { id: "enr-y", userId: "user-y" },
        ],
      },
      cohort: { findUnique: async () => ({ title: "November cohort" }) },
    });

    const intents = await mapper(
      makeEvent("cohort.cancelled", {
        cohortId: "cohort-11",
        actorId: "staff-7",
        reason: "SECRET-COHORT-REASON",
      }),
      ctx,
    );

    expect(intents).toHaveLength(2);
    expect(intents.map((i) => i.recipientUserId).sort()).toEqual(["user-x", "user-y"]);
    for (const intent of intents) {
      expect(intent.email).toEqual({
        template: "cohort-cancelled",
        params: { cohortTitle: "November cohort" },
        correlationId: `evt-1:${intent.recipientUserId}`,
      });
      expect(intent.notification!.type).toBe("cohort.cancelled");
      expect(intent.notification!.targetType).toBe("LEARNER_DASHBOARD");
      expect(intent.skipReason).toBeUndefined();
    }
    expect(JSON.stringify(intents)).not.toContain("SECRET-COHORT-REASON");
  });

  it("returns no intents when no superseded enrolment ids are found (nobody affected)", async () => {
    const mapper = requireOneMapper("cohort.cancelled");
    const ctx = makeCtx({ queryRaw: async () => [] });
    const intents = await mapper(
      makeEvent("cohort.cancelled", { cohortId: "cohort-12", actorId: "staff-8", reason: "n/a" }),
      ctx,
    );
    expect(intents).toEqual([]);
  });

  it("de-duplicates when the same user appears behind more than one superseded enrolment id", async () => {
    const mapper = requireOneMapper("cohort.cancelled");
    const ctx = makeCtx({
      queryRaw: async () => [{ enrolmentId: "enr-x" }, { enrolmentId: "enr-x-dup" }],
      enrolment: {
        findMany: async () => [
          { id: "enr-x", userId: "user-x" },
          { id: "enr-x-dup", userId: "user-x" },
        ],
      },
      cohort: { findUnique: async () => ({ title: "December cohort" }) },
    });
    const intents = await mapper(
      makeEvent("cohort.cancelled", { cohortId: "cohort-13", actorId: "staff-9", reason: "n/a" }),
      ctx,
    );
    expect(intents).toHaveLength(1);
    expect(intents[0]!.recipientUserId).toBe("user-x");
  });
});
