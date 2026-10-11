/**
 * D-16 (U-11) — sign-in never tells anyone whether an address has an account
 * or is still unverified. The service flags `unverified: true` only when the
 * submitted password matches the REAL hash of a PENDING_VERIFICATION account,
 * so the action can queue a fresh verification email after the response;
 * every other failure stays on the decoy path with no flag.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// The module-level singleton binds the real Prisma client; these tests only
// use the factory with a fake store, so no client is ever constructed.
vi.mock("@/server/db", () => ({ prisma: {} }));

import { createAuthService } from "@/server/services/auth-service";
import type { BusinessAuditEvent } from "@/server/services/audit-service";

const PENDING_HASH = "pending-real-hash";
const ACTIVE_HASH = "active-real-hash";
const RIGHT = "right-password";

type FakeUser = {
  id: string;
  email: string;
  passwordHash: string | null;
  status: "ACTIVE" | "PENDING_VERIFICATION" | "DEACTIVATED";
  isStaff: boolean;
};

type StoreOpts = { throttled?: boolean; session?: { id: string; userId: string } | null; revoked?: number };

function fakeStore(user: FakeUser | null, opts: StoreOpts = {}) {
  const executeRaw = vi.fn(async () => 1);
  const sessionCreate = vi.fn(async () => ({}));
  const tx = {
    $queryRaw: vi.fn(async () => []),
    user: { findUnique: vi.fn(async () => user) },
    session: { create: sessionCreate },
  };
  const store = {
    user: { findUnique: vi.fn(async () => user) },
    session: {
      create: sessionCreate,
      findUnique: vi.fn(async () => opts.session ?? null),
      updateMany: vi.fn(async () => ({ count: opts.revoked ?? 0 })),
    },
    loginThrottle: {
      findMany: vi.fn(async (args: { where: { key: { in: string[] } } }) =>
        opts.throttled
          ? args.where.key.in.map((key) => ({ key, failures: 10_000, windowStartedAt: new Date() }))
          : [],
      ),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    $executeRaw: executeRaw,
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { store, executeRaw, sessionCreate };
}

function pending(passwordHash: string | null = PENDING_HASH): FakeUser {
  return { id: "u-pending", email: "pending@example.com", passwordHash, status: "PENDING_VERIFICATION", isStaff: false };
}

function active(): FakeUser {
  return { id: "u-active", email: "active@example.com", passwordHash: ACTIVE_HASH, status: "ACTIVE", isStaff: false };
}

/** Matches only the right password against a real (non-decoy) hash. */
function fakeVerify() {
  return vi.fn(async (password: string, hash: string) =>
    password === RIGHT && (hash === PENDING_HASH || hash === ACTIVE_HASH),
  );
}

function service(user: FakeUser | null, opts: StoreOpts = {}) {
  const fake = fakeStore(user, opts);
  const verify = fakeVerify();
  const audit = vi.fn<(event: BusinessAuditEvent) => Promise<void>>(async () => {});
  const auth = createAuthService({
    store: fake.store as never,
    verify,
    audit,
    correlationId: async () => "corr-test",
  });
  return { auth, verify, audit, ...fake };
}

const ctx = { ip: "203.0.113.9" };

beforeEach(() => vi.clearAllMocks());

describe("signIn — D-16 unverified branch", () => {
  it("(a) a pending account with the right password returns INVALID with unverified true", async () => {
    const { auth } = service(pending());
    expect(await auth.signIn("pending@example.com", RIGHT, ctx)).toEqual({ ok: false, reason: "INVALID", unverified: true });
  });

  it("(b) a pending account with a wrong password returns INVALID and no flag", async () => {
    const { auth } = service(pending());
    const result = await auth.signIn("pending@example.com", "wrong", ctx);
    expect(result).toEqual({ ok: false, reason: "INVALID" });
    expect(result).not.toHaveProperty("unverified");
  });

  it("(c) an unknown address and an active account with a wrong password return no flag", async () => {
    const unknown = service(null);
    expect(await unknown.auth.signIn("nobody@example.com", RIGHT, ctx)).toEqual({ ok: false, reason: "INVALID" });
    const wrong = service(active());
    expect(await wrong.auth.signIn("active@example.com", "wrong", ctx)).toEqual({ ok: false, reason: "INVALID" });
  });

  it("(c) a pending account with no password (contested registration) stays on the decoy path and never flags", async () => {
    const { auth, verify } = service(pending(null));
    expect(await auth.signIn("pending@example.com", RIGHT, ctx)).toEqual({ ok: false, reason: "INVALID" });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify.mock.calls[0][1]).not.toBe(PENDING_HASH);
  });

  it("(c) a deactivated account with the right password stays on the decoy path and never flags", async () => {
    const { auth, verify } = service({ ...active(), status: "DEACTIVATED" });
    expect(await auth.signIn("active@example.com", RIGHT, ctx)).toEqual({ ok: false, reason: "INVALID" });
    expect(verify.mock.calls[0][1]).not.toBe(ACTIVE_HASH);
  });

  it("(d) the pending path verifies once against the real hash and never the decoy", async () => {
    const { auth, verify } = service(pending());
    await auth.signIn("pending@example.com", "wrong", ctx);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith("wrong", PENDING_HASH);
  });

  it("(d) the unknown path verifies once against the decoy", async () => {
    const { auth, verify } = service(null);
    await auth.signIn("nobody@example.com", "wrong", ctx);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify.mock.calls[0][1]).not.toBe(PENDING_HASH);
    expect(verify.mock.calls[0][1]).not.toBe(ACTIVE_HASH);
  });

  it("(e) a throttle failure is recorded on every failure path, including a pending right-password match", async () => {
    for (const [user, email, password] of [
      [pending(), "pending@example.com", RIGHT],
      [pending(), "pending@example.com", "wrong"],
      [null, "nobody@example.com", RIGHT],
      [active(), "active@example.com", "wrong"],
      [pending(null), "pending@example.com", RIGHT],
    ] as const) {
      const { auth, executeRaw, sessionCreate } = service(user);
      await auth.signIn(email, password, ctx);
      expect(executeRaw).toHaveBeenCalled();
      expect(sessionCreate).not.toHaveBeenCalled();
    }
  });

  it("an active account with the right password still signs in", async () => {
    const { auth, sessionCreate } = service(active());
    const result = await auth.signIn("active@example.com", RIGHT, ctx);
    expect(result.ok).toBe(true);
    expect(sessionCreate).toHaveBeenCalledTimes(1);
  });
});

describe("signIn / signOut — NFR-07 audit rows", () => {
  function only(audit: ReturnType<typeof service>["audit"]): BusinessAuditEvent {
    expect(audit).toHaveBeenCalledTimes(1);
    return audit.mock.calls[0][0];
  }

  it("a successful sign-in writes auth.sign_in.succeeded for the user", async () => {
    const { auth, audit } = service(active());
    await auth.signIn("active@example.com", RIGHT, ctx);
    expect(only(audit)).toMatchObject({
      actorId: "u-active",
      action: "auth.sign_in.succeeded",
      targetType: "User",
      targetId: "u-active",
      outcome: "SUCCESS",
      ipAddress: ctx.ip,
      correlationId: "corr-test",
    });
  });

  it("a wrong password on an existing account writes auth.sign_in.failed targeting that user", async () => {
    const { auth, audit } = service(active());
    await auth.signIn("active@example.com", "wrong", ctx);
    expect(only(audit)).toMatchObject({
      actorId: null,
      actorType: "SYSTEM",
      action: "auth.sign_in.failed",
      targetType: "User",
      targetId: "u-active",
      outcome: "DENIED",
      ipAddress: ctx.ip,
      correlationId: "corr-test",
    });
  });

  it("an unknown address writes auth.sign_in.failed with no target", async () => {
    const { auth, audit } = service(null);
    await auth.signIn("nobody@example.com", "wrong", ctx);
    expect(only(audit)).toMatchObject({
      actorId: null,
      actorType: "SYSTEM",
      action: "auth.sign_in.failed",
      targetType: "User",
      targetId: null,
      outcome: "DENIED",
      ipAddress: ctx.ip,
      correlationId: "corr-test",
    });
  });

  it("pending (right and wrong password), no-password and deactivated accounts each write one auth.sign_in.failed", async () => {
    for (const [user, password] of [
      [pending(), RIGHT],
      [pending(), "wrong"],
      [pending(null), RIGHT],
      [{ ...active(), status: "DEACTIVATED" } as FakeUser, RIGHT],
    ] as const) {
      const { auth, audit } = service(user);
      await auth.signIn(user.email, password, ctx);
      expect(only(audit)).toMatchObject({ action: "auth.sign_in.failed", targetId: user.id, outcome: "DENIED" });
    }
  });

  it("a throttled attempt writes auth.sign_in.throttled with no target and checks nothing else", async () => {
    const { auth, audit, verify } = service(active(), { throttled: true });
    expect(await auth.signIn("active@example.com", RIGHT, ctx)).toEqual({ ok: false, reason: "THROTTLED" });
    const event = only(audit);
    expect(event).toMatchObject({
      actorId: null,
      actorType: "SYSTEM",
      action: "auth.sign_in.throttled",
      outcome: "DENIED",
      ipAddress: ctx.ip,
      correlationId: "corr-test",
    });
    expect(event.targetId ?? null).toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });

  it("sign-out writes auth.sign_out for the session's user", async () => {
    const { auth, audit } = service(null, { session: { id: "s-1", userId: "u-active" }, revoked: 1 });
    await auth.signOut("raw-session-token", ctx);
    expect(only(audit)).toMatchObject({
      actorId: "u-active",
      action: "auth.sign_out",
      targetType: "User",
      targetId: "u-active",
      outcome: "SUCCESS",
      ipAddress: ctx.ip,
      correlationId: "corr-test",
    });
  });

  it("sign-out of an unknown or already revoked session writes nothing", async () => {
    const unknown = service(null, { session: null, revoked: 0 });
    await unknown.auth.signOut("raw-session-token", ctx);
    expect(unknown.audit).not.toHaveBeenCalled();
    const revoked = service(null, { session: { id: "s-1", userId: "u-active" }, revoked: 0 });
    await revoked.auth.signOut("raw-session-token", ctx);
    expect(revoked.audit).not.toHaveBeenCalled();
  });

  it("no audit row ever carries the password, and the typed email never appears in reason, before or after", async () => {
    const PASSWORD = "Sup3r-secret-typed-password";
    const cases: Array<[FakeUser | null, string, string, StoreOpts]> = [
      [active(), "Active@Example.com", PASSWORD, {}],
      [active(), "active@example.com", RIGHT, {}],
      [null, "typed.unknown@example.com", PASSWORD, {}],
      [pending(), "pending@example.com", PASSWORD, {}],
      [pending(), "pending@example.com", RIGHT, {}],
      [active(), "active@example.com", PASSWORD, { throttled: true }],
    ];
    for (const [user, email, password, opts] of cases) {
      const { auth, audit } = service(user, opts);
      await auth.signIn(email, password, ctx);
      const event = only(audit);
      expect(JSON.stringify(event)).not.toContain(password);
      for (const field of [event.reason, event.before, event.after]) {
        const text = JSON.stringify(field ?? null).toLowerCase();
        expect(text).not.toContain(email.toLowerCase());
        expect(text).not.toContain(password.toLowerCase());
      }
      // The address is never written anywhere in the row, in any case.
      expect(JSON.stringify(event).toLowerCase()).not.toContain(email.toLowerCase());
    }
  });

  it("an audit-write failure never changes the sign-in result", async () => {
    const fake = fakeStore(active());
    const auth = createAuthService({
      store: fake.store as never,
      verify: fakeVerify(),
      audit: async () => { throw new Error("audit down"); },
      correlationId: async () => "corr-test",
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await auth.signIn("active@example.com", RIGHT, ctx)).ok).toBe(true);
    expect(await auth.signIn("active@example.com", "wrong", ctx)).toEqual({ ok: false, reason: "INVALID" });
    for (const call of error.mock.calls) expect(JSON.stringify(call)).not.toContain("active@example.com");
    error.mockRestore();
  });
});
