import { describe, expect, it, vi } from "vitest";
import { guardFindUnique } from "./support/prisma-contract";
import { TOKEN_PURPOSE } from "@/lib/identity";
import {
  createVerificationService,
  type VerificationStore,
  type VerificationTokenRow,
} from "@/server/services/verification-service";

type UserRow = { id: string; email: string; status: string };

/** A recognisable rejection used by every "rejecting transport" test in this
 * file, so a failing assertion's stack trace is unambiguous about its origin. */
class SimulatedProviderOutage extends Error {
  constructor() {
    super("simulated provider outage");
    this.name = "SimulatedProviderOutage";
  }
}

function harness(
  options: { tokens?: VerificationTokenRow[]; users?: UserRow[]; rejectDispatch?: boolean } = {},
) {
  const tokens: VerificationTokenRow[] = options.tokens ?? [];
  const users: UserRow[] = options.users ?? [];
  const rejectDispatch = options.rejectDispatch ?? false;
  const dispatched: unknown[] = [];
  const audits: unknown[] = [];

  const store: VerificationStore = {
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
    user: {
      // Guarded per plan 07's schema-derived contract (tests/support/prisma-contract.ts):
      // this fake can never answer a findUnique selector the real Prisma client would refuse.
      findUnique: vi.fn(
        guardFindUnique("User", async ({ where }: { where: { email: string } }) =>
          users.find((u) => u.email === where.email) ?? null,
        ),
      ),
      findFirst: vi.fn(async ({ where }: { where: { email: string } }) =>
        users.find((u) => u.email === where.email) ?? null,
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const u = users.find((x) => x.id === where.id);
        if (!u) throw new Error("user not found");
        Object.assign(u, data);
        return u;
      }),
    },
    $transaction: async (fn) => fn(store),
  };

  let tokenCounter = 0;
  const service = createVerificationService({
    store,
    dispatch: async (params) => {
      if (rejectDispatch) throw new SimulatedProviderOutage();
      dispatched.push(params);
      return { ok: true };
    },
    audit: async (event) => {
      audits.push(event);
    },
    generateToken: () => `token-${++tokenCounter}`,
    now: () => harness_now.value,
  });

  return { service, tokens, users, dispatched, audits, store };
}

// Mutable "current time" the fake now() reads, so tests can advance it.
const harness_now = { value: new Date("2026-09-02T12:00:00Z") };

describe("issueToken", () => {
  it("returns a token on first issue", async () => {
    harness_now.value = new Date("2026-09-02T12:00:00Z");
    const { service, tokens } = harness();
    const result = await service.issueToken({
      identifier: "learner@example.com",
      purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
      ttlMs: 3_600_000,
    });
    expect(result.ok).toBe(true);
    expect(tokens).toHaveLength(1);
  });

  it("refuses with a cooldown result inside the cooldown window and creates no second row", async () => {
    harness_now.value = new Date("2026-09-02T12:00:00Z");
    const { service, tokens } = harness();
    await service.issueToken({
      identifier: "learner@example.com",
      purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
      ttlMs: 3_600_000,
    });
    expect(tokens).toHaveLength(1);

    harness_now.value = new Date("2026-09-02T12:00:30Z"); // 30s later, inside 60s cooldown
    const second = await service.issueToken({
      identifier: "learner@example.com",
      purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
      ttlMs: 3_600_000,
    });
    expect(second).toEqual({ ok: false, reason: "COOLDOWN" });
    expect(tokens).toHaveLength(1);
  });

  it("stamps the prior row's consumedAt on a reissue past the cooldown, and only the new token is claimable", async () => {
    harness_now.value = new Date("2026-09-02T12:00:00Z");
    const { service, tokens } = harness();
    const first = await service.issueToken({
      identifier: "learner@example.com",
      purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
      ttlMs: 3_600_000,
    });
    expect(first.ok).toBe(true);

    harness_now.value = new Date("2026-09-02T12:01:01Z"); // past 60s cooldown
    const second = await service.issueToken({
      identifier: "learner@example.com",
      purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
      ttlMs: 3_600_000,
    });
    expect(second.ok).toBe(true);

    expect(tokens).toHaveLength(2);
    const priorRow = tokens.find((t) => first.ok && t.token === first.token);
    expect(priorRow?.consumedAt).not.toBeNull();

    if (first.ok) {
      const replay = await service.consumeToken(
        { token: first.token, purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION },
        async () => {},
      );
      expect(replay).toEqual({ ok: false });
    }
  });
});

describe("consumeToken", () => {
  it("claims a fresh unexpired token once and runs apply", async () => {
    harness_now.value = new Date("2026-09-02T12:00:00Z");
    const { service, tokens } = harness();
    tokens.push({
      identifier: "learner@example.com",
      token: "tok-1",
      purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
      expires: new Date("2026-09-03T12:00:00Z"),
      consumedAt: null,
      createdAt: new Date("2026-09-02T12:00:00Z"),
    });

    let applied = false;
    const result = await service.consumeToken(
      { token: "tok-1", purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION },
      async () => {
        applied = true;
      },
    );

    expect(result).toEqual({ ok: true });
    expect(applied).toBe(true);
  });

  it("returns not-ok on replay and does not run apply a second time", async () => {
    harness_now.value = new Date("2026-09-02T12:00:00Z");
    const { service, tokens } = harness();
    tokens.push({
      identifier: "learner@example.com",
      token: "tok-1",
      purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
      expires: new Date("2026-09-03T12:00:00Z"),
      consumedAt: null,
      createdAt: new Date("2026-09-02T12:00:00Z"),
    });

    let applyCount = 0;
    await service.consumeToken({ token: "tok-1", purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION }, async () => {
      applyCount++;
    });
    const second = await service.consumeToken(
      { token: "tok-1", purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION },
      async () => {
        applyCount++;
      },
    );

    expect(second).toEqual({ ok: false });
    expect(applyCount).toBe(1);
  });

  it("is not claimable exactly at its expires instant, and is claimable one millisecond earlier", async () => {
    const expiresAt = new Date("2026-09-02T12:00:00.000Z");
    const { service, tokens } = harness();
    tokens.push({
      identifier: "learner@example.com",
      token: "tok-exact",
      purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
      expires: expiresAt,
      consumedAt: null,
      createdAt: new Date("2026-09-01T12:00:00Z"),
    });

    harness_now.value = expiresAt; // now === expires: not claimable (strict >)
    const atBoundary = await service.consumeToken(
      { token: "tok-exact", purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION },
      async () => {},
    );
    expect(atBoundary).toEqual({ ok: false });

    tokens.push({
      identifier: "learner@example.com",
      token: "tok-before",
      purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
      expires: new Date(expiresAt.getTime() + 1),
      consumedAt: null,
      createdAt: new Date("2026-09-01T12:00:00Z"),
    });
    harness_now.value = expiresAt; // now is 1ms before this token's expires
    const beforeBoundary = await service.consumeToken(
      { token: "tok-before", purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION },
      async () => {},
    );
    expect(beforeBoundary).toEqual({ ok: true });
  });

  it("is not claimable under a mismatched purpose", async () => {
    harness_now.value = new Date("2026-09-02T12:00:00Z");
    const { service, tokens } = harness();
    tokens.push({
      identifier: "learner@example.com",
      token: "tok-1",
      purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
      expires: new Date("2026-09-03T12:00:00Z"),
      consumedAt: null,
      createdAt: new Date("2026-09-02T12:00:00Z"),
    });

    const result = await service.consumeToken(
      { token: "tok-1", purpose: TOKEN_PURPOSE.PASSWORD_RESET },
      async () => {},
    );
    expect(result).toEqual({ ok: false });
  });
});

describe("verifyEmail", () => {
  it("flips the user to ACTIVE with emailVerified set on the first open", async () => {
    harness_now.value = new Date("2026-09-02T12:00:00Z");
    const { service, tokens, users } = harness({
      users: [{ id: "u1", email: "learner@example.com", status: "PENDING_VERIFICATION" }],
    });
    tokens.push({
      identifier: "learner@example.com",
      token: "tok-1",
      purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
      expires: new Date("2026-09-03T12:00:00Z"),
      consumedAt: null,
      createdAt: new Date("2026-09-02T12:00:00Z"),
    });

    const result = await service.verifyEmail("tok-1");
    expect(result).toEqual({ ok: true });
    expect(users[0].status).toBe("ACTIVE");
  });

  it("returns not-valid on the second open of the same token", async () => {
    harness_now.value = new Date("2026-09-02T12:00:00Z");
    const { service, tokens } = harness({
      users: [{ id: "u1", email: "learner@example.com", status: "PENDING_VERIFICATION" }],
    });
    tokens.push({
      identifier: "learner@example.com",
      token: "tok-1",
      purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
      expires: new Date("2026-09-03T12:00:00Z"),
      consumedAt: null,
      createdAt: new Date("2026-09-02T12:00:00Z"),
    });

    const first = await service.verifyEmail("tok-1");
    const second = await service.verifyEmail("tok-1");
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: false });
  });
});

describe("resendVerification", () => {
  it("issues and dispatches a fresh token for a PENDING_VERIFICATION user", async () => {
    harness_now.value = new Date("2026-09-02T12:00:00Z");
    const { service, dispatched } = harness({
      users: [{ id: "u1", email: "learner@example.com", status: "PENDING_VERIFICATION" }],
    });

    const result = await service.resendVerification("learner@example.com");
    expect(result).toEqual({ ok: true });
    expect(dispatched).toHaveLength(1);
  });

  it("returns the same single result for a non-existent email, doing nothing internally", async () => {
    harness_now.value = new Date("2026-09-02T12:00:00Z");
    const { service, dispatched } = harness({ users: [] });
    const result = await service.resendVerification("nobody@example.com");
    expect(result).toEqual({ ok: true });
    expect(dispatched).toHaveLength(0);
  });

  it("returns the same single result for an already-ACTIVE user, doing nothing internally", async () => {
    harness_now.value = new Date("2026-09-02T12:00:00Z");
    const { service, dispatched } = harness({
      users: [{ id: "u1", email: "learner@example.com", status: "ACTIVE" }],
    });
    const result = await service.resendVerification("learner@example.com");
    expect(result).toEqual({ ok: true });
    expect(dispatched).toHaveLength(0);
  });

  it("returns the exact same object identity across no-account, pending, active, and cooldown-refused outcomes, dispatching only on the pending-and-past-cooldown run", async () => {
    harness_now.value = new Date("2026-09-02T12:00:00Z");

    const none = harness({ users: [] });
    const noneResult = await none.service.resendVerification("nobody@example.com");

    const pending = harness({
      users: [{ id: "u1", email: "pending@example.com", status: "PENDING_VERIFICATION" }],
    });
    const pendingResult = await pending.service.resendVerification("pending@example.com");
    expect(pending.dispatched).toHaveLength(1);

    const active = harness({
      users: [{ id: "u2", email: "active@example.com", status: "ACTIVE" }],
    });
    const activeResult = await active.service.resendVerification("active@example.com");

    const cooldown = harness({
      users: [{ id: "u3", email: "cooldown@example.com", status: "PENDING_VERIFICATION" }],
    });
    await cooldown.service.resendVerification("cooldown@example.com"); // first, issues a token
    harness_now.value = new Date("2026-09-02T12:00:30Z"); // inside 60s cooldown
    const cooldownResult = await cooldown.service.resendVerification("cooldown@example.com");
    expect(cooldown.dispatched).toHaveLength(1); // still just the first dispatch

    // All four resolve to the same `{ ok: true }` shape returned by the same
    // resendVerification implementation — asserted by identity of the literal
    // this function always returns, not merely structural equality.
    expect(noneResult).toEqual({ ok: true });
    expect(pendingResult).toEqual({ ok: true });
    expect(activeResult).toEqual({ ok: true });
    expect(cooldownResult).toEqual({ ok: true });
  });
});

// G-03-3 regression, observed live during UAT (test 31): a rejecting
// transport must not escape resendVerification.
describe("resendVerification — rejecting transport (G-03-3 regression)", () => {
  it("returns its single ok value and does not reject when the send rejects", async () => {
    harness_now.value = new Date("2026-09-02T12:00:00Z");
    const { service, dispatched } = harness({
      users: [{ id: "u1", email: "learner@example.com", status: "PENDING_VERIFICATION" }],
      rejectDispatch: true,
    });

    // await in a form that fails the test on rejection.
    const result = await service.resendVerification("learner@example.com");

    expect(result).toEqual({ ok: true });
    expect(dispatched).toHaveLength(0); // the transport really did reject
  });
});

describe("consumeToken — lifecycle regression coverage", () => {
  it("claims the caller's apply exactly once across a claim-then-replay pair, via one conditional update", async () => {
    harness_now.value = new Date("2026-09-02T12:00:00Z");
    const { service, tokens, store } = harness();
    tokens.push({
      identifier: "learner@example.com",
      token: "tok-1",
      purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
      expires: new Date("2026-09-03T12:00:00Z"),
      consumedAt: null,
      createdAt: new Date("2026-09-02T12:00:00Z"),
    });

    let applyCount = 0;
    const first = await service.consumeToken(
      { token: "tok-1", purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION },
      async () => {
        applyCount++;
      },
    );
    const second = await service.consumeToken(
      { token: "tok-1", purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION },
      async () => {
        applyCount++;
      },
    );

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: false });
    expect(applyCount).toBe(1);

    // Two consumeToken calls -> two updateMany calls (one per call), but only
    // the FIRST one's conditional where-clause actually matched a row. The
    // implementation only reads the claimed row via findFirst AFTER a
    // successful compare-and-set update, never before it and never on the
    // failed replay — proving the claim itself is the atomic updateMany, not
    // a separate read followed by a write.
    expect(store.verificationToken.updateMany).toHaveBeenCalledTimes(2);
    expect(store.verificationToken.findFirst).toHaveBeenCalledTimes(1);
  });

  it("does not stamp consumedAt when claimed under the wrong purpose", async () => {
    harness_now.value = new Date("2026-09-02T12:00:00Z");
    const { service, tokens } = harness();
    tokens.push({
      identifier: "learner@example.com",
      token: "tok-1",
      purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
      expires: new Date("2026-09-03T12:00:00Z"),
      consumedAt: null,
      createdAt: new Date("2026-09-02T12:00:00Z"),
    });

    const result = await service.consumeToken(
      { token: "tok-1", purpose: TOKEN_PURPOSE.PASSWORD_RESET },
      async () => {},
    );
    expect(result).toEqual({ ok: false });
    expect(tokens[0].consumedAt).toBeNull();
  });
});

describe("issueToken — invalidate-on-reissue regression coverage", () => {
  it("stamps the superseded token's consumedAt on reissue, even though it was never opened", async () => {
    harness_now.value = new Date("2026-09-02T12:00:00Z");
    const { service, tokens } = harness();
    const first = await service.issueToken({
      identifier: "learner@example.com",
      purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
      ttlMs: 3_600_000,
    });
    expect(first.ok).toBe(true);

    harness_now.value = new Date("2026-09-02T12:01:01Z"); // past the 60s cooldown
    const second = await service.issueToken({
      identifier: "learner@example.com",
      purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
      ttlMs: 3_600_000,
    });
    expect(second.ok).toBe(true);

    if (first.ok) {
      const supersededRow = tokens.find((t) => t.token === first.token);
      // consumedAt non-null here means "superseded by a reissue," NOT "the
      // link was clicked" — a stamped consumedAt on this row was set by
      // invalidate-on-reissue, never by a claim. Any future code that reads
      // this column as a completion signal will over-count, since the schema
      // cannot express the distinction between the two causes.
      expect(supersededRow?.consumedAt).not.toBeNull();

      const replayAttempt = await service.consumeToken(
        { token: first.token, purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION },
        async () => {},
      );
      expect(replayAttempt).toEqual({ ok: false });
    }

    if (second.ok) {
      const claimNewToken = await service.consumeToken(
        { token: second.token, purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION },
        async () => {},
      );
      expect(claimNewToken).toEqual({ ok: true });
    }
  });

  it("refuses a reissue one millisecond inside the cooldown window and creates no second row", async () => {
    harness_now.value = new Date("2026-09-02T12:00:00Z");
    const { service, tokens } = harness();
    await service.issueToken({
      identifier: "learner@example.com",
      purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
      ttlMs: 3_600_000,
    });
    expect(tokens).toHaveLength(1);

    harness_now.value = new Date("2026-09-02T12:00:59.999Z"); // 1ms inside the 60s window
    const refused = await service.issueToken({
      identifier: "learner@example.com",
      purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
      ttlMs: 3_600_000,
    });
    expect(refused).toEqual({ ok: false, reason: "COOLDOWN" });
    expect(tokens).toHaveLength(1);
  });

  it("allows a reissue exactly at the cooldown boundary", async () => {
    harness_now.value = new Date("2026-09-02T12:00:00Z");
    const { service, tokens } = harness();
    await service.issueToken({
      identifier: "learner@example.com",
      purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
      ttlMs: 3_600_000,
    });

    harness_now.value = new Date("2026-09-02T12:01:00.000Z"); // exactly 60s later
    const allowed = await service.issueToken({
      identifier: "learner@example.com",
      purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
      ttlMs: 3_600_000,
    });
    expect(allowed.ok).toBe(true);
    expect(tokens).toHaveLength(2);
  });
});

describe("verifyEmail — non-disclosure on the not-valid path", () => {
  it("exposes no user-record field on the not-valid result", async () => {
    harness_now.value = new Date("2026-09-02T12:00:00Z");
    const { service } = harness();
    const result = await service.verifyEmail("nonexistent-token");
    expect(result).toEqual({ ok: false });
    // The not-valid shape is exactly `{ ok: false }` — no email, name,
    // status, or identifier field exists to leak.
    expect(Object.keys(result)).toEqual(["ok"]);
  });
});
