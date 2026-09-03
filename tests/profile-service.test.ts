import { describe, expect, it, vi } from "vitest";
import { guardFindUnique } from "./support/prisma-contract";
import { POLICY_TYPE, POLICY_VERSIONS } from "@/lib/identity";
import {
  createProfileService,
  EMAIL_CHANGE_ACCEPTED,
  EMAIL_CHANGE_STEP_UP_FAILED,
  type ProfileStore,
  type ProfileUserRow,
} from "@/server/services/profile-service";
import {
  createVerificationService,
  type VerificationStore,
  type VerificationTokenRow,
} from "@/server/services/verification-service";

type PolicyAcceptanceRow = {
  id: string;
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

function sharedHarness(options: { rejectDispatch?: boolean } = {}) {
  const rejectDispatch = options.rejectDispatch ?? false;
  const users: ProfileUserRow[] = [];
  const policyAcceptances: PolicyAcceptanceRow[] = [];
  const tokens: VerificationTokenRow[] = [];
  const dispatched: { toEmail: string; textContent: string; subject: string }[] = [];
  const audits: unknown[] = [];
  let policyIdCounter = 0;

  const store = {
    user: {
      // Guarded: G-03-6a. A hand-written fake once answered
      // `findUnique({ where: { pendingEmail } })`, a query the real Prisma
      // client rejects because User.pendingEmail carries no @unique — the
      // suite passed while the email-change confirmation flow was 100%
      // broken in the browser. The guard reads legal selectors out of
      // prisma/schema.prisma at run time, so this fake can never again be
      // more permissive than the database it stands in for.
      findUnique: vi.fn(
        guardFindUnique("User", async ({ where }: { where: { id?: string; email?: string } }) => {
          if (where.id) return users.find((u) => u.id === where.id) ?? null;
          if (where.email) return users.find((u) => u.email === where.email) ?? null;
          return null;
        }),
      ),
      findFirst: vi.fn(async ({ where }: { where: { id?: string; email?: string; pendingEmail?: string } }) => {
        if (where.email) return users.find((u) => u.email === where.email) ?? null;
        if (where.pendingEmail) return users.find((u) => u.pendingEmail === where.pendingEmail) ?? null;
        if (where.id) return users.find((u) => u.id === where.id) ?? null;
        return null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const u = users.find((x) => x.id === where.id);
        if (!u) throw new Error("user not found");
        Object.assign(u, data);
        return u;
      }),
      // Not guarded — updateMany takes a filter, not a unique selector, so
      // the findUnique contract does not apply here.
      updateMany: vi.fn(async ({ where, data }: { where: { pendingEmail?: string }; data: Record<string, unknown> }) => {
        let count = 0;
        for (const u of users) {
          if (where.pendingEmail !== undefined && u.pendingEmail !== where.pendingEmail) continue;
          Object.assign(u, data);
          count++;
        }
        return { count };
      }),
    },
    policyAcceptance: {
      findFirst: vi.fn(async ({ where }: { where: { userId: string; policyType: string } }) =>
        policyAcceptances.find(
          (p) => p.userId === where.userId && p.policyType === where.policyType,
        ) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `pa-${++policyIdCounter}`, ...data } as PolicyAcceptanceRow;
        policyAcceptances.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = policyAcceptances.find((p) => p.id === where.id);
        if (!row) throw new Error("policyAcceptance not found");
        Object.assign(row, data);
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

  let verifyResult = true;
  const profileService = createProfileService({
    store: store as unknown as ProfileStore,
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
    verify: async () => verifyResult,
    now: () => NOW.value,
  });

  return {
    profileService,
    verificationService,
    users,
    policyAcceptances,
    tokens,
    dispatched,
    audits,
    store,
    setVerifyResult: (v: boolean) => {
      verifyResult = v;
    },
  };
}

function extractToken(textContent: string): string {
  const match = textContent.match(/token=([^\s&]+)/);
  if (!match) throw new Error(`No token found in dispatched text: ${textContent}`);
  return match[1];
}

function makeUser(overrides: Partial<ProfileUserRow> = {}): ProfileUserRow {
  return {
    id: "u1",
    email: "learner@example.com",
    name: "Ada Lovelace",
    phone: null,
    pendingEmail: null,
    passwordHash: "stored-hash",
    ...overrides,
  };
}

describe("updateOwnProfile", () => {
  it("updates name and phone directly, writes one audit event, issues no token, dispatches nothing", async () => {
    const { profileService, users, audits, tokens, dispatched } = sharedHarness();
    users.push(makeUser());

    const result = await profileService.updateOwnProfile({ userId: "u1" }, { name: "Ada", phone: "555-1234" });
    expect(result.ok).toBe(true);
    expect(users[0].name).toBe("Ada");
    expect(users[0].phone).toBe("555-1234");
    expect(tokens).toHaveLength(0);
    expect(dispatched).toHaveLength(0);
    expect(audits.filter((a) => (a as { action: string }).action === "user.profile_updated")).toHaveLength(1);
  });

  it("stores an empty submitted phone as null, not an empty string", async () => {
    const { profileService, users } = sharedHarness();
    users.push(makeUser({ phone: "555-1234" }));

    await profileService.updateOwnProfile({ userId: "u1" }, { name: "Ada", phone: "" });
    expect(users[0].phone).toBeNull();
  });

  it("rejects an empty name", async () => {
    const { profileService } = sharedHarness();
    const result = await profileService.updateOwnProfile({ userId: "u1" }, { name: "   ", phone: null });
    expect(result).toEqual({ ok: false, reason: "INVALID_INPUT" });
  });

  it("only ever reads and writes the row matching the passed actor's user id", async () => {
    const { profileService, users } = sharedHarness();
    users.push(makeUser({ id: "u1", email: "a@example.com" }));
    users.push(makeUser({ id: "u2", email: "b@example.com", name: "Other Learner" }));

    await profileService.updateOwnProfile({ userId: "u1" }, { name: "Changed", phone: null });
    expect(users.find((u) => u.id === "u1")?.name).toBe("Changed");
    expect(users.find((u) => u.id === "u2")?.name).toBe("Other Learner"); // untouched
  });
});

describe("requestEmailChange — step-up gate", () => {
  it("returns the step-up-failed value and writes nothing when the current password is wrong", async () => {
    const { profileService, users, setVerifyResult, tokens, dispatched } = sharedHarness();
    users.push(makeUser());
    setVerifyResult(false);

    const result = await profileService.requestEmailChange(
      { userId: "u1" },
      { currentPassword: "wrong", newEmail: "new@example.com" },
    );
    expect(result).toBe(EMAIL_CHANGE_STEP_UP_FAILED);
    expect(users[0].pendingEmail).toBeNull();
    expect(tokens).toHaveLength(0);
    expect(dispatched).toHaveLength(0);
  });
});

describe("requestEmailChange — happy path, collision, and same-address", () => {
  it("sets pendingEmail, issues a token, dispatches once, and leaves email/emailVerified untouched", async () => {
    const { profileService, users, tokens, dispatched } = sharedHarness();
    users.push(makeUser());

    const result = await profileService.requestEmailChange(
      { userId: "u1" },
      { currentPassword: "correct", newEmail: "NEW@Example.com" },
    );
    expect(result).toBe(EMAIL_CHANGE_ACCEPTED);
    expect(users[0].pendingEmail).toBe("new@example.com");
    expect(users[0].email).toBe("learner@example.com"); // unchanged
    expect(tokens).toHaveLength(1);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].toEmail).toBe("new@example.com");
  });

  it("returns the same value with nothing written when the new address belongs to another account", async () => {
    const { profileService, users, tokens, dispatched } = sharedHarness();
    users.push(makeUser({ id: "u1", email: "learner@example.com" }));
    users.push(makeUser({ id: "u2", email: "taken@example.com" }));

    const result = await profileService.requestEmailChange(
      { userId: "u1" },
      { currentPassword: "correct", newEmail: "taken@example.com" },
    );
    expect(result).toBe(EMAIL_CHANGE_ACCEPTED);
    expect(users[0].pendingEmail).toBeNull();
    expect(tokens).toHaveLength(0);
    expect(dispatched).toHaveLength(0);
  });

  it("is a no-op returning the same value when the submitted address is already on the record", async () => {
    const { profileService, users, tokens } = sharedHarness();
    users.push(makeUser());

    const result = await profileService.requestEmailChange(
      { userId: "u1" },
      { currentPassword: "correct", newEmail: "learner@example.com" },
    );
    expect(result).toBe(EMAIL_CHANGE_ACCEPTED);
    expect(tokens).toHaveLength(0);
  });

  it("the collision, same-address, and happy-path outcomes share one object identity", async () => {
    const a = sharedHarness();
    a.users.push(makeUser({ id: "u1", email: "a@example.com" }));
    const happy = await a.profileService.requestEmailChange(
      { userId: "u1" },
      { currentPassword: "correct", newEmail: "brand-new@example.com" },
    );

    const b = sharedHarness();
    b.users.push(makeUser({ id: "u1", email: "b@example.com" }));
    b.users.push(makeUser({ id: "u2", email: "taken2@example.com" }));
    const collision = await b.profileService.requestEmailChange(
      { userId: "u1" },
      { currentPassword: "correct", newEmail: "taken2@example.com" },
    );

    const c = sharedHarness();
    c.users.push(makeUser({ id: "u1", email: "c@example.com" }));
    const sameAddress = await c.profileService.requestEmailChange(
      { userId: "u1" },
      { currentPassword: "correct", newEmail: "c@example.com" },
    );

    expect(happy).toBe(EMAIL_CHANGE_ACCEPTED);
    expect(collision).toBe(EMAIL_CHANGE_ACCEPTED);
    expect(sameAddress).toBe(EMAIL_CHANGE_ACCEPTED);
  });
});

// G-03-3 regression, observed live during UAT (test 31): a rejecting
// transport must not escape requestEmailChange.
describe("requestEmailChange — rejecting transport (G-03-3 regression)", () => {
  it("returns the frozen accepted value and does not reject when the send rejects", async () => {
    const { profileService, users, dispatched } = sharedHarness({ rejectDispatch: true });
    users.push(makeUser());

    // await in a form that fails the test on rejection.
    const result = await profileService.requestEmailChange(
      { userId: "u1" },
      { currentPassword: "correct", newEmail: "new@example.com" },
    );

    expect(result).toBe(EMAIL_CHANGE_ACCEPTED);
    expect(dispatched).toHaveLength(0); // the transport really did reject
    expect(users[0].pendingEmail).toBe("new@example.com"); // the request itself still took effect
  });
});

describe("confirmEmailChange", () => {
  it("moves pendingEmail into email, nulls pendingEmail, and sets emailVerified inside the claim transaction", async () => {
    const { profileService, users, dispatched } = sharedHarness();
    users.push(makeUser());
    await profileService.requestEmailChange(
      { userId: "u1" },
      { currentPassword: "correct", newEmail: "new@example.com" },
    );
    const token = extractToken(dispatched[0].textContent);

    const result = await profileService.confirmEmailChange(token);
    expect(result).toEqual({ ok: true });
    expect(users[0].email).toBe("new@example.com");
    expect(users[0].pendingEmail).toBeNull();
    expect(users[0].emailVerified).toBeInstanceOf(Date);
  });

  it("returns the not-valid result and changes nothing on a replay", async () => {
    const { profileService, users, dispatched } = sharedHarness();
    users.push(makeUser());
    await profileService.requestEmailChange(
      { userId: "u1" },
      { currentPassword: "correct", newEmail: "new@example.com" },
    );
    const token = extractToken(dispatched[0].textContent);

    await profileService.confirmEmailChange(token);
    const replay = await profileService.confirmEmailChange(token);
    expect(replay).toEqual({ ok: false });
    expect(users[0].email).toBe("new@example.com"); // from the first confirm, unchanged by the replay
  });

  it("refuses inside the transaction when the address was claimed between request and confirmation", async () => {
    const { profileService, users, dispatched } = sharedHarness();
    users.push(makeUser({ id: "u1", email: "learner@example.com" }));
    await profileService.requestEmailChange(
      { userId: "u1" },
      { currentPassword: "correct", newEmail: "coveted@example.com" },
    );
    const token = extractToken(dispatched[0].textContent);

    // Someone else registers/claims the coveted address between request and confirmation.
    users.push(makeUser({ id: "u2", email: "coveted@example.com", pendingEmail: null }));

    const result = await profileService.confirmEmailChange(token);
    expect(result).toEqual({ ok: false });
    expect(users[0].email).toBe("learner@example.com"); // unchanged — refused cleanly, not a thrown constraint error
  });

  // G-03-6a regression: without Task 1's fix, this fails at the guarded
  // findUnique inside confirmEmailChange — a query on a non-unique column —
  // rather than at an assertion below. That is precisely the behaviour
  // being pinned: the flow was 100% broken and no test caught it.
  it("resolves the pending account through a legal query and completes the confirmation end to end", async () => {
    const { profileService, users, dispatched } = sharedHarness();
    users.push(makeUser({ id: "u1", email: "learner@example.com" }));

    await profileService.requestEmailChange(
      { userId: "u1" },
      { currentPassword: "correct", newEmail: "fresh@example.com" },
    );
    const token = extractToken(dispatched[0].textContent);

    const result = await profileService.confirmEmailChange(token);

    expect(result).toEqual({ ok: true });
    expect(users[0].email).toBe("fresh@example.com");
    expect(users[0].pendingEmail).toBeNull();
    expect(users[0].emailVerified).toBeInstanceOf(Date);
  });

  // Pins the ambiguity Task 1 closes: two accounts cannot simultaneously
  // hold the same pendingEmail, so findFirst always resolves to the
  // requester who asked most recently — never to an earlier, unrelated
  // account that once requested the same address.
  it("when a second account requests the same pending address, confirming resolves to the second account, never the first", async () => {
    const { profileService, users, dispatched } = sharedHarness();
    users.push(makeUser({ id: "u1", email: "first@example.com" }));
    users.push(makeUser({ id: "u2", email: "second@example.com" }));

    const originalNow = NOW.value;
    try {
      await profileService.requestEmailChange(
        { userId: "u1" },
        { currentPassword: "correct", newEmail: "contested@example.com" },
      );
      dispatched.length = 0; // isolate the second requester's dispatch below

      // D-05's per-address cooldown is keyed on the target identifier, not
      // the requester — advance the fake clock past it so the second
      // requester's own token actually issues rather than being silently
      // suppressed.
      NOW.value = new Date(originalNow.getTime() + 61_000);

      await profileService.requestEmailChange(
        { userId: "u2" },
        { currentPassword: "correct", newEmail: "contested@example.com" },
      );

      const pendingHolders = users.filter((u) => u.pendingEmail === "contested@example.com");
      expect(pendingHolders).toHaveLength(1);
      expect(pendingHolders[0].id).toBe("u2");
      expect(users.find((u) => u.id === "u1")?.pendingEmail).toBeNull();

      const token = extractToken(dispatched[0].textContent);
      const result = await profileService.confirmEmailChange(token);

      expect(result).toEqual({ ok: true });
      expect(users.find((u) => u.id === "u2")?.email).toBe("contested@example.com");
      expect(users.find((u) => u.id === "u1")?.email).toBe("first@example.com"); // untouched
    } finally {
      NOW.value = originalNow;
    }
  });
});

describe("setMarketingPreference", () => {
  it("creates the marketing PolicyAcceptance row with accepted true on first opt-in", async () => {
    const { profileService, policyAcceptances } = sharedHarness();
    await profileService.setMarketingPreference({ userId: "u1" }, true);
    expect(policyAcceptances).toHaveLength(1);
    expect(policyAcceptances[0]).toMatchObject({
      userId: "u1",
      policyType: POLICY_TYPE.MARKETING,
      accepted: true,
      orderId: null,
      version: POLICY_VERSIONS[POLICY_TYPE.MARKETING],
    });
  });

  it("updates the existing row to accepted false rather than deleting it", async () => {
    const { profileService, policyAcceptances, store } = sharedHarness();
    await profileService.setMarketingPreference({ userId: "u1" }, true);
    await profileService.setMarketingPreference({ userId: "u1" }, false);

    expect(policyAcceptances).toHaveLength(1); // same row, updated in place
    expect(policyAcceptances[0].accepted).toBe(false);
    expect((store.policyAcceptance as Record<string, unknown>).delete).toBeUndefined();
  });

  it("writes exactly one audit event per call", async () => {
    const { profileService, audits } = sharedHarness();
    await profileService.setMarketingPreference({ userId: "u1" }, true);
    const events = audits.filter(
      (a) => (a as { action: string }).action === "user.marketing_preference_updated",
    );
    expect(events).toHaveLength(1);
  });
});

describe("getOwnProfile", () => {
  it("reports the marketing preference as off for an account with no marketing row", async () => {
    const { profileService, users } = sharedHarness();
    users.push(makeUser());
    const profile = await profileService.getOwnProfile({ userId: "u1" });
    expect(profile?.marketingOptIn).toBe(false);
  });

  it("reports the marketing preference as on after an opt-in", async () => {
    const { profileService, users } = sharedHarness();
    users.push(makeUser());
    await profileService.setMarketingPreference({ userId: "u1" }, true);
    const profile = await profileService.getOwnProfile({ userId: "u1" });
    expect(profile?.marketingOptIn).toBe(true);
  });
});

describe("profile-service — audit coverage across all four mutating entry points", () => {
  it("each mutating entry point fires exactly one audit event with the learner as actor", async () => {
    const { profileService, users, dispatched, audits } = sharedHarness();
    users.push(makeUser());

    await profileService.updateOwnProfile({ userId: "u1" }, { name: "New Name", phone: null });
    await profileService.requestEmailChange(
      { userId: "u1" },
      { currentPassword: "correct", newEmail: "changed@example.com" },
    );
    const token = extractToken(dispatched[0].textContent);
    await profileService.confirmEmailChange(token);
    await profileService.setMarketingPreference({ userId: "u1" }, true);

    const actions = [
      "user.profile_updated",
      "user.email_change_requested",
      "user.email_changed",
      "user.marketing_preference_updated",
    ];
    for (const action of actions) {
      const matching = audits.filter((a) => (a as { action: string; actorId: string }).action === action);
      expect(matching).toHaveLength(1);
      expect((matching[0] as { actorId: string }).actorId).toBe("u1");
    }
  });
});
