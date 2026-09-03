import { describe, expect, it, vi } from "vitest";
import { guardFindUnique } from "./support/prisma-contract";
import {
  PASSWORD_RESET_TOKEN_TTL_MS,
  VERIFICATION_TOKEN_TTL_MS,
  MIN_PASSWORD_LENGTH,
  TOKEN_PURPOSE,
} from "@/lib/identity";
import {
  createPasswordResetService,
  PASSWORD_RESET_ACCEPTED,
  RESET_INVALID_INPUT,
  RESET_INVALID_TOKEN,
  RESET_ACCEPTED,
  type PasswordResetStore,
  type PasswordResetUserRow,
} from "@/server/services/password-reset-service";
import {
  createVerificationService,
  type VerificationStore,
  type VerificationTokenRow,
} from "@/server/services/verification-service";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { signIn } from "@/server/services/auth-service";

const NOW = { value: new Date("2026-09-02T12:00:00Z") };

/** A recognisable rejection used by every "rejecting transport" test in this
 * file, so a failing assertion's stack trace is unambiguous about its origin. */
class SimulatedProviderOutage extends Error {
  constructor() {
    super("simulated provider outage");
    this.name = "SimulatedProviderOutage";
  }
}

function sharedHarness(options: { rejectDispatch?: boolean } = {}) {
  const rejectDispatch = options.rejectDispatch ?? false;
  const users: (PasswordResetUserRow & { passwordHash: string | null })[] = [];
  const tokens: VerificationTokenRow[] = [];
  const dispatched: { toEmail: string; textContent: string; subject: string }[] = [];
  const audits: unknown[] = [];
  const signOutCalls: string[] = [];

  const store = {
    user: {
      // Guarded per plan 07's schema-derived contract (tests/support/prisma-contract.ts):
      // this fake can never answer a findUnique selector the real Prisma client would refuse.
      findUnique: vi.fn(
        guardFindUnique("User", async ({ where }: { where: { id?: string; email?: string } }) => {
          if (where.id) return users.find((u) => u.id === where.id) ?? null;
          if (where.email) return users.find((u) => u.email === where.email) ?? null;
          return null;
        }),
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const u = users.find((x) => x.id === where.id);
        if (!u) throw new Error("user not found");
        Object.assign(u, data);
        return u;
      }),
    },
    verificationToken: {
      findFirst: vi.fn(async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { createdAt?: string } }) => {
        let matches = tokens.filter((t) => {
          if (where.identifier !== undefined && t.identifier !== where.identifier) return false;
          if (where.purpose !== undefined && t.purpose !== where.purpose) return false;
          if (where.token !== undefined && t.token !== where.token) return false;
          return true;
        });
        if (orderBy?.createdAt === "desc") {
          matches = [...matches].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        return matches[0] ?? null;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const t of tokens) {
          if (where.identifier !== undefined && t.identifier !== where.identifier) continue;
          if (where.purpose !== undefined && t.purpose !== where.purpose) continue;
          if (where.token !== undefined && t.token !== where.token) continue;
          if (where.consumedAt === null && t.consumedAt !== null) continue;
          const expiresGt = (where.expires as { gt?: Date } | undefined)?.gt;
          if (expiresGt && !(t.expires.getTime() > expiresGt.getTime())) continue;
          Object.assign(t, data);
          count++;
        }
        return { count };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { consumedAt: null, ...data } as VerificationTokenRow;
        tokens.push(row);
        return row;
      }),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(store),
  };

  const verificationService = createVerificationService({
    store: store as unknown as VerificationStore,
    dispatch: async (params) => {
      if (rejectDispatch) throw new SimulatedProviderOutage();
      dispatched.push({ toEmail: params.toEmail, subject: params.subject, textContent: params.textContent });
      return { ok: true };
    },
    audit: async (event) => {
      audits.push(event);
    },
    now: () => NOW.value,
  });

  let hashCallCount = 0;
  const passwordResetService = createPasswordResetService({
    store: store as unknown as PasswordResetStore,
    issueToken: (params) => verificationService.issueToken(params),
    consumeToken: (params, apply) => verificationService.consumeToken(params, apply),
    dispatch: async (params) => {
      if (rejectDispatch) throw new SimulatedProviderOutage();
      dispatched.push({ toEmail: params.toEmail, subject: params.subject, textContent: params.textContent });
      return { ok: true };
    },
    audit: async (event) => {
      audits.push(event);
    },
    hash: async (plaintext: string) => {
      hashCallCount++;
      return `fake-hash(${plaintext})`;
    },
    signOutAll: async (userId: string) => {
      signOutCalls.push(userId);
      return 1;
    },
    now: () => NOW.value,
  });

  return {
    passwordResetService,
    verificationService,
    users,
    tokens,
    dispatched,
    audits,
    signOutCalls,
    hashCallCount: () => hashCallCount,
  };
}

function extractToken(textContent: string): string {
  const match = textContent.match(/token=([^\s&]+)/);
  if (!match) throw new Error(`No token found in dispatched text: ${textContent}`);
  return match[1];
}

describe("requestReset — TTL", () => {
  it("issues a token whose expires equals now plus PASSWORD_RESET_TOKEN_TTL_MS, one twenty-fourth of VERIFICATION_TOKEN_TTL_MS", async () => {
    expect(PASSWORD_RESET_TOKEN_TTL_MS).toBe(VERIFICATION_TOKEN_TTL_MS / 24);

    NOW.value = new Date("2026-09-02T12:00:00Z");
    const { passwordResetService, users, tokens } = sharedHarness();
    users.push({ id: "u1", email: "learner@example.com", status: "ACTIVE", passwordHash: "hash" });

    await passwordResetService.requestReset("learner@example.com");
    const token = tokens.find((t) => t.purpose === TOKEN_PURPOSE.PASSWORD_RESET);
    expect(token).toBeDefined();
    expect(token?.expires.getTime()).toBe(NOW.value.getTime() + PASSWORD_RESET_TOKEN_TTL_MS);
  });
});

describe("requestReset — non-enumeration across all five outcomes", () => {
  it("returns the same object identity for active, unknown, pending, deactivated, and cooldown-refused, dispatching on exactly one", async () => {
    NOW.value = new Date("2026-09-02T12:00:00Z");

    const active = sharedHarness();
    active.users.push({ id: "u1", email: "active@example.com", status: "ACTIVE", passwordHash: "hash" });
    const activeResult = await active.passwordResetService.requestReset("active@example.com");
    expect(active.dispatched).toHaveLength(1);

    const unknown = sharedHarness();
    const unknownResult = await unknown.passwordResetService.requestReset("nobody@example.com");

    const pending = sharedHarness();
    pending.users.push({ id: "u2", email: "pending@example.com", status: "PENDING_VERIFICATION", passwordHash: "hash" });
    const pendingResult = await pending.passwordResetService.requestReset("pending@example.com");

    const deactivated = sharedHarness();
    deactivated.users.push({ id: "u3", email: "deactivated@example.com", status: "DEACTIVATED", passwordHash: "hash" });
    const deactivatedResult = await deactivated.passwordResetService.requestReset("deactivated@example.com");

    const cooldown = sharedHarness();
    cooldown.users.push({ id: "u4", email: "cooldown@example.com", status: "ACTIVE", passwordHash: "hash" });
    await cooldown.passwordResetService.requestReset("cooldown@example.com");
    NOW.value = new Date("2026-09-02T12:00:30Z"); // inside 60s cooldown
    const cooldownResult = await cooldown.passwordResetService.requestReset("cooldown@example.com");
    expect(cooldown.dispatched).toHaveLength(1); // only the first request dispatched

    expect(activeResult).toBe(PASSWORD_RESET_ACCEPTED);
    expect(unknownResult).toBe(PASSWORD_RESET_ACCEPTED);
    expect(pendingResult).toBe(PASSWORD_RESET_ACCEPTED);
    expect(deactivatedResult).toBe(PASSWORD_RESET_ACCEPTED);
    expect(cooldownResult).toBe(PASSWORD_RESET_ACCEPTED);

    // Exactly one of the five runs above ever dispatched an email.
    expect(unknown.dispatched).toHaveLength(0);
    expect(pending.dispatched).toHaveLength(0);
    expect(deactivated.dispatched).toHaveLength(0);
  });
});

// G-03-3 regression, observed live during UAT (test 31): a provider outage
// used to crash the active-account branch while an unknown address still
// returned the normal frozen confirmation — a live account-enumeration
// oracle defeating D-08/IAM-06's non-enumeration guarantee. This pins the
// exact scenario: with a rejecting transport, an existing ACTIVE account and
// an address with no account at all must resolve to the byte-identical
// value, and neither call may reject.
describe("requestReset — outage-time indistinguishability (G-03-3 regression)", () => {
  it("returns the identical frozen value, by object identity and deep equality, for an existing ACTIVE account and an unknown address when dispatch rejects", async () => {
    NOW.value = new Date("2026-09-02T12:00:00Z");

    const active = sharedHarness({ rejectDispatch: true });
    active.users.push({ id: "u1", email: "active@example.com", status: "ACTIVE", passwordHash: "hash" });

    // await in a form that fails the test on rejection — a test that only
    // inspects the returned value would still pass if this call rejected and
    // the assertion below never ran.
    const activeResult = await active.passwordResetService.requestReset("active@example.com");

    const unknown = sharedHarness({ rejectDispatch: true });
    const unknownResult = await unknown.passwordResetService.requestReset("nobody@example.com");

    // Same object identity as the exported frozen constant...
    expect(activeResult).toBe(PASSWORD_RESET_ACCEPTED);
    expect(unknownResult).toBe(PASSWORD_RESET_ACCEPTED);
    // ...and therefore also identical to, and deep-equal with, each other.
    expect(activeResult).toBe(unknownResult);
    expect(activeResult).toEqual(unknownResult);

    // No email was actually recorded as sent — the transport really did
    // reject, this is not accidentally the always-resolving default path.
    expect(active.dispatched).toHaveLength(0);
    expect(unknown.dispatched).toHaveLength(0);
  });
});

describe("resetPassword — happy path and session revocation", () => {
  it("consumes the token, replaces the password hash, and revokes every session for that user", async () => {
    NOW.value = new Date("2026-09-02T12:00:00Z");
    const { passwordResetService, users, dispatched, signOutCalls } = sharedHarness();
    users.push({ id: "u1", email: "learner@example.com", status: "ACTIVE", passwordHash: "old-hash" });

    await passwordResetService.requestReset("learner@example.com");
    const token = extractToken(dispatched[0].textContent);

    const result = await passwordResetService.resetPassword({ token, newPassword: "correcthorsebattery" });
    expect(result).toBe(RESET_ACCEPTED);
    expect(users[0].passwordHash).toBe("fake-hash(correcthorsebattery)");
    expect(signOutCalls).toEqual(["u1"]);
  });

  it("does not call signOutAll a second time on a replayed token, and leaves the hash unchanged", async () => {
    NOW.value = new Date("2026-09-02T12:00:00Z");
    const { passwordResetService, users, dispatched, signOutCalls } = sharedHarness();
    users.push({ id: "u1", email: "learner@example.com", status: "ACTIVE", passwordHash: "old-hash" });

    await passwordResetService.requestReset("learner@example.com");
    const token = extractToken(dispatched[0].textContent);

    await passwordResetService.resetPassword({ token, newPassword: "correcthorsebattery" });
    const replay = await passwordResetService.resetPassword({ token, newPassword: "anotherpassword99" });

    expect(replay).toBe(RESET_INVALID_TOKEN);
    expect(users[0].passwordHash).toBe("fake-hash(correcthorsebattery)"); // unchanged from the first reset
    expect(signOutCalls).toEqual(["u1"]); // not called again
  });
});

describe("resetPassword — expiry, validation, and purpose isolation", () => {
  it("returns invalid-token for a token whose expires equals the frozen now, leaving the hash unchanged", async () => {
    const { passwordResetService, users, tokens } = sharedHarness();
    users.push({ id: "u1", email: "learner@example.com", status: "ACTIVE", passwordHash: "old-hash" });
    const expiresAt = new Date("2026-09-02T13:00:00Z");
    tokens.push({
      identifier: "learner@example.com",
      token: "tok-1",
      purpose: TOKEN_PURPOSE.PASSWORD_RESET,
      expires: expiresAt,
      consumedAt: null,
      createdAt: new Date("2026-09-02T12:00:00Z"),
    });

    NOW.value = expiresAt;
    const result = await passwordResetService.resetPassword({ token: "tok-1", newPassword: "correcthorsebattery" });
    expect(result).toBe(RESET_INVALID_TOKEN);
    expect(users[0].passwordHash).toBe("old-hash");
  });

  it("returns invalid-input for a password shorter than MIN_PASSWORD_LENGTH, leaving the token unconsumed", async () => {
    const { passwordResetService, tokens } = sharedHarness();
    tokens.push({
      identifier: "learner@example.com",
      token: "tok-1",
      purpose: TOKEN_PURPOSE.PASSWORD_RESET,
      expires: new Date("2026-09-03T12:00:00Z"),
      consumedAt: null,
      createdAt: new Date("2026-09-02T12:00:00Z"),
    });

    NOW.value = new Date("2026-09-02T12:00:00Z");
    const result = await passwordResetService.resetPassword({
      token: "tok-1",
      newPassword: "a".repeat(MIN_PASSWORD_LENGTH - 1),
    });
    expect(result).toBe(RESET_INVALID_INPUT);
    expect(tokens[0].consumedAt).toBeNull(); // link still usable on a corrected retry
  });

  it("returns invalid-token when an email-verification token is passed to resetPassword", async () => {
    const { passwordResetService, users, tokens } = sharedHarness();
    users.push({ id: "u1", email: "learner@example.com", status: "ACTIVE", passwordHash: "old-hash" });
    tokens.push({
      identifier: "learner@example.com",
      token: "tok-verify",
      purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
      expires: new Date("2026-09-03T12:00:00Z"),
      consumedAt: null,
      createdAt: new Date("2026-09-02T12:00:00Z"),
    });

    NOW.value = new Date("2026-09-02T12:00:00Z");
    const result = await passwordResetService.resetPassword({ token: "tok-verify", newPassword: "correcthorsebattery" });
    expect(result).toBe(RESET_INVALID_TOKEN);
    expect(users[0].passwordHash).toBe("old-hash");
  });
});

describe("password-reset-service — module boundaries", () => {
  it("imports MIN_PASSWORD_LENGTH from a real module path (no local literal)", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
  });
});

// --- Lockout regression (auth-service.ts, unchanged by this phase) ---
//
// auth-service.ts's signIn() calls the real `prisma` singleton directly (no
// dependency injection) — @/server/db is mocked at the module level so this
// stays a unit test rather than requiring a live database.
const fakeAuthUsers: {
  id: string;
  email: string;
  passwordHash: string;
  status: string;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  isStaff: boolean;
}[] = [];
const fakeSessions: unknown[] = [];

vi.mock("@/server/db", () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) => {
        if (where.email) return fakeAuthUsers.find((u) => u.email === where.email) ?? null;
        if (where.id) return fakeAuthUsers.find((u) => u.id === where.id) ?? null;
        return null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const u = fakeAuthUsers.find((x) => x.id === where.id);
        if (!u) throw new Error("user not found");
        Object.assign(u, data);
        return u;
      },
    },
    session: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        fakeSessions.push(data);
        return data;
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));

describe("signIn — lockout counter reset (regression, CONCERNS.md)", () => {
  it("a successful sign-in resets failedLoginAttempts to 0 and clears lockedUntil", async () => {
    const passwordHash = await hashPassword("correcthorsebattery");
    fakeAuthUsers.length = 0;
    fakeAuthUsers.push({
      id: "u1",
      email: "learner@example.com",
      passwordHash,
      status: "ACTIVE",
      failedLoginAttempts: 3,
      lockedUntil: new Date("2020-01-01T00:00:00Z"), // in the past — not currently locked
      isStaff: false,
    });

    const result = await signIn("learner@example.com", "correcthorsebattery");
    expect(result.ok).toBe(true);
    expect(fakeAuthUsers[0].failedLoginAttempts).toBe(0);
    expect(fakeAuthUsers[0].lockedUntil).toBeNull();

    // Sanity: verifyPassword itself still works as expected against the real hash.
    expect(await verifyPassword("correcthorsebattery", passwordHash)).toBe(true);
  });
});
