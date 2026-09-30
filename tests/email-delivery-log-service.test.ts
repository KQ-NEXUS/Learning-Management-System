import { describe, expect, it, vi } from "vitest";
import { createWithPermission, type RawGrant } from "@/server/permissions/with-permission";
import {
  createEmailDeliveryLogService,
  buildEmailDeliveryLogWhere,
  EMAIL_LOG_PAGE_LIMIT,
  ResendNotAllowedError,
  type EmailDeliveryLogStore,
  type RawEmailDispatchRow,
} from "@/server/services/email-delivery-log-service";
import type { EmailDispatchRow } from "@/server/services/email-dispatch-service";

const grant = (
  permission: string,
  scopeType: RawGrant["scopeType"] = "GLOBAL",
  scopeId: string | null = null,
): RawGrant => ({
  permission: permission as RawGrant["permission"],
  scopeType,
  scopeId,
  active: true,
  revokedAt: null,
  startsAt: null,
  endsAt: null,
});

function makeRawRow(overrides: Partial<RawEmailDispatchRow> = {}): RawEmailDispatchRow {
  return {
    id: "ed-1",
    template: "enrolment-confirmed",
    toEmail: "learner@example.test",
    status: "FAILED",
    attempts: 2,
    nextAttemptAt: null,
    error: "provider_rejected",
    skipReason: null,
    createdAt: new Date("2026-09-20T10:00:00Z"),
    sentAt: null,
    providerMessageId: null,
    templateParams: { foo: "bar" },
    ...overrides,
  };
}

function harness(options: {
  grants?: RawGrant[];
  rows?: RawEmailDispatchRow[];
  resendResult?: EmailDispatchRow;
  resendError?: unknown;
} = {}) {
  const grants = options.grants ?? [grant("audit.view"), grant("users.manage")];
  const rows = options.rows ?? [makeRawRow()];

  const store: EmailDeliveryLogStore = {
    emailDispatch: {
      findMany: vi.fn(async () => rows),
    },
  };

  const resendDispatch = vi.fn(async () => {
    if (options.resendError) throw options.resendError;
    return (
      options.resendResult ?? {
        id: "ed-1",
        template: "enrolment-confirmed",
        toEmail: "learner@example.test",
        userId: "user-1",
        correlationId: "corr-1",
        status: "QUEUED",
        providerMessageId: null,
        sentAt: null,
        failedAt: null,
        error: null,
        attempts: 0,
        lastAttemptAt: null,
        nextAttemptAt: null,
        templateParams: { foo: "bar" },
        resentCount: 1,
      }
    );
  });

  const withPermission = createWithPermission({
    getActor: async () => ({ userId: "actor-1" }),
    loadGrants: async () => grants,
    audit: async () => {},
  });

  const service = createEmailDeliveryLogService({ store, withPermission, resendDispatch });

  return { service, store, resendDispatch };
}

describe("buildEmailDeliveryLogWhere", () => {
  it("returns an object with no keys for an empty filter", () => {
    expect(Object.keys(buildEmailDeliveryLogWhere({}))).toEqual([]);
  });

  it("sets a status key when supplied", () => {
    expect(buildEmailDeliveryLogWhere({ status: "FAILED" })).toEqual({ status: "FAILED" });
  });

  it("sets a template key when supplied", () => {
    expect(buildEmailDeliveryLogWhere({ template: "ticket-created" })).toEqual({
      template: "ticket-created",
    });
  });

  it("sets both keys when both are supplied", () => {
    expect(buildEmailDeliveryLogWhere({ status: "SENT", template: "ticket-created" })).toEqual({
      status: "SENT",
      template: "ticket-created",
    });
  });
});

describe("listDispatches", () => {
  it("refuses without an audit.view grant", async () => {
    const { service, store } = harness({ grants: [grant("users.manage")] });
    await expect(service.listDispatches()).rejects.toThrow();
    expect(store.emailDispatch.findMany).not.toHaveBeenCalled();
  });

  it("orders newest first and caps at EMAIL_LOG_PAGE_LIMIT", async () => {
    const { service, store } = harness();
    await service.listDispatches();
    expect(store.emailDispatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" }, take: EMAIL_LOG_PAGE_LIMIT }),
    );
  });

  it("never includes templateParams in the projected rows", async () => {
    const { service } = harness();
    const rows = await service.listDispatches();
    expect(rows[0]).not.toHaveProperty("templateParams");
  });

  it("marks a row whose providerMessageId starts with stub: as a stub delivery", async () => {
    const { service } = harness({ rows: [makeRawRow({ providerMessageId: "stub:abc123" })] });
    const rows = await service.listDispatches();
    expect(rows[0].isStub).toBe(true);
  });

  it("does not mark a real provider message id as a stub", async () => {
    const { service } = harness({ rows: [makeRawRow({ providerMessageId: "brevo-real-id" })] });
    const rows = await service.listDispatches();
    expect(rows[0].isStub).toBe(false);
  });

  describe("canResend matrix", () => {
    it("is true for a FAILED, non-auth, known-template row with stored params", async () => {
      const { service } = harness({ rows: [makeRawRow({ status: "FAILED" })] });
      expect((await service.listDispatches())[0].canResend).toBe(true);
    });

    it("is true for a SENT row with stored params", async () => {
      const { service } = harness({ rows: [makeRawRow({ status: "SENT" })] });
      expect((await service.listDispatches())[0].canResend).toBe(true);
    });

    it("is false for an AUTH-category template", async () => {
      const { service } = harness({ rows: [makeRawRow({ template: "password-reset" })] });
      expect((await service.listDispatches())[0].canResend).toBe(false);
    });

    it("is false for a SKIPPED row", async () => {
      const { service } = harness({ rows: [makeRawRow({ status: "SKIPPED", skipReason: "muted_by_recipient" })] });
      expect((await service.listDispatches())[0].canResend).toBe(false);
    });

    it("is false for a QUEUED row", async () => {
      const { service } = harness({ rows: [makeRawRow({ status: "QUEUED" })] });
      expect((await service.listDispatches())[0].canResend).toBe(false);
    });

    it("is false for a SENDING row", async () => {
      const { service } = harness({ rows: [makeRawRow({ status: "SENDING" })] });
      expect((await service.listDispatches())[0].canResend).toBe(false);
    });

    it("is false when templateParams is null", async () => {
      const { service } = harness({ rows: [makeRawRow({ templateParams: null })] });
      expect((await service.listDispatches())[0].canResend).toBe(false);
    });

    it("is false for an unknown/legacy template id", async () => {
      const { service } = harness({ rows: [makeRawRow({ template: "order-confirmation" })] });
      expect((await service.listDispatches())[0].canResend).toBe(false);
    });
  });
});

describe("resendDispatch", () => {
  it("refuses without a users.manage grant, even with audit.view", async () => {
    const { service, resendDispatch } = harness({ grants: [grant("audit.view")] });
    await expect(
      service.resendDispatch({ dispatchId: "ed-1", reason: "a valid reason" }),
    ).rejects.toThrow();
    expect(resendDispatch).not.toHaveBeenCalled();
  });

  it("rejects a 9-character reason and never calls the dispatch service", async () => {
    const { service, resendDispatch } = harness();
    await expect(
      service.resendDispatch({ dispatchId: "ed-1", reason: "123456789" }),
    ).rejects.toThrow(ResendNotAllowedError);
    expect(resendDispatch).not.toHaveBeenCalled();
  });

  it("accepts a 10-character reason and calls the dispatch service with the trimmed reason and the authorised actor id", async () => {
    const { service, resendDispatch } = harness();
    await service.resendDispatch({ dispatchId: "ed-1", reason: "  1234567890  " });
    expect(resendDispatch).toHaveBeenCalledWith({
      dispatchId: "ed-1",
      actorId: "actor-1",
      reason: "1234567890",
    });
  });

  it("propagates ResendNotAllowedError from the underlying dispatch service unchanged", async () => {
    const { service } = harness({ resendError: new ResendNotAllowedError() });
    await expect(
      service.resendDispatch({ dispatchId: "ed-1", reason: "a valid reason" }),
    ).rejects.toThrow(ResendNotAllowedError);
  });
});
