import { describe, expect, it, vi } from "vitest";
import {
  createEmailDispatchService,
  dispatchBestEffort,
  type EmailDispatchRow,
  type EmailDispatchStore,
} from "@/server/services/email-dispatch-service";

const NOW = { value: new Date("2026-09-02T12:00:00Z") };

/** The first test for this module — every send in the phase runs through
 * `dispatch`, but until this file it had no direct coverage of its own
 * FAILED-row-then-rethrow contract. */
function harness(options: { sendOk?: boolean; sendError?: unknown } = {}) {
  const sendOk = options.sendOk ?? true;
  const rows: EmailDispatchRow[] = [];
  let idCounter = 0;

  const store: EmailDispatchStore = {
    emailDispatch: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `ed-${++idCounter}`,
          template: data.template as string,
          toEmail: data.toEmail as string,
          userId: (data.userId as string | null) ?? null,
          correlationId: data.correlationId as string,
          status: data.status as string,
          providerMessageId: null,
          sentAt: null,
          failedAt: null,
          error: null,
        } satisfies EmailDispatchRow;
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error("row not found");
        Object.assign(row, data);
        return row;
      }),
    },
  };

  const sendCalls: { to: string; subject: string; textContent: string }[] = [];

  const service = createEmailDispatchService({
    store,
    send: async (params) => {
      sendCalls.push(params);
      if (sendOk) return { providerMessageId: "provider-msg-1" };
      throw options.sendError ?? new Error("simulated provider failure");
    },
    describeFailure: () => "Brevo send failed (described).",
    now: () => NOW.value,
  });

  return { service, store, rows, sendCalls };
}

describe("dispatch — success", () => {
  it("writes a QUEUED row, then updates it to SENT with the provider message id and sentAt", async () => {
    const { service, rows } = harness({ sendOk: true });

    const result = await service.dispatch({
      template: "email-verification",
      toEmail: "learner@example.com",
      userId: "u1",
      subject: "Verify your account",
      textContent: "Click to verify: https://example.com/verify?token=tok-abc",
    });

    expect(rows).toHaveLength(1);
    expect(result.status).toBe("SENT");
    expect(result.providerMessageId).toBe("provider-msg-1");
    expect(result.sentAt).toEqual(NOW.value);
    expect(result.failedAt).toBeNull();
    expect(result.error).toBeNull();
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
      }),
    ).rejects.toBe(originalError); // the very same object, not a wrapper — Phase 13 will branch on its class

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
      }),
    ).rejects.toBe(originalError);

    // The row's `error` column is the fixed describeFailure() string, never
    // the raw Error object and never a value resembling a link token.
    expect(rows[0].error).toBe("Brevo send failed (described).");
    expect(rows[0].error).not.toContain("token=");
    expect(typeof rows[0].error).toBe("string");
  });

  it("writes the QUEUED row before attempting the send, so a failed send still leaves an observability record", async () => {
    const { service, store, rows } = harness({ sendOk: false });

    await expect(
      service.dispatch({
        template: "email-change-confirmation",
        toEmail: "learner@example.com",
        userId: "u1",
        subject: "Confirm your new email address",
        textContent: "Click to confirm your new email address: https://example.com/confirm-email-change?token=tok-1",
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
      }),
    ).resolves.toEqual({ sent: false });
  });
});
