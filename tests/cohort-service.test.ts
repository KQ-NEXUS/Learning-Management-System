/**
 * Plan 05-05: the Cohort service.
 *
 * Driven by in-memory fake delegates plus a harness-built `withPermission`
 * (`createTestWithPermission` — GLOBAL grants for the data-semantics cases, a
 * deliberately scoped or missing grant for the authorization cases). No real
 * Postgres: the offer-lock guard, the publish gate, the pin selection and the
 * stale-token refusal are all provable against fakes.
 */

import { describe, expect, it, vi } from "vitest";
import { createTestWithPermission, grant } from "./support/harness";
import {
  createCohortService,
  createCohortGuards,
  OfferLockedError,
  CohortReadinessRefusedError,
  NoPublishedOfferError,
  CohortCancelBlockedError,
  type CohortRecord,
  type CohortAggregateRow,
  type CohortPublishTx,
} from "@/server/services/cohort-service";
import { AuthorizationError } from "@/server/permissions/with-permission";
import { StaleOrderError } from "@/server/services/reorder-service";
import { CohortNotFoundError } from "@/server/services/seat-accounting";
import { ReasonRequiredError } from "@/server/services/enrolment-service";
import { type Delegate } from "@/server/services/resource-service";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const COHORT_START = new Date("2026-03-01T09:00:00.000Z");
const COHORT_END = new Date("2026-04-01T17:00:00.000Z");
const SESSION_START = new Date("2026-03-05T09:00:00.000Z");
const SESSION_END = new Date("2026-03-05T11:00:00.000Z");
const NOW = new Date("2026-02-15T00:00:00.000Z");

function makeCohortRow(over: Partial<CohortRecord> = {}): CohortRecord {
  return {
    id: "cohort-1",
    code: "C1",
    title: "Cohort One",
    courseId: "course-1",
    programmeId: null,
    deliveryMode: "INSTRUCTOR_LED",
    timezone: "Africa/Lagos",
    startsAt: COHORT_START,
    endsAt: COHORT_END,
    enrolmentOpensAt: new Date("2026-02-01T00:00:00.000Z"),
    enrolmentClosesAt: new Date("2026-02-28T00:00:00.000Z"),
    capacity: 20,
    seatsTaken: 0,
    priceMinor: 50000,
    currency: "NGN",
    status: "DRAFT",
    publishedAt: null,
    attendanceThresholdPct: null,
    coursePublicationId: null,
    programmePublicationId: null,
    holdMinutes: 30,
    updatedAt: T0,
    ...over,
  };
}

function readyAggregateRow(over: Partial<CohortAggregateRow> = {}): CohortAggregateRow {
  return {
    status: "DRAFT",
    deliveryMode: "INSTRUCTOR_LED",
    startsAt: COHORT_START,
    endsAt: COHORT_END,
    capacity: 20,
    seatsTaken: 0,
    priceMinor: 50000,
    currency: "NGN",
    attendanceThresholdPct: null,
    courseId: "course-1",
    programmeId: null,
    scheduledSessions: [
      { startsAt: SESSION_START, endsAt: SESSION_END, cancelledAt: null },
    ],
    _count: { instructors: 1 },
    course: {
      status: "PUBLISHED",
      publications: [{ id: "pub-1", payload: { completionRule: { kind: "ALL_REQUIRED" } } }],
    },
    programme: null,
    ...over,
  };
}

type TxFake = {
  cohort: { updateMany: ReturnType<typeof vi.fn> };
  domainEvent: { create: ReturnType<typeof vi.fn> };
};

function makeTx(over?: Partial<TxFake>): TxFake {
  return {
    cohort: { updateMany: vi.fn(async () => ({ count: 1 })) },
    domainEvent: { create: vi.fn(async () => ({ id: "evt-1" })) },
    ...over,
  };
}

function harness(opts?: {
  grants?: ReturnType<typeof grant>[];
  rows?: CohortRecord[];
  enrolmentCount?: number;
  aggregateRow?: CohortAggregateRow | null;
  tx?: TxFake;
}) {
  const rows = new Map(
    (opts?.rows ?? [makeCohortRow()]).map((r) => [r.id, r] as const),
  );
  const audits: Array<Record<string, unknown>> = [];

  const delegate: Delegate<CohortRecord> = {
    findMany: vi.fn(async () => [...rows.values()]),
    findUnique: vi.fn(async ({ where }) => rows.get(where.id) ?? null),
    create: vi.fn(async ({ data }) => {
      const row = makeCohortRow({ id: "cohort-new", ...(data as Partial<CohortRecord>) });
      rows.set(row.id, row);
      return row;
    }),
    update: vi.fn(async ({ where, data }) => {
      const next = { ...(rows.get(where.id) as CohortRecord), ...(data as Partial<CohortRecord>) };
      rows.set(where.id, next);
      return next;
    }),
  };

  const enrolment = { count: vi.fn(async () => opts?.enrolmentCount ?? 0) };
  const aggregateRow: CohortAggregateRow | null =
    opts && "aggregateRow" in opts ? (opts.aggregateRow ?? null) : readyAggregateRow();
  const aggregate = { findUnique: vi.fn(async () => aggregateRow) };
  const tx = opts?.tx ?? makeTx();

  const { withPermission } = createTestWithPermission(
    opts?.grants ?? [
      grant("cohorts.view"),
      grant("cohorts.manage"),
      grant("cohorts.publish"),
    ],
  );

  const service = createCohortService({
    delegate,
    enrolment,
    aggregate,
    db: { $transaction: async (fn) => fn(tx as unknown as CohortPublishTx) },
    toScope: (id) => ({ cohortId: id, courseIds: ["course-1"] }),
    withPermission,
    audit: async (entry) => {
      audits.push(entry as unknown as Record<string, unknown>);
    },
    runInTransaction: (fn) => fn(),
    now: () => NOW,
  });

  return { service, delegate, enrolment, aggregate, tx, audits, rows };
}

describe("createCohortGuards / assertOfferMutable (D-30)", () => {
  it("resolves when zero Enrolment rows exist for the cohort", async () => {
    const { assertOfferMutable } = createCohortGuards({
      enrolment: { count: vi.fn(async () => 0) },
    });
    await expect(assertOfferMutable("cohort-1")).resolves.toBeUndefined();
  });

  it("throws OfferLockedError when an Enrolment exists in ANY status, and never filters by status", async () => {
    // A WITHDRAWN / CANCELLED / TRANSFERRED enrolment still locks the offer
    // target — the guard counts rows with no status filter at all.
    const count = vi.fn(async (args: unknown) => {
      expect(args).toEqual({ where: { cohortId: "cohort-1" } });
      return 1;
    });
    const { assertOfferMutable } = createCohortGuards({ enrolment: { count } });
    await expect(assertOfferMutable("cohort-1")).rejects.toBeInstanceOf(OfferLockedError);
    expect(count).toHaveBeenCalledTimes(1);
  });

  it("OfferLockedError carries the cohort id and the enrolment count", async () => {
    const { assertOfferMutable } = createCohortGuards({
      enrolment: { count: vi.fn(async () => 3) },
    });
    const err = await assertOfferMutable("cohort-1").catch((e) => e);
    expect(err).toBeInstanceOf(OfferLockedError);
    expect(err.cohortId).toBe("cohort-1");
    expect(err.enrolmentCount).toBe(3);
  });
});

describe("cohortService — factory CRUD", () => {
  it("lists with a GLOBAL view grant", async () => {
    const { service } = harness({ grants: [grant("cohorts.view")] });
    await expect(service.cohortService.list({})).resolves.toHaveLength(1);
  });

  it("refuses an unscoped list when the only grant is COHORT-scoped", async () => {
    const { service, delegate } = harness({
      grants: [grant("cohorts.view", "COHORT", "cohort-1")],
    });
    await expect(service.cohortService.list({})).rejects.toBeInstanceOf(AuthorizationError);
    expect(delegate.findMany).not.toHaveBeenCalled();
  });

  it("denies get for a cohort outside the caller's grant, with the same message as a missing row", async () => {
    const { service } = harness({
      grants: [grant("cohorts.view", "COHORT", "other-cohort")],
    });
    await expect(service.cohortService.get("cohort-1")).rejects.toThrow(
      "You do not have access",
    );
    await expect(service.cohortService.get("does-not-exist")).rejects.toThrow(
      "You do not have access",
    );
  });

  it("creates and audits actor, after-state and a SUCCESS outcome", async () => {
    const { service, audits } = harness({ grants: [grant("cohorts.manage")] });
    await service.cohortService.create({
      code: "C2",
      title: "Cohort Two",
      courseId: "course-1",
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "cohort.created",
      targetType: "Cohort",
      outcome: "SUCCESS",
      actorId: "user-1",
    });
    expect(audits[0].after).toBeTruthy();
  });

  it("archive writes status CANCELLED and there is no delete operation", async () => {
    const { service, delegate } = harness({ grants: [grant("cohorts.manage")] });
    await service.cohortService.archive("cohort-1", "Cancelled by operations");
    expect(delegate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELLED" }),
      }),
    );
    expect((service.cohortService as Record<string, unknown>).delete).toBeUndefined();
    expect((delegate as Record<string, unknown>).delete).toBeUndefined();
  });
});

describe("updateCohort — the D-30 offer-lock wrapper", () => {
  it("throws OfferLockedError when courseId changes on a cohort with enrolments", async () => {
    const { service } = harness({ enrolmentCount: 2 });
    await expect(
      service.updateCohort({ id: "cohort-1", data: { courseId: "course-2" } }),
    ).rejects.toBeInstanceOf(OfferLockedError);
  });

  it("throws OfferLockedError when programmeId changes on a cohort with enrolments", async () => {
    const { service } = harness({ enrolmentCount: 1 });
    await expect(
      service.updateCohort({ id: "cohort-1", data: { programmeId: "programme-9" } }),
    ).rejects.toBeInstanceOf(OfferLockedError);
  });

  it("allows an update that leaves both offer columns unchanged, even with enrolments", async () => {
    const { service, delegate } = harness({ enrolmentCount: 5 });
    await service.updateCohort({ id: "cohort-1", data: { title: "Renamed cohort" } });
    expect(delegate.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: "Renamed cohort" }) }),
    );
  });

  it("does not lock when the submitted courseId equals the stored one", async () => {
    const { service, delegate, enrolment } = harness({ enrolmentCount: 5 });
    await service.updateCohort({ id: "cohort-1", data: { courseId: "course-1" } });
    expect(enrolment.count).not.toHaveBeenCalled();
    expect(delegate.update).toHaveBeenCalled();
  });

  it("requires cohorts.manage", async () => {
    const { service } = harness({ grants: [grant("cohorts.view")] });
    await expect(
      service.updateCohort({ id: "cohort-1", data: { title: "x" } }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("loadCohortReadinessAggregate", () => {
  it("builds a ReadinessCohortInput from the cohort row, its sessions, instructor count and pinned publication", async () => {
    const row = readyAggregateRow({
      seatsTaken: 3,
      attendanceThresholdPct: 75,
      _count: { instructors: 2 },
      scheduledSessions: [
        { startsAt: SESSION_START, endsAt: SESSION_END, cancelledAt: null },
        {
          startsAt: SESSION_START,
          endsAt: SESSION_END,
          cancelledAt: new Date("2026-03-04T00:00:00.000Z"),
        },
      ],
    });
    const { service } = harness({ aggregateRow: row });
    const input = await service.loadCohortReadinessAggregate("cohort-1");
    expect(input).toMatchObject({
      deliveryMode: "INSTRUCTOR_LED",
      capacity: 20,
      seatsTaken: 3,
      priceMinor: 50000,
      currency: "NGN",
      attendanceThresholdPct: 75,
      instructorCount: 2,
      nonCancelledSessionCount: 1,
      pin: {
        kind: "course",
        publicationId: "pub-1",
        targetStatus: "PUBLISHED",
        completionRule: { kind: "ALL_REQUIRED" },
      },
    });
    expect(input?.sessions).toHaveLength(2);
  });

  it("resolves the pin from the programme side for a programme cohort", async () => {
    const row = readyAggregateRow({
      courseId: null,
      programmeId: "programme-1",
      course: null,
      programme: {
        status: "PUBLISHED",
        publications: [{ id: "ppub-7", payload: { completionRule: null } }],
      },
    });
    const { service } = harness({ aggregateRow: row });
    const input = await service.loadCohortReadinessAggregate("cohort-1");
    expect(input?.pin).toMatchObject({
      kind: "programme",
      publicationId: "ppub-7",
      targetStatus: "PUBLISHED",
      completionRule: null,
    });
  });

  it("returns null for a missing cohort", async () => {
    const { service } = harness({ aggregateRow: null });
    await expect(service.loadCohortReadinessAggregate("nope")).resolves.toBeNull();
  });
});

describe("publishCohort — permission-, readiness- and token-gated", () => {
  it("requires cohorts.publish — a cohorts.manage-only caller is denied", async () => {
    const { service, tx } = harness({
      grants: [grant("cohorts.view"), grant("cohorts.manage")],
    });
    await expect(
      service.publishCohort({ cohortId: "cohort-1", expectedUpdatedAt: T0 }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(tx.cohort.updateMany).not.toHaveBeenCalled();
  });

  it("throws CohortNotFoundError when the cohort does not exist", async () => {
    const { service } = harness({ aggregateRow: null });
    await expect(
      service.publishCohort({ cohortId: "gone", expectedUpdatedAt: T0 }),
    ).rejects.toBeInstanceOf(CohortNotFoundError);
  });

  it("throws NoPublishedOfferError when the offer target has no publication row", async () => {
    const row = readyAggregateRow({ course: { status: "DRAFT", publications: [] } });
    const { service, tx } = harness({ aggregateRow: row });
    await expect(
      service.publishCohort({ cohortId: "cohort-1", expectedUpdatedAt: T0 }),
    ).rejects.toBeInstanceOf(NoPublishedOfferError);
    expect(tx.cohort.updateMany).not.toHaveBeenCalled();
  });

  it("throws CohortReadinessRefusedError carrying the failing items, and writes nothing", async () => {
    const row = readyAggregateRow({ _count: { instructors: 0 } });
    const { service, tx } = harness({ aggregateRow: row });
    const err = await service
      .publishCohort({ cohortId: "cohort-1", expectedUpdatedAt: T0 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(CohortReadinessRefusedError);
    expect(err.failures.map((f: { id: string }) => f.id)).toContain("instructors");
    expect(tx.cohort.updateMany).not.toHaveBeenCalled();
    expect(tx.domainEvent.create).not.toHaveBeenCalled();
  });

  it("on success pins the latest publication, sets status + publishedAt, emits one event and audits after commit", async () => {
    const captured: Array<Record<string, unknown>> = [];
    const tx = makeTx({
      cohort: {
        updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          captured.push(data);
          return { count: 1 };
        }),
      },
    });
    const { service, audits } = harness({ tx });
    await service.publishCohort({
      cohortId: "cohort-1",
      expectedUpdatedAt: T0,
      reason: "All blocking checks pass",
    });

    expect(tx.cohort.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cohort-1", updatedAt: T0 } }),
    );
    expect(captured[0]).toMatchObject({
      status: "PUBLISHED",
      coursePublicationId: "pub-1",
    });
    expect(captured[0].publishedAt).toBeInstanceOf(Date);

    expect(tx.domainEvent.create).toHaveBeenCalledTimes(1);
    const evt = tx.domainEvent.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(evt.type).toBe("cohort.published");
    expect(evt.payload).toMatchObject({ cohortId: "cohort-1", publicationId: "pub-1" });

    expect(
      audits.some((a) => a.action === "cohort.published" && a.outcome === "SUCCESS"),
    ).toBe(true);
  });

  it("pins the programmePublicationId column for a programme cohort", async () => {
    const captured: Array<Record<string, unknown>> = [];
    const tx = makeTx({
      cohort: {
        updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          captured.push(data);
          return { count: 1 };
        }),
      },
    });
    const row = readyAggregateRow({
      courseId: null,
      programmeId: "programme-1",
      course: null,
      programme: {
        status: "PUBLISHED",
        publications: [{ id: "ppub-3", payload: { completionRule: { kind: "ALL_COURSES" } } }],
      },
    });
    const { service } = harness({ aggregateRow: row, tx });
    await service.publishCohort({ cohortId: "cohort-1", expectedUpdatedAt: T0 });
    expect(captured[0]).toMatchObject({ programmePublicationId: "ppub-3" });
    expect(captured[0].coursePublicationId).toBeUndefined();
  });

  it("throws StaleOrderError and writes no event when expectedUpdatedAt is stale", async () => {
    const tx = makeTx({ cohort: { updateMany: vi.fn(async () => ({ count: 0 })) } });
    const { service } = harness({ tx });
    await expect(
      service.publishCohort({
        cohortId: "cohort-1",
        expectedUpdatedAt: new Date("2020-01-01"),
      }),
    ).rejects.toBeInstanceOf(StaleOrderError);
    expect(tx.domainEvent.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// cancelCohort (D-31) — Task 1
//
// Driven by its own staged-commit fake `$transaction` (the same idiom
// `tests/enrolment-service.test.ts` uses for `db.$transaction`): a mutation
// made inside the callback is only applied to the outer store if the
// callback resolves, so a mid-loop throw genuinely proves nothing partial
// survives — not just "the mock wasn't asked to persist it".
// ---------------------------------------------------------------------------

type CancelEnrolmentRow = {
  id: string;
  userId: string;
  cohortId: string;
  status: string;
  holdExpiresAt: Date | null;
  activatedAt: Date | null;
  withdrawnAt: Date | null;
  reason: string | null;
  orderId: string | null;
  transferredFromId: string | null;
};

function cancelEnr(over: Partial<CancelEnrolmentRow> = {}): CancelEnrolmentRow {
  return {
    id: over.id ?? "enr-1",
    userId: over.userId ?? "user-1",
    cohortId: over.cohortId ?? "cohort-1",
    status: over.status ?? "ACTIVE",
    holdExpiresAt: over.holdExpiresAt ?? null,
    activatedAt: over.activatedAt ?? null,
    withdrawnAt: over.withdrawnAt ?? null,
    reason: over.reason ?? null,
    orderId: over.orderId ?? null,
    transferredFromId: over.transferredFromId ?? null,
  };
}

type CancelSessionRow = {
  id: string;
  cancelledAt: Date | null;
  cancellationReason: string | null;
};

function cancelSession(over: Partial<CancelSessionRow> = {}): CancelSessionRow {
  return {
    id: over.id ?? "session-1",
    cancelledAt: over.cancelledAt ?? null,
    cancellationReason: over.cancellationReason ?? null,
  };
}

function cancelHarness(opts?: {
  grants?: ReturnType<typeof grant>[];
  cohortRow?: CohortRecord;
  enrolments?: CancelEnrolmentRow[];
  sessions?: CancelSessionRow[];
  failOnEnrolmentId?: string;
}) {
  const cohortRow = opts?.cohortRow ?? makeCohortRow({ status: "PUBLISHED", seatsTaken: 3 });
  const cohorts = new Map<string, CohortRecord>([[cohortRow.id, cohortRow]]);
  const enrolments = new Map<string, CancelEnrolmentRow>(
    (opts?.enrolments ?? []).map((e) => [e.id, { ...e }]),
  );
  const sessions = new Map<string, CancelSessionRow>(
    (opts?.sessions ?? []).map((s) => [s.id, { ...s }]),
  );
  const audits: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];

  const cloneMap = <V,>(m: Map<string, V>) =>
    new Map<string, V>([...m].map(([k, v]) => [k, { ...(v as object) } as V]));

  function makeTx(
    cStore: Map<string, CohortRecord>,
    eStore: Map<string, CancelEnrolmentRow>,
    sStore: Map<string, CancelSessionRow>,
    evStore: Array<Record<string, unknown>>,
  ) {
    return {
      $queryRaw: async (_s: TemplateStringsArray, ...vals: unknown[]) => {
        const c = cStore.get(vals[0] as string);
        return c ? [{ seatsTaken: c.seatsTaken, capacity: c.capacity }] : [];
      },
      $executeRaw: async (_s: TemplateStringsArray, ...vals: unknown[]) => {
        const c = cStore.get(vals[0] as string);
        if (c) c.seatsTaken = Math.max(c.seatsTaken - 1, 0);
        return 1;
      },
      enrolment: {
        findMany: async ({
          where,
        }: {
          where: { cohortId: string; status: { in: string[] } };
        }) =>
          [...eStore.values()].filter(
            (e) => e.cohortId === where.cohortId && where.status.in.includes(e.status),
          ),
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          if (opts?.failOnEnrolmentId && where.id === opts.failOnEnrolmentId) {
            throw new Error("simulated mid-loop failure");
          }
          const row = eStore.get(where.id);
          if (!row) throw new Error(`no such enrolment ${where.id}`);
          Object.assign(row, data);
          return row;
        },
      },
      cohort: {
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const c = cStore.get(where.id) as CohortRecord;
          const s = data.seatsTaken as
            | { increment?: number; decrement?: number }
            | undefined;
          if (s?.increment) c.seatsTaken += s.increment;
          if (s?.decrement) c.seatsTaken -= s.decrement;
          return c;
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: { id: string; updatedAt: Date };
          data: Record<string, unknown>;
        }) => {
          const c = cStore.get(where.id);
          if (!c || c.updatedAt.getTime() !== where.updatedAt.getTime()) {
            return { count: 0 };
          }
          Object.assign(c, data);
          return { count: 1 };
        },
      },
      scheduledSession: {
        findMany: async ({ where }: { where: { cohortId: string; cancelledAt: null } }) =>
          [...sStore.values()].filter(
            (s) => s.cancelledAt === where.cancelledAt,
          ),
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = sStore.get(where.id);
          if (!row) throw new Error(`no such session ${where.id}`);
          Object.assign(row, data);
          return row;
        },
      },
      domainEvent: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          evStore.push(data);
          return { id: `evt-${evStore.length}` };
        },
      },
    };
  }

  const db = {
    $transaction: async <R,>(fn: (tx: CohortPublishTx) => Promise<R>): Promise<R> => {
      const cStaged = cloneMap(cohorts);
      const eStaged = cloneMap(enrolments);
      const sStaged = cloneMap(sessions);
      const evStaged: Array<Record<string, unknown>> = [];
      const result = await fn(
        makeTx(cStaged, eStaged, sStaged, evStaged) as unknown as CohortPublishTx,
      );
      for (const [k, v] of cStaged) cohorts.set(k, v);
      for (const [k, v] of eStaged) enrolments.set(k, v);
      for (const [k, v] of sStaged) sessions.set(k, v);
      for (const e of evStaged) events.push(e);
      return result;
    },
  };

  const delegate: Delegate<CohortRecord> = {
    findMany: vi.fn(async () => [...cohorts.values()]),
    findUnique: vi.fn(async ({ where }) => cohorts.get(where.id) ?? null),
    create: vi.fn(async ({ data }) => {
      const row = makeCohortRow({ id: "cohort-new", ...(data as Partial<CohortRecord>) });
      cohorts.set(row.id, row);
      return row;
    }),
    update: vi.fn(async ({ where, data }) => {
      const next = {
        ...(cohorts.get(where.id) as CohortRecord),
        ...(data as Partial<CohortRecord>),
      };
      cohorts.set(where.id, next);
      return next;
    }),
  };

  const { withPermission } = createTestWithPermission(
    opts?.grants ?? [grant("cohorts.manage")],
  );

  const service = createCohortService({
    delegate,
    enrolment: { count: vi.fn(async () => 0) },
    aggregate: { findUnique: vi.fn(async () => null) },
    db,
    toScope: (id) => ({ cohortId: id, courseIds: ["course-1"] }),
    withPermission,
    audit: async (entry) => {
      audits.push(entry as unknown as Record<string, unknown>);
    },
    runInTransaction: (fn) => fn(),
    now: () => NOW,
  });

  return { service, cohorts, enrolments, sessions, events, audits };
}

describe("cancelCohort (D-31) — atomic bulk withdraw, session cancellation, status change", () => {
  it("requires a reason of at least 10 trimmed characters, writing nothing for a blank one", async () => {
    const { service, audits } = cancelHarness();
    await expect(
      service.cancelCohort({ cohortId: "cohort-1", reason: "   ", expectedUpdatedAt: T0 }),
    ).rejects.toBeInstanceOf(ReasonRequiredError);
    expect(audits).toHaveLength(0);
  });

  it("requires a reason of at least 10 trimmed characters, writing nothing for a too-short one", async () => {
    const { service, audits } = cancelHarness();
    await expect(
      service.cancelCohort({ cohortId: "cohort-1", reason: "too short", expectedUpdatedAt: T0 }),
    ).rejects.toBeInstanceOf(ReasonRequiredError);
    expect(audits).toHaveLength(0);
  });

  it("requires cohorts.manage", async () => {
    const { service } = cancelHarness({ grants: [grant("cohorts.view")] });
    await expect(
      service.cancelCohort({
        cohortId: "cohort-1",
        reason: "Cohort closed for the season",
        expectedUpdatedAt: T0,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("throws CohortCancelBlockedError on an already-CANCELLED cohort and writes nothing", async () => {
    const { service, audits, events } = cancelHarness({
      cohortRow: makeCohortRow({ status: "CANCELLED" }),
    });
    await expect(
      service.cancelCohort({
        cohortId: "cohort-1",
        reason: "Duplicate cancellation attempt",
        expectedUpdatedAt: T0,
      }),
    ).rejects.toBeInstanceOf(CohortCancelBlockedError);
    expect(audits).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("withdraws ACTIVE, cancels PENDING_PAYMENT, leaves terminal statuses untouched, soft-cancels open sessions, zeroes seatsTaken", async () => {
    const untouchedWithdrawn = cancelEnr({ id: "enr-withdrawn", status: "WITHDRAWN", reason: "prior reason" });
    const { service, cohorts, enrolments, sessions, audits, events } = cancelHarness({
      cohortRow: makeCohortRow({ status: "PUBLISHED", seatsTaken: 3 }),
      enrolments: [
        cancelEnr({ id: "enr-active-1", status: "ACTIVE" }),
        cancelEnr({ id: "enr-active-2", status: "ACTIVE" }),
        cancelEnr({
          id: "enr-pending",
          status: "PENDING_PAYMENT",
          holdExpiresAt: new Date(NOW.getTime() + 10 * 60_000),
        }),
        untouchedWithdrawn,
      ],
      sessions: [
        cancelSession({ id: "session-open-1" }),
        cancelSession({ id: "session-open-2" }),
        cancelSession({
          id: "session-already-cancelled",
          cancelledAt: new Date("2026-02-01T00:00:00.000Z"),
          cancellationReason: "weather",
        }),
      ],
    });

    const reason = "Cohort cancelled — operations decision";
    await service.cancelCohort({ cohortId: "cohort-1", reason, expectedUpdatedAt: T0 });

    expect(enrolments.get("enr-active-1")!.status).toBe("WITHDRAWN");
    expect(enrolments.get("enr-active-1")!.reason).toBe(reason);
    expect(enrolments.get("enr-active-1")!.withdrawnAt).toEqual(NOW);
    expect(enrolments.get("enr-active-2")!.status).toBe("WITHDRAWN");

    expect(enrolments.get("enr-pending")!.status).toBe("CANCELLED");
    expect(enrolments.get("enr-pending")!.reason).toBe(reason);
    expect(enrolments.get("enr-pending")!.holdExpiresAt).toBeNull();

    // Terminal-status row is byte-identical to before.
    expect(enrolments.get("enr-withdrawn")).toEqual(untouchedWithdrawn);

    expect(sessions.get("session-open-1")!.cancelledAt).toEqual(NOW);
    expect(sessions.get("session-open-1")!.cancellationReason).toBe(reason);
    expect(sessions.get("session-open-2")!.cancelledAt).toEqual(NOW);
    expect(sessions.get("session-already-cancelled")!.cancelledAt).toEqual(
      new Date("2026-02-01T00:00:00.000Z"),
    );
    expect(sessions.get("session-already-cancelled")!.cancellationReason).toBe("weather");

    expect(cohorts.get("cohort-1")!.status).toBe("CANCELLED");
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(0);

    // One audit row per affected enrolment (2 withdrawn + 1 cancelled), one
    // per cancelled session (2), one for the cohort — never a single batch
    // row (D-31, T-05-69).
    const enrolmentAudits = audits.filter((a) => a.targetType === "Enrolment");
    expect(enrolmentAudits).toHaveLength(3);
    expect(enrolmentAudits.map((a) => a.targetId).sort()).toEqual(
      ["enr-active-1", "enr-active-2", "enr-pending"].sort(),
    );
    expect(
      enrolmentAudits.find((a) => a.targetId === "enr-active-1"),
    ).toMatchObject({ action: "enrolment.withdrawn", before: { status: "ACTIVE" }, after: { status: "WITHDRAWN" }, reason });
    expect(
      enrolmentAudits.find((a) => a.targetId === "enr-pending"),
    ).toMatchObject({ action: "enrolment.cancelled", before: { status: "PENDING_PAYMENT" }, after: { status: "CANCELLED" }, reason });

    const sessionAudits = audits.filter((a) => a.targetType === "ScheduledSession");
    expect(sessionAudits).toHaveLength(2);
    expect(sessionAudits.map((a) => a.targetId).sort()).toEqual(
      ["session-open-1", "session-open-2"].sort(),
    );

    const cohortAudits = audits.filter((a) => a.targetType === "Cohort");
    expect(cohortAudits).toHaveLength(1);
    expect(cohortAudits[0]).toMatchObject({ action: "cohort.cancelled", reason });

    // Total audit rows: 3 enrolments + 2 sessions + 1 cohort — never a
    // single batch-level row.
    expect(audits).toHaveLength(6);

    // One domain event per affected enrolment plus one cohort.cancelled,
    // all written inside the transaction.
    expect(events.filter((e) => e.type === "enrolment.withdrawn")).toHaveLength(2);
    expect(events.filter((e) => e.type === "enrolment.cancelled")).toHaveLength(1);
    expect(events.filter((e) => e.type === "cohort.cancelled")).toHaveLength(1);
  });

  it("a mid-loop failure leaves the cohort open and every enrolment untouched", async () => {
    const { service, cohorts, enrolments, sessions, audits, events } = cancelHarness({
      cohortRow: makeCohortRow({ status: "PUBLISHED", seatsTaken: 2 }),
      enrolments: [
        cancelEnr({ id: "enr-active-1", status: "ACTIVE" }),
        cancelEnr({ id: "enr-active-2", status: "ACTIVE" }),
      ],
      sessions: [cancelSession({ id: "session-open-1" })],
      failOnEnrolmentId: "enr-active-2",
    });

    await expect(
      service.cancelCohort({
        cohortId: "cohort-1",
        reason: "Should not partially apply",
        expectedUpdatedAt: T0,
      }),
    ).rejects.toThrow("simulated mid-loop failure");

    expect(cohorts.get("cohort-1")!.status).toBe("PUBLISHED");
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(2);
    expect(enrolments.get("enr-active-1")!.status).toBe("ACTIVE");
    expect(enrolments.get("enr-active-2")!.status).toBe("ACTIVE");
    expect(sessions.get("session-open-1")!.cancelledAt).toBeNull();
    expect(audits).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("throws StaleOrderError on a stale expectedUpdatedAt and writes no audit or event", async () => {
    const { service, cohorts, audits, events } = cancelHarness({
      cohortRow: makeCohortRow({ status: "PUBLISHED", seatsTaken: 0, updatedAt: T0 }),
      enrolments: [],
    });
    await expect(
      service.cancelCohort({
        cohortId: "cohort-1",
        reason: "Attempting with a stale token",
        expectedUpdatedAt: new Date("2020-01-01"),
      }),
    ).rejects.toBeInstanceOf(StaleOrderError);
    expect(cohorts.get("cohort-1")!.status).toBe("PUBLISHED");
    expect(audits).toHaveLength(0);
    expect(events).toHaveLength(0);
  });
});
