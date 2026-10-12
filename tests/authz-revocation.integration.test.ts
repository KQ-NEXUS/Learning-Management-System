/**
 * Revocation timing and concurrency (Phase 15, plan 15-26, Task 3; NFR-05, IAM-03,
 * T-15-26-03).
 *
 * A grant that has ended, an assignment that was revoked, a role that was switched off or
 * stripped of the permission, and a session that was revoked must each stop working on the
 * very next request. Plan 15-09 made the grant and actor caches request-scoped only
 * ("revocation must be immediate"), and this file proves it end to end on a real Postgres by
 * calling the real, `withPermission`-gated staff actions as the same person twice with the
 * revocation in between.
 *
 * The behaviours, each in its own `it`:
 *   1. a grant ended between two requests is refused on the second;
 *   2. a session revoked between two requests is refused on the second, as unauthenticated;
 *   3. the end instant rule at the boundary, as the plan wrote it and as the code now
 *      defines it (G-06, `isGrantActive`: a grant holds until one millisecond before its
 *      end instant and has ended AT it; the start instant is inclusive), with a fake clock;
 *   4. concurrency: calls started after the end are all refused, and when a burst races a
 *      revocation, no call that STARTS after the revocation committed succeeds and no row
 *      is written for one.
 *
 * The action used is `listEnrolmentCandidatesAction` (enrolments.manage on a cohort, a read,
 * so it can be repeated freely) and, for the writes, `createSessionAction` (cohorts.manage on
 * a cohort).
 *
 * SAFETY: the only database is a disposable Testcontainers instance from
 * `startMatrixDatabase()`, which refuses a non-local host. Nothing reads `.env`.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with a
 * container-start error and every case reports BLOCKED, which is the expected failure
 * mode, not a bug in the code under test.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ACTION_INPUTS } from "./support/authz-inputs";
import {
  asPersona,
  countDenials,
  denialsSince,
  describeOutcome,
  invokeAction,
  isRefusal,
  startMatrixDatabase,
  stopMatrixDatabase,
  type Outcome,
  type Persona,
} from "./support/authz-matrix";
import { captureBaseline, resetScopeDatabase, seedScopeWorld, type ScopeWorld } from "./support/authz-scope-fixtures";
import { TEST_DB_TIMEOUT_MS } from "./support/pg";

vi.mock("next/headers", async () => (await import("./support/authz-matrix")).nextHeadersMock());
vi.mock("next/cache", async () => (await import("./support/authz-matrix")).nextCacheMock());
vi.mock("next/navigation", async () => (await import("./support/authz-matrix")).nextNavigationMock());

const CASE_TIMEOUT_MS = 120_000;

const ENROLMENT_ACTIONS = "src/app/staff/cohorts/[id]/enrolment-actions.ts";
const SESSION_ACTIONS = "src/app/staff/cohorts/[id]/session-actions.ts";
const LIST = { file: ENROLMENT_ACTIONS, exportName: "listEnrolmentCandidatesAction" } as const;
const CREATE_SESSION = { file: SESSION_ACTIONS, exportName: "createSessionAction" } as const;

let scope: ScopeWorld;
let prismaClient: Awaited<ReturnType<typeof startMatrixDatabase>>["prisma"];

async function freshWorld(): Promise<ScopeWorld> {
  await resetScopeDatabase(prismaClient);
  scope = await seedScopeWorld(prismaClient);
  return scope;
}

beforeAll(async () => {
  const database = await startMatrixDatabase();
  prismaClient = database.prisma;
  await captureBaseline(prismaClient);
  await freshWorld();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await stopMatrixDatabase();
}, TEST_DB_TIMEOUT_MS);

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

async function listAs(persona: Persona): Promise<Outcome> {
  return invokeAction(LIST, persona, await ACTION_INPUTS["enrolments.listCandidates"]!(scope.world));
}

const listAllowed = (outcome: Outcome) =>
  outcome.kind === "returned" && (outcome.value as { ok?: boolean }).ok === true;

async function sessionArgs(title: string) {
  const [input] = (await ACTION_INPUTS["sessions.create"]!(scope.world)) as [Record<string, unknown>];
  return [{ ...input, title }];
}

async function createSessionAs(persona: Persona, title: string): Promise<Outcome> {
  return invokeAction(CREATE_SESSION, persona, await sessionArgs(title));
}

const createAllowed = (outcome: Outcome) =>
  outcome.kind === "returned" && (outcome.value as { ok?: boolean }).ok === true;

/** The staff member under test: every scopable permission on cohort A. */
const staff = () => scope.personas.staffCohortA;

const staffAssignments = () => ({ where: { userId: staff().userId! } });

// ---------------------------------------------------------------------------
// 1. A grant ended between two requests
// ---------------------------------------------------------------------------

describe("1. a grant that ends between two requests is refused on the second", () => {
  it("an assignment whose end instant has passed", async () => {
    await freshWorld();
    const first = await listAs(staff());
    expect(listAllowed(first), `the first request must be allowed: ${describeOutcome(first)}`).toBe(true);

    await prismaClient.assignment.updateMany({ ...staffAssignments(), data: { endsAt: new Date(Date.now() - 1) } });

    const denialsBefore = await countDenials();
    const second = await listAs(staff());
    expect(isRefusal(second), describeOutcome(second)).toBe(true);
    expect(listAllowed(second)).toBe(false);
    const rows = await denialsSince(denialsBefore);
    expect(rows.some((row) => row.actorId === staff().userId && row.targetId === "enrolments.manage")).toBe(true);
  }, CASE_TIMEOUT_MS);

  it("an assignment that was revoked", async () => {
    await freshWorld();
    expect(listAllowed(await listAs(staff()))).toBe(true);

    await prismaClient.assignment.updateMany({ ...staffAssignments(), data: { revokedAt: new Date(), active: false } });

    const second = await listAs(staff());
    expect(isRefusal(second), describeOutcome(second)).toBe(true);
  }, CASE_TIMEOUT_MS);

  it("an assignment that was switched off", async () => {
    await freshWorld();
    expect(listAllowed(await listAs(staff()))).toBe(true);

    await prismaClient.assignment.updateMany({ ...staffAssignments(), data: { active: false } });

    const second = await listAs(staff());
    expect(isRefusal(second), describeOutcome(second)).toBe(true);
  }, CASE_TIMEOUT_MS);

  it("a role that was deactivated", async () => {
    await freshWorld();
    expect(listAllowed(await listAs(staff()))).toBe(true);

    const assignment = await prismaClient.assignment.findFirstOrThrow({ ...staffAssignments(), select: { roleId: true } });
    await prismaClient.role.update({ where: { id: assignment.roleId }, data: { active: false } });

    const second = await listAs(staff());
    expect(isRefusal(second), describeOutcome(second)).toBe(true);
  }, CASE_TIMEOUT_MS);

  it("a role that lost the permission", async () => {
    await freshWorld();
    expect(listAllowed(await listAs(staff()))).toBe(true);

    const assignment = await prismaClient.assignment.findFirstOrThrow({ ...staffAssignments(), select: { role: { select: { id: true, permissions: true } } } });
    await prismaClient.role.update({
      where: { id: assignment.role.id },
      data: { permissions: assignment.role.permissions.filter((permission) => permission !== "enrolments.manage") },
    });

    const second = await listAs(staff());
    expect(isRefusal(second), describeOutcome(second)).toBe(true);
  }, CASE_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// 2. A session revoked between two requests
// ---------------------------------------------------------------------------

describe("2. a session that is revoked between two requests is refused on the second, as unauthenticated", () => {
  it("a session that was revoked", async () => {
    await freshWorld();
    expect(listAllowed(await listAs(staff()))).toBe(true);

    await prismaClient.session.updateMany({ where: { userId: staff().userId! }, data: { revokedAt: new Date() } });

    const denialsBefore = await countDenials();
    const second = await listAs(staff());
    expect(isRefusal(second), describeOutcome(second)).toBe(true);
    const rows = await denialsSince(denialsBefore);
    expect(
      rows.some((row) => row.actorId === null && row.targetId === "enrolments.manage"),
      `the refusal must be the unauthenticated one (no actor): ${JSON.stringify(rows)}`,
    ).toBe(true);
  }, CASE_TIMEOUT_MS);

  it("a session that expired", async () => {
    await freshWorld();
    expect(listAllowed(await listAs(staff()))).toBe(true);

    await prismaClient.session.updateMany({ where: { userId: staff().userId! }, data: { expires: new Date(Date.now() - 1) } });

    const second = await listAs(staff());
    expect(isRefusal(second), describeOutcome(second)).toBe(true);
  }, CASE_TIMEOUT_MS);

  it("an account that was deactivated", async () => {
    await freshWorld();
    expect(listAllowed(await listAs(staff()))).toBe(true);

    await prismaClient.user.update({ where: { id: staff().userId! }, data: { status: "DEACTIVATED", deactivatedAt: new Date() } });

    const second = await listAs(staff());
    expect(isRefusal(second), describeOutcome(second)).toBe(true);
  }, CASE_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// 3. The end instant, with a fake clock
// ---------------------------------------------------------------------------

describe("3. the end instant of a grant, at the boundary", () => {
  /**
   * `withPermission` bound to the real actor, grants and audit sink but to a fixed clock, so
   * the boundary can be probed to the millisecond. This is the same factory the application's
   * live `withPermission` is built from.
   */
  async function probeAt(now: Date): Promise<"ran" | "refused"> {
    const { createWithPermission, AuthorizationError } = await import("@/server/permissions/with-permission");
    const { loadGrantsForUser } = await import("@/server/services/grant-service");
    const { recordAuthorizationAudit } = await import("@/server/services/audit-service");
    const { getCurrentActor } = await import("@/server/auth/current-actor");
    const withPermission = createWithPermission({
      getActor: getCurrentActor,
      loadGrants: loadGrantsForUser,
      audit: recordAuthorizationAudit,
      now: () => now,
    });
    asPersona(staff());
    try {
      return await withPermission("enrolments.manage", () => ({ cohortId: scope.world.cohortAId }))(async () => "ran" as const)(undefined as never);
    } catch (error) {
      if (error instanceof AuthorizationError) return "refused";
      throw error;
    }
  }

  it("holds until its end instant and has ended AT it (the written rule: a grant whose end equals the request instant is treated as ended)", async () => {
    await freshWorld();
    const end = new Date("2027-03-01T12:00:00.000Z");
    await prismaClient.assignment.updateMany({ ...staffAssignments(), data: { endsAt: end } });

    expect(await probeAt(new Date(end.getTime() - 1)), "one millisecond before the end").toBe("ran");
    // G-06: the end is exclusive. `endsAt <= now` ends a grant, so AT the end instant it is refused.
    expect(await probeAt(end), "at the end instant").toBe("refused");
    expect(await probeAt(new Date(end.getTime() + 1)), "one millisecond after the end").toBe("refused");
    expect(await probeAt(new Date(end.getTime() + 86_400_000)), "a day after the end").toBe("refused");
  }, CASE_TIMEOUT_MS);

  it("does not begin before its start instant and holds from it (the start is inclusive)", async () => {
    await freshWorld();
    const start = new Date("2027-03-01T12:00:00.000Z");
    await prismaClient.assignment.updateMany({ ...staffAssignments(), data: { startsAt: start } });

    expect(await probeAt(new Date(start.getTime() - 1)), "one millisecond before the start").toBe("refused");
    expect(await probeAt(start), "at the start instant").toBe("ran");
    expect(await probeAt(new Date(start.getTime() + 1)), "one millisecond after the start").toBe("ran");
  }, CASE_TIMEOUT_MS);

  it("a revoked assignment is refused at any instant, including the instant of revocation", async () => {
    await freshWorld();
    const revokedAt = new Date("2027-03-01T12:00:00.000Z");
    await prismaClient.assignment.updateMany({ ...staffAssignments(), data: { revokedAt, active: false } });

    expect(await probeAt(new Date(revokedAt.getTime() - 1))).toBe("refused");
    expect(await probeAt(revokedAt)).toBe("refused");
    expect(await probeAt(new Date(revokedAt.getTime() + 1))).toBe("refused");
  }, CASE_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// 4. Concurrency
// ---------------------------------------------------------------------------

describe("4. concurrent calls around a revocation", () => {
  it("two calls started after the grant ended are both refused (a read, and a write that creates nothing)", async () => {
    await freshWorld();
    expect(listAllowed(await listAs(staff()))).toBe(true);
    await prismaClient.assignment.updateMany({ ...staffAssignments(), data: { endsAt: new Date(Date.now() - 1) } });

    const reads = await Promise.all([listAs(staff()), listAs(staff())]);
    for (const outcome of reads) expect(listAllowed(outcome), describeOutcome(outcome)).toBe(false);

    const before = await prismaClient.scheduledSession.count();
    const writes = await Promise.all([createSessionAs(staff(), "After the end A"), createSessionAs(staff(), "After the end B")]);
    for (const outcome of writes) expect(isRefusal(outcome), describeOutcome(outcome)).toBe(true);
    expect(await prismaClient.scheduledSession.count(), "a refused concurrent write created a session").toBe(before);
  }, CASE_TIMEOUT_MS);

  it("two calls started before the end may both succeed, and a third started after it is refused", async () => {
    await freshWorld();
    const sessionsBefore = await prismaClient.scheduledSession.count();
    const early = await Promise.all([createSessionAs(staff(), "Before the end A"), createSessionAs(staff(), "Before the end B")]);
    expect(early.every(createAllowed), early.map(describeOutcome).join(" | ")).toBe(true);
    expect(await prismaClient.scheduledSession.count()).toBe(sessionsBefore + 2);

    await prismaClient.assignment.updateMany({ ...staffAssignments(), data: { endsAt: new Date(Date.now() - 1) } });

    const late = await createSessionAs(staff(), "After the end");
    expect(isRefusal(late), describeOutcome(late)).toBe(true);
    expect(await prismaClient.scheduledSession.count(), "a call after the end wrote a session").toBe(sessionsBefore + 2);
  }, CASE_TIMEOUT_MS);

  it("in a burst racing a revocation, no call that starts after the revocation committed succeeds or writes", async () => {
    await freshWorld();
    const burst = 30;
    const revokeAfter = 8;
    const calls: Array<{ title: string; startedAfterRevocation: boolean; outcome: Promise<Outcome> }> = [];
    let revocationCommitted = false;

    for (let index = 0; index < burst; index += 1) {
      const title = `Burst ${String(index).padStart(2, "0")}`;
      // Started means: the moment the call is issued, as seen against the committed revocation.
      calls.push({ title, startedAfterRevocation: revocationCommitted, outcome: createSessionAs(staff(), title) });
      if (index === revokeAfter) {
        await prismaClient.assignment.updateMany({ ...staffAssignments(), data: { revokedAt: new Date(), active: false } });
        revocationCommitted = true;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    const settled = await Promise.all(calls.map(async (call) => ({ ...call, result: await call.outcome })));

    const afterRevocation = settled.filter((call) => call.startedAfterRevocation);
    expect(afterRevocation.length, "the burst must include calls started after the revocation").toBeGreaterThan(10);
    for (const call of afterRevocation) {
      expect(createAllowed(call.result), `${call.title} started after the revocation yet ${describeOutcome(call.result)}`).toBe(false);
    }

    const created = await prismaClient.scheduledSession.findMany({ where: { title: { startsWith: "Burst " } }, select: { title: true } });
    const afterTitles = new Set(afterRevocation.map((call) => call.title));
    for (const row of created) {
      expect(afterTitles.has(row.title), `${row.title} was written by a call that started after the revocation`).toBe(false);
    }
    // And every success is accounted for by a row, none more.
    const succeeded = settled.filter((call) => createAllowed(call.result));
    expect(created.length).toBe(succeeded.length);
    expect(succeeded.length, "at least the first calls ran while the grant was in force").toBeGreaterThan(0);
  }, CASE_TIMEOUT_MS);

  it("a session revoked mid-burst: no call that starts after it succeeds", async () => {
    await freshWorld();
    const calls: Array<{ startedAfterRevocation: boolean; outcome: Promise<Outcome> }> = [];
    let revoked = false;
    for (let index = 0; index < 16; index += 1) {
      calls.push({ startedAfterRevocation: revoked, outcome: listAs(staff()) });
      if (index === 5) {
        await prismaClient.session.updateMany({ where: { userId: staff().userId! }, data: { revokedAt: new Date() } });
        revoked = true;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    const settled = await Promise.all(calls.map(async (call) => ({ ...call, result: await call.outcome })));
    const after = settled.filter((call) => call.startedAfterRevocation);
    expect(after.length).toBeGreaterThan(5);
    for (const call of after) expect(listAllowed(call.result), describeOutcome(call.result)).toBe(false);
  }, CASE_TIMEOUT_MS);
});
