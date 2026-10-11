/**
 * Harness for the authorization bypass matrix (Phase 15, plans 15-25 and 15-26;
 * NFR-05, D-09).
 *
 * Every server action is a public POST endpoint (Next.js server-actions guide:
 * an action "is reachable to anyone who can send the same POST"), and the
 * framework's action-id check is not authorization. Calling the exported action
 * function directly is the same code path the POST runs after that check, so
 * this harness drives the real authorization wiring against a real Postgres:
 *
 *   - `startMatrixDatabase()` starts ONE disposable Testcontainers Postgres
 *     (`tests/support/pg.ts`), applies the checked-in migrations, and sets
 *     `process.env.DATABASE_URL` to it. It must run before any application module
 *     is imported, because `@/server/db` builds its singleton Prisma client from
 *     that variable on first evaluation. Nothing here reads `.env` or reaches a
 *     shared database.
 *   - `seedPersonas()` creates the people the matrix calls as, each with a real
 *     `Session` row, so `getCurrentActor()` resolves them exactly as production.
 *   - `asPersona()` points the mocked `next/headers` cookie jar at one persona's
 *     raw session token (or at nobody).
 *   - `invokeAction()` / `invokeRoute()` call the real export and normalise what
 *     came back (a returned refusal, a thrown error, a redirect, an HTTP status).
 *   - `snapshotWrites()` / `expectNoWrites()` compare row counts and the newest
 *     `updatedAt` of every table before and after a denied call.
 *
 * The three `next/*` mocks are exported as factories so each test file can wire
 * them with `vi.mock("next/headers", async () => (await import("./support/authz-matrix")).nextHeadersMock())`.
 * The persona state lives on `globalThis` so it survives a module re-evaluation.
 *
 * PREREQUISITE: Docker must be running. If it is not, `startMatrixDatabase()`
 * rejects with a container-start error and every case reports BLOCKED, which is
 * the expected failure mode and not a bug in the code under test.
 *
 * ESLint boundary note: this file lives under `tests/`, outside the `src/**`
 * glob that confines `@prisma/client`, so importing it here is intentional.
 */

import { randomBytes } from "node:crypto";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { hashToken } from "@/server/auth/token-hash";
import { isGlobalOnly, PERMISSIONS } from "@/server/permissions/catalogue";
import { startTestDatabase, type TestDatabase } from "./pg";

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

export type PersonaName =
  | "anonymous"
  | "learnerOther"
  | "learnerOwner"
  | "staffNone"
  | "staffViewOnly"
  | "staffCohortA"
  | "staffCohortB"
  | "staffGlobal";

export type Persona = {
  name: PersonaName;
  /** Null only for the anonymous visitor. */
  userId: string | null;
  /** The raw cookie value; null for the anonymous visitor. */
  token: string | null;
};

export type Personas = Record<PersonaName, Persona>;

type MatrixState = {
  token: string | null;
  headers: Record<string, string>;
  redirects: string[];
  cookieWrites: Array<{ name: string; value: string | null }>;
};

const STATE_KEY = "__authzMatrixState" as const;

function state(): MatrixState {
  const holder = globalThis as unknown as Record<string, MatrixState | undefined>;
  holder[STATE_KEY] ??= { token: null, headers: {}, redirects: [], cookieWrites: [] };
  return holder[STATE_KEY];
}

/** Points the mocked cookie jar at one persona (or at nobody). */
export function asPersona(persona: Persona): void {
  const current = state();
  current.token = persona.token;
  current.cookieWrites = [];
}

/** Request headers the mocked `headers()` reports (for example a client address). */
export function setRequestHeaders(headers: Record<string, string>): void {
  state().headers = { ...headers };
}

export function cookieWritesSinceLastPersona(): ReadonlyArray<{ name: string; value: string | null }> {
  return state().cookieWrites;
}

// ---------------------------------------------------------------------------
// next/* mock factories
// ---------------------------------------------------------------------------

const SESSION_COOKIE_NAME = "lms.session";

export function nextHeadersMock() {
  const cookieStore = () => ({
    get(name: string) {
      const current = state();
      if (name === SESSION_COOKIE_NAME && current.token) return { name, value: current.token };
      return undefined;
    },
    has(name: string) {
      return name === SESSION_COOKIE_NAME && state().token !== null;
    },
    getAll() {
      const current = state();
      return current.token ? [{ name: SESSION_COOKIE_NAME, value: current.token }] : [];
    },
    set(name: string, value?: string) {
      state().cookieWrites.push({ name, value: value ?? null });
    },
    delete(name: string) {
      state().cookieWrites.push({ name, value: null });
    },
  });
  return {
    cookies: async () => cookieStore(),
    headers: async () => new Headers(state().headers),
    draftMode: async () => ({ isEnabled: false, enable() {}, disable() {} }),
  };
}

export function nextCacheMock() {
  const noop = () => {};
  return {
    revalidatePath: noop,
    revalidateTag: noop,
    updateTag: noop,
    refresh: noop,
    cacheLife: noop,
    cacheTag: noop,
    unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  };
}

export class MatrixRedirect extends Error {
  readonly digest: string;
  constructor(readonly location: string) {
    super("NEXT_REDIRECT");
    this.digest = `NEXT_REDIRECT;replace;${location};307;`;
  }
}

export class MatrixNotFound extends Error {
  readonly digest = "NEXT_HTTP_ERROR_FALLBACK;404";
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}

export function nextNavigationMock() {
  return {
    redirect(location: string): never {
      state().redirects.push(location);
      throw new MatrixRedirect(location);
    },
    permanentRedirect(location: string): never {
      state().redirects.push(location);
      throw new MatrixRedirect(location);
    },
    notFound(): never {
      throw new MatrixNotFound();
    },
    unstable_rethrow(error: unknown): void {
      if (error instanceof MatrixRedirect || error instanceof MatrixNotFound) throw error;
    },
    RedirectType: { push: "push", replace: "replace" },
  };
}

// ---------------------------------------------------------------------------
// Database and personas
// ---------------------------------------------------------------------------

let activeDatabase: TestDatabase | null = null;

export function matrixPrisma(): PrismaClient {
  if (!activeDatabase) throw new Error("startMatrixDatabase() has not been called.");
  return activeDatabase.prisma;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * The matrix writes (the allowed halves create orders, enrolments and so on) and
 * must never run against a shared database. A Testcontainers URL is always a
 * local port; anything else is refused before the application can connect.
 */
export function assertLocalDatabase(url: string): void {
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to run the authorization matrix against a non-local database host (${host}).`);
  }
}

/**
 * Starts the disposable database and prepares the environment the application
 * modules read at import time. Call it first in `beforeAll`, before importing
 * anything from `@/server`.
 */
export async function startMatrixDatabase(): Promise<TestDatabase> {
  const database = await startTestDatabase();
  activeDatabase = database;
  assertLocalDatabase(database.url);
  process.env.DATABASE_URL = database.url;

  // Object storage is only SIGNED against, never reached, by a denied call. These
  // placeholders just let `storage-service` construct its clients at import time.
  process.env.S3_BUCKET ??= "lms-private";
  process.env.S3_ENDPOINT ??= "http://127.0.0.1:9";
  process.env.S3_PUBLIC_ENDPOINT ??= process.env.S3_ENDPOINT;
  process.env.S3_ACCESS_KEY_ID ??= "matrix-access-key";
  process.env.S3_SECRET_ACCESS_KEY ??= "matrix-secret-key";
  process.env.S3_FORCE_PATH_STYLE ??= "true";
  process.env.S3_REGION ??= "us-east-1";

  // Webhook secrets so a bad signature is judged on the signature, not on a
  // missing configuration (which answers 500).
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_authz_matrix_secret";
  process.env.PAYSTACK_SECRET_KEY = "sk_test_authz_matrix_secret";
  return database;
}

export async function stopMatrixDatabase(): Promise<void> {
  const database = activeDatabase;
  activeDatabase = null;
  await database?.stop();
}

/** Permissions a cohort-scoped grant may carry (the global-only ones cannot be scoped). */
export const SCOPED_PERMISSIONS: readonly string[] = PERMISSIONS.filter((permission) => !isGlobalOnly(permission));

export type PersonaSeedInput = {
  cohortAId: string;
  cohortBId: string;
};

async function createPersonaUser(
  prisma: PrismaClient,
  name: PersonaName,
  isStaff: boolean,
): Promise<Persona> {
  const user = await prisma.user.create({
    data: {
      email: `${name.toLowerCase()}@authz-matrix.test`,
      name: `Matrix ${name}`,
      status: "ACTIVE",
      emailVerified: new Date(),
      isStaff,
    },
    select: { id: true },
  });
  const token = randomBytes(24).toString("hex");
  await prisma.session.create({
    data: {
      sessionToken: hashToken(token),
      userId: user.id,
      expires: new Date(Date.now() + 7 * 86_400_000),
    },
  });
  return { name, userId: user.id, token };
}

/**
 * The people the matrix calls as:
 *   anonymous      - no session at all
 *   learnerOther   - a signed-in learner who owns nothing in the target
 *   learnerOwner   - the learner who owns the target records
 *   staffNone      - staff with no role assigned
 *   staffViewOnly  - every "*.view" permission at Global scope and nothing that changes data
 *   staffCohortA   - every cohort-scopable permission, scoped to cohort A
 *   staffCohortB   - the same, scoped to cohort B
 *   staffGlobal    - every permission at Global scope
 */
export async function seedPersonas(prisma: PrismaClient, input: PersonaSeedInput): Promise<Personas> {
  const anonymous: Persona = { name: "anonymous", userId: null, token: null };
  const learnerOther = await createPersonaUser(prisma, "learnerOther", false);
  const learnerOwner = await createPersonaUser(prisma, "learnerOwner", false);
  const staffNone = await createPersonaUser(prisma, "staffNone", true);
  const staffViewOnly = await createPersonaUser(prisma, "staffViewOnly", true);
  const staffCohortA = await createPersonaUser(prisma, "staffCohortA", true);
  const staffCohortB = await createPersonaUser(prisma, "staffCohortB", true);
  const staffGlobal = await createPersonaUser(prisma, "staffGlobal", true);

  const scopedRole = await prisma.role.create({
    data: { name: "Matrix cohort-scoped staff", permissions: [...SCOPED_PERMISSIONS] },
    select: { id: true },
  });
  const viewOnlyRole = await prisma.role.create({
    data: { name: "Matrix view-only staff", permissions: PERMISSIONS.filter((permission) => permission.endsWith(".view")) },
    select: { id: true },
  });
  const globalRole = await prisma.role.create({
    data: { name: "Matrix global staff", permissions: [...PERMISSIONS] },
    select: { id: true },
  });

  await prisma.assignment.createMany({
    data: [
      { userId: staffViewOnly.userId!, roleId: viewOnlyRole.id, scopeType: "GLOBAL", scopeId: null },
      { userId: staffCohortA.userId!, roleId: scopedRole.id, scopeType: "COHORT", scopeId: input.cohortAId },
      { userId: staffCohortB.userId!, roleId: scopedRole.id, scopeType: "COHORT", scopeId: input.cohortBId },
      { userId: staffGlobal.userId!, roleId: globalRole.id, scopeType: "GLOBAL", scopeId: null },
    ],
  });

  return { anonymous, learnerOther, learnerOwner, staffNone, staffViewOnly, staffCohortA, staffCohortB, staffGlobal };
}

// ---------------------------------------------------------------------------
// Invoking an export and normalising what came back
// ---------------------------------------------------------------------------

export type Outcome =
  | { kind: "returned"; value: unknown }
  | { kind: "threw"; name: string; message: string }
  | { kind: "redirect"; location: string }
  | { kind: "notFound" }
  | { kind: "response"; status: number; body: string; headers: Record<string, string> };

export function describeOutcome(outcome: Outcome): string {
  switch (outcome.kind) {
    case "returned":
      return `returned ${JSON.stringify(outcome.value, (_key, value) => (typeof value === "bigint" ? `${value}n` : value))}`;
    case "threw":
      return `threw ${outcome.name}: ${outcome.message}`;
    case "redirect":
      return `redirected to ${outcome.location}`;
    case "notFound":
      return "called notFound()";
    case "response":
      return `HTTP ${outcome.status}${outcome.body ? ` body=${outcome.body.slice(0, 120)}` : " (empty body)"}`;
  }
}

function classifyThrown(error: unknown): Outcome {
  if (error instanceof MatrixRedirect) return { kind: "redirect", location: error.location };
  if (error instanceof MatrixNotFound) return { kind: "notFound" };
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
    return { kind: "redirect", location: digest.split(";")[2] ?? "" };
  }
  if (error instanceof Error) return { kind: "threw", name: error.name, message: error.message };
  return { kind: "threw", name: "NonError", message: String(error) };
}

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

function absoluteSource(file: string): string {
  return path.resolve(REPO_ROOT, file);
}

export type ActionTarget = { file: string; exportName: string };
export type RouteTarget = { file: string; method: string };

/** Calls the exported action function with the persona's session in place. */
export async function invokeAction(
  target: ActionTarget,
  persona: Persona,
  args: readonly unknown[],
): Promise<Outcome> {
  asPersona(persona);
  const mod = (await import(/* @vite-ignore */ absoluteSource(target.file))) as Record<string, unknown>;
  const fn = mod[target.exportName];
  if (typeof fn !== "function") {
    throw new Error(`${target.file} does not export a function named ${target.exportName}.`);
  }
  try {
    const value = await (fn as (...a: unknown[]) => unknown)(...args);
    return { kind: "returned", value };
  } catch (error) {
    return classifyThrown(error);
  }
}

export type RouteRequest = {
  url: string;
  headers?: Record<string, string>;
  body?: string;
  params?: Record<string, string>;
};

/** Calls a route handler verb with the persona's session in place. */
export async function invokeRoute(
  target: RouteTarget,
  persona: Persona,
  request: RouteRequest,
): Promise<Outcome> {
  asPersona(persona);
  const mod = (await import(/* @vite-ignore */ absoluteSource(target.file))) as Record<string, unknown>;
  const handler = mod[target.method];
  if (typeof handler !== "function") {
    throw new Error(`${target.file} does not export a ${target.method} handler.`);
  }
  const init: RequestInit = { method: target.method, headers: request.headers };
  if (request.body !== undefined && target.method !== "GET" && target.method !== "HEAD") {
    init.body = request.body;
  }
  const req = new Request(request.url, init);
  try {
    const response = (await (handler as (...a: unknown[]) => unknown)(req, {
      params: Promise.resolve(request.params ?? {}),
    })) as Response;
    const body = target.method === "HEAD" ? "" : await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return { kind: "response", status: response.status, body, headers };
  } catch (error) {
    return classifyThrown(error);
  }
}

// ---------------------------------------------------------------------------
// What counts as a refusal
// ---------------------------------------------------------------------------

/** Error names that are an intentional denial when thrown. */
const DENIAL_ERROR_NAMES = new Set(["AuthenticationError", "AuthorizationError", "LicenceRestrictedError"]);

export function isDenialError(outcome: Outcome): boolean {
  return outcome.kind === "threw" && DENIAL_ERROR_NAMES.has(outcome.name);
}

/**
 * Whether a returned value is a refusal. Actions return many shapes (`{ ok: false }`,
 * `{ errors: [...] }`, `{ error: "..." }`, `{ completed: false }`, a neutral
 * `{ unavailable: true }`, an empty list or null for a read). Anything else, and in
 * particular `undefined` from a void action, means the call went through.
 */
export function isRefusalValue(value: unknown, options: { nullMeansRefused?: boolean } = {}): boolean {
  if (value === null) return options.nullMeansRefused === true;
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.ok === false) return true;
  if (record.unavailable === true) return true;
  if (record.completed === false) return true;
  if (record.success === false) return true;
  if (typeof record.error === "string" && record.error.length > 0) return true;
  if (Array.isArray(record.errors) && record.errors.length > 0) return true;
  return false;
}

export function isRefusal(outcome: Outcome, options: { nullMeansRefused?: boolean; deniedStatuses?: readonly number[] } = {}): boolean {
  switch (outcome.kind) {
    case "returned":
      return isRefusalValue(outcome.value, options);
    case "threw":
      return isDenialError(outcome);
    case "redirect":
    case "notFound":
      return true;
    case "response":
      return (options.deniedStatuses ?? [401, 403, 404]).includes(outcome.status);
  }
}

// ---------------------------------------------------------------------------
// Write snapshots
// ---------------------------------------------------------------------------

/**
 * `hash` is a digest of every row's full text. Most tables carry no `updatedAt`
 * column (grades, attempts, submissions, certificates, notifications, sessions),
 * so an in-place update there changes neither the count nor the newest
 * `updatedAt`; the digest is what catches it.
 */
export type TableState = { count: number; latest: string | null; hash: string };
export type WriteSnapshot = ReadonlyMap<string, TableState>;

let tableCatalogue: Array<{ table: string; hasUpdatedAt: boolean }> | null = null;

async function loadTableCatalogue(prisma: PrismaClient) {
  if (tableCatalogue) return tableCatalogue;
  const rows = await prisma.$queryRaw<Array<{ table_name: string; has_updated: boolean }>>`
    SELECT t.table_name,
           EXISTS (
             SELECT 1 FROM information_schema.columns c
             WHERE c.table_schema = 'public' AND c.table_name = t.table_name AND c.column_name = 'updatedAt'
           ) AS has_updated
    FROM information_schema.tables t
    WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND t.table_name <> '_prisma_migrations'
    ORDER BY t.table_name`;
  tableCatalogue = rows.map((row) => ({ table: row.table_name, hasUpdatedAt: row.has_updated }));
  return tableCatalogue;
}

/** Row count, newest `updatedAt` and a digest of every row, for every table (or the named ones). */
export async function snapshotWrites(tables?: readonly string[]): Promise<WriteSnapshot> {
  const prisma = matrixPrisma();
  const catalogue = await loadTableCatalogue(prisma);
  const wanted = tables ? catalogue.filter((entry) => tables.includes(entry.table)) : catalogue;
  if (tables) {
    const unknown = tables.filter((name) => !catalogue.some((entry) => entry.table === name));
    if (unknown.length > 0) throw new Error(`Unknown table(s) in snapshotWrites: ${unknown.join(", ")}`);
  }
  const sql = wanted
    .map(
      (entry) =>
        `SELECT '${entry.table}' AS "t", count(*)::int AS "c", ${
          entry.hasUpdatedAt ? `max("updatedAt")::text` : "NULL::text"
        } AS "l", coalesce(md5(string_agg(md5(r::text), '' ORDER BY md5(r::text))), '') AS "h" FROM "${entry.table}" r`,
    )
    .join("\nUNION ALL\n");
  const rows = await prisma.$queryRawUnsafe<Array<{ t: string; c: number; l: string | null; h: string }>>(sql);
  return new Map(rows.map((row) => [row.t, { count: row.c, latest: row.l, hash: row.h }]));
}

/** Tables a denied call is allowed to touch: only the audit trail records the refusal. */
export const DENIAL_MAY_WRITE: readonly string[] = ["AuditEvent"];

/** Tables whose rows change as a side effect of simply being signed in or checked. */
export type NoWriteOptions = {
  /** The tables the registry says the entry's service writes; reported first on failure. */
  entryTables?: readonly string[];
  /** Extra tables to leave out of the comparison. */
  ignore?: readonly string[];
};

export function changedTables(before: WriteSnapshot, after: WriteSnapshot, ignore: readonly string[] = []): string[] {
  const changed: string[] = [];
  for (const [table, prior] of before) {
    if (ignore.includes(table)) continue;
    const next = after.get(table);
    if (!next || next.count !== prior.count || next.latest !== prior.latest || next.hash !== prior.hash) changed.push(table);
  }
  return changed.sort();
}

/**
 * Throws when any table other than the audit trail changed between two snapshots.
 * A denial writes nothing the caller could have asked for.
 */
export function expectNoWrites(before: WriteSnapshot, after: WriteSnapshot, options: NoWriteOptions = {}): void {
  const changed = changedTables(before, after, [...DENIAL_MAY_WRITE, ...(options.ignore ?? [])]);
  if (changed.length === 0) return;
  const listed = (options.entryTables ?? []).filter((table) => changed.includes(table));
  const detail = changed
    .map((table) => `${table} ${JSON.stringify(before.get(table))} -> ${JSON.stringify(after.get(table))}`)
    .join("; ");
  throw new Error(
    `A denied call wrote to the database: ${detail}${
      listed.length > 0 ? ` (registered write tables hit: ${listed.join(", ")})` : " (none of these were in the entry's registered writes)"
    }`,
  );
}

/** True when at least one of the named tables changed. */
export function didWrite(before: WriteSnapshot, after: WriteSnapshot, tables: readonly string[]): boolean {
  return tables.some((table) => changedTables(before, after).includes(table));
}

// ---------------------------------------------------------------------------
// Denial audit rows
// ---------------------------------------------------------------------------

export async function countDenials(): Promise<number> {
  return matrixPrisma().auditEvent.count({ where: { action: "authorization.denied" } });
}

export type DenialRow = { actorId: string | null; targetId: string | null; outcome: string };

/** The denial rows written since `before` (a `countDenials()` taken first), newest first. */
export async function denialsSince(before: number): Promise<DenialRow[]> {
  const total = await countDenials();
  const added = total - before;
  if (added <= 0) return [];
  return matrixPrisma().auditEvent.findMany({
    where: { action: "authorization.denied" },
    orderBy: { createdAt: "desc" },
    take: added,
    select: { actorId: true, targetId: true, outcome: true },
  });
}
