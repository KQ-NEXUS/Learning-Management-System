import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  it("serializes failed attempts and enforces lockout across simultaneous requests", async () => {
    const account = await user();
    let arrivals = 0;
    let open!: () => void;
    const barrier = new Promise<void>((resolve) => { open = resolve; });
    const auth = createAuthService({
      store: db.prisma,
      verify: async () => {
        if (++arrivals === 5) open();
        await barrier;
        return false;
      },
    });
    await Promise.all(Array.from({ length: 5 }, () => auth.signIn(account.email, "wrong")));
    const updated = await db.prisma.user.findUniqueOrThrow({ where: { id: account.id } });
    expect(updated.failedLoginAttempts).toBe(5);
    expect(updated.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(await auth.signIn(account.email, "wrong")).toEqual({ ok: false, reason: "LOCKED" });
    expect(await db.prisma.session.count({ where: { userId: account.id } })).toBe(0);
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
    expect((await db.prisma.verificationToken.findUniqueOrThrow({ where: { token } })).consumedAt).not.toBeNull();
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
    expect((await db.prisma.verificationToken.findUniqueOrThrow({ where: { token } })).consumedAt).toBeNull();
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
