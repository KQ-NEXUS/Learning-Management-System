/**
 * Tracer for the authorization bypass matrix: the payments actions through the
 * full harness (Phase 15, plan 15-25, Task 1; NFR-05, D-09, T-15-25-02).
 *
 * Payments are the highest-stakes mutations, and the only ones whose scope is
 * resolved from the order's own cohort, so they prove the whole stack end to end:
 * the registry entry, the input builder, a real session, the real
 * `withPermission` choke point and a real Postgres. For each payments export
 * (`confirmManualPaymentAction`, `recordRefundAction`) this file proves:
 *
 *   - an anonymous visitor, a learner who does not own the order, and a staff
 *     member holding no role are refused with NO write to any table (only the
 *     audit trail may grow), and each refusal leaves an `authorization.denied`
 *     row naming the permission and the caller;
 *   - the adjacency pair: a staff grant scoped to cohort A is REFUSED on a cohort
 *     B order and ALLOWED on a cohort A order, and the mirror grant on cohort B is
 *     refused on cohort A;
 *   - an empty or schema-invalid input never reaches a write, even from the most
 *     privileged caller.
 *
 * Calling the exported action function directly is the same code path the public
 * POST runs after the framework's action-id check (server-actions guide), so the
 * authorization wiring exercised here is the production wiring.
 *
 * SAFETY: the only database here is a disposable Testcontainers instance from
 * `startMatrixDatabase()`, which refuses a non-local host. Nothing reads `.env`.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with a
 * container-start error and every case reports BLOCKED, which is the expected
 * failure mode, not a bug in the code under test.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ACTION_REGISTRY, type ActionRegistryEntry } from "./support/authz-registry";
import {
  ACTION_INPUTS,
  confirmManualPaymentInput,
  emptyArgs,
  recordRefundInput,
  seedWorld,
  type World,
} from "./support/authz-inputs";
import {
  changedTables,
  countDenials,
  denialsSince,
  describeOutcome,
  expectNoWrites,
  invokeAction,
  isRefusal,
  seedPersonas,
  snapshotWrites,
  startMatrixDatabase,
  stopMatrixDatabase,
  matrixPrisma,
  type Persona,
  type Personas,
} from "./support/authz-matrix";

import { TEST_DB_TIMEOUT_MS } from "./support/pg";

vi.mock("next/headers", async () => (await import("./support/authz-matrix")).nextHeadersMock());
vi.mock("next/cache", async () => (await import("./support/authz-matrix")).nextCacheMock());
vi.mock("next/navigation", async () => (await import("./support/authz-matrix")).nextNavigationMock());

const PAYMENT_ENTRIES: readonly ActionRegistryEntry[] = ACTION_REGISTRY.filter((entry) =>
  entry.file.startsWith("src/app/staff/payments/"),
);

let world: World;
let personas: Personas;

beforeAll(async () => {
  const database = await startMatrixDatabase();
  world = await seedWorld(database.prisma);
  personas = await seedPersonas(database.prisma, {
    cohortAId: world.cohortAId,
    cohortBId: world.cohortBId,
  });
  await world.attachOwner(personas);
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await stopMatrixDatabase();
}, TEST_DB_TIMEOUT_MS);

async function buildArgs(entry: ActionRegistryEntry): Promise<readonly unknown[]> {
  const builder = ACTION_INPUTS[entry.inputId];
  if (!builder) throw new Error(`No input builder registered for ${entry.inputId}`);
  return builder(world);
}

/** Calls one entry as one persona and returns the outcome plus what the database did. */
async function callAndObserve(entry: ActionRegistryEntry, persona: Persona, args: readonly unknown[]) {
  const before = await snapshotWrites();
  const denialsBefore = await countDenials();
  const outcome = await invokeAction(entry, persona, args);
  const after = await snapshotWrites();
  const denials = await denialsSince(denialsBefore);
  return { before, after, outcome, denials };
}

describe("registry sanity for the tracer", () => {
  it("registers the two payments exports with a record-scoped permission", () => {
    expect(PAYMENT_ENTRIES.map((entry) => entry.exportName).sort()).toEqual([
      "confirmManualPaymentAction",
      "recordRefundAction",
    ]);
    for (const entry of PAYMENT_ENTRIES) {
      expect(entry.class).toBe("permission");
      expect(entry.scope).toBe("RECORD");
      expect(typeof entry.permission).toBe("string");
    }
  });
});

describe("harness negative controls (the checks are not vacuous)", () => {
  it("expectNoWrites throws when a table changed between two snapshots", async () => {
    const before = await snapshotWrites();
    await matrixPrisma().user.create({
      data: { email: "negative-control@authz-matrix.test", name: "Negative control", status: "ACTIVE" },
    });
    const after = await snapshotWrites();
    expect(() => expectNoWrites(before, after)).toThrow(/User/);
  });

  it("expectNoWrites throws for an in-place update of a table that has no updatedAt column", async () => {
    // Session has no updatedAt, so the row count and newest updatedAt both stay the same.
    const before = await snapshotWrites();
    await matrixPrisma().session.updateMany({
      where: { userId: personas.staffNone.userId! },
      data: { expires: new Date(Date.now() + 8 * 86_400_000) },
    });
    const after = await snapshotWrites();
    expect(before.get("Session")?.count).toBe(after.get("Session")?.count);
    expect(() => expectNoWrites(before, after)).toThrow(/Session/);
  });

  it("the audit trail alone growing is not counted as a write", async () => {
    const before = await snapshotWrites();
    await matrixPrisma().auditEvent.create({
      data: { actorType: "USER", action: "authorization.denied", targetType: "PERMISSION", outcome: "DENIED" },
    });
    const after = await snapshotWrites();
    expect(() => expectNoWrites(before, after)).not.toThrow();
  });

  it("a returned success is not a refusal, and an unexpected crash is not either", () => {
    expect(isRefusal({ kind: "returned", value: { ok: true, outcome: "ACTIVATED" } })).toBe(false);
    expect(isRefusal({ kind: "returned", value: undefined })).toBe(false);
    expect(isRefusal({ kind: "threw", name: "TypeError", message: "boom" })).toBe(false);
    expect(isRefusal({ kind: "returned", value: { ok: false, message: "no" } })).toBe(true);
    expect(isRefusal({ kind: "threw", name: "AuthorizationError", message: "no" })).toBe(true);
  });
});

describe.each(PAYMENT_ENTRIES.map((entry) => [entry.exportName, entry] as const))(
  "%s: the wrong people are refused and nothing is written",
  (_name, entry) => {
    it.each(["anonymous", "learnerOther", "staffNone"] as const)(
      "%s is refused, writes nothing, and the denial is audited",
      async (personaName) => {
        const persona = personas[personaName];
        const { before, after, outcome, denials } = await callAndObserve(entry, persona, await buildArgs(entry));

        expect(isRefusal(outcome), describeOutcome(outcome)).toBe(true);
        expectNoWrites(before, after, { entryTables: entry.writes });

        // The refusal came from the authorization check on the right permission,
        // not from the input being rejected first.
        const denial = denials.find((row) => row.actorId === persona.userId);
        expect(denial, `no authorization.denied row for ${personaName}`).toBeDefined();
        expect(denial?.targetId).toBe(entry.permission);
        expect(denial?.outcome).toBe("DENIED");
      },
      60_000,
    );

    it("staff scoped to cohort B is refused on a cohort A order and nothing is written", async () => {
      const persona = personas.staffCohortB;
      const { before, after, outcome, denials } = await callAndObserve(entry, persona, await buildArgs(entry));

      expect(isRefusal(outcome), describeOutcome(outcome)).toBe(true);
      expectNoWrites(before, after, { entryTables: entry.writes });
      expect(denials.some((row) => row.actorId === persona.userId && row.targetId === entry.permission)).toBe(true);
    }, 60_000);

    it("staff scoped to cohort A is refused on a cohort B order and nothing is written", async () => {
      const orderB = await world.freshOrder("B");
      const args =
        entry.exportName === "confirmManualPaymentAction"
          ? [confirmManualPaymentInput(orderB.orderId, orderB.totalMinor)]
          : [recordRefundInput(orderB.orderId)];
      const persona = personas.staffCohortA;
      const { before, after, outcome, denials } = await callAndObserve(entry, persona, args);

      expect(isRefusal(outcome), describeOutcome(outcome)).toBe(true);
      expectNoWrites(before, after, { entryTables: entry.writes });
      expect(denials.some((row) => row.actorId === persona.userId && row.targetId === entry.permission)).toBe(true);
    }, 60_000);

    it("an empty input is refused or rejected as invalid, even from the Global caller, and writes nothing", async () => {
      const valid = await buildArgs(entry);
      for (const persona of [personas.anonymous, personas.staffGlobal]) {
        const { before, after, outcome } = await callAndObserve(entry, persona, emptyArgs(valid));
        expect(isRefusal(outcome), `${persona.name}: ${describeOutcome(outcome)}`).toBe(true);
        expectNoWrites(before, after, { entryTables: entry.writes });
      }
    }, 60_000);
  },
);

describe("the cohort A versus cohort B adjacency pair (allowed half)", () => {
  it("confirmManualPaymentAction: cohort A staff is allowed on a cohort A order, and the write lands in the registered tables", async () => {
    const entry = PAYMENT_ENTRIES.find((candidate) => candidate.exportName === "confirmManualPaymentAction")!;
    const order = await world.freshOrder("A");
    const persona = personas.staffCohortA;

    const { before, after, outcome, denials } = await callAndObserve(entry, persona, [
      confirmManualPaymentInput(order.orderId, order.totalMinor),
    ]);

    expect(outcome, describeOutcome(outcome)).toEqual({
      kind: "returned",
      value: { ok: true, outcome: "ACTIVATED" },
    });
    expect(denials.filter((row) => row.actorId === persona.userId)).toHaveLength(0);

    // The registry's `writes` list is accurate: every registered table really changed.
    const changed = changedTables(before, after);
    for (const table of entry.writes) expect(changed, `expected ${table} to change`).toContain(table);

    const row = await matrixPrisma().order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(row.status).toBe("PAID");
  }, 60_000);

  it("recordRefundAction: cohort A staff is allowed on a PAID cohort A order, cohort B staff is refused on it", async () => {
    const entry = PAYMENT_ENTRIES.find((candidate) => candidate.exportName === "recordRefundAction")!;
    const order = await world.freshOrder("A");
    const confirm = await invokeAction(
      { file: "src/app/staff/payments/actions.ts", exportName: "confirmManualPaymentAction" },
      personas.staffCohortA,
      [confirmManualPaymentInput(order.orderId, order.totalMinor)],
    );
    expect(confirm, describeOutcome(confirm)).toEqual({ kind: "returned", value: { ok: true, outcome: "ACTIVATED" } });

    // Refused for the cohort B grant: nothing changes.
    const refused = await callAndObserve(entry, personas.staffCohortB, [recordRefundInput(order.orderId)]);
    expect(isRefusal(refused.outcome), describeOutcome(refused.outcome)).toBe(true);
    expectNoWrites(refused.before, refused.after, { entryTables: entry.writes });

    // Allowed for the cohort A grant: the refund is recorded.
    const allowed = await callAndObserve(entry, personas.staffCohortA, [recordRefundInput(order.orderId)]);
    expect(allowed.outcome, describeOutcome(allowed.outcome)).toEqual({
      kind: "returned",
      value: { ok: true, status: "RECORDED_MANUALLY", access: "unchanged" },
    });
    expect(allowed.denials.filter((row) => row.actorId === personas.staffCohortA.userId)).toHaveLength(0);
    const changed = changedTables(allowed.before, allowed.after);
    for (const table of entry.writes) expect(changed, `expected ${table} to change`).toContain(table);
  }, 60_000);
});
