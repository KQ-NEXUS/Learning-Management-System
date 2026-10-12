/**
 * Wrong-scope and wrong-record-state authorization matrix (Phase 15, plan 15-26;
 * NFR-05, D-09, T-15-26-01, T-15-26-02).
 *
 * Plan 15-25 proved identity and permission presence. NFR-05 also requires every
 * protected operation to evaluate ASSIGNMENT SCOPE and RECORD STATE, and those are where
 * per-action wiring mistakes hide (RESEARCH A4, Pitfall 4: the scope must come from the
 * real record, never from an id the caller sent). This file walks the registry
 * (`tests/support/authz-registry.ts`) in sorted order and, on a real Postgres:
 *
 *   0. TRACER. One cohort-scoped action (`cancelEnrolmentAction`) refused for staff scoped
 *      to another cohort, allowed for staff scoped to the right cohort, and refused for a
 *      fully authorised caller on a cancelled enrolment. The generic sections below repeat
 *      exactly this shape for every entry.
 *   1. WRONG SCOPE. Every entry whose permission is checked at RECORD scope is called by
 *      staff who hold EVERY cohort-scopable permission, but only on another cohort
 *      (`staffCohortB`), another course (`staffCourseB`) or another programme
 *      (`staffProgrammeZ`). Each must be refused, leave an `authorization.denied` row for
 *      the permission, write nothing to any table, and leak no id of the target record.
 *      Where the input names a second record besides the cohort or course, a CLAIMED-SCOPE
 *      variant sends the caller's own cohort or course id beside the other scope's record,
 *      which is the shape of a real attack (the scope must be resolved from the record).
 *   2. RIGHT SCOPE (positive control). The same call by staff scoped to the right cohort,
 *      course or programme on a fresh database gets through (no authorization refusal), so
 *      a refusal above cannot be a dead action or an input that never validates.
 *   3. COLLECTION SCOPE. Entries whose permission narrows the rows returned or written
 *      (exports, role assignment) are proven to hand a scoped caller only rows in scope and
 *      to refuse a grant or revocation outside the caller's reach.
 *   4. RECORD STATE. Every entry that declares `recordStates` in the registry is called by a
 *      fully authorised caller against a record put into each disallowed state (an archived
 *      course, a cancelled enrolment, a paid order, a revoked certificate, a closed ticket,
 *      ...). Each must be refused with its domain error and write nothing.
 *
 * A failing case is a real authorization failure: fix the application, never the
 * expectation (D-07 forbids waiving it).
 *
 * SAFETY: the only database is a disposable Testcontainers instance from
 * `startMatrixDatabase()`, which refuses a non-local host. Nothing reads `.env`.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with a
 * container-start error and every case reports BLOCKED, which is the expected failure
 * mode, not a bug in the code under test.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ACTION_REGISTRY,
  ROUTE_REGISTRY,
  type ActionRegistryEntry,
  type RouteRegistryEntry,
} from "./support/authz-registry";
import { ACTION_INPUTS, ROUTE_INPUTS } from "./support/authz-inputs";
import {
  countDenials,
  denialsSince,
  describeOutcome,
  expectNoWrites,
  invokeAction,
  invokeRoute,
  isDenialError,
  isRefusal,
  snapshotWrites,
  startMatrixDatabase,
  stopMatrixDatabase,
  type Outcome,
  type Persona,
} from "./support/authz-matrix";
import {
  POSITIVE_OVERRIDES,
  STATE_CASES,
  captureBaseline,
  certificateOut,
  claimScope,
  createScopedStaff,
  otherRecordIds,
  resetScopeDatabase,
  rightScopePersona,
  scopeLevelOf,
  seedExportData,
  seedScopeWorld,
  seedSiblingCohort,
  type ScopeWorld,
} from "./support/authz-scope-fixtures";
import { TEST_DB_TIMEOUT_MS } from "./support/pg";

vi.mock("next/headers", async () => (await import("./support/authz-matrix")).nextHeadersMock());
vi.mock("next/cache", async () => (await import("./support/authz-matrix")).nextCacheMock());
vi.mock("next/navigation", async () => (await import("./support/authz-matrix")).nextNavigationMock());

const EVIDENCE_PATH = path.resolve(
  import.meta.dirname,
  "..",
  ".planning",
  "phases",
  "15-launch-readiness-nfr-verification-operational-cutover",
  "evidence",
  "authz-scope-state-local.json",
);

const CASE_TIMEOUT_MS = 120_000;

/** Lets work an action started without awaiting land before the "after" snapshot is taken. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

type AnyEntry = ActionRegistryEntry | RouteRegistryEntry;

const isRoute = (entry: AnyEntry): entry is RouteRegistryEntry => "method" in entry;
const keyOf = (entry: AnyEntry) => (isRoute(entry) ? `${entry.file}#${entry.method}` : `${entry.file}#${entry.exportName}`);

const ALL_ENTRIES: readonly AnyEntry[] = [...ACTION_REGISTRY, ...ROUTE_REGISTRY];

/** Entries whose permission is resolved from ONE record the input names. */
const RECORD_ENTRIES = ALL_ENTRIES.filter((entry) => entry.class === "permission" && entry.scope === "RECORD");
/** Entries whose permission narrows the rows returned or written. */
const COLLECTION_ENTRIES = ALL_ENTRIES.filter((entry) => entry.class === "permission" && entry.scope === "COLLECTION");
/** Entries that declare disallowed record states. */
const STATEFUL_ENTRIES = ALL_ENTRIES.filter((entry) => (entry.recordStates?.length ?? 0) > 0);

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

type PerEntry = { key: string; permission: string | null; scope: string | null; cases: Record<string, string> };

const counters = { cases: 0, passed: 0 };
const byKind: Record<string, { cases: number; passed: number }> = {};
const evidence = new Map<string, PerEntry>();

function recordFor(entry: AnyEntry): PerEntry {
  const key = keyOf(entry);
  let record = evidence.get(key);
  if (!record) {
    record = { key, permission: entry.permission ?? null, scope: entry.scope ?? null, cases: {} };
    evidence.set(key, record);
  }
  return record;
}

/** Counts a case, and counts it passed only when the body completes without an assertion failing. */
async function tracked(entry: AnyEntry, kind: string, label: string, body: () => Promise<string>): Promise<void> {
  counters.cases += 1;
  const bucket = (byKind[kind] ??= { cases: 0, passed: 0 });
  bucket.cases += 1;
  const outcome = await body();
  recordFor(entry).cases[label] = outcome;
  counters.passed += 1;
  bucket.passed += 1;
}

function outcomeLabel(outcome: Outcome): string {
  switch (outcome.kind) {
    case "returned":
      return typeof outcome.value === "object" && outcome.value !== null ? "returned-refusal" : `returned-${String(outcome.value)}`;
    case "threw":
      return `threw:${outcome.name}`;
    case "redirect":
      return "redirect";
    case "notFound":
      return "notFound";
    case "response":
      return `HTTP ${outcome.status}`;
  }
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

let scope: ScopeWorld;
let prismaClient: Awaited<ReturnType<typeof startMatrixDatabase>>["prisma"];

/** Empties the database back to the migrations and seeds the world again. */
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
  try {
    // When the database never started no case ran; leave the last real evidence alone.
    if (counters.cases === 0) return;
    const summary = {
      plan: "15-26",
      note: "Local Testcontainers Postgres. No timestamps or ids: the file is identical from run to run.",
      scopedEntries: RECORD_ENTRIES.length + COLLECTION_ENTRIES.length,
      recordScopedEntries: RECORD_ENTRIES.length,
      collectionScopedEntries: COLLECTION_ENTRIES.length,
      statefulEntries: STATEFUL_ENTRIES.length,
      stateCases: STATE_CASES.length,
      entries: new Set([...RECORD_ENTRIES, ...COLLECTION_ENTRIES, ...STATEFUL_ENTRIES].map(keyOf)).size,
      cases: counters.cases,
      passed: counters.passed,
      byKind,
      perEntry: [...evidence.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    };
    mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
    writeFileSync(EVIDENCE_PATH, `${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await stopMatrixDatabase();
  }
}, TEST_DB_TIMEOUT_MS);

// ---------------------------------------------------------------------------
// Calling an entry
// ---------------------------------------------------------------------------

async function buildInput(entry: AnyEntry, inputId: string): Promise<unknown> {
  if (isRoute(entry)) {
    const builder = ROUTE_INPUTS[inputId];
    if (!builder) throw new Error(`No route input builder ${inputId}`);
    return builder(scope.world);
  }
  const builder = ACTION_INPUTS[inputId];
  if (!builder) throw new Error(`No action input builder ${inputId}`);
  return builder(scope.world);
}

async function callWith(entry: AnyEntry, persona: Persona, input: unknown): Promise<Outcome> {
  if (isRoute(entry)) {
    return invokeRoute({ file: entry.file, method: entry.method }, persona, input as Parameters<typeof invokeRoute>[2]);
  }
  return invokeAction({ file: entry.file, exportName: entry.exportName }, persona, input as readonly unknown[]);
}

async function call(entry: AnyEntry, persona: Persona, inputId: string): Promise<Outcome> {
  return callWith(entry, persona, await buildInput(entry, inputId));
}

function inputIdsFor(entry: AnyEntry): string[] {
  return [entry.inputId, ...(isRoute(entry) ? (entry.variantInputIds ?? []) : [])];
}

type Observation = {
  outcome: Outcome;
  before: Awaited<ReturnType<typeof snapshotWrites>>;
  after: Awaited<ReturnType<typeof snapshotWrites>>;
  denials: Awaited<ReturnType<typeof denialsSince>>;
};

async function observe(run: () => Promise<Outcome>): Promise<Observation> {
  const before = await snapshotWrites();
  const denialsBefore = await countDenials();
  const outcome = await run();
  await settle();
  const after = await snapshotWrites();
  return { outcome, before, after, denials: await denialsSince(denialsBefore) };
}

/** Every id the target records carry; none may appear in a refusal. */
function worldIdentifiers(): string[] {
  const values: string[] = [];
  for (const [key, value] of Object.entries(scope.world)) {
    if (key === "prisma" || key === "personas") continue;
    if (typeof value === "string" && value.length >= 20) values.push(value);
  }
  return values;
}

function expectNoLeak(outcome: Outcome): void {
  if (outcome.kind === "redirect") return;
  let text: string;
  switch (outcome.kind) {
    case "returned":
      text = JSON.stringify(outcome.value ?? null, (_key, value) => (typeof value === "bigint" ? String(value) : value)) ?? "";
      break;
    case "threw":
      text = outcome.message;
      break;
    case "response":
      text = outcome.body + JSON.stringify(outcome.headers);
      break;
    default:
      text = "";
  }
  for (const id of worldIdentifiers()) {
    expect(text.includes(id), `a refusal leaked a record id (${id.slice(0, 6)}...) in: ${text.slice(0, 160)}`).toBe(false);
  }
}

function refusalOptions(entry: AnyEntry) {
  return {
    nullMeansRefused: entry.nullMeansRefused === true,
    deniedStatuses: isRoute(entry) ? entry.deniedStatuses : undefined,
  };
}

/** A refusal that is correct, writes nothing, and leaks nothing. */
function expectRefusedWithoutWrites(entry: AnyEntry, who: string, observation: Observation, options: { leak?: boolean } = {}): void {
  const { outcome, before, after } = observation;
  expect(isRefusal(outcome, refusalOptions(entry)), `${who}: not refused: ${describeOutcome(outcome)}`).toBe(true);
  if (!isRoute(entry) && isDenialError(outcome)) {
    expect(
      entry.throwsWhenDenied === true,
      `${who}: the action threw a denial (${describeOutcome(outcome)}) but the registry does not say throwsWhenDenied`,
    ).toBe(true);
  }
  expectNoWrites(before, after, { entryTables: entry.writes });
  if (options.leak !== false) expectNoLeak(outcome);
  if (entry.denialMessage && outcome.kind === "returned") {
    expect(JSON.stringify(outcome.value), `${who}: refusal was not the authorization one`).toContain(entry.denialMessage);
  }
}

/** The refusal came from the permission check on the right permission, not from the input. */
function expectDenialAudit(entry: AnyEntry, persona: Persona, who: string, observation: Observation): void {
  if (entry.class !== "permission" || entry.denialAudit === false) return;
  const row = observation.denials.find((candidate) => candidate.actorId === persona.userId && candidate.targetId === entry.permission);
  expect(
    row,
    `${who}: no authorization.denied row for ${entry.permission} (rows: ${JSON.stringify(
      observation.denials.map((candidate) => ({ who: candidate.actorId === persona.userId ? "caller" : "other", permission: candidate.targetId })),
    )})`,
  ).toBeDefined();
  expect(row?.outcome).toBe("DENIED");
}

// ---------------------------------------------------------------------------
// 0. Tracer
// ---------------------------------------------------------------------------

const CANCEL_ENTRY = ACTION_REGISTRY.find((entry) => entry.exportName === "cancelEnrolmentAction")!;

describe("0. tracer: cancelEnrolmentAction (enrolments.manage, cohort-scoped)", () => {
  it("staff holding every permission only on ANOTHER cohort are refused, audited, and write nothing", async () => {
    await freshWorld();
    await tracked(CANCEL_ENTRY, "tracer", "wrong-cohort", async () => {
      const persona = scope.personas.staffCohortB;
      const observation = await observe(() => call(CANCEL_ENTRY, persona, CANCEL_ENTRY.inputId));
      expectRefusedWithoutWrites(CANCEL_ENTRY, "staffCohortB", observation);
      expectDenialAudit(CANCEL_ENTRY, persona, "staffCohortB", observation);
      const enrolment = await prismaClient.enrolment.findUniqueOrThrow({ where: { id: scope.world.enrolmentAId } });
      expect(enrolment.status).not.toBe("CANCELLED");
      return outcomeLabel(observation.outcome);
    });
  }, CASE_TIMEOUT_MS);

  it("positive control: staff scoped to the RIGHT cohort get through and the enrolment is cancelled", async () => {
    await freshWorld();
    await certificateOut(scope, prismaClient);
    await tracked(CANCEL_ENTRY, "tracer", "right-cohort", async () => {
      const persona = scope.personas.staffCohortA;
      const { outcome, denials } = await observe(() => call(CANCEL_ENTRY, persona, CANCEL_ENTRY.inputId));
      expect(denials.filter((row) => row.actorId === persona.userId)).toEqual([]);
      expect(outcome, describeOutcome(outcome)).toMatchObject({ kind: "returned", value: { ok: true } });
      const enrolment = await prismaClient.enrolment.findUniqueOrThrow({ where: { id: scope.world.enrolmentAId } });
      expect(enrolment.status).toBe("CANCELLED");
      return outcomeLabel(outcome);
    });
  }, CASE_TIMEOUT_MS);

  it("a fully authorised caller on a CANCELLED enrolment is refused with the domain error and writes nothing", async () => {
    await freshWorld();
    await certificateOut(scope, prismaClient);
    await prismaClient.enrolment.update({
      where: { id: scope.world.enrolmentAId },
      data: { status: "CANCELLED", holdExpiresAt: null },
    });
    await tracked(CANCEL_ENTRY, "tracer", "cancelled-enrolment", async () => {
      const observation = await observe(() => call(CANCEL_ENTRY, scope.personas.staffGlobal, CANCEL_ENTRY.inputId));
      expectRefusedWithoutWrites(CANCEL_ENTRY, "staffGlobal", observation);
      expect(JSON.stringify(observation.outcome)).toMatch(/cancelled/i);
      return outcomeLabel(observation.outcome);
    });
  }, CASE_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// 1. Wrong scope
// ---------------------------------------------------------------------------

describe("1. wrong scope: staff holding the permission only on another cohort, course or programme", () => {
  beforeAll(async () => {
    await freshWorld();
  }, TEST_DB_TIMEOUT_MS);

  it("covers the scoped entries of the registry", () => {
    expect(RECORD_ENTRIES.length).toBeGreaterThan(0);
    for (const entry of RECORD_ENTRIES) {
      expect(entry.permission, keyOf(entry)).toBeTruthy();
    }
  });

  for (const entry of RECORD_ENTRIES) {
    const title = `${isRoute(entry) ? `${entry.method} ${entry.route}` : entry.exportName} (${entry.file}) [${entry.permission}, ${entry.scope}]`;
    describe(title, () => {
      for (const inputId of inputIdsFor(entry)) {
        const suffix = inputId === entry.inputId ? "" : ` [${inputId}]`;
        for (const label of ["staffCohortB", "staffCourseB", "staffProgrammeZ"] as const) {
          it(`${label} is refused, audited, and writes nothing${suffix}`, async () => {
            await tracked(entry, "wrong-scope", `${label}${suffix}`, async () => {
              const persona = scope.personas[label];
              const observation = await observe(() => call(entry, persona, inputId));
              expectRefusedWithoutWrites(entry, label, observation);
              expectDenialAudit(entry, persona, label, observation);
              return outcomeLabel(observation.outcome);
            });
          }, CASE_TIMEOUT_MS);
        }
      }

      // Claimed scope: the caller's own cohort or course beside another scope's record.
      if (!isRoute(entry)) {
        for (const claim of [
          { key: "cohortId", label: "staffCohortB", persona: "staffCohortB" },
          { key: "courseId", label: "staffCourseB", persona: "staffCourseB" },
        ] as const) {
          it(`${claim.label} claiming its own ${claim.key} beside the other scope's record is refused and writes nothing`, async (context) => {
            const args = (await buildInput(entry, entry.inputId)) as readonly unknown[];
            const own = claim.key === "cohortId" ? scope.world.cohortBId : scope.world.courseBId;
            const from = claim.key === "cohortId" ? scope.world.cohortAId : scope.world.courseAId;
            const claimed = claimScope(args, claim.key, from, own);
            if (claimed.replaced === 0 || otherRecordIds(args, scope.world).length === 0) {
              context.skip();
              return;
            }
            await tracked(entry, "wrong-scope-claimed", `${claim.label}:claims-${claim.key}`, async () => {
              const observation = await observe(() => callWith(entry, scope.personas[claim.persona], claimed.args));
              expectRefusedWithoutWrites(entry, `${claim.label} (claims ${claim.key})`, observation);
              return outcomeLabel(observation.outcome);
            });
          }, CASE_TIMEOUT_MS);
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 1b. A target outside the caller's reach
// ---------------------------------------------------------------------------

describe("1b. a second record outside the caller's reach", () => {
  const TRANSFER = ACTION_REGISTRY.find((entry) => entry.exportName === "transferEnrolmentAction")!;

  it("staff scoped to the SOURCE cohort only cannot transfer an enrolment into a cohort they do not manage", async () => {
    await freshWorld();
    await certificateOut(scope, prismaClient);
    const siblingId = await seedSiblingCohort(prismaClient, scope);
    await tracked(TRANSFER, "wrong-scope-target", "staffCohortA:target-outside-scope", async () => {
      const persona = scope.personas.staffCohortA;
      const args = [
        { cohortId: scope.world.cohortAId, enrolmentId: scope.world.enrolmentAId, targetCohortId: siblingId, reason: "Moved to the sibling cohort of the same course." },
      ];
      const observation = await observe(() => callWith(TRANSFER, persona, args));
      expectRefusedWithoutWrites(TRANSFER, "staffCohortA (target outside scope)", observation);
      expectDenialAudit(TRANSFER, persona, "staffCohortA (target outside scope)", observation);
      const enrolment = await prismaClient.enrolment.findUniqueOrThrow({ where: { id: scope.world.enrolmentAId } });
      expect(enrolment.cohortId, "the enrolment must stay where it was").toBe(scope.world.cohortAId);
      return outcomeLabel(observation.outcome);
    });
  }, CASE_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// 2. Right scope (positive controls): each starts from pristine records
// ---------------------------------------------------------------------------

/** Text an authorization refusal carries when it is returned as a result rather than thrown. */
const AUTHORIZATION_REFUSAL_TEXT = /do not have access|does not permit|not authori[sz]ed|permit this|permit adding/i;

describe("2. right scope: the same call by staff scoped to the right record gets through", () => {
  for (const entry of RECORD_ENTRIES) {
    const level = scopeLevelOf(entry);
    const override = POSITIVE_OVERRIDES[keyOf(entry)];
    const who = override ? "the correctly scoped staff member" : level === "COHORT" ? "staffCohortA" : level === "COURSE" ? "staffCourseA" : "staffProgrammeA";
    const title = `${isRoute(entry) ? `${entry.method} ${entry.route}` : entry.exportName} lets ${who} through`;
    it(title, async () => {
      await freshWorld();
      await tracked(entry, "right-scope", override ? "right-scope-override" : `right-${level.toLowerCase()}`, async () => {
        const persona = override ? override.persona(scope.personas) : rightScopePersona(scope.personas, level);
        const input = override?.args ? await override.args(scope, prismaClient) : await buildInput(entry, entry.inputId);
        const { outcome, denials } = await observe(() => callWith(entry, persona, input));
        expect(
          denials.filter((row) => row.actorId === persona.userId),
          `${who} were denied: ${describeOutcome(outcome)}`,
        ).toEqual([]);
        expect(isDenialError(outcome), describeOutcome(outcome)).toBe(false);
        if (isRoute(entry)) {
          expect(outcome.kind, describeOutcome(outcome)).toBe("response");
          if (outcome.kind === "response" && entry.deniedStatuses.includes(outcome.status)) {
            // A route answers a denial and "nothing to serve" with the same status (denial parity).
            // The right person must get exactly what fully authorised Global staff get on the same
            // fresh records, so the status cannot be the authorization one.
            await freshWorld();
            const reference = await call(entry, scope.personas.staffGlobal, entry.inputId);
            expect(
              reference.kind === "response" ? reference.status : reference.kind,
              `${who} got ${describeOutcome(outcome)} but Global staff got ${describeOutcome(reference)}`,
            ).toBe(outcome.status);
          }
        } else {
          expect(outcome.kind === "returned" || outcome.kind === "redirect", describeOutcome(outcome)).toBe(true);
          if (outcome.kind === "returned") {
            expect(JSON.stringify(outcome.value ?? null), "the right scope was refused as unauthorised").not.toMatch(AUTHORIZATION_REFUSAL_TEXT);
          }
        }
        return outcomeLabel(outcome);
      });
    }, CASE_TIMEOUT_MS);
  }
});

// ---------------------------------------------------------------------------
// 3. Collection scope: the permission narrows the rows returned or written
// ---------------------------------------------------------------------------

const entryNamed = (name: string) => {
  const found = ACTION_REGISTRY.find((entry) => entry.exportName === name);
  if (!found) throw new Error(`No registry entry ${name}`);
  return found;
};

const AS_OF = () => new Date(Date.now() - 1_000).toISOString();

type ExportOutcome = { ok: boolean; jobId?: string };

/** The rows an export snapshot froze, and the scope it recorded, read straight from the database. */
async function readExport(outcome: Outcome): Promise<{ ok: boolean; scope: Record<string, unknown> | null; rows: Array<Record<string, unknown>> }> {
  const value = outcome.kind === "returned" ? (outcome.value as ExportOutcome) : { ok: false };
  if (!value.ok || !value.jobId) return { ok: false, scope: null, rows: [] };
  const job = await prismaClient.exportJob.findUniqueOrThrow({
    where: { id: value.jobId },
    include: { snapshotRows: { orderBy: { ordinal: "asc" } } },
  });
  return {
    ok: true,
    scope: job.scopeSnapshot as Record<string, unknown>,
    rows: job.snapshotRows.map((row) => row.data as Record<string, unknown>),
  };
}

describe("3. collection scope: staff scoped to one cohort, course or programme get only the rows in that scope", () => {
  const REPORT_EXPORT = entryNamed("requestReportExportAction");
  const REFUND_EXPORT = entryNamed("requestReconciliationRefundExportAction");
  const SENSITIVE = entryNamed("permittedSensitiveColumnsAction");
  const CREATE_ASSIGNMENT = entryNamed("createAssignmentAction");
  const REVOKE_ASSIGNMENT = entryNamed("revokeAssignmentAction");

  type Who = { label: string; pick: (s: ScopeWorld) => Persona; expect: "A" | "B" | "none" | "both" };
  const PEOPLE: readonly Who[] = [
    { label: "staffCohortA", pick: (s) => s.personas.staffCohortA, expect: "A" },
    { label: "staffCohortB", pick: (s) => s.personas.staffCohortB, expect: "B" },
    { label: "staffCourseA", pick: (s) => s.personas.staffCourseA, expect: "A" },
    { label: "staffCourseB", pick: (s) => s.personas.staffCourseB, expect: "B" },
    { label: "staffProgrammeZ", pick: (s) => s.personas.staffProgrammeZ, expect: "none" },
    { label: "staffGlobal", pick: (s) => s.personas.staffGlobal, expect: "both" },
  ];

  const wanted = (expected: Who["expect"], a: string, b: string) =>
    expected === "A" ? [a] : expected === "B" ? [b] : expected === "both" ? [a, b] : [];

  for (const who of PEOPLE) {
    it(`requestReportExportAction as ${who.label} freezes only the enrolments in its scope`, async () => {
      await freshWorld();
      const data = await seedExportData(prismaClient, scope);
      await tracked(REPORT_EXPORT, "collection-scope", `${who.label}:enrolments-export`, async () => {
        const persona = who.pick(scope);
        const input = { dataset: "enrolments", asOf: AS_OF() };
        const actual = await invokeAction({ file: REPORT_EXPORT.file, exportName: REPORT_EXPORT.exportName }, persona, [input]);
        const exported = await readExport(actual);
        expect(exported.ok, `${who.label}: the export was refused: ${describeOutcome(actual)}`).toBe(true);
        const ids = exported.rows.map((row) => String(row.id)).sort();
        expect(ids, `${who.label}: wrong rows in the frozen snapshot`).toEqual(wanted(who.expect, data.enrolmentAId, data.enrolmentBId).sort());
        const scopeSnapshot = exported.scope ?? {};
        if (who.expect === "both") {
          expect(scopeSnapshot.kind).toBe("GLOBAL");
        } else {
          expect(scopeSnapshot.kind, `${who.label}: a scoped caller was handed a GLOBAL scope`).toBe("LIMITED");
        }
        return `rows:${ids.length}`;
      });
    }, CASE_TIMEOUT_MS);

    it(`requestReconciliationRefundExportAction as ${who.label} freezes only the refunds in its scope`, async () => {
      await freshWorld();
      const data = await seedExportData(prismaClient, scope);
      await tracked(REFUND_EXPORT, "collection-scope", `${who.label}:refund-export`, async () => {
        const persona = who.pick(scope);
        const actual = await invokeAction(
          { file: REFUND_EXPORT.file, exportName: REFUND_EXPORT.exportName },
          persona,
          [{ filters: {}, columns: ["reference", "amountMinor"], asOf: AS_OF() }],
        );
        const exported = await readExport(actual);
        expect(exported.ok, `${who.label}: the export was refused: ${describeOutcome(actual)}`).toBe(true);
        const references = exported.rows.map((row) => String(row.reference)).sort();
        expect(references, `${who.label}: wrong rows in the frozen snapshot`).toEqual(
          wanted(who.expect, data.orderAReference, data.orderBReference).sort(),
        );
        return `rows:${references.length}`;
      });
    }, CASE_TIMEOUT_MS);
  }

  it("permittedSensitiveColumnsAction hands a scoped caller only column keys, never a record id", async () => {
    await freshWorld();
    for (const who of PEOPLE) {
      await tracked(SENSITIVE, "collection-scope", `${who.label}:sensitive-columns`, async () => {
        const outcome = await invokeAction({ file: SENSITIVE.file, exportName: SENSITIVE.exportName }, who.pick(scope), ["enrolments"]);
        expect(outcome.kind, describeOutcome(outcome)).toBe("returned");
        const list = outcome.kind === "returned" ? (outcome.value as unknown[]) : [];
        expect(Array.isArray(list)).toBe(true);
        for (const key of list) expect(["learnerName", "learnerEmail"], `${who.label}: unexpected column ${String(key)}`).toContain(key);
        expectNoLeak(outcome);
        return `columns:${list.length}`;
      });
    }
  }, CASE_TIMEOUT_MS);

  // ---- who may grant and revoke roles, and where ----

  const assignmentForm = (userId: string, roleId: string, scopeType: string, scopeId?: string) => {
    const data = new FormData();
    data.append("userId", userId);
    data.append("roleId", roleId);
    data.append("scopeType", scopeType);
    if (scopeId) data.append("scopeId", scopeId);
    return [{ errors: [], success: false }, data] as const;
  };

  async function assignmentRows(userId: string) {
    return prismaClient.assignment.findMany({ where: { userId }, select: { id: true, scopeType: true, scopeId: true, active: true, revokedAt: true } });
  }

  const grantCases: Array<{
    label: string;
    who: (s: ScopeWorld) => Persona;
    target: (s: ScopeWorld) => { scopeType: string; scopeId?: string };
    allowed: boolean;
  }> = [
    { label: "staffCohortB grants at GLOBAL scope", who: (s) => s.personas.staffCohortB, target: () => ({ scopeType: "GLOBAL" }), allowed: false },
    { label: "staffCohortB grants on cohort A", who: (s) => s.personas.staffCohortB, target: (s) => ({ scopeType: "COHORT", scopeId: s.world.cohortAId }), allowed: false },
    { label: "staffCohortB grants on course A", who: (s) => s.personas.staffCohortB, target: (s) => ({ scopeType: "COURSE", scopeId: s.world.courseAId }), allowed: false },
    { label: "staffCourseB grants on cohort A", who: (s) => s.personas.staffCourseB, target: (s) => ({ scopeType: "COHORT", scopeId: s.world.cohortAId }), allowed: false },
    { label: "staffProgrammeZ grants on programme A", who: (s) => s.personas.staffProgrammeZ, target: (s) => ({ scopeType: "PROGRAMME", scopeId: s.world.programmeId }), allowed: false },
    { label: "staffCohortB grants on its own cohort B", who: (s) => s.personas.staffCohortB, target: (s) => ({ scopeType: "COHORT", scopeId: s.world.cohortBId }), allowed: true },
    { label: "staffCohortA grants on its own cohort A", who: (s) => s.personas.staffCohortA, target: (s) => ({ scopeType: "COHORT", scopeId: s.world.cohortAId }), allowed: true },
  ];

  for (const grantCase of grantCases) {
    it(`createAssignmentAction: ${grantCase.label} is ${grantCase.allowed ? "allowed" : "refused and creates nothing"}`, async () => {
      await freshWorld();
      await tracked(CREATE_ASSIGNMENT, "collection-scope", grantCase.label, async () => {
        const persona = grantCase.who(scope);
        const target = grantCase.target(scope);
        const before = await assignmentRows(scope.world.staffTargetUserId);
        const observation = await observe(() =>
          invokeAction({ file: CREATE_ASSIGNMENT.file, exportName: CREATE_ASSIGNMENT.exportName }, persona, assignmentForm(scope.world.staffTargetUserId, scope.world.roleId, target.scopeType, target.scopeId)),
        );
        const after = await assignmentRows(scope.world.staffTargetUserId);
        if (grantCase.allowed) {
          expect(observation.denials.filter((row) => row.actorId === persona.userId), describeOutcome(observation.outcome)).toEqual([]);
          expect(after.length, "the allowed grant was not created").toBe(before.length + 1);
          expect(JSON.stringify(observation.outcome)).toMatch(/"success":true/);
        } else {
          expectRefusedWithoutWrites(CREATE_ASSIGNMENT, grantCase.label, observation);
          expect(after, "a refused grant created an assignment").toEqual(before);
        }
        return outcomeLabel(observation.outcome);
      });
    }, CASE_TIMEOUT_MS);
  }

  it("createAssignmentAction: staff who hold only roles.manage cannot hand out a role that carries a permission they lack (grant ceiling)", async () => {
    await freshWorld();
    const rolesOnly = await prismaClient.role.create({ data: { name: "Scope matrix roles-only", permissions: ["roles.manage"] }, select: { id: true } });
    const delegate = await createScopedStaff(prismaClient, "staffRolesOnlyB", rolesOnly.id, "COHORT", scope.world.cohortBId);
    await tracked(CREATE_ASSIGNMENT, "collection-scope", "grant-ceiling", async () => {
      const before = await assignmentRows(scope.world.staffTargetUserId);
      const observation = await observe(() =>
        invokeAction(
          { file: CREATE_ASSIGNMENT.file, exportName: CREATE_ASSIGNMENT.exportName },
          delegate,
          assignmentForm(scope.world.staffTargetUserId, scope.world.roleId, "COHORT", scope.world.cohortBId),
        ),
      );
      expectRefusedWithoutWrites(CREATE_ASSIGNMENT, "roles-only delegate", observation, { leak: false });
      expect(JSON.stringify(observation.outcome)).toMatch(/Missing: reports\.view/);
      expect(await assignmentRows(scope.world.staffTargetUserId)).toEqual(before);
      return outcomeLabel(observation.outcome);
    });
  }, CASE_TIMEOUT_MS);

  const revokeCases: Array<{ label: string; who: (s: ScopeWorld) => Persona; target: "cohortA" | "global"; allowed: boolean }> = [
    { label: "staffCohortB revokes an assignment on cohort A", who: (s) => s.personas.staffCohortB, target: "cohortA", allowed: false },
    { label: "staffCourseB revokes an assignment on cohort A", who: (s) => s.personas.staffCourseB, target: "cohortA", allowed: false },
    { label: "staffCohortA revokes a GLOBAL assignment", who: (s) => s.personas.staffCohortA, target: "global", allowed: false },
    { label: "staffCohortA revokes an assignment on its own cohort A", who: (s) => s.personas.staffCohortA, target: "cohortA", allowed: true },
  ];

  for (const revokeCase of revokeCases) {
    it(`revokeAssignmentAction: ${revokeCase.label} is ${revokeCase.allowed ? "allowed" : "refused and revokes nothing"}`, async () => {
      await freshWorld();
      const cohortAssignment = await prismaClient.assignment.create({
        data: { userId: scope.world.staffTargetUserId, roleId: scope.world.roleId, scopeType: "COHORT", scopeId: scope.world.cohortAId },
        select: { id: true },
      });
      await tracked(REVOKE_ASSIGNMENT, "collection-scope", revokeCase.label, async () => {
        const persona = revokeCase.who(scope);
        const targetId = revokeCase.target === "cohortA" ? cohortAssignment.id : scope.world.targetAssignmentId;
        const observation = await observe(() =>
          invokeAction({ file: REVOKE_ASSIGNMENT.file, exportName: REVOKE_ASSIGNMENT.exportName }, persona, [targetId, "Revoked by the scope matrix."]),
        );
        const row = await prismaClient.assignment.findUniqueOrThrow({ where: { id: targetId } });
        if (revokeCase.allowed) {
          expect(observation.denials.filter((entry) => entry.actorId === persona.userId), describeOutcome(observation.outcome)).toEqual([]);
          expect(row.revokedAt, "the allowed revocation did not happen").not.toBeNull();
        } else {
          expectRefusedWithoutWrites(REVOKE_ASSIGNMENT, revokeCase.label, observation);
          expect(row.revokedAt, "a refused revocation revoked the assignment").toBeNull();
          expect(row.active).toBe(true);
        }
        return outcomeLabel(observation.outcome);
      });
    }, CASE_TIMEOUT_MS);
  }
});

// ---------------------------------------------------------------------------
// 4. Record states
// ---------------------------------------------------------------------------

/** Developer aid: set AUTHZ_DEBUG_FILE to append what each state case answered. Unused in the suite. */
const DEBUG_FILE = process.env.AUTHZ_DEBUG_FILE;

describe("4. record state: a fully authorised caller is refused on a record in a disallowed state", () => {
  it("every stateful entry has a case for every declared state, and every case names a declared state", () => {
    for (const entry of STATEFUL_ENTRIES) {
      for (const state of entry.recordStates ?? []) {
        expect(
          STATE_CASES.some((stateCase) => stateCase.entryKey === keyOf(entry) && stateCase.state === state),
          `${keyOf(entry)} declares recordState "${state}" but no state case builds it`,
        ).toBe(true);
      }
    }
    for (const stateCase of STATE_CASES) {
      const entry = STATEFUL_ENTRIES.find((candidate) => keyOf(candidate) === stateCase.entryKey);
      expect(entry, `${stateCase.entryKey} is not a stateful registry entry`).toBeDefined();
      expect(entry?.recordStates, stateCase.entryKey).toContain(stateCase.state);
    }
  });

  for (const stateCase of STATE_CASES) {
    const entry = STATEFUL_ENTRIES.find((candidate) => keyOf(candidate) === stateCase.entryKey);
    if (!entry) continue;
    it(`${isRoute(entry) ? `${entry.method} ${entry.route}` : entry.exportName} refuses a record that is ${stateCase.state}`, async () => {
      await freshWorld();
      await stateCase.arrange(scope, prismaClient);
      await tracked(entry, "record-state", stateCase.state, async () => {
        const persona = stateCase.caller === "owner" ? scope.personas.learnerOwner : scope.personas.staffGlobal;
        const input = stateCase.args ? await stateCase.args(scope, prismaClient) : await buildInput(entry, stateCase.inputId ?? entry.inputId);
        const observation = await observe(() => callWith(entry, persona, input));
        if (DEBUG_FILE) appendFileSync(DEBUG_FILE, `STATE ${keyOf(entry)} [${stateCase.state}] -> ${describeOutcome(observation.outcome)}
`);
        const who = `${stateCase.caller === "owner" ? "learnerOwner" : "staffGlobal"} on a ${stateCase.state} record`;
        if (stateCase.idempotent) {
          // A deliberate harmless repeat: it answers success, but it must change nothing at all.
          expect(observation.outcome.kind === "returned" || observation.outcome.kind === "response", describeOutcome(observation.outcome)).toBe(true);
          expectNoWrites(observation.before, observation.after, { entryTables: entry.writes });
        } else if (stateCase.statuses) {
          // A route that answers a not-ready record with its own status rather than the denial 404.
          const { outcome } = observation;
          expect(outcome.kind === "response" && stateCase.statuses.includes(outcome.status), `${who}: ${describeOutcome(outcome)}`).toBe(true);
          expectNoWrites(observation.before, observation.after, { entryTables: entry.writes });
        } else {
          // The caller is fully authorised and named the record, so the id may appear in the answer.
          expectRefusedWithoutWrites(entry, who, observation, { leak: false });
        }
        // No exception: W-15 removed the one case (the owner of a revoked certificate) that
        // used to leave a denial row here.
        expect(
          observation.denials.filter((row) => row.actorId === persona.userId),
          "the caller was fully authorised: the refusal must not be an authorization denial",
        ).toEqual([]);
        if (stateCase.message) {
          expect(JSON.stringify(observation.outcome), "the refusal was not the domain one").toMatch(stateCase.message);
        }
        return stateCase.idempotent ? "idempotent-no-write" : outcomeLabel(observation.outcome);
      });
    }, CASE_TIMEOUT_MS);
  }
});
