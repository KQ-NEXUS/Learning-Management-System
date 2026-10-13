/**
 * The generic authorization bypass matrix (Phase 15, plan 15-25, Task 3; NFR-05,
 * D-09, T-15-25-01, T-15-25-03, T-15-25-04).
 *
 * Server actions are public POST endpoints (Next.js server-actions guide) and
 * route handlers are reachable at their URLs, so the UI hiding a button proves
 * nothing. This file walks EVERY non-public entry of the registry
 * (`tests/support/authz-registry.ts`, kept complete by `authz-inventory.test.ts`),
 * in sorted file and export order, and calls the real exported function against a
 * real Postgres as the people who must be refused:
 *
 *   - an anonymous visitor (no session);
 *   - a signed-in learner who does not own the target record;
 *   - a staff member holding no role;
 *   - for every entry that changes data, a staff member who holds EVERY view
 *     permission at Global scope but nothing that changes data (the classic "can
 *     see it, so can edit it" mistake), which must be refused by the write check.
 *     The one exception is reconciliation case triage, which the product gates on
 *     `payments.view` by design (see the registry entry's reason).
 *
 * Every refusal must (a) be a refusal the action or route can express (a mapped
 * result, a thrown authentication or authorization error, a redirect, or the
 * route's pinned status), (b) write nothing to ANY table except the audit trail,
 * which is proven by a before/after snapshot of every table, (c) for a permission
 * entry that uses the audited choke point, leave an `authorization.denied` row
 * naming the caller and the permission (proving the denial came from the
 * authorization wiring and not from the input being rejected first), and (d) leak no
 * id from the target record in its answer.
 *
 * Two further probes per entry that takes input: an EMPTY input from an anonymous
 * caller, and an empty input from the most privileged caller (Global staff). An
 * empty or schema-invalid input must be refused or rejected as invalid before any
 * write. Signed webhooks are checked with a bad signature and an empty body: both
 * refused with no write.
 *
 * Entries that act only on the signed-in person's own data (`selfOnly`) have no
 * "someone else's record" to name, so they run the anonymous case plus the empty
 * input probes.
 *
 * Finally, positive controls run the person who IS allowed through the entries
 * that are safe to call (reads, and routes that only presign), so a refusal above
 * cannot be a dead route or an input that never validates.
 *
 * A failing case here is a real authorization failure. Fix the action or service,
 * never the expectation (D-07 forbids waiving it).
 *
 * SAFETY: the only database here is a disposable Testcontainers instance from
 * `startMatrixDatabase()`, which refuses a non-local host. Nothing reads `.env`.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with a
 * container-start error and every case reports BLOCKED, which is the expected
 * failure mode, not a bug in the code under test.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ACTION_REGISTRY,
  ROUTE_REGISTRY,
  type ActionRegistryEntry,
  type RouteRegistryEntry,
} from "./support/authz-registry";
import {
  ACTION_INPUTS,
  ROUTE_INPUTS,
  emptyArgs,
  seedWorld,
  type World,
} from "./support/authz-inputs";
import {
  countDenials,
  denialsSince,
  describeOutcome,
  expectNoWrites,
  invokeAction,
  invokeRoute,
  isDenialError,
  isRefusal,
  seedPersonas,
  snapshotWrites,
  startMatrixDatabase,
  stopMatrixDatabase,
  type Outcome,
  type Persona,
  type Personas,
} from "./support/authz-matrix";
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
  "authz-matrix-local.json",
);

const CASE_TIMEOUT_MS = 120_000;

/**
 * A short pause after each call so work an action started without awaiting (a
 * second concurrent check, a deferred write) lands before the "after" snapshot is
 * taken, instead of leaking into the next case's window.
 */
const SETTLE_MS = 30;
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, SETTLE_MS));

type AnyEntry = ActionRegistryEntry | RouteRegistryEntry;

const isRoute = (entry: AnyEntry): entry is RouteRegistryEntry => "method" in entry;
const keyOf = (entry: AnyEntry) => (isRoute(entry) ? `${entry.file}#${entry.method}` : `${entry.file}#${entry.exportName}`);

/** Registry order is sorted already (the inventory test proves it); actions first, then routes. */
const ENTRIES: readonly AnyEntry[] = [...ACTION_REGISTRY, ...ROUTE_REGISTRY].filter(
  (entry) => entry.class !== "public",
);

type PerEntry = { key: string; class: string; permission: string | null; cases: Record<string, string> };

const counters = { cases: 0, passed: 0 };
const evidence = new Map<string, PerEntry>();
const casesByClass: Record<string, number> = {};
const passedByClass: Record<string, number> = {};

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
  try {
    // When the database never started no case ran; leave the last real evidence
    // alone instead of replacing it with a file that says zero cases.
    if (counters.cases === 0) return;
    const entries = [...evidence.values()];
    const byClass: Record<string, { entries: number; cases: number; passed: number }> = {};
    for (const entry of ENTRIES) {
      const bucket = (byClass[entry.class] ??= { entries: 0, cases: 0, passed: 0 });
      bucket.entries += 1;
      bucket.cases = casesByClass[entry.class] ?? 0;
      bucket.passed = passedByClass[entry.class] ?? 0;
    }
    const summary = {
      plan: "15-25",
      note: "Local Testcontainers Postgres. No timestamps or ids: the file is identical from run to run.",
      entries: ENTRIES.length,
      actionEntries: ENTRIES.filter((entry) => !isRoute(entry)).length,
      routeEntries: ENTRIES.filter(isRoute).length,
      cases: counters.cases,
      passed: counters.passed,
      byClass,
      perEntry: entries,
    };
    mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
    writeFileSync(EVIDENCE_PATH, `${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await stopMatrixDatabase();
  }
}, TEST_DB_TIMEOUT_MS);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recordFor(entry: AnyEntry): PerEntry {
  const key = keyOf(entry);
  let record = evidence.get(key);
  if (!record) {
    record = { key, class: entry.class, permission: entry.permission ?? null, cases: {} };
    evidence.set(key, record);
  }
  return record;
}

/** A deterministic, id-free label for what a call did. */
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

/** Counts a case, and counts it passed only when the body completes without an assertion failing. */
async function tracked(entry: AnyEntry, label: string, body: () => Promise<string>): Promise<void> {
  counters.cases += 1;
  casesByClass[entry.class] = (casesByClass[entry.class] ?? 0) + 1;
  const label2 = await body();
  recordFor(entry).cases[label] = label2;
  counters.passed += 1;
  passedByClass[entry.class] = (passedByClass[entry.class] ?? 0) + 1;
}

/** Every id the target records carry; none may appear in a refusal. */
function worldIdentifiers(): string[] {
  const values: string[] = [];
  for (const [key, value] of Object.entries(world)) {
    if (key === "prisma" || key === "personas") continue;
    if (typeof value === "string" && value.length >= 20) values.push(value);
  }
  return values;
}

function expectNoLeak(outcome: Outcome): void {
  // A redirect is built from what the caller sent, so it can only echo the caller's own input.
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

type Observation = { outcome: Outcome; before: Awaited<ReturnType<typeof snapshotWrites>>; after: Awaited<ReturnType<typeof snapshotWrites>>; denials: Awaited<ReturnType<typeof denialsSince>> };

async function observe(call: () => Promise<Outcome>): Promise<Observation> {
  const before = await snapshotWrites();
  const denialsBefore = await countDenials();
  const outcome = await call();
  await settle();
  const after = await snapshotWrites();
  const denials = await denialsSince(denialsBefore);
  return { outcome, before, after, denials };
}

/** A malformed body is rejected with a 400 or 422 before any authorization or write; that is a refusal too. */
const VALIDATION_STATUSES = [400, 422];

function refusalOptions(entry: AnyEntry, emptied = false) {
  return {
    nullMeansRefused: entry.nullMeansRefused === true,
    deniedStatuses: isRoute(entry)
      ? emptied
        ? [...entry.deniedStatuses, ...VALIDATION_STATUSES]
        : entry.deniedStatuses
      : undefined,
  };
}

/** Checks (a) refusal, (b) no write, (d) no leak; returns the observation for the audit check. */
function expectRefusedWithoutWrites(entry: AnyEntry, persona: Persona, observation: Observation, emptied = false): void {
  const { outcome, before, after } = observation;
  expect(isRefusal(outcome, refusalOptions(entry, emptied)), `${persona.name}: not refused: ${describeOutcome(outcome)}`).toBe(true);
  if (!isRoute(entry) && isDenialError(outcome)) {
    expect(
      entry.throwsWhenDenied === true,
      `${persona.name}: the action threw a denial (${describeOutcome(outcome)}) but the registry does not say throwsWhenDenied`,
    ).toBe(true);
  }
  expectNoWrites(before, after, { entryTables: entry.writes });
  expectNoLeak(outcome);
  // Where no audit row proves the refusal came from authorization, the mapped message does.
  if (entry.denialMessage && !emptied && outcome.kind === "returned") {
    expect(JSON.stringify(outcome.value), `${persona.name}: refusal was not the authorization one`).toContain(entry.denialMessage);
  }
}

/** A write entry whose caller holds every view permission: the refusal must come from a non-view permission. */
function expectDenialAuditOfAWritePermission(entry: AnyEntry, persona: Persona, observation: Observation): void {
  if (entry.class !== "permission" || entry.denialAudit === false) return;
  const rows = observation.denials.filter((candidate) => candidate.actorId === persona.userId);
  expect(rows.length, `${persona.name}: no authorization.denied row written for the caller`).toBeGreaterThan(0);
  expect(
    rows.some((row) => row.targetId !== null && !row.targetId.endsWith(".view")),
    `${persona.name}: denied only on view permissions: ${JSON.stringify(rows.map((row) => row.targetId))}`,
  ).toBe(true);
}

function expectDenialAudit(entry: AnyEntry, persona: Persona, observation: Observation): void {
  if (entry.class !== "permission" || entry.denialAudit === false) return;
  const row = observation.denials.find((candidate) => candidate.actorId === persona.userId && candidate.targetId === entry.permission);
  expect(
    row,
    `${persona.name}: no authorization.denied row for ${entry.permission} (rows written: ${JSON.stringify(
      observation.denials.map((candidate) => ({ actor: candidate.actorId === null ? "anonymous" : candidate.actorId === persona.userId ? "caller" : "other", permission: candidate.targetId })),
    )})`,
  ).toBeDefined();
  expect(row?.outcome).toBe("DENIED");
}

async function buildInput(entry: AnyEntry, inputId: string) {
  if (isRoute(entry)) {
    const builder = ROUTE_INPUTS[inputId];
    if (!builder) throw new Error(`No route input builder ${inputId}`);
    return builder(world);
  }
  const builder = ACTION_INPUTS[inputId];
  if (!builder) throw new Error(`No action input builder ${inputId}`);
  return builder(world);
}

async function call(entry: AnyEntry, persona: Persona, inputId: string, emptied = false): Promise<Outcome> {
  if (isRoute(entry)) {
    const request = (await buildInput(entry, inputId)) as Awaited<ReturnType<NonNullable<(typeof ROUTE_INPUTS)[string]>>>;
    const shaped = emptied ? { ...request, body: request.body === undefined ? undefined : "", headers: {} } : request;
    return invokeRoute({ file: entry.file, method: entry.method }, persona, shaped);
  }
  const args = (await buildInput(entry, inputId)) as readonly unknown[];
  return invokeAction({ file: entry.file, exportName: entry.exportName }, persona, emptied ? emptyArgs(args) : args);
}

function inputIdsFor(entry: AnyEntry): string[] {
  return [entry.inputId, ...(isRoute(entry) ? (entry.variantInputIds ?? []) : [])];
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

describe("authorization matrix: registry is walked in sorted order", () => {
  it("covers every non-public entry", () => {
    expect(ENTRIES.length).toBeGreaterThan(0);
    expect(ENTRIES.length).toBe(
      ACTION_REGISTRY.filter((entry) => entry.class !== "public").length +
        ROUTE_REGISTRY.filter((entry) => entry.class !== "public").length,
    );
    const keys = ENTRIES.map(keyOf);
    expect(keys.slice(0, ACTION_REGISTRY.filter((entry) => entry.class !== "public").length)).toEqual(
      [...ACTION_REGISTRY].filter((entry) => entry.class !== "public").map(keyOf),
    );
  });
});

for (const entry of ENTRIES) {
  const title = `${isRoute(entry) ? `${entry.method} ${entry.route}` : entry.exportName} (${entry.file}) [${entry.class}${entry.permission ? `: ${entry.permission}, ${entry.scope}` : ""}]`;

  if (entry.class === "public-signature") {
    describe(title, () => {
      it("a bad signature is refused and nothing is written", async () => {
        await tracked(entry, "bad-signature", async () => {
          const observation = await observe(() => call(entry, personas.anonymous, entry.inputId));
          expect(isRefusal(observation.outcome, refusalOptions(entry)), describeOutcome(observation.outcome)).toBe(true);
          expectNoWrites(observation.before, observation.after, { entryTables: entry.writes });
          return outcomeLabel(observation.outcome);
        });
      }, CASE_TIMEOUT_MS);

      it("an empty body with no signature is refused and nothing is written", async () => {
        await tracked(entry, "empty-body", async () => {
          const observation = await observe(() => call(entry, personas.anonymous, entry.inputId, true));
          expect(isRefusal(observation.outcome, refusalOptions(entry, true)), describeOutcome(observation.outcome)).toBe(true);
          expectNoWrites(observation.before, observation.after, { entryTables: entry.writes });
          return outcomeLabel(observation.outcome);
        });
      }, CASE_TIMEOUT_MS);
    });
    continue;
  }

  describe(title, () => {
    const personaNames = (entry.selfOnly ? ["anonymous"] : ["anonymous", "learnerOther", "staffNone"]) as Array<
      "anonymous" | "learnerOther" | "staffNone"
    >;

    for (const inputId of inputIdsFor(entry)) {
      for (const personaName of personaNames) {
        it(`${personaName} is refused, writes nothing${entry.class === "permission" && entry.denialAudit !== false ? " and the denial is audited" : ""}${inputId === entry.inputId ? "" : ` [${inputId}]`}`, async () => {
          await tracked(entry, `${personaName}${inputId === entry.inputId ? "" : `:${inputId}`}`, async () => {
            const persona = personas[personaName];
            const observation = await observe(() => call(entry, persona, inputId));
            expectRefusedWithoutWrites(entry, persona, observation);
            expectDenialAudit(entry, persona, observation);
            return outcomeLabel(observation.outcome);
          });
        }, CASE_TIMEOUT_MS);
      }
    }

    // Staff who hold every view permission but nothing that changes data must still be refused by a write.
    if (entry.class === "permission" && entry.viewPermissionSuffices !== true && entry.writes.some((table) => table !== "AuditEvent")) {
      for (const inputId of inputIdsFor(entry)) {
        it(`staffViewOnly (every view permission, no change permission) is refused, writes nothing${inputId === entry.inputId ? "" : ` [${inputId}]`}`, async () => {
          await tracked(entry, `staffViewOnly${inputId === entry.inputId ? "" : `:${inputId}`}`, async () => {
            const persona = personas.staffViewOnly;
            const observation = await observe(() => call(entry, persona, inputId));
            expectRefusedWithoutWrites(entry, persona, observation);
            expectDenialAuditOfAWritePermission(entry, persona, observation);
            return outcomeLabel(observation.outcome);
          });
        }, CASE_TIMEOUT_MS);
      }
    }

    // A GET route has no body to empty; its input is the URL, which every persona case already uses.
    const hasBody = !isRoute(entry) || entry.method === "POST";
    if (!entry.noInput && hasBody) {
      it("an empty input from an anonymous caller is refused and writes nothing", async () => {
        await tracked(entry, "anonymous-empty-input", async () => {
          const observation = await observe(() => call(entry, personas.anonymous, entry.inputId, true));
          expectRefusedWithoutWrites(entry, personas.anonymous, observation, true);
          return outcomeLabel(observation.outcome);
        });
      }, CASE_TIMEOUT_MS);

      if (entry.writes.filter((table) => table !== "AuditEvent").length > 0 && entry.emptyInputIsValid !== true) {
        it("an empty input from the Global staff caller is rejected before any write", async () => {
          await tracked(entry, "global-staff-empty-input", async () => {
            const observation = await observe(() => call(entry, personas.staffGlobal, entry.inputId, true));
            const { outcome, before, after } = observation;
            // Validation, a redirect or a mapped refusal: anything but a completed write.
            expect(isRefusal(outcome, refusalOptions(entry, true)) || outcome.kind === "threw", describeOutcome(outcome)).toBe(true);
            expectNoWrites(before, after, { entryTables: entry.writes });
            return outcomeLabel(outcome);
          });
        }, CASE_TIMEOUT_MS);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Positive controls: run last, because a few of them create rows
// ---------------------------------------------------------------------------

describe("positive controls: the person who IS allowed gets through (the entries are live, not dead)", () => {
  for (const entry of ENTRIES.filter((candidate) => candidate.allowedPersona !== undefined)) {
    it(`${keyOf(entry)} lets ${entry.allowedPersona} through`, async () => {
      await tracked(entry, `allowed:${entry.allowedPersona}`, async () => {
        const persona = personas[entry.allowedPersona!];
        const { outcome, denials } = await observe(() => call(entry, persona, entry.inputId));
        expect(
          denials.filter((row) => row.actorId === persona.userId),
          `${persona.name} was denied: ${describeOutcome(outcome)}`,
        ).toEqual([]);
        expect(isDenialError(outcome), describeOutcome(outcome)).toBe(false);
        if (isRoute(entry)) {
          const allowed = entry.allowedStatuses ?? [200, 201, 204, 302];
          expect(outcome.kind === "response" && allowed.includes(outcome.status), describeOutcome(outcome)).toBe(true);
        } else {
          expect(outcome.kind === "returned" || outcome.kind === "redirect", describeOutcome(outcome)).toBe(true);
        }
        return outcomeLabel(outcome);
      });
    }, CASE_TIMEOUT_MS);
  }
});
