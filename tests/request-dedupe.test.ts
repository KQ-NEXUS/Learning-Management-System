/**
 * Request-scoped dedupe of the session and grant reads (plan 15-09, NFR-02,
 * threat T-15-09-01, IAM-03).
 *
 * The staff layout runs about 16 can() checks per render; each one called
 * getCurrentActor() and loadGrantsForUser(). Both are now wrapped with React
 * cache(), which dedupes within ONE server render and never across requests.
 *
 * Static part: both files import cache from "react" and contain no
 * cross-request cache (unstable_cache, "use cache", a module-level Map or a
 * module-level variable holding an actor or grants).
 *
 * Behavioural part: over fake in-memory stores (the Prisma singleton is
 * mocked), revoking a session or a grant is seen on the very next call, and a
 * guarded function is refused on the next call after revocation.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeSession = { expires: Date; revokedAt: Date | null; user: { id: string; status: string; isStaff: boolean } };
type FakeAssignment = {
  userId: string;
  scopeType: string;
  scopeId: string | null;
  active: boolean;
  revokedAt: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
  role: { active: boolean; permissions: string[] };
};

const store = vi.hoisted(() => ({
  sessions: new Map<string, FakeSession>(),
  assignments: [] as FakeAssignment[],
  cookie: undefined as string | undefined,
  sessionReads: 0,
  grantReads: 0,
}));

vi.mock("@/server/db", () => ({
  prisma: {
    session: {
      findUnique: async ({ where }: { where: { sessionToken: string } }) => {
        store.sessionReads += 1;
        return store.sessions.get(where.sessionToken) ?? null;
      },
    },
    assignment: {
      findMany: async ({ where }: { where: { userId: string; role: { active: boolean } } }) => {
        store.grantReads += 1;
        return store.assignments
          .filter((row) => row.userId === where.userId && row.role.active === where.role.active)
          .map((row) => ({ ...row, role: { permissions: row.role.permissions } }));
      },
    },
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "lms.session" && store.cookie ? { name, value: store.cookie } : undefined),
  }),
}));

import { getCurrentActor, SESSION_COOKIE } from "@/server/auth/current-actor";
import { hashToken } from "@/server/auth/token-hash";
import { loadGrantsForUser } from "@/server/services/grant-service";
import { getActorBySessionToken } from "@/server/services/session-service";
import { AuthenticationError, AuthorizationError, createWithPermission } from "@/server/permissions/with-permission";

const ROOT = path.resolve(import.meta.dirname, "..");
const FILES = ["src/server/auth/current-actor.ts", "src/server/services/grant-service.ts"];

/** Source with comment lines and block comments removed. */
function code(file: string): string {
  return readFileSync(path.join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("static: request-scoped only", () => {
  it.each(FILES)("%s imports cache from react", (file) => {
    expect(code(file)).toMatch(/import\s*\{[^}]*\bcache\b[^}]*\}\s*from\s*["']react["']/);
  });

  it("wraps getCurrentActor and loadGrantsForUser with cache()", () => {
    expect(code(FILES[0])).toMatch(/export const getCurrentActor\s*=\s*cache\(/);
    expect(code(FILES[1])).toMatch(/export const loadGrantsForUser\s*=\s*cache\(/);
  });

  it.each(FILES)("%s holds no cross-request cache", (file) => {
    const source = code(file);
    expect(source).not.toContain("unstable_cache");
    expect(source).not.toMatch(/["']use cache["']/);
    expect(source).not.toContain("new Map(");
    expect(source).not.toContain("new WeakMap(");
    // No module-level mutable state at all (an actor or grants held between requests).
    expect(source).not.toMatch(/^(let|var)\s/m);
  });

  it("the session cookie name the fake reads is the real one", () => {
    expect(SESSION_COOKIE).toBe("lms.session");
  });
});

describe("behaviour: revocation is seen on the very next call", () => {
  const RAW = "raw-session-token";
  const withPermission = createWithPermission({
    getActor: getCurrentActor,
    loadGrants: loadGrantsForUser,
    audit: async () => undefined,
  });
  const viewPayments = withPermission<void>("payments.view", () => ({}))(async () => "ok");

  beforeEach(() => {
    store.sessions.clear();
    store.assignments.length = 0;
    store.sessionReads = 0;
    store.grantReads = 0;
    store.cookie = RAW;
    store.sessions.set(hashToken(RAW), {
      expires: new Date(Date.now() + 60 * 60 * 1_000),
      revokedAt: null,
      user: { id: "staff-1", status: "ACTIVE", isStaff: true },
    });
    store.assignments.push({
      userId: "staff-1",
      scopeType: "GLOBAL",
      scopeId: null,
      active: true,
      revokedAt: null,
      startsAt: null,
      endsAt: null,
      role: { active: true, permissions: ["payments.view"] },
    });
  });

  it("a revoked session returns null from the next getActorBySessionToken and getCurrentActor call", async () => {
    await expect(getActorBySessionToken(RAW)).resolves.toEqual({ userId: "staff-1", isStaff: true });
    await expect(getCurrentActor()).resolves.toEqual({ userId: "staff-1", isStaff: true });
    store.sessions.get(hashToken(RAW))!.revokedAt = new Date();
    await expect(getActorBySessionToken(RAW)).resolves.toBeNull();
    await expect(getCurrentActor()).resolves.toBeNull();
    // Every call outside a render read the store: nothing is held between calls.
    expect(store.sessionReads).toBe(4);
  });

  it("an ended grant is gone from the next loadGrantsForUser call", async () => {
    await expect(loadGrantsForUser("staff-1")).resolves.toHaveLength(1);
    store.assignments.length = 0; // the assignment is ended and removed
    await expect(loadGrantsForUser("staff-1")).resolves.toEqual([]);
    store.assignments.push({
      userId: "staff-1",
      scopeType: "GLOBAL",
      scopeId: null,
      active: true,
      revokedAt: null,
      startsAt: null,
      endsAt: null,
      role: { active: false, permissions: ["payments.view"] }, // role deactivated
    });
    await expect(loadGrantsForUser("staff-1")).resolves.toEqual([]);
    expect(store.grantReads).toBe(3);
  });

  it("a guarded call is refused on the next request after the grant or session is revoked", async () => {
    await expect(viewPayments()).resolves.toBe("ok");
    store.assignments[0].revokedAt = new Date();
    await expect(viewPayments()).rejects.toBeInstanceOf(AuthorizationError);

    store.assignments[0].revokedAt = null;
    await expect(viewPayments()).resolves.toBe("ok");
    store.sessions.get(hashToken(RAW))!.revokedAt = new Date();
    await expect(viewPayments()).rejects.toBeInstanceOf(AuthenticationError);
  });
});
