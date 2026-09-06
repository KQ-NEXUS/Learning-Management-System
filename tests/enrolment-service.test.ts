/**
 * Plan 05-07: the enrolment state machine (COH-05).
 *
 * Driven by an in-memory, staged-commit fake `$transaction` plus a
 * harness-built `withPermission` (`createTestWithPermission`). The real
 * `seat-accounting` primitives (`takeSeat` / `claimSeat` / `releaseSeat`) run
 * against the fake `tx`, so the seat-count coupling is exercised for real at
 * unit level. No Postgres — `tests/enrolment-service.integration.test.ts`
 * proves the transition and transfer semantics against the real schema.
 */

import { describe, expect, it } from "vitest";
import { createTestWithPermission, grant } from "./support/harness";
import {
  assertTransition,
  createEnrolmentService,
  CrossOfferTransferError,
  EnrolmentNotFoundError,
  IllegalTransitionError,
  ReasonRequiredError,
  VALID_TRANSITIONS,
} from "@/server/services/enrolment-service";
import {
  AlreadyEnrolledError,
  CapacityExceededError,
} from "@/server/services/seat-accounting";
import { AuthorizationError } from "@/server/permissions/with-permission";

// ---------------------------------------------------------------------------
// Fake store + staged-commit transaction
// ---------------------------------------------------------------------------

type CohortRow = {
  id: string;
  status: string;
  capacity: number;
  seatsTaken: number;
  holdMinutes: number | null;
  courseId: string | null;
  programmeId: string | null;
};

type EnrolmentRow = {
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

const NOW = new Date("2026-02-01T00:00:00.000Z");

function enr(over: Partial<EnrolmentRow> = {}): EnrolmentRow {
  return {
    id: over.id ?? "enr-1",
    userId: over.userId ?? "user-1",
    cohortId: over.cohortId ?? "cohort-1",
    status: over.status ?? "PENDING_PAYMENT",
    holdExpiresAt: over.holdExpiresAt ?? null,
    activatedAt: over.activatedAt ?? null,
    withdrawnAt: over.withdrawnAt ?? null,
    reason: over.reason ?? null,
    orderId: over.orderId ?? null,
    transferredFromId: over.transferredFromId ?? null,
  };
}

function coh(over: Partial<CohortRow> = {}): CohortRow {
  return {
    id: over.id ?? "cohort-1",
    status: over.status ?? "PUBLISHED",
    capacity: over.capacity ?? 10,
    seatsTaken: over.seatsTaken ?? 0,
    holdMinutes: over.holdMinutes === undefined ? 30 : over.holdMinutes,
    courseId: over.courseId === undefined ? "course-1" : over.courseId,
    programmeId: over.programmeId ?? null,
  };
}

function harness(opts?: {
  grants?: ReturnType<typeof grant>[];
  cohorts?: CohortRow[];
  enrolments?: EnrolmentRow[];
}) {
  const cohorts = new Map<string, CohortRow>(
    (opts?.cohorts ?? [coh()]).map((c) => [c.id, { ...c }]),
  );
  const enrolments = new Map<string, EnrolmentRow>(
    (opts?.enrolments ?? []).map((e) => [e.id, { ...e }]),
  );
  const events: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  let seq = 0;

  const cloneMap = <V,>(m: Map<string, V>) =>
    new Map<string, V>([...m].map(([k, v]) => [k, { ...(v as object) } as V]));

  function makeTx(
    cStore: Map<string, CohortRow>,
    eStore: Map<string, EnrolmentRow>,
    evStore: Array<Record<string, unknown>>,
  ) {
    return {
      $queryRaw: async (_s: TemplateStringsArray, ...vals: unknown[]) => {
        const c = cStore.get(vals[0] as string);
        return c ? [{ status: c.status, seatsTaken: c.seatsTaken, capacity: c.capacity }] : [];
      },
      $executeRaw: async (_s: TemplateStringsArray, ...vals: unknown[]) => {
        const c = cStore.get(vals[0] as string);
        if (c) c.seatsTaken = Math.max(c.seatsTaken - 1, 0);
        return 1;
      },
      enrolment: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          if (data.status === "ACTIVE") {
            for (const row of eStore.values()) {
              if (
                row.userId === data.userId &&
                row.cohortId === data.cohortId &&
                row.status === "ACTIVE"
              ) {
                const e = new Error("Unique constraint failed") as Error & {
                  code: string;
                };
                e.code = "P2002";
                throw e;
              }
            }
          }
          seq += 1;
          const id = `enr-new-${seq}`;
          eStore.set(id, { ...enr({ id }), ...(data as Partial<EnrolmentRow>) });
          return { id };
        },
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = eStore.get(where.id) as EnrolmentRow;
          Object.assign(row, data);
          return row;
        },
        findUnique: async ({ where }: { where: { id: string } }) =>
          eStore.get(where.id) ?? null,
      },
      cohort: {
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const c = cStore.get(where.id) as CohortRow;
          const s = data.seatsTaken as
            | { increment?: number; decrement?: number }
            | undefined;
          if (s?.increment) c.seatsTaken += s.increment;
          if (s?.decrement) c.seatsTaken -= s.decrement;
          return c;
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
    $transaction: async <R,>(fn: (tx: unknown) => Promise<R>): Promise<R> => {
      const cStaged = cloneMap(cohorts);
      const eStaged = cloneMap(enrolments);
      const evStaged: Array<Record<string, unknown>> = [];
      const result = await fn(makeTx(cStaged, eStaged, evStaged));
      for (const [k, v] of cStaged) cohorts.set(k, v);
      for (const [k, v] of eStaged) enrolments.set(k, v);
      for (const e of evStaged) events.push(e);
      return result;
    },
  };

  const { withPermission } = createTestWithPermission(
    opts?.grants ?? [grant("enrolments.manage")],
  );

  const service = createEnrolmentService({
    db: db as never,
    enrolment: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        (enrolments.get(where.id) as never) ?? null,
    } as never,
    cohort: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        (cohorts.get(where.id) as never) ?? null,
    } as never,
    enrolmentScope: (id: string) => {
      const e = enrolments.get(id);
      return e ? { cohortId: e.cohortId, courseIds: [] } : {};
    },
    cohortScope: (id: string) => ({ cohortId: id, courseIds: [] }),
    withPermission,
    audit: async (entry) => {
      audits.push(entry as unknown as Record<string, unknown>);
    },
    now: () => NOW,
  });

  return { service, cohorts, enrolments, events, audits };
}

describe.each(["CANCELLED", "COMPLETED"])("%s cohorts reject new access", (status) => {
  it.each([
    { target: "ACTIVE" as const, holdMinutes: 30 },
    { target: "PENDING_PAYMENT" as const, holdMinutes: 30 },
    { target: "PENDING_PAYMENT" as const, holdMinutes: null },
    { target: "PENDING_PAYMENT" as const, holdMinutes: 0 },
  ])("refuses new enrolment %j without side effects", async ({ target, holdMinutes }) => {
    const { service, enrolments, cohorts, events, audits } = harness({
      cohorts: [coh({ status, holdMinutes })],
    });
    await expect(service.addEnrolment({
      cohortId: "cohort-1", userId: "user-1", target, reason: "manual enrolment",
    })).rejects.toThrow(/cohort.*(cancelled|completed)/i);
    expect(enrolments.size).toBe(0);
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(0);
    expect(events).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it.each([null, new Date("2026-02-02T00:00:00.000Z")])("refuses approval with hold %s", async (holdExpiresAt) => {
    const seatsTaken = holdExpiresAt ? 1 : 0;
    const { service, enrolments, cohorts, events, audits } = harness({
      cohorts: [coh({ status, seatsTaken })],
      enrolments: [enr({ holdExpiresAt })],
    });
    await expect(service.approveEnrolment({
      enrolmentId: "enr-1", reason: "payment confirmed",
    })).rejects.toThrow(/cohort.*(cancelled|completed)/i);
    expect(enrolments.get("enr-1")!.status).toBe("PENDING_PAYMENT");
    expect(enrolments.get("enr-1")!.holdExpiresAt).toEqual(holdExpiresAt);
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(seatsTaken);
    expect(events).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("refuses transfers into a terminal cohort without changing the source", async () => {
    const { service, enrolments, cohorts, events, audits } = harness({
      cohorts: [coh({ seatsTaken: 1 }), coh({ id: "cohort-2", status })],
      enrolments: [enr({ status: "ACTIVE" })],
    });
    await expect(service.transferEnrolment({
      enrolmentId: "enr-1", targetCohortId: "cohort-2", reason: "cohort transfer",
    })).rejects.toThrow(/cohort.*(cancelled|completed)/i);
    expect(enrolments.get("enr-1")!.status).toBe("ACTIVE");
    expect(enrolments.size).toBe(1);
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(1);
    expect(cohorts.get("cohort-2")!.seatsTaken).toBe(0);
    expect(events).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// assertTransition / VALID_TRANSITIONS
// ---------------------------------------------------------------------------

describe("assertTransition — the explicit table (D-16)", () => {
  it("refuses a jump not in the table", () => {
    expect(() => assertTransition("WITHDRAWN", "ACTIVE")).toThrow(
      IllegalTransitionError,
    );
  });

  it("allows PENDING_PAYMENT -> ACTIVE", () => {
    expect(() => assertTransition("PENDING_PAYMENT", "ACTIVE")).not.toThrow();
  });

  it("every terminal status has an empty allow-list", () => {
    for (const terminal of ["WITHDRAWN", "TRANSFERRED", "CANCELLED", "COMPLETED"] as const) {
      expect(VALID_TRANSITIONS[terminal]).toEqual([]);
    }
  });

  it("carries from / to / enrolmentId on the error", () => {
    try {
      assertTransition("CANCELLED", "ACTIVE", "enr-9");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(IllegalTransitionError);
      expect((e as IllegalTransitionError).from).toBe("CANCELLED");
      expect((e as IllegalTransitionError).to).toBe("ACTIVE");
      expect((e as IllegalTransitionError).enrolmentId).toBe("enr-9");
    }
  });
});

// ---------------------------------------------------------------------------
// addEnrolment (D-11)
// ---------------------------------------------------------------------------

describe("addEnrolment (D-11)", () => {
  it("requires enrolments.manage", async () => {
    const { service } = harness({ grants: [grant("enrolments.view")] });
    await expect(
      service.addEnrolment({
        cohortId: "cohort-1",
        userId: "user-1",
        target: "ACTIVE",
        reason: "scholarship",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("target ACTIVE takes a seat, sets activatedAt, leaves orderId null", async () => {
    const { service, cohorts, enrolments } = harness({
      cohorts: [coh({ seatsTaken: 0, capacity: 5 })],
    });
    const res = await service.addEnrolment({
      cohortId: "cohort-1",
      userId: "user-1",
      target: "ACTIVE",
      reason: "corporate sponsorship",
    });
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(1);
    const row = enrolments.get(res.id)!;
    expect(row.status).toBe("ACTIVE");
    expect(row.activatedAt).toEqual(NOW);
    expect(row.orderId).toBeNull();
    expect(row.reason).toBe("corporate sponsorship");
  });

  it("target PENDING_PAYMENT on a holdMinutes:30 cohort takes a seat and sets holdExpiresAt 30m ahead", async () => {
    const { service, cohorts, enrolments } = harness({
      cohorts: [coh({ holdMinutes: 30, seatsTaken: 0 })],
    });
    const res = await service.addEnrolment({
      cohortId: "cohort-1",
      userId: "user-1",
      target: "PENDING_PAYMENT",
      reason: "awaiting bank transfer",
    });
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(1);
    expect(enrolments.get(res.id)!.holdExpiresAt).toEqual(
      new Date(NOW.getTime() + 30 * 60_000),
    );
  });

  it("target PENDING_PAYMENT on a holdMinutes:null cohort takes NO seat and leaves holdExpiresAt null (D-02)", async () => {
    const { service, cohorts, enrolments } = harness({
      cohorts: [coh({ holdMinutes: null, seatsTaken: 0 })],
    });
    const res = await service.addEnrolment({
      cohortId: "cohort-1",
      userId: "user-1",
      target: "PENDING_PAYMENT",
      reason: "invoice raised",
    });
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(0);
    expect(enrolments.get(res.id)!.holdExpiresAt).toBeNull();
  });

  it("target PENDING_PAYMENT on a holdMinutes:0 cohort takes NO seat", async () => {
    const { service, cohorts } = harness({
      cohorts: [coh({ holdMinutes: 0, seatsTaken: 0 })],
    });
    await service.addEnrolment({
      cohortId: "cohort-1",
      userId: "user-1",
      target: "PENDING_PAYMENT",
      reason: "invoice raised",
    });
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(0);
  });

  it("surfaces CapacityExceededError on a full cohort", async () => {
    const { service } = harness({
      cohorts: [coh({ capacity: 1, seatsTaken: 1 })],
    });
    await expect(
      service.addEnrolment({
        cohortId: "cohort-1",
        userId: "user-2",
        target: "ACTIVE",
        reason: "comp",
      }),
    ).rejects.toBeInstanceOf(CapacityExceededError);
  });

  it("surfaces AlreadyEnrolledError for a learner with an existing ACTIVE enrolment", async () => {
    const { service } = harness({
      cohorts: [coh({ capacity: 5, seatsTaken: 1 })],
      enrolments: [enr({ id: "enr-1", userId: "user-1", status: "ACTIVE" })],
    });
    await expect(
      service.addEnrolment({
        cohortId: "cohort-1",
        userId: "user-1",
        target: "ACTIVE",
        reason: "double add",
      }),
    ).rejects.toBeInstanceOf(AlreadyEnrolledError);
  });

  it("a blank reason throws ReasonRequiredError and writes nothing", async () => {
    const { service, cohorts, enrolments } = harness({
      cohorts: [coh({ seatsTaken: 0 })],
    });
    await expect(
      service.addEnrolment({
        cohortId: "cohort-1",
        userId: "user-1",
        target: "ACTIVE",
        reason: "   ",
      }),
    ).rejects.toBeInstanceOf(ReasonRequiredError);
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(0);
    expect(enrolments.size).toBe(0);
  });

  it("writes one audit row and one domain event", async () => {
    const { service, events, audits } = harness({ cohorts: [coh({ seatsTaken: 0 })] });
    await service.addEnrolment({
      cohortId: "cohort-1",
      userId: "user-1",
      target: "ACTIVE",
      reason: "scholarship",
    });
    expect(events.filter((e) => e.type === "enrolment.created")).toHaveLength(1);
    expect(
      audits.filter(
        (a) => a.action === "enrolment.created" && a.targetType === "Enrolment",
      ),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// approveEnrolment (D-12) — the seat-count Pitfall-3 branches
// ---------------------------------------------------------------------------

describe("approveEnrolment (D-12)", () => {
  it("on a PENDING_PAYMENT enrolment WITH a live hold: ACTIVE, holdExpiresAt null, activatedAt set, seatsTaken NOT incremented", async () => {
    const hold = new Date(NOW.getTime() + 20 * 60_000);
    const { service, cohorts, enrolments } = harness({
      cohorts: [coh({ seatsTaken: 1, capacity: 5 })],
      enrolments: [
        enr({ id: "enr-1", status: "PENDING_PAYMENT", holdExpiresAt: hold }),
      ],
    });
    const res = await service.approveEnrolment({
      enrolmentId: "enr-1",
      reason: "manual payment confirmed",
    });
    expect(res.status).toBe("ACTIVE");
    const row = enrolments.get("enr-1")!;
    expect(row.status).toBe("ACTIVE");
    expect(row.holdExpiresAt).toBeNull();
    expect(row.activatedAt).toEqual(NOW);
    // Pitfall 3: a hold-holding enrolment already counts — 0 increments.
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(1);
  });

  it("on a PENDING_PAYMENT enrolment with NO hold: seatsTaken incremented by exactly 1", async () => {
    const { service, cohorts, enrolments } = harness({
      cohorts: [coh({ seatsTaken: 0, capacity: 5 })],
      enrolments: [
        enr({ id: "enr-1", status: "PENDING_PAYMENT", holdExpiresAt: null }),
      ],
    });
    await service.approveEnrolment({
      enrolmentId: "enr-1",
      reason: "manual payment confirmed",
    });
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(1);
    expect(enrolments.get("enr-1")!.status).toBe("ACTIVE");
  });

  it("a hold-less approve on a full cohort is refused with CapacityExceededError", async () => {
    const { service, enrolments, cohorts } = harness({
      cohorts: [coh({ seatsTaken: 1, capacity: 1 })],
      enrolments: [enr({ id: "enr-1", status: "PENDING_PAYMENT", holdExpiresAt: null })],
    });
    await expect(
      service.approveEnrolment({ enrolmentId: "enr-1", reason: "confirmed" }),
    ).rejects.toBeInstanceOf(CapacityExceededError);
    expect(enrolments.get("enr-1")!.status).toBe("PENDING_PAYMENT");
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(1);
  });

  it("on an already-ACTIVE enrolment throws IllegalTransitionError", async () => {
    const { service } = harness({
      enrolments: [enr({ id: "enr-1", status: "ACTIVE" })],
    });
    await expect(
      service.approveEnrolment({ enrolmentId: "enr-1", reason: "again" }),
    ).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  it("an unknown enrolment throws EnrolmentNotFoundError", async () => {
    const { service } = harness();
    await expect(
      service.approveEnrolment({ enrolmentId: "nope", reason: "x" }),
    ).rejects.toBeInstanceOf(EnrolmentNotFoundError);
  });

  it("a blank reason throws ReasonRequiredError", async () => {
    const { service } = harness({
      enrolments: [enr({ id: "enr-1", status: "PENDING_PAYMENT" })],
    });
    await expect(
      service.approveEnrolment({ enrolmentId: "enr-1", reason: "" }),
    ).rejects.toBeInstanceOf(ReasonRequiredError);
  });

  it("writes one audit row (before/after) and one enrolment.approved event", async () => {
    const { service, events, audits } = harness({
      cohorts: [coh({ seatsTaken: 0 })],
      enrolments: [enr({ id: "enr-1", status: "PENDING_PAYMENT" })],
    });
    await service.approveEnrolment({ enrolmentId: "enr-1", reason: "confirmed" });
    expect(events.filter((e) => e.type === "enrolment.approved")).toHaveLength(1);
    const audit = audits.find((a) => a.action === "enrolment.approved");
    expect(audit?.before).toEqual({ status: "PENDING_PAYMENT" });
    expect(audit?.after).toEqual({ status: "ACTIVE" });
  });
});

// ---------------------------------------------------------------------------
// withdrawEnrolment / cancelEnrolment (D-14)
// ---------------------------------------------------------------------------

describe("withdrawEnrolment (D-14)", () => {
  it("on an ACTIVE enrolment: WITHDRAWN, withdrawnAt, reason, seat released, event + audit", async () => {
    const { service, cohorts, enrolments, events, audits } = harness({
      cohorts: [coh({ seatsTaken: 1, capacity: 5 })],
      enrolments: [enr({ id: "enr-1", status: "ACTIVE" })],
    });
    await service.withdrawEnrolment({
      enrolmentId: "enr-1",
      reason: "learner requested withdrawal",
    });
    const row = enrolments.get("enr-1")!;
    expect(row.status).toBe("WITHDRAWN");
    expect(row.withdrawnAt).toEqual(NOW);
    expect(row.reason).toBe("learner requested withdrawal");
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(0);
    expect(events.filter((e) => e.type === "enrolment.withdrawn")).toHaveLength(1);
    const audit = audits.find((a) => a.action === "enrolment.withdrawn");
    expect(audit?.before).toEqual({ status: "ACTIVE" });
    expect(audit?.after).toEqual({ status: "WITHDRAWN" });
  });

  it("refuses a blank reason", async () => {
    const { service } = harness({
      enrolments: [enr({ id: "enr-1", status: "ACTIVE" })],
    });
    await expect(
      service.withdrawEnrolment({ enrolmentId: "enr-1", reason: "  " }),
    ).rejects.toBeInstanceOf(ReasonRequiredError);
  });

  it("refuses a terminal-status source with IllegalTransitionError", async () => {
    const { service, cohorts } = harness({
      cohorts: [coh({ seatsTaken: 0 })],
      enrolments: [enr({ id: "enr-1", status: "WITHDRAWN" })],
    });
    await expect(
      service.withdrawEnrolment({ enrolmentId: "enr-1", reason: "again" }),
    ).rejects.toBeInstanceOf(IllegalTransitionError);
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(0);
  });
});

describe("cancelEnrolment (D-14)", () => {
  it("on an ACTIVE enrolment: CANCELLED, reason, seat released", async () => {
    const { service, cohorts, enrolments, events } = harness({
      cohorts: [coh({ seatsTaken: 1, capacity: 5 })],
      enrolments: [enr({ id: "enr-1", status: "ACTIVE" })],
    });
    await service.cancelEnrolment({
      enrolmentId: "enr-1",
      reason: "administrative void",
    });
    expect(enrolments.get("enr-1")!.status).toBe("CANCELLED");
    expect(enrolments.get("enr-1")!.withdrawnAt).toBeNull();
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(0);
    expect(events.filter((e) => e.type === "enrolment.cancelled")).toHaveLength(1);
  });

  it("on a PENDING_PAYMENT WITH a live hold: releases the seat (heldSeat true)", async () => {
    const hold = new Date(NOW.getTime() + 15 * 60_000);
    const { service, cohorts } = harness({
      cohorts: [coh({ seatsTaken: 1, capacity: 5 })],
      enrolments: [
        enr({ id: "enr-1", status: "PENDING_PAYMENT", holdExpiresAt: hold }),
      ],
    });
    await service.cancelEnrolment({ enrolmentId: "enr-1", reason: "hold void" });
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(0);
  });

  it("on a hold-less PENDING_PAYMENT: passes heldSeat:false — seatsTaken is NOT decremented", async () => {
    const { service, cohorts, enrolments } = harness({
      cohorts: [coh({ seatsTaken: 2, capacity: 5 })],
      enrolments: [
        enr({ id: "enr-1", status: "PENDING_PAYMENT", holdExpiresAt: null }),
      ],
    });
    await service.cancelEnrolment({
      enrolmentId: "enr-1",
      reason: "hold lapsed, no seat held",
    });
    expect(enrolments.get("enr-1")!.status).toBe("CANCELLED");
    // heldSeat:false path — no decrement.
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(2);
  });

  it("refuses a blank reason and a terminal source", async () => {
    const { service } = harness({
      enrolments: [
        enr({ id: "enr-1", status: "ACTIVE" }),
        enr({ id: "enr-2", status: "CANCELLED" }),
      ],
    });
    await expect(
      service.cancelEnrolment({ enrolmentId: "enr-1", reason: "" }),
    ).rejects.toBeInstanceOf(ReasonRequiredError);
    await expect(
      service.cancelEnrolment({ enrolmentId: "enr-2", reason: "x" }),
    ).rejects.toBeInstanceOf(IllegalTransitionError);
  });
});

// ---------------------------------------------------------------------------
// transferEnrolment (D-13) — same offer only, no history carried across
// ---------------------------------------------------------------------------

describe("transferEnrolment (D-13)", () => {
  it.each(["cohort-1", "cohort-2"])("requires permission on both ends, not just %s", async (scopeId) => {
    const { service, cohorts, enrolments, events, audits } = harness({
      grants: [grant("enrolments.manage", "COHORT", scopeId)],
      cohorts: [coh({ seatsTaken: 1 }), coh({ id: "cohort-2" })],
      enrolments: [enr({ status: "ACTIVE" })],
    });
    await expect(service.transferEnrolment({
      enrolmentId: "enr-1", targetCohortId: "cohort-2", reason: "cohort swap",
    })).rejects.toBeInstanceOf(AuthorizationError);
    expect(enrolments.get("enr-1")!.status).toBe("ACTIVE");
    expect(enrolments.size).toBe(1);
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(1);
    expect(cohorts.get("cohort-2")!.seatsTaken).toBe(0);
    expect(events).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("accepts separate cohort grants covering both ends", async () => {
    const { service, enrolments } = harness({
      grants: [
        grant("enrolments.manage", "COHORT", "cohort-1"),
        grant("enrolments.manage", "COHORT", "cohort-2"),
      ],
      cohorts: [coh({ seatsTaken: 1 }), coh({ id: "cohort-2" })],
      enrolments: [enr({ status: "ACTIVE" })],
    });
    const result = await service.transferEnrolment({
      enrolmentId: "enr-1", targetCohortId: "cohort-2", reason: "cohort swap",
    });
    expect(enrolments.get(result.targetEnrolmentId)!.status).toBe("ACTIVE");
  });

  const twoCourseCohorts = (over?: {
    source?: Partial<CohortRow>;
    target?: Partial<CohortRow>;
  }) => [
    coh({ id: "cohort-1", courseId: "course-1", seatsTaken: 1, capacity: 5, ...over?.source }),
    coh({ id: "cohort-2", courseId: "course-1", seatsTaken: 0, capacity: 5, ...over?.target }),
  ];

  it("to a cohort sharing courseId succeeds: source TRANSFERRED + seat released, new ACTIVE row in target with transferredFromId", async () => {
    const { service, cohorts, enrolments } = harness({
      cohorts: twoCourseCohorts(),
      enrolments: [enr({ id: "enr-1", userId: "user-1", cohortId: "cohort-1", status: "ACTIVE" })],
    });
    const res = await service.transferEnrolment({
      enrolmentId: "enr-1",
      targetCohortId: "cohort-2",
      reason: "moved to the evening cohort",
    });
    expect(enrolments.get("enr-1")!.status).toBe("TRANSFERRED");
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(0);
    expect(cohorts.get("cohort-2")!.seatsTaken).toBe(1);
    const target = enrolments.get(res.targetEnrolmentId)!;
    expect(target.status).toBe("ACTIVE");
    expect(target.cohortId).toBe("cohort-2");
    expect(target.transferredFromId).toBe("enr-1");
    expect(target.userId).toBe("user-1");
  });

  it("to a cohort sharing programmeId succeeds", async () => {
    const { service, enrolments } = harness({
      cohorts: [
        coh({ id: "cohort-1", courseId: null, programmeId: "prog-1", seatsTaken: 1 }),
        coh({ id: "cohort-2", courseId: null, programmeId: "prog-1", seatsTaken: 0 }),
      ],
      enrolments: [enr({ id: "enr-1", cohortId: "cohort-1", status: "ACTIVE" })],
    });
    const res = await service.transferEnrolment({
      enrolmentId: "enr-1",
      targetCohortId: "cohort-2",
      reason: "programme cohort swap",
    });
    expect(enrolments.get(res.targetEnrolmentId)!.status).toBe("ACTIVE");
  });

  it("to a different-offer cohort throws CrossOfferTransferError and changes nothing", async () => {
    const { service, cohorts, enrolments } = harness({
      cohorts: [
        coh({ id: "cohort-1", courseId: "course-1", seatsTaken: 1 }),
        coh({ id: "cohort-2", courseId: "course-2", seatsTaken: 0 }),
      ],
      enrolments: [enr({ id: "enr-1", cohortId: "cohort-1", status: "ACTIVE" })],
    });
    await expect(
      service.transferEnrolment({
        enrolmentId: "enr-1",
        targetCohortId: "cohort-2",
        reason: "cross offer",
      }),
    ).rejects.toBeInstanceOf(CrossOfferTransferError);
    expect(enrolments.get("enr-1")!.status).toBe("ACTIVE");
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(1);
    expect(cohorts.get("cohort-2")!.seatsTaken).toBe(0);
  });

  it("to the same cohort throws CrossOfferTransferError", async () => {
    const { service } = harness({
      cohorts: twoCourseCohorts(),
      enrolments: [enr({ id: "enr-1", cohortId: "cohort-1", status: "ACTIVE" })],
    });
    await expect(
      service.transferEnrolment({
        enrolmentId: "enr-1",
        targetCohortId: "cohort-1",
        reason: "same",
      }),
    ).rejects.toBeInstanceOf(CrossOfferTransferError);
  });

  it("a full target makes the whole transfer fail atomically — source stays ACTIVE, no target row", async () => {
    const { service, cohorts, enrolments } = harness({
      cohorts: twoCourseCohorts({ target: { seatsTaken: 3, capacity: 3 } }),
      enrolments: [enr({ id: "enr-1", cohortId: "cohort-1", status: "ACTIVE" })],
    });
    await expect(
      service.transferEnrolment({
        enrolmentId: "enr-1",
        targetCohortId: "cohort-2",
        reason: "target full",
      }),
    ).rejects.toBeInstanceOf(CapacityExceededError);
    expect(enrolments.get("enr-1")!.status).toBe("ACTIVE");
    expect(cohorts.get("cohort-1")!.seatsTaken).toBe(1);
    expect(cohorts.get("cohort-2")!.seatsTaken).toBe(3);
    expect([...enrolments.values()].filter((e) => e.cohortId === "cohort-2")).toHaveLength(0);
  });

  it("refuses a terminal-status source and a blank reason", async () => {
    const { service } = harness({
      cohorts: twoCourseCohorts(),
      enrolments: [
        enr({ id: "enr-1", cohortId: "cohort-1", status: "ACTIVE" }),
        enr({ id: "enr-2", cohortId: "cohort-1", status: "WITHDRAWN" }),
      ],
    });
    await expect(
      service.transferEnrolment({ enrolmentId: "enr-1", targetCohortId: "cohort-2", reason: " " }),
    ).rejects.toBeInstanceOf(ReasonRequiredError);
    await expect(
      service.transferEnrolment({ enrolmentId: "enr-2", targetCohortId: "cohort-2", reason: "x" }),
    ).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  it("emits one enrolment.transferred event and writes an audit row for BOTH the source and the target", async () => {
    const { service, events, audits } = harness({
      cohorts: twoCourseCohorts(),
      enrolments: [enr({ id: "enr-1", cohortId: "cohort-1", status: "ACTIVE" })],
    });
    const res = await service.transferEnrolment({
      enrolmentId: "enr-1",
      targetCohortId: "cohort-2",
      reason: "cohort swap",
    });
    expect(events.filter((e) => e.type === "enrolment.transferred")).toHaveLength(1);
    const transferAudits = audits.filter((a) => a.action === "enrolment.transferred");
    expect(transferAudits.map((a) => a.targetId).sort()).toEqual(
      ["enr-1", res.targetEnrolmentId].sort(),
    );
  });
});
