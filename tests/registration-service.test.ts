import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { guardFindUnique } from "./support/prisma-contract";
import { POLICY_TYPE, POLICY_VERSIONS, MIN_PASSWORD_LENGTH } from "@/lib/identity";
import {
  createRegistrationService,
  REGISTRATION_ACCEPTED,
  REGISTRATION_INVALID_INPUT,
  type RegistrationStore,
  type RegisteredUserRow,
  type RegistrationInput,
} from "@/server/services/registration-service";
import {
  createVerificationService,
  type VerificationStore,
  type VerificationTokenRow,
} from "@/server/services/verification-service";

type PolicyAcceptanceRow = {
  userId: string;
  policyType: string;
  version: string;
  accepted: boolean;
  orderId: string | null;
};

const NOW = { value: new Date("2026-09-02T12:00:00Z") };

/** A recognisable rejection used by every "rejecting transport" test in this
 * file, so a failing assertion's stack trace is unambiguous about its origin. */
class SimulatedProviderOutage extends Error {
  constructor() {
    super("simulated provider outage");
    this.name = "SimulatedProviderOutage";
  }
}

/** One fake store backing both registration-service and verification-service, so an
 * end-to-end test can drive registerLearner and then verifyEmail against the same data. */
function sharedHarness(options: { rejectDispatch?: boolean } = {}) {
  const rejectDispatch = options.rejectDispatch ?? false;
  const users: RegisteredUserRow[] = [];
  const policyAcceptances: PolicyAcceptanceRow[] = [];
  const tokens: VerificationTokenRow[] = [];
  const dispatched: { toEmail: string; textContent: string; subject: string }[] = [];
  let userIdCounter = 0;
  let hashCallCount = 0;

  const store = {
    user: {
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const matches = users.filter((u) => Object.entries(where).every(([key, value]) => u[key as keyof RegisteredUserRow] === value));
        matches.forEach((u) => Object.assign(u, data));
        return { count: matches.length };
      },
      // Guarded per plan 07's schema-derived contract (tests/support/prisma-contract.ts):
      // this fake can never answer a findUnique selector the real Prisma client would refuse.
      findUnique: vi.fn(
        guardFindUnique("User", async ({ where }: { where: { id?: string; email?: string } }) => {
          if (where.id) return users.find((u) => u.id === where.id) ?? null;
          if (where.email) return users.find((u) => u.email === where.email) ?? null;
          return null;
        }),
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (users.some((u) => u.email === data.email)) {
          throw { code: "P2002" };
        }
        const row = {
          id: `u-${++userIdCounter}`,
          phone: null,
          ...data,
        } as RegisteredUserRow & { status: string; emailVerified?: Date | null };
        users.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const u = users.find((x) => x.id === where.id) as Record<string, unknown> | undefined;
        if (!u) throw new Error("user not found");
        Object.assign(u, data);
        return u;
      }),
    },
    policyAcceptance: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = data as unknown as PolicyAcceptanceRow;
        policyAcceptances.push(row);
        return row;
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
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      // Simulate real transaction rollback: snapshot before running, restore
      // on throw. A real Prisma $transaction rolls back at the database
      // level; this fake store must do the same or "no row survives" tests
      // are meaningless.
      const usersSnapshot = [...users];
      const policySnapshot = [...policyAcceptances];
      try {
        return await fn(store);
      } catch (error) {
        users.length = 0;
        users.push(...usersSnapshot);
        policyAcceptances.length = 0;
        policyAcceptances.push(...policySnapshot);
        throw error;
      }
    },
  };

  const audits: unknown[] = [];

  const verificationService = createVerificationService({
    store: store as unknown as VerificationStore,
    dispatch: async (params) => {
      if (rejectDispatch) throw new SimulatedProviderOutage();
      dispatched.push({
        toEmail: params.toEmail,
        subject: params.subject,
        textContent: params.textContent,
      });
      return { ok: true };
    },
    audit: async (event) => {
      audits.push(event);
    },
    now: () => NOW.value,
  });

  const registrationService = createRegistrationService({
    store: store as unknown as RegistrationStore,
    issueToken: (params) => verificationService.issueToken(params),
    resendVerification: (email) => verificationService.resendVerification(email),
    dispatch: async (params) => {
      if (rejectDispatch) throw new SimulatedProviderOutage();
      dispatched.push({
        toEmail: params.toEmail,
        subject: params.subject,
        textContent: params.textContent,
      });
      return { ok: true };
    },
    audit: async (event) => {
      audits.push(event);
    },
    hash: async (plaintext: string) => {
      hashCallCount++;
      return `fake-hash(${plaintext})`;
    },
    now: () => NOW.value,
  });

  return {
    registrationService,
    verificationService,
    users,
    policyAcceptances,
    tokens,
    dispatched,
    audits,
    store,
    hashCallCount: () => hashCallCount,
  };
}

const BASE_INPUT: RegistrationInput = {
  email: "learner@example.com",
  password: "correcthorsebattery",
  name: "Ada Lovelace",
  phone: null,
  acceptedTerms: true,
  acceptedPrivacy: true,
};

function extractToken(textContent: string): string {
  const match = textContent.match(/token=([^\s&]+)/);
  if (!match) throw new Error(`No token found in dispatched text: ${textContent}`);
  return match[1];
}

describe("registerLearner — brand-new email", () => {
  it("end-to-end: register then verify activates the account", async () => {
    const { registrationService, verificationService, users, dispatched } = sharedHarness();

    const result = await registrationService.registerLearner(BASE_INPUT);
    expect(result).toBe(REGISTRATION_ACCEPTED);
    expect(dispatched).toHaveLength(1);

    const token = extractToken(dispatched[0].textContent);
    const verifyResult = await verificationService.verifyEmail(token);
    expect(verifyResult).toEqual({ ok: true });

    const user = users.find((u) => u.email === "learner@example.com") as unknown as {
      status: string;
      emailVerified: Date | null;
    };
    expect(user.status).toBe("ACTIVE");
    expect(user.emailVerified).not.toBeNull();
  });

  it("creates a PENDING_VERIFICATION user with a hashed password", async () => {
    const { registrationService, users } = sharedHarness();
    await registrationService.registerLearner(BASE_INPUT);
    const user = users[0] as unknown as { status: string; passwordHash: string };
    expect(user.status).toBe("PENDING_VERIFICATION");
    expect(user.passwordHash).toBe("fake-hash(correcthorsebattery)");
  });

  it("creates exactly two PolicyAcceptance rows with the terms and privacy constants and matching versions", async () => {
    const { registrationService, policyAcceptances } = sharedHarness();
    await registrationService.registerLearner(BASE_INPUT);

    expect(policyAcceptances).toHaveLength(2);
    const types = policyAcceptances.map((p) => p.policyType).sort();
    expect(types).toEqual([POLICY_TYPE.PRIVACY, POLICY_TYPE.TERMS].sort());
    for (const row of policyAcceptances) {
      expect(row.version).toBe(POLICY_VERSIONS[row.policyType]);
      expect(row.orderId).toBeNull();
    }
  });

  it("dispatches exactly one verification email per successful registration", async () => {
    const { registrationService, dispatched } = sharedHarness();
    await registrationService.registerLearner(BASE_INPUT);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].toEmail).toBe("learner@example.com");
  });

  it("leaves zero User rows when the PolicyAcceptance write throws, proving both writes share one transaction", async () => {
    const { registrationService, store, users } = sharedHarness();
    store.policyAcceptance.create = vi.fn(async () => {
      throw new Error("simulated policy write failure");
    });

    await expect(registrationService.registerLearner(BASE_INPUT)).rejects.toThrow(
      "simulated policy write failure",
    );
    expect(users).toHaveLength(0);
  });

  it("writes exactly one user.created audit event", async () => {
    const { registrationService, audits } = sharedHarness();
    await registrationService.registerLearner(BASE_INPUT);
    const created = audits.filter((a) => (a as { action: string }).action === "user.created");
    expect(created).toHaveLength(1);
  });
});

// G-03-3 regression, observed live during UAT (test 31): a rejecting
// transport must not escape registerLearner, and the audit ordering fix
// (T-03-52) must survive it — the user.created row is committed with the
// account, before the send is even attempted.
describe("registerLearner — rejecting transport (G-03-3 regression)", () => {
  it("returns the frozen accepted value, does not reject, and still writes exactly one user.created audit row", async () => {
    const { registrationService, audits, users, dispatched } = sharedHarness({ rejectDispatch: true });

    // await in a form that fails the test on rejection.
    const result = await registrationService.registerLearner({ ...BASE_INPUT, email: "outage@example.com" });

    expect(result).toBe(REGISTRATION_ACCEPTED);
    expect(dispatched).toHaveLength(0); // the transport really did reject
    expect(users).toHaveLength(1); // the account was still committed

    const created = audits.filter((a) => (a as { action: string }).action === "user.created");
    expect(created).toHaveLength(1);
  });
});

describe("registerLearner — already PENDING_VERIFICATION", () => {
  it("resends a fresh token, creates no second user row or new policy rows, and returns the shared success value", async () => {
    const { registrationService, users, policyAcceptances, dispatched, tokens } = sharedHarness();

    await registrationService.registerLearner(BASE_INPUT);
    expect(users).toHaveLength(1);
    expect(policyAcceptances).toHaveLength(2);
    expect(dispatched).toHaveLength(1);

    NOW.value = new Date("2026-09-02T12:05:00Z"); // past the 60s cooldown
    const second = await registrationService.registerLearner(BASE_INPUT);

    expect(second).toBe(REGISTRATION_ACCEPTED);
    expect(users).toHaveLength(1);
    expect(policyAcceptances).toHaveLength(2);
    expect(dispatched).toHaveLength(2);

    const firstToken = tokens.find((t) => t.identifier === "learner@example.com" && t.consumedAt !== null);
    expect(firstToken).toBeDefined();
  });

  it("writes exactly one user.verification_resent audit event", async () => {
    const { registrationService, audits } = sharedHarness();
    await registrationService.registerLearner(BASE_INPUT);
    NOW.value = new Date("2026-09-02T12:05:00Z");
    await registrationService.registerLearner(BASE_INPUT);

    const resent = audits.filter((a) => (a as { action: string }).action === "user.verification_resent");
    expect(resent).toHaveLength(1);
  });
});

describe("registerLearner — already ACTIVE", () => {
  it("creates nothing, dispatches nothing, and returns the shared success value", async () => {
    const { registrationService, users, dispatched, audits } = sharedHarness();
    users.push({
      id: "u-active",
      email: "active@example.com",
      name: "Existing Learner",
      phone: null,
      status: "ACTIVE",
      passwordHash: "already-hashed",
    });

    const result = await registrationService.registerLearner({ ...BASE_INPUT, email: "active@example.com" });

    expect(result).toBe(REGISTRATION_ACCEPTED);
    expect(users).toHaveLength(1); // unchanged
    expect(dispatched).toHaveLength(0);
    expect(audits.filter((a) => (a as { targetId?: string }).targetId === "u-active")).toHaveLength(0);
  });
});

describe("registerLearner — lost insert race (P2002)", () => {
  it("falls through to the resend branch and returns the shared success value", async () => {
    const { registrationService, store, users, dispatched } = sharedHarness();

    // Simulate a winner committing (via its own, already-completed
    // transaction) between our own findUnique (sees nothing) and our own
    // create (rejects with P2002). Bypass this fake's rollback-on-throw for
    // this transaction only — the winner's commit is a separate transaction
    // in reality and must not be undone by ours failing.
    store.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(store);
    store.user.create = vi.fn(async () => {
      users.push({
        id: "u-winner",
        email: "racer@example.com",
        name: "Winner",
        phone: null,
        status: "PENDING_VERIFICATION",
        passwordHash: "winner-hash",
      });
      throw { code: "P2002" };
    });

    const result = await registrationService.registerLearner({ ...BASE_INPUT, email: "racer@example.com" });
    expect(result).toBe(REGISTRATION_ACCEPTED);
    expect(dispatched).toHaveLength(1);
    expect(users).toHaveLength(1); // only the winner's row — our own insert never landed
  });
});

describe("registerLearner — validation runs before any store call", () => {
  it("rejects a password shorter than MIN_PASSWORD_LENGTH before any store call", async () => {
    const { registrationService, store } = sharedHarness();
    const result = await registrationService.registerLearner({
      ...BASE_INPUT,
      password: "a".repeat(MIN_PASSWORD_LENGTH - 1),
    });
    expect(result).toBe(REGISTRATION_INVALID_INPUT);
    expect(store.user.findUnique).not.toHaveBeenCalled();
    expect(store.user.create).not.toHaveBeenCalled();
  });

  it("accepts a password exactly at MIN_PASSWORD_LENGTH", async () => {
    const { registrationService } = sharedHarness();
    const result = await registrationService.registerLearner({
      ...BASE_INPUT,
      password: "a".repeat(MIN_PASSWORD_LENGTH),
    });
    expect(result).toBe(REGISTRATION_ACCEPTED);
  });

  it("rejects when acceptedTerms is false, with zero store calls", async () => {
    const { registrationService, store } = sharedHarness();
    const result = await registrationService.registerLearner({ ...BASE_INPUT, acceptedTerms: false });
    expect(result).toBe(REGISTRATION_INVALID_INPUT);
    expect(store.user.findUnique).not.toHaveBeenCalled();
  });

  it("rejects when acceptedPrivacy is false, with zero store calls", async () => {
    const { registrationService, store } = sharedHarness();
    const result = await registrationService.registerLearner({ ...BASE_INPUT, acceptedPrivacy: false });
    expect(result).toBe(REGISTRATION_INVALID_INPUT);
    expect(store.user.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an empty name", async () => {
    const { registrationService } = sharedHarness();
    const result = await registrationService.registerLearner({ ...BASE_INPUT, name: "   " });
    expect(result).toBe(REGISTRATION_INVALID_INPUT);
  });
});

describe("registerLearner — non-enumeration: response indistinguishability and cost symmetry", () => {
  it("returns the exact same object identity across new, pending, active and lost-race outcomes", async () => {
    const newHarness = sharedHarness();
    const newResult = await newHarness.registrationService.registerLearner({
      ...BASE_INPUT,
      email: "new@example.com",
    });

    const pendingHarness = sharedHarness();
    await pendingHarness.registrationService.registerLearner({ ...BASE_INPUT, email: "pending@example.com" });
    const pendingResult = await pendingHarness.registrationService.registerLearner({
      ...BASE_INPUT,
      email: "pending@example.com",
    });

    const activeHarness = sharedHarness();
    activeHarness.users.push({
      id: "u-active",
      email: "active2@example.com",
      name: "Existing",
      phone: null,
      status: "ACTIVE",
      passwordHash: "hash",
    });
    const activeResult = await activeHarness.registrationService.registerLearner({
      ...BASE_INPUT,
      email: "active2@example.com",
    });

    // All four are the exact same frozen module-level object — not merely
    // structurally equal clones.
    expect(newResult).toBe(REGISTRATION_ACCEPTED);
    expect(pendingResult).toBe(REGISTRATION_ACCEPTED);
    expect(activeResult).toBe(REGISTRATION_ACCEPTED);
    expect(newResult).toBe(pendingResult);
    expect(pendingResult).toBe(activeResult);
  });

  it("hashes the password the same number of times on the brand-new branch as on the already-active branch", async () => {
    const newHarness = sharedHarness();
    await newHarness.registrationService.registerLearner({ ...BASE_INPUT, email: "new2@example.com" });
    expect(newHarness.hashCallCount()).toBe(1);

    const activeHarness = sharedHarness();
    activeHarness.users.push({
      id: "u-active",
      email: "active3@example.com",
      name: "Existing",
      phone: null,
      status: "ACTIVE",
      passwordHash: "hash",
    });
    await activeHarness.registrationService.registerLearner({ ...BASE_INPUT, email: "active3@example.com" });
    expect(activeHarness.hashCallCount()).toBe(1);
  });
});

describe("registerLearner — consent integrity", () => {
  it("leaves zero policyAcceptance rows in the store after a submission with a false consent flag", async () => {
    const { registrationService, policyAcceptances } = sharedHarness();
    await registrationService.registerLearner({ ...BASE_INPUT, acceptedPrivacy: false });
    expect(policyAcceptances).toHaveLength(0);
  });

  it("reads RegisterForm.tsx from disk and confirms no checkbox is rendered defaulted-on", () => {
    const formSource = readFileSync(
      path.resolve(process.cwd(), "src/app/(auth)/register/RegisterForm.tsx"),
      "utf8",
    );
    const checkboxBlocks = formSource.match(/<input[^>]*type="checkbox"[^>]*\/>/g) ?? [];
    expect(checkboxBlocks.length).toBeGreaterThan(0);
    for (const block of checkboxBlocks) {
      expect(block).not.toMatch(/defaultChecked/);
      expect(block).not.toMatch(/checked={true}/);
      expect(block).not.toMatch(/checked\s*$/);
    }
  });
});
