/**
 * Plan 05-05 Task 1: factory-backed Cohort CRUD, cancel-on-archive, and the
 * D-30 offer-lock guard.
 *
 * Driven by in-memory fake delegates plus a harness-built `withPermission`
 * (`createTestWithPermission` — GLOBAL grants for the data-semantics cases, a
 * deliberately scoped or missing grant for the authorization cases). No real
 * Postgres.
 */

import { describe, expect, it, vi } from "vitest";
import { createTestWithPermission, grant } from "./support/harness";
import {
  createCohortService,
  createCohortGuards,
  OfferLockedError,
  type CohortRecord,
} from "@/server/services/cohort-service";
import { AuthorizationError } from "@/server/permissions/with-permission";
import { type Delegate } from "@/server/services/resource-service";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const COHORT_START = new Date("2026-03-01T09:00:00.000Z");
const COHORT_END = new Date("2026-04-01T17:00:00.000Z");
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

function harness(opts?: {
  grants?: ReturnType<typeof grant>[];
  rows?: CohortRecord[];
  enrolmentCount?: number;
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

  const { withPermission } = createTestWithPermission(
    opts?.grants ?? [grant("cohorts.view"), grant("cohorts.manage")],
  );

  const service = createCohortService({
    delegate,
    enrolment,
    toScope: (id) => ({ cohortId: id, courseIds: ["course-1"] }),
    withPermission,
    audit: async (entry) => {
      audits.push(entry as unknown as Record<string, unknown>);
    },
    runInTransaction: (fn) => fn(),
    now: () => NOW,
  });

  return { service, delegate, enrolment, audits, rows };
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
