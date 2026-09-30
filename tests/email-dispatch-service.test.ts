import { describe, expect, it, vi } from "vitest";
import {
  createEmailDispatchService,
  dispatchBestEffort,
  computeNextAttemptAt,
  buildAuthCorrelationId,
  ResendNotAllowedError,
  type EmailDispatchRow,
  type EmailDispatchStore,
} from "@/server/services/email-dispatch-service";
import { RETRY_BACKOFF_MS, MAX_SEND_ATTEMPTS, TEMPLATE_CATEGORY } from "@/server/communications/contracts";
import type { TemplateId } from "@/server/communications/contracts";

const NOW = { value: new Date("2026-09-02T12:00:00Z") };

type FakeUser = { id: string; status: string };

/** An in-memory implementation of the full `EmailDispatchStore` contract —
 * exercised directly by every dispatch/sendQueued/resend unit test in this
 * file. The real transactional guarantees (SKIP LOCKED, CAS atomicity against
 * a real Postgres) are proven separately in
 * tests/email-dispatch.integration.test.ts; this fake only needs to model the
 * same observable state machine. */
function harness(options: { sendOk?: boolean; sendError?: unknown; classify?: "permanent" | "transient" } = {}) {
  const sendOk = options.sendOk ?? true;
  const rows: EmailDispatchRow[] = [];
  const users: FakeUser[] = [];
  const audits: { actorId: string; action: string; targetId: string | null; reason?: string | null }[] = [];
  let idCounter = 0;
  let auditShouldThrow = false;

  function findByKey(template: string, correlationId: string): EmailDispatchRow | undefined {
    return rows.find((r) => r.template === template && r.correlationId === correlationId);
  }

  const store: EmailDispatchStore = {
    emailDispatch: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const template = data.template as string;
        const correlationId = data.correlationId as string;
        if (findByKey(template, correlationId)) {
          const conflict = new Error("Unique constraint failed") as Error & { code?: string };
          conflict.code = "P2002";
          throw conflict;
        }
        const row: EmailDispatchRow = {
          id: `ed-${++idCounter}`,
          template,
          toEmail: data.toEmail as string,
          userId: (data.userId as string | null) ?? null,
          correlationId,
          status: data.status as string,
          providerMessageId: null,
          sentAt: null,
          failedAt: null,
          error: null,
          attempts: (data.attempts as number) ?? 0,
          lastAttemptAt: (data.lastAttemptAt as Date | undefined) ?? null,
          nextAttemptAt: (data.nextAttemptAt as Date | undefined) ?? null,
          templateParams: (data.templateParams as Record<string, unknown> | null) ?? null,
          resentCount: 0,
        };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error("row not found");
        Object.assign(row, data);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: { template_correlationId: { template: string; correlationId: string } } }) => {
        return findByKey(where.template_correlationId.template, where.template_correlationId.correlationId) ?? null;
      }),
    },

    claimDue: vi.fn(async ({ limit, now }: { limit: number; now: Date }) => {
      const due = rows
        .filter((r) => r.status === "QUEUED" && (r.nextAttemptAt === null || r.nextAttemptAt.getTime() <= now.getTime()))
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, limit);
      for (const row of due) {
        row.status = "SENDING";
        row.attempts += 1;
        row.lastAttemptAt = now;
      }
      return due;
    }),

    recoverStale: vi.fn(async ({ cutoff, now }: { cutoff: Date; now: Date }) => {
      let count = 0;
      for (const row of rows) {
        if (row.status === "SENDING" && row.lastAttemptAt && row.lastAttemptAt.getTime() <= cutoff.getTime()) {
          row.status = "QUEUED";
          row.nextAttemptAt = now;
          count++;
        }
      }
      return count;
    }),

    requeueForResend: vi.fn(async ({ id, actorId, reason, now }: { id: string; actorId: string; reason: string; now: Date }) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return { ok: false as const, reason: "NOT_FOUND" as const };
      if (row.status !== "FAILED" && row.status !== "SENT") return { ok: false as const, reason: "NOT_ELIGIBLE" as const };
      if (!row.templateParams) return { ok: false as const, reason: "NOT_ELIGIBLE" as const };
      if (TEMPLATE_CATEGORY[row.template as TemplateId] === "AUTH") return { ok: false as const, reason: "NOT_ELIGIBLE" as const };
      if (!row.userId) return { ok: false as const, reason: "NOT_ELIGIBLE" as const };
      const user = users.find((u) => u.id === row.userId);
      if (!user || user.status !== "ACTIVE") return { ok: false as const, reason: "NOT_ELIGIBLE" as const };

      // Simulate the same-transaction audit write and its rollback semantics:
      // a failing audit must leave the row exactly as it was.
      if (auditShouldThrow) {
        throw new Error("simulated audit failure");
      }
      audits.push({ actorId, action: "email.resent", targetId: id, reason });

      row.status = "QUEUED";
      row.attempts = 0;
      row.resentCount += 1;
      row.error = null;
      row.failedAt = null;
      row.nextAttemptAt = null;
      return { ok: true as const, row };
    }),
  };

  const sendCalls: { to: string; subject: string; textContent: string; htmlContent?: string; tags?: string[] }[] = [];

  const service = createEmailDispatchService({
    store,
    send: async (params) => {
      sendCalls.push(params);
      if (sendOk) return { providerMessageId: "provider-msg-1" };
      throw options.sendError ?? new Error("simulated provider failure");
    },
    describeFailure: () => "Brevo send failed (described).",
    classifyFailure: () => options.classify ?? "transient",
    render: (template, params) => ({
      subject: `Subject for ${String(template)}`,
      html: `<p>html ${JSON.stringify(params)}</p>`,
      text: `text ${JSON.stringify(params)}`,
    }),
    now: () => NOW.value,
  });

  return {
    service,
    store,
    rows,
    users,
    audits,
    sendCalls,
    setAuditShouldThrow: (v: boolean) => {
      auditShouldThrow = v;
    },
  };
}

describe("dispatch — success", () => {
  it("writes a SENDING row, then updates it to SENT with the provider message id and sentAt", async () => {
    const { service, rows } = harness({ sendOk: true });

    const result = await service.dispatch({
      template: "email-verification",
      toEmail: "learner@example.com",
      userId: "u1",
      subject: "Verify your account",
      textContent: "Click to verify: https://example.com/verify?token=tok-abc",
      htmlContent: "<p>Click to verify</p>",
      correlationId: "auth:corr-1",
    });

    expect(rows).toHaveLength(1);
    expect(result.status).toBe("SENT");
    expect(result.providerMessageId).toBe("provider-msg-1");
    expect(result.sentAt).toEqual(NOW.value);
    expect(result.failedAt).toBeNull();
    expect(result.error).toBeNull();
    expect(result.templateParams).toBeNull();
  });
});

describe("dispatch — stable-key deduplication (D-05, COM-02)", () => {
  it("a second dispatch under the same (template, correlationId) returns the existing row without a second send", async () => {
    const { service, rows, sendCalls } = harness({ sendOk: true });
    const correlationId = "auth:fixed-key-for-test";

    const first = await service.dispatch({
      template: "email-verification",
      toEmail: "learner@example.com",
      userId: "u1",
      subject: "Verify your account",
      textContent: "text",
      htmlContent: "<p>text</p>",
      correlationId,
    });
    const second = await service.dispatch({
      template: "email-verification",
      toEmail: "learner@example.com",
      userId: "u1",
      subject: "Verify your account",
      textContent: "text",
      htmlContent: "<p>text</p>",
      correlationId,
    });

    expect(rows).toHaveLength(1);
    expect(sendCalls).toHaveLength(1);
    expect(second).toEqual(first);
  });
});

describe("dispatch — failure (the FAILED-row-then-rethrow contract)", () => {
  it("updates the same row to FAILED with a failed-at stamp and the described error, and rethrows the original error", async () => {
    const originalError = new Error("simulated provider failure");
    const { service, rows } = harness({ sendOk: false, sendError: originalError });

    await expect(
      service.dispatch({
        template: "password-reset",
        toEmail: "learner@example.com",
        userId: "u1",
        subject: "Reset your password",
        textContent: "Click to reset your password: https://example.com/reset-password?token=tok-xyz",
        htmlContent: "<p>Click to reset</p>",
        correlationId: "auth:corr-failure-1",
      }),
    ).rejects.toBe(originalError);

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("FAILED");
    expect(rows[0].failedAt).toEqual(NOW.value);
    expect(rows[0].error).toBe("Brevo send failed (described).");
    expect(rows[0].providerMessageId).toBeNull();
  });

  it("never stores the raw error object or a token-shaped value in the row", async () => {
    const originalError = new Error("simulated provider failure carrying a secret token=do-not-store");
    const { service, rows } = harness({ sendOk: false, sendError: originalError });

    await expect(
      service.dispatch({
        template: "email-verification",
        toEmail: "learner@example.com",
        userId: "u1",
        subject: "Verify your account",
        textContent: "Click to verify: https://example.com/verify?token=tok-secret",
        htmlContent: "<p>Click to verify</p>",
        correlationId: "auth:corr-failure-2",
      }),
    ).rejects.toBe(originalError);

    expect(rows[0].error).toBe("Brevo send failed (described).");
    expect(rows[0].error).not.toContain("token=");
    expect(typeof rows[0].error).toBe("string");
  });

  it("writes the row before attempting the send, so a failed send still leaves an observability record", async () => {
    const { service, store, rows } = harness({ sendOk: false });

    await expect(
      service.dispatch({
        template: "email-change-confirmation",
        toEmail: "learner@example.com",
        userId: "u1",
        subject: "Confirm your new email address",
        textContent: "Click to confirm your new email address: https://example.com/confirm-email-change?token=tok-1",
        htmlContent: "<p>Click to confirm</p>",
        correlationId: "auth:corr-failure-3",
      }),
    ).rejects.toThrow();

    expect(store.emailDispatch.create).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
  });
});

describe("dispatchBestEffort", () => {
  it("resolves and reports the send did not happen when the wrapped dispatch rejects", async () => {
    const rejecting = vi.fn(async () => {
      throw new Error("simulated provider failure");
    });

    const result = await dispatchBestEffort(rejecting, {
      template: "password-reset",
      toEmail: "learner@example.com",
      userId: "u1",
      subject: "Reset your password",
      textContent: "Click to reset your password: https://example.com/reset-password?token=tok-1",
      htmlContent: "<p>Click to reset</p>",
      correlationId: "auth:corr-best-effort-1",
    });

    expect(result).toEqual({ sent: false });
    expect(rejecting).toHaveBeenCalledTimes(1);
  });

  it("resolves and reports success when the wrapped dispatch resolves", async () => {
    const resolving = vi.fn(async () => ({ id: "ed-1", status: "SENT" }));

    const result = await dispatchBestEffort(resolving, {
      template: "email-verification",
      toEmail: "learner@example.com",
      userId: "u1",
      subject: "Verify your account",
      textContent: "Click to verify: https://example.com/verify?token=tok-1",
      htmlContent: "<p>Click to verify</p>",
      correlationId: "auth:corr-best-effort-2",
    });

    expect(result).toEqual({ sent: true });
    expect(resolving).toHaveBeenCalledTimes(1);
  });

  it("against the real dispatch (not a re-implementation): a rejecting send resolves { sent: false } without rejecting", async () => {
    const { service } = harness({ sendOk: false });

    await expect(
      dispatchBestEffort(service.dispatch, {
        template: "email-verification",
        toEmail: "learner@example.com",
        userId: "u1",
        subject: "Verify your account",
        textContent: "Click to verify: https://example.com/verify?token=tok-1",
        htmlContent: "<p>Click to verify</p>",
        correlationId: "auth:corr-best-effort-3",
      }),
    ).resolves.toEqual({ sent: false });
  });
});

describe("buildAuthCorrelationId", () => {
  it("is deterministic for the same token and never contains the raw token", () => {
    const a = buildAuthCorrelationId("raw-token-value");
    const b = buildAuthCorrelationId("raw-token-value");
    expect(a).toBe(b);
    expect(a.startsWith("auth:")).toBe(true);
    expect(a).not.toContain("raw-token-value");
  });

  it("differs for different tokens", () => {
    expect(buildAuthCorrelationId("token-a")).not.toBe(buildAuthCorrelationId("token-b"));
  });
});

describe("computeNextAttemptAt", () => {
  it("indexes RETRY_BACKOFF_MS by attemptsAfterFailure (1-based)", () => {
    const base = new Date("2026-09-02T12:00:00Z");
    expect(computeNextAttemptAt(base, 1).getTime()).toBe(base.getTime() + RETRY_BACKOFF_MS[0]);
    expect(computeNextAttemptAt(base, 2).getTime()).toBe(base.getTime() + RETRY_BACKOFF_MS[1]);
    expect(computeNextAttemptAt(base, 3).getTime()).toBe(base.getTime() + RETRY_BACKOFF_MS[2]);
    expect(computeNextAttemptAt(base, 4).getTime()).toBe(base.getTime() + RETRY_BACKOFF_MS[3]);
  });
});

function queueRow(rows: EmailDispatchRow[], overrides: Partial<EmailDispatchRow> = {}): EmailDispatchRow {
  const row: EmailDispatchRow = {
    id: overrides.id ?? `ed-${rows.length + 1}`,
    template: "enrolment-confirmed",
    toEmail: "learner@example.com",
    userId: "u1",
    correlationId: `corr-${rows.length + 1}`,
    status: "QUEUED",
    providerMessageId: null,
    sentAt: null,
    failedAt: null,
    error: null,
    attempts: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    templateParams: { foo: "bar" },
    resentCount: 0,
    ...overrides,
  };
  rows.push(row);
  return row;
}

describe("sendQueued — claiming", () => {
  it("claims a due row (nextAttemptAt null) and not one whose nextAttemptAt is one millisecond in the future", async () => {
    const { service, rows } = harness({ sendOk: true });
    queueRow(rows, { id: "due", nextAttemptAt: null });
    queueRow(rows, { id: "future", nextAttemptAt: new Date(NOW.value.getTime() + 1) });

    const result = await service.sendQueued({ limit: 10 });
    expect(result.sent).toBe(1);
    expect(rows.find((r) => r.id === "due")?.status).toBe("SENT");
    expect(rows.find((r) => r.id === "future")?.status).toBe("QUEUED");
  });

  it("claims a row whose nextAttemptAt equals now exactly", async () => {
    const { service, rows } = harness({ sendOk: true });
    queueRow(rows, { id: "exact", nextAttemptAt: NOW.value });

    const result = await service.sendQueued({ limit: 10 });
    expect(result.sent).toBe(1);
    expect(rows[0].status).toBe("SENT");
  });
});

describe("sendQueued — success", () => {
  it("sets SENT with providerMessageId and sentAt, clearing error and nextAttemptAt", async () => {
    const { service, rows } = harness({ sendOk: true });
    queueRow(rows, { id: "r1", error: "stale", nextAttemptAt: null });

    await service.sendQueued({ limit: 10 });
    const row = rows[0];
    expect(row.status).toBe("SENT");
    expect(row.providerMessageId).toBe("provider-msg-1");
    expect(row.sentAt).toEqual(NOW.value);
    expect(row.error).toBeNull();
    expect(row.nextAttemptAt).toBeNull();
  });
});

describe("sendQueued — retry and backoff schedule", () => {
  it("requeues at attempts 1..4 with the exact backoff delay, and sets FAILED at attempt 5", async () => {
    const { service, rows } = harness({ sendOk: false, classify: "transient" });
    queueRow(rows, { id: "r1", nextAttemptAt: null });

    for (let attempt = 1; attempt <= 4; attempt++) {
      await service.sendQueued({ limit: 10 });
      const row = rows[0];
      expect(row.status).toBe("QUEUED");
      expect(row.attempts).toBe(attempt);
      expect(row.nextAttemptAt?.getTime()).toBe(NOW.value.getTime() + RETRY_BACKOFF_MS[attempt - 1]);
      // Make the row due again for the next claim.
      row.nextAttemptAt = NOW.value;
    }

    await service.sendQueued({ limit: 10 });
    const row = rows[0];
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(MAX_SEND_ATTEMPTS);
    expect(row.failedAt).toEqual(NOW.value);
  });

  it("sets FAILED immediately, with no requeue, on a permanent failure at attempt 1", async () => {
    const { service, rows } = harness({ sendOk: false, classify: "permanent" });
    queueRow(rows, { id: "r1", nextAttemptAt: null });

    await service.sendQueued({ limit: 10 });
    const row = rows[0];
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt).toBeNull();
  });

  it("stores only the describeFailure text — never the recipient address or a provider detail string", async () => {
    const { service, rows } = harness({ sendOk: false, classify: "permanent" });
    queueRow(rows, { id: "r1", toEmail: "secret-recipient@example.com" });

    await service.sendQueued({ limit: 10 });
    expect(rows[0].error).toBe("Brevo send failed (described).");
    expect(rows[0].error).not.toContain("secret-recipient@example.com");
  });
});

describe("sendQueued — render and templateParams failures", () => {
  it("sets FAILED with a generic classification, not a retry, when templateParams is missing", async () => {
    const { service, rows } = harness({ sendOk: true });
    queueRow(rows, { id: "r1", templateParams: null });

    const result = await service.sendQueued({ limit: 10 });
    expect(result.failed).toHaveLength(1);
    expect(rows[0].status).toBe("FAILED");
    expect(rows[0].attempts).toBe(1);
  });

  it("sets FAILED with a generic classification when the render step throws", async () => {
    const rows: EmailDispatchRow[] = [];
    queueRow(rows, { id: "r1" });
    // A dedicated service instance whose `render` dependency always throws,
    // isolating the render-failure branch from the send-failure branch.
    const throwingService = createServiceWithThrowingRender(rows);
    const result = await throwingService.sendQueued({ limit: 10 });
    expect(result.failed).toHaveLength(1);
    expect(rows[0].status).toBe("FAILED");
  });
});

// A second service instance sharing the same `rows` fake but whose `render`
// dependency always throws — isolates the render-failure branch from the
// send-failure branch without adding a third harness() knob.
function createServiceWithThrowingRender(rows: EmailDispatchRow[]) {
  const store: EmailDispatchStore = {
    emailDispatch: {
      create: async () => {
        throw new Error("not used in this test");
      },
      update: async ({ where, data }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error("row not found");
        Object.assign(row, data);
        return row;
      },
      findUnique: async () => null,
    },
    claimDue: async ({ limit, now }) => {
      const due = rows.filter((r) => r.status === "QUEUED").slice(0, limit);
      for (const row of due) {
        row.status = "SENDING";
        row.attempts += 1;
        row.lastAttemptAt = now;
      }
      return due;
    },
    recoverStale: async () => 0,
    requeueForResend: async () => ({ ok: false, reason: "NOT_ELIGIBLE" }),
  };
  return createEmailDispatchService({
    store,
    send: async () => ({ providerMessageId: "unused" }),
    describeFailure: () => "unused",
    render: () => {
      throw new Error("render exploded");
    },
    now: () => NOW.value,
  });
}

describe("sendQueued — stale recovery", () => {
  it("recovers a SENDING row whose lastAttemptAt is exactly 10 minutes old, and leaves a 9m59s row alone", async () => {
    const { service, rows } = harness({ sendOk: true });
    const staleCutoff = new Date(NOW.value.getTime() - 10 * 60 * 1000);
    queueRow(rows, { id: "stale", status: "SENDING", lastAttemptAt: staleCutoff, templateParams: { foo: "bar" } });
    queueRow(rows, {
      id: "fresh",
      status: "SENDING",
      lastAttemptAt: new Date(staleCutoff.getTime() + 1000),
      templateParams: { foo: "bar" },
    });

    const result = await service.sendQueued({ limit: 10 });
    expect(result.recovered).toBe(1);
    // The recovered row is due immediately (nextAttemptAt=now) and gets
    // claimed and sent in the same pass.
    expect(rows.find((r) => r.id === "stale")?.status).toBe("SENT");
    expect(rows.find((r) => r.id === "fresh")?.status).toBe("SENDING");
  });
});

describe("sendQueued — one row's failure never stops the batch", () => {
  it("processes every claimed row even when a store write throws unexpectedly for one of them", async () => {
    const { service, rows, store } = harness({ sendOk: true });
    queueRow(rows, { id: "ok-1" });
    // Missing templateParams routes straight to a FAILED write with no send
    // attempt — the write itself is not already inside a failure-handling
    // catch, so forcing it to throw exercises the outer per-row guard.
    queueRow(rows, { id: "boom", templateParams: null });
    queueRow(rows, { id: "ok-2" });

    const originalUpdate = store.emailDispatch.update;
    store.emailDispatch.update = vi.fn(async (args) => {
      if (args.where.id === "boom") {
        throw new Error("simulated store failure");
      }
      return originalUpdate(args);
    });

    const result = await service.sendQueued({ limit: 10 });
    expect(result.sent).toBe(2);
    expect(result.failed.map((f) => f.id)).toEqual(["boom"]);
  });
});

describe("resend — eligibility", () => {
  it("refuses an unknown id", async () => {
    const { service } = harness();
    await expect(service.resend({ dispatchId: "nope", actorId: "staff-1", reason: "customer asked" })).rejects.toBeInstanceOf(
      ResendNotAllowedError,
    );
  });

  it.each(["QUEUED", "SENDING", "SKIPPED"])("refuses a %s row", async (status) => {
    const { service, rows, users } = harness();
    users.push({ id: "u1", status: "ACTIVE" });
    queueRow(rows, { id: "r1", status, template: "enrolment-confirmed" });
    await expect(service.resend({ dispatchId: "r1", actorId: "staff-1", reason: "x" })).rejects.toBeInstanceOf(
      ResendNotAllowedError,
    );
  });

  it("refuses an auth-category template", async () => {
    const { service, rows, users } = harness();
    users.push({ id: "u1", status: "ACTIVE" });
    queueRow(rows, { id: "r1", status: "FAILED", template: "email-verification" });
    await expect(service.resend({ dispatchId: "r1", actorId: "staff-1", reason: "x" })).rejects.toBeInstanceOf(
      ResendNotAllowedError,
    );
  });

  it("refuses a row with null templateParams", async () => {
    const { service, rows, users } = harness();
    users.push({ id: "u1", status: "ACTIVE" });
    queueRow(rows, { id: "r1", status: "FAILED", templateParams: null });
    await expect(service.resend({ dispatchId: "r1", actorId: "staff-1", reason: "x" })).rejects.toBeInstanceOf(
      ResendNotAllowedError,
    );
  });

  it("refuses when the recipient's user is not ACTIVE", async () => {
    const { service, rows, users } = harness();
    users.push({ id: "u1", status: "DEACTIVATED" });
    queueRow(rows, { id: "r1", status: "FAILED" });
    await expect(service.resend({ dispatchId: "r1", actorId: "staff-1", reason: "x" })).rejects.toBeInstanceOf(
      ResendNotAllowedError,
    );
  });

  it("resend of a SENT row with an ACTIVE recipient sets QUEUED, resentCount 1, and writes one audit row with the actor and reason", async () => {
    const { service, rows, users, audits } = harness();
    users.push({ id: "u1", status: "ACTIVE" });
    queueRow(rows, { id: "r1", status: "SENT" });

    const result = await service.resend({ dispatchId: "r1", actorId: "staff-1", reason: "customer requested a copy" });
    expect(result.status).toBe("QUEUED");
    expect(result.resentCount).toBe(1);
    expect(result.attempts).toBe(0);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorId: "staff-1", reason: "customer requested a copy", targetId: "r1" });
  });

  it("a failing audit rolls back the requeue (atomicity)", async () => {
    const { service, rows, users, setAuditShouldThrow } = harness();
    users.push({ id: "u1", status: "ACTIVE" });
    queueRow(rows, { id: "r1", status: "FAILED" });
    setAuditShouldThrow(true);

    await expect(service.resend({ dispatchId: "r1", actorId: "staff-1", reason: "x" })).rejects.toThrow(
      "simulated audit failure",
    );
    // The row must be unchanged — a real Postgres transaction rolls the
    // status/attempts/resentCount update back along with the audit write.
    expect(rows[0].status).toBe("FAILED");
    expect(rows[0].resentCount).toBe(0);
  });
});
