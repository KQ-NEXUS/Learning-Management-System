import { randomUUID } from "node:crypto";
import { hashToken } from "@/server/auth/token-hash";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { createAuthService } from "@/server/services/auth-service";
import { createVerificationService, type VerificationStore } from "@/server/services/verification-service";
import { createPasswordResetService, type PasswordResetStore } from "@/server/services/password-reset-service";
import { createProfileService, type ProfileStore } from "@/server/services/profile-service";
import { TOKEN_PURPOSE } from "@/lib/identity";

let db: TestDatabase;
beforeAll(async () => { db = await startTestDatabase(); }, TEST_DB_TIMEOUT_MS);
afterAll(async () => { await db?.stop(); }, TEST_DB_TIMEOUT_MS);

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
