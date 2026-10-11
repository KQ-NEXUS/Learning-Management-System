import { randomUUID } from "node:crypto";
import { hashToken } from "@/server/auth/token-hash";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { createAuthService } from "@/server/services/auth-service";
import { createVerificationService, type VerificationStore } from "@/server/services/verification-service";
import { createPasswordResetService, type PasswordResetStore } from "@/server/services/password-reset-service";
import { createProfileService, type ProfileStore } from "@/server/services/profile-service";
import { TOKEN_PURPOSE } from "@/lib/identity";
import { hashPassword } from "@/server/auth/password";
import { signInAction } from "@/app/(auth)/signin/actions";

// D-16 — the sign-in action runs its module singletons (auth and verification
// services) against `@/server/db`. Point that module at this file's
// Testcontainers database, lazily, so the shared `.env` database is never
// touched.
const dbHolder = vi.hoisted(() => ({ prisma: null as unknown as object }));
vi.mock("@/server/db", () => ({
  prisma: new Proxy({}, {
    get(_target, key) {
      const client = dbHolder.prisma as Record<PropertyKey, unknown>;
      const value = Reflect.get(client, key);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(client) : value;
    },
  }),
}));

// The action reads the trusted client-IP header and the cookie jar.
const request = vi.hoisted(() => ({ ip: "198.51.100.1" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-nf-client-connection-ip": request.ip }),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error("redirect:" + url); },
}));

// `after()` is recorded, not run, so a test can prove the email is queued
// only once the action has already returned its state.
const afterQueue = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (callback: () => unknown) => { afterQueue.push(callback); },
}));

// Real Postgres plus real scrypt (N=131072) per sign-in: on a loaded machine
// several cases exceed Vitest's 5 s default without anything being wrong.
vi.setConfig({ testTimeout: 60_000 });

let db: TestDatabase;
beforeAll(async () => {
  db = await startTestDatabase();
  dbHolder.prisma = db.prisma;
}, TEST_DB_TIMEOUT_MS);
afterAll(async () => {
  vi.unstubAllEnvs();
  await db?.stop();
}, TEST_DB_TIMEOUT_MS);

function verification() {
  return createVerificationService({
    store: db.prisma as unknown as VerificationStore,
    dispatch: async () => {},
    audit: async () => {},
  });
}

function resetService(signOutAll?: Parameters<typeof createPasswordResetService>[0]["signOutAll"]) {
  const v = verification();
  return createPasswordResetService({
    store: db.prisma as unknown as PasswordResetStore,
    issueToken: v.issueToken,
    consumeToken: v.consumeToken,
    dispatch: async () => {},
    audit: async () => {},
    hash: async () => "new-hash",
    ...(signOutAll ? { signOutAll } : {}),
  });
}

async function user() {
  return db.prisma.user.create({
    data: { email: randomUUID() + "@example.com", name: "Security fixture", status: "ACTIVE", passwordHash: "old-hash" },
  });
}

async function resetToken(email: string) {
  const issued = await verification().issueToken({ identifier: email, purpose: TOKEN_PURPOSE.PASSWORD_RESET, ttlMs: 60000 });
  if (!issued.ok) throw new Error("fixture cooldown");
  return issued.token;
}

describe("identity security — real Postgres", () => {
  it("F-14a: a new session and a new reset token are stored only as SHA-256 hashes", async () => {
    const { createHash } = await import("node:crypto");
    const sha = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
    const account = await user();
    const auth = createAuthService({ store: db.prisma, verify: async () => true });
    const signedIn = await auth.signIn(account.email, "right");
    if (!signedIn.ok) throw new Error("expected sign-in");
    const session = await db.prisma.session.findFirstOrThrow({ where: { userId: account.id } });
    expect(session.sessionToken).toBe(sha(signedIn.token));
    expect(session.sessionToken).not.toBe(signedIn.token);
    // NFR-07 — the success is audited through the real sink.
    expect(await db.prisma.auditEvent.count({
      where: { action: "auth.sign_in.succeeded", actorId: account.id, targetId: account.id, outcome: "SUCCESS" },
    })).toBe(1);

    const raw = await resetToken(account.email);
    const row = await db.prisma.verificationToken.findFirstOrThrow({ where: { identifier: account.email } });
    expect(row.token).toBe(sha(raw));
  });

  it("F-14b: five failures for one address from one device throttle that device only — the owner elsewhere still signs in", async () => {
    const account = await user();
    const auth = createAuthService({ store: db.prisma, verify: async (password) => password === "right" });
    const attacker = { ip: "203.0.113.50" };
    const owner = { ip: "198.51.100.20" };
    await Promise.all(Array.from({ length: 5 }, () => auth.signIn(account.email, "wrong", attacker)));
    expect(await auth.signIn(account.email, "right", attacker)).toEqual({ ok: false, reason: "THROTTLED" });
    const fromOwner = await auth.signIn(account.email, "right", owner);
    expect(fromOwner.ok).toBe(true);
  });

  it("F-14b: an unknown address is throttled exactly like a real one (no account-existence oracle)", async () => {
    const auth = createAuthService({ store: db.prisma, verify: async () => false });
    const ctx = { ip: "203.0.113.51" };
    const unknown = `${randomUUID()}@example.com`;
    for (let i = 0; i < 5; i++) expect(await auth.signIn(unknown, "wrong", ctx)).toEqual({ ok: false, reason: "INVALID" });
    expect(await auth.signIn(unknown, "wrong", ctx)).toEqual({ ok: false, reason: "THROTTLED" });
  });

  it("F-14b: one device spraying 20 addresses is throttled for every address", async () => {
    const auth = createAuthService({ store: db.prisma, verify: async () => false });
    const ctx = { ip: "203.0.113.52" };
    for (let i = 0; i < 20; i++) await auth.signIn(`${randomUUID()}@example.com`, "wrong", ctx);
    expect(await auth.signIn(`${randomUUID()}@example.com`, "wrong", ctx)).toEqual({ ok: false, reason: "THROTTLED" });
  });

  it("F-14b: a wrong password for an unknown address still runs a password check (equal timing)", async () => {
    const verify = vi.fn(async () => false);
    const auth = createAuthService({ store: db.prisma, verify });
    await auth.signIn(`${randomUUID()}@example.com`, "wrong", { ip: "203.0.113.53" });
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("F-14b: a successful sign-in clears that device's address counter, and no account row is ever locked", async () => {
    const account = await user();
    const auth = createAuthService({ store: db.prisma, verify: async (password) => password === "right" });
    const ctx = { ip: "203.0.113.54" };
    for (let i = 0; i < 4; i++) await auth.signIn(account.email, "wrong", ctx);
    expect((await auth.signIn(account.email, "right", ctx)).ok).toBe(true);
    for (let i = 0; i < 4; i++) await auth.signIn(account.email, "wrong", ctx);
    expect((await auth.signIn(account.email, "right", ctx)).ok).toBe(true);
    const row = await db.prisma.user.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.lockedUntil).toBeNull();
  });

  it("F-14b: a password reset clears the throttle for that address", async () => {
    const account = await user();
    const auth = createAuthService({ store: db.prisma, verify: async () => false });
    const ctx = { ip: "203.0.113.55" };
    for (let i = 0; i < 5; i++) await auth.signIn(account.email, "wrong", ctx);
    expect(await auth.signIn(account.email, "wrong", ctx)).toEqual({ ok: false, reason: "THROTTLED" });

    const token = await resetToken(account.email);
    expect(await resetService().resetPassword({ token, newPassword: "new-password" })).toEqual({ ok: true });
    expect(await auth.signIn(account.email, "wrong", ctx)).toEqual({ ok: false, reason: "INVALID" });
  });

  it("commits reset, token consumption and revocation together without revoking another user", async () => {
    const account = await user();
    const other = await user();
    await db.prisma.session.createMany({ data: [account, other].map((u) => ({
      userId: u.id, sessionToken: randomUUID(), expires: new Date(Date.now() + 60000),
    })) });
    const token = await resetToken(account.email);
    expect(await resetService().resetPassword({ token, newPassword: "new-password" })).toEqual({ ok: true });
    expect((await db.prisma.user.findUniqueOrThrow({ where: { id: account.id } })).passwordHash).toBe("new-hash");
    expect((await db.prisma.verificationToken.findUniqueOrThrow({ where: { token: hashToken(token) } })).consumedAt).not.toBeNull();
    expect(await db.prisma.session.count({ where: { userId: account.id, revokedAt: null } })).toBe(0);
    expect(await db.prisma.session.count({ where: { userId: other.id, revokedAt: null } })).toBe(1);
  });

  it("rolls back both password and token if the revocation step fails", async () => {
    const account = await user();
    const token = await resetToken(account.email);
    const session = await db.prisma.session.create({ data: {
      userId: account.id, sessionToken: randomUUID(), expires: new Date(Date.now() + 60000),
    } });
    const reset = resetService(async (userId, tx) => {
      await tx.session.updateMany({ where: { userId }, data: { revokedAt: new Date() } });
      throw new Error("simulated revocation failure");
    });
    await expect(reset.resetPassword({ token, newPassword: "new-password" })).rejects.toThrow("simulated revocation failure");
    expect((await db.prisma.user.findUniqueOrThrow({ where: { id: account.id } })).passwordHash).toBe("old-hash");
    expect((await db.prisma.verificationToken.findUniqueOrThrow({ where: { token: hashToken(token) } })).consumedAt).toBeNull();
    expect((await db.prisma.session.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeNull();
  });

  it("does not create a session from an old password verification completed after reset", async () => {
    const account = await user();
    const token = await resetToken(account.email);
    let entered!: () => void;
    let resume!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const barrier = new Promise<void>((resolve) => { resume = resolve; });
    const auth = createAuthService({
      store: db.prisma,
      verify: async () => { entered(); await barrier; return true; },
    });
    const login = auth.signIn(account.email, "old-password");
    await started;
    try {
      await resetService().resetPassword({ token, newPassword: "new-password" });
    } finally { resume(); }
    expect(await login).toEqual({ ok: false, reason: "INVALID" });
    expect(await db.prisma.session.count({ where: { userId: account.id, revokedAt: null } })).toBe(0);
  });

  it("cannot apply one account's email-change token to another account during cooldown", async () => {
    const first = await user();
    const second = await user();
    const v = verification();
    const profile = createProfileService({
      store: db.prisma as unknown as ProfileStore,
      issueToken: v.issueToken, consumeToken: v.consumeToken,
      verify: async () => true, dispatch: async () => {}, audit: async () => {},
    });
    const newEmail = randomUUID() + "@example.com";
    await profile.requestEmailChange({ userId: first.id }, { currentPassword: "password", newEmail });
    const token = await db.prisma.verificationToken.findFirstOrThrow({ where: { identifier: newEmail } });
    expect(token.userId).toBe(first.id);
    await profile.requestEmailChange({ userId: second.id }, { currentPassword: "password", newEmail });
    expect(await profile.confirmEmailChange(token.token)).toEqual({ ok: false });
    expect((await db.prisma.user.findUniqueOrThrow({ where: { id: second.id } })).email).toBe(second.email);
  });

  it("does not reactivate a deactivated account when verification is opened", async () => {
    const account = await user();
    await db.prisma.user.update({ where: { id: account.id }, data: { status: "PENDING_VERIFICATION" } });
    const v = verification();
    const token = await v.issueToken({ identifier: account.email, purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION, ttlMs: 60000 });
    if (!token.ok) throw new Error("fixture cooldown");
    await db.prisma.user.update({ where: { id: account.id }, data: { status: "DEACTIVATED" } });
    expect(await v.verifyEmail(token.token)).toEqual({ ok: false });
    expect((await db.prisma.user.findUniqueOrThrow({ where: { id: account.id } })).status).toBe("DEACTIVATED");
  });
});

describe("D-16 (U-11) — sign-in for an unverified account, through the action", () => {
  const RIGHT = "Right-passw0rd!";

  beforeAll(() => {
    // Stub transport only: no real email leaves the test.
    vi.stubEnv("EMAIL_TRANSPORT", "stub");
    vi.stubEnv("EMAIL_SENDER_NAME", "Acme Academy");
    vi.stubEnv("EMAIL_SENDER_ADDRESS", "no-reply@acme.test");
    vi.stubEnv("SUPPORT_CONTACT_EMAIL", "help@acme.test");
    vi.stubEnv("APP_BASE_URL", "https://lms.acme.test");
  });

  function form(email: string, password: string) {
    const data = new FormData();
    data.set("email", email);
    data.set("password", password);
    return data;
  }

  async function pendingAccount() {
    return db.prisma.user.create({
      data: {
        email: randomUUID() + "@example.com",
        name: "Pending fixture",
        status: "PENDING_VERIFICATION",
        passwordHash: await hashPassword(RIGHT),
      },
    });
  }

  async function mailFor(email: string) {
    const [tokens, dispatches] = await Promise.all([
      db.prisma.verificationToken.count({ where: { identifier: email, purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION } }),
      db.prisma.emailDispatch.count({ where: { toEmail: email, template: "email-verification" } }),
    ]);
    return { tokens, dispatches };
  }

  async function runQueuedAfterCallbacks() {
    const queued = afterQueue.splice(0);
    for (const callback of queued) await callback();
    return queued.length;
  }

  it("the right password queues exactly one fresh verification email, and only after the action has returned", async () => {
    afterQueue.length = 0;
    request.ip = "198.51.100.61";
    const account = await pendingAccount();

    const state = await signInAction({ error: null }, form(account.email, RIGHT));
    expect(state.error).toMatch(/^Those details do not match an account\./);
    // Nothing has been sent yet: the email is queued for after the response.
    expect(await mailFor(account.email)).toEqual({ tokens: 0, dispatches: 0 });
    expect(afterQueue).toHaveLength(1);

    expect(await runQueuedAfterCallbacks()).toBe(1);
    expect(await mailFor(account.email)).toEqual({ tokens: 1, dispatches: 1 });
    const dispatch = await db.prisma.emailDispatch.findFirstOrThrow({ where: { toEmail: account.email } });
    expect(dispatch.status).toBe("SENT");
    // The account stays unverified and no session was created.
    expect((await db.prisma.user.findUniqueOrThrow({ where: { id: account.id } })).status).toBe("PENDING_VERIFICATION");
    expect(await db.prisma.session.count({ where: { userId: account.id } })).toBe(0);

    // NFR-07 — one real audit row, with IP and correlation, and no address.
    const rows = await db.prisma.auditEvent.findMany({ where: { action: "auth.sign_in.failed", targetId: account.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: null, actorType: "SYSTEM", targetType: "User", outcome: "DENIED", ipAddress: "198.51.100.61" });
    expect(rows[0].correlationId).toBeTruthy();
    expect(JSON.stringify(rows[0])).not.toContain(account.email);
    expect(JSON.stringify(rows[0])).not.toContain(RIGHT);
  });

  it("a wrong password for an unverified account queues nothing", async () => {
    afterQueue.length = 0;
    request.ip = "198.51.100.62";
    const account = await pendingAccount();

    await signInAction({ error: null }, form(account.email, "Wrong-passw0rd!"));
    expect(afterQueue).toHaveLength(0);
    expect(await mailFor(account.email)).toEqual({ tokens: 0, dispatches: 0 });
  });

  it("unknown address, wrong password and unverified account return byte-identical states", async () => {
    afterQueue.length = 0;
    request.ip = "198.51.100.63";
    const email = randomUUID() + "@example.com";
    const prev = { error: null };

    // 1. The address has no account.
    const unknown = await signInAction(prev, form(email, RIGHT));

    // 2. The address belongs to an unverified account and the password matches.
    const account = await db.prisma.user.create({
      data: { email, name: "Same address", status: "PENDING_VERIFICATION", passwordHash: await hashPassword(RIGHT) },
    });
    const unverified = await signInAction(prev, form(email, RIGHT));
    expect(afterQueue).toHaveLength(1);
    afterQueue.length = 0;

    // 3. The account is active and the password is wrong.
    await db.prisma.user.update({ where: { id: account.id }, data: { status: "ACTIVE" } });
    const wrong = await signInAction(prev, form(email, "Wrong-passw0rd!"));

    expect(unverified).toEqual(unknown);
    expect(wrong).toEqual(unknown);
    expect(JSON.stringify(unverified)).toBe(JSON.stringify(unknown));
    expect(JSON.stringify(wrong)).toBe(JSON.stringify(unknown));
    expect(unknown).toEqual({
      email,
      attempt: 1,
      error:
        "Those details do not match an account. If you've registered but not verified your email yet, use the link in the verification email we sent you, then sign in.",
    });
  });
});
