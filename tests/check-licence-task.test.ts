/**
 * `check-licence-task.ts` — the hourly licence evaluation (plan 14-16, LIC-04,
 * LIC-07, D-15, D-16). Mirrors `cleanup-notifications-task.test.ts`: the
 * injected-deps factory is exercised with fakes, never a database.
 */

import { describe, expect, it, vi } from "vitest";
import { createCheckLicenceTask } from "@/server/scheduled/check-licence-task";
import type { LicenceStatusSnapshot } from "@/server/licence/types";

/**
 * A snapshot that carries every sensitive value the log line must never
 * contain: the client name, key id, licence id, deployment id and support
 * emails (T-14-16-03).
 */
function fakeSnapshot(state: LicenceStatusSnapshot["state"] = "GRACE"): LicenceStatusSnapshot {
  return {
    state,
    reasonCode: null,
    isRestricted: false,
    everActivated: true,
    licenceId: "lic-secret-0001",
    keyId: "kid-secret-key",
    schemaVersion: 1,
    clientName: "Acme Confidential Academy",
    deploymentId: "deployment-secret-id",
    issuedAt: new Date("2026-01-01T00:00:00.000Z"),
    notBefore: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: new Date("2026-10-01T00:00:00.000Z"),
    graceEndsAt: new Date("2026-10-15T00:00:00.000Z"),
    timeZone: "Africa/Lagos",
    support: {
      renewalEmail: "renewals@acme-secret.example",
      supportEmail: "help@acme-secret.example",
    },
    restrictedAt: null,
    daysRemaining: null,
    daysToGraceEnd: 12,
    underOneDay: false,
    lastVerifiedAt: new Date("2026-10-02T00:00:00.000Z"),
    lastVerificationOutcome: "OK",
    attentionSince: null,
    clockAlertAt: null,
    highWaterAt: new Date("2026-10-02T00:00:00.000Z"),
    evaluatedAt: new Date("2026-10-02T00:00:00.000Z"),
  } as unknown as LicenceStatusSnapshot;
}

describe("check-licence scheduled task", () => {
  it("evaluates once with source SCHEDULED, emits the returned notices once, and logs only the state code and counts", async () => {
    const snapshot = fakeSnapshot("GRACE");
    const evaluateAndRecord = vi.fn(async (options: { source: "SCHEDULED" }) => {
      void options;
      return {
        snapshot,
        transitions: [{ from: "ACTIVE", to: "GRACE", won: true }],
        noticeKeys: ["grace-started"],
      };
    });
    const emitNotices = vi.fn(async (input: { snapshot: LicenceStatusSnapshot; noticeKeys: string[] }) => {
      void input;
      return { created: ["licence:lic-secret-0001:grace-started"], skipped: [] as string[] };
    });
    const log = vi.fn();
    const run = createCheckLicenceTask({ evaluateAndRecord, emitNotices, log });

    await run();

    expect(evaluateAndRecord).toHaveBeenCalledTimes(1);
    expect(evaluateAndRecord).toHaveBeenCalledWith({ source: "SCHEDULED" });
    expect(emitNotices).toHaveBeenCalledTimes(1);
    expect(emitNotices).toHaveBeenCalledWith({ snapshot, noticeKeys: ["grace-started"] });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      "[scheduled] licence check: state=GRACE transitions=1 notices=1 skipped=0",
    );
  });

  it("does not call emitNotices when there are no notice keys and reports notices=0", async () => {
    const emitNotices = vi.fn(async () => ({ created: [] as string[], skipped: [] as string[] }));
    const log = vi.fn();
    const run = createCheckLicenceTask({
      evaluateAndRecord: vi.fn(async () => ({
        snapshot: fakeSnapshot("ACTIVE"),
        transitions: [],
        noticeKeys: [] as string[],
      })),
      emitNotices,
      log,
    });

    await run();

    expect(emitNotices).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "[scheduled] licence check: state=ACTIVE transitions=0 notices=0 skipped=0",
    );
  });

  it("counts skipped (already emitted) notices separately so a repeat run reports created=0", async () => {
    const log = vi.fn();
    const run = createCheckLicenceTask({
      evaluateAndRecord: vi.fn(async () => ({
        snapshot: fakeSnapshot("GRACE"),
        transitions: [],
        noticeKeys: ["grace-started"],
      })),
      emitNotices: vi.fn(async () => ({
        created: [] as string[],
        skipped: ["licence:lic-secret-0001:grace-started"],
      })),
      log,
    });

    await run();

    expect(log).toHaveBeenCalledWith(
      "[scheduled] licence check: state=GRACE transitions=0 notices=0 skipped=1",
    );
  });

  it("propagates a rejected evaluation and never emits notices", async () => {
    const emitNotices = vi.fn(async () => ({ created: [] as string[], skipped: [] as string[] }));
    const log = vi.fn();
    const run = createCheckLicenceTask({
      evaluateAndRecord: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
      emitNotices,
      log,
    });

    await expect(run()).rejects.toThrow("database unavailable");
    expect(emitNotices).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("logs no licence text, key id, licence id, client name or email (T-14-16-03)", async () => {
    const log = vi.fn();
    const run = createCheckLicenceTask({
      evaluateAndRecord: vi.fn(async () => ({
        snapshot: fakeSnapshot("GRACE"),
        transitions: [{ from: "ACTIVE" as const, to: "GRACE" as const, won: true }],
        noticeKeys: ["grace-started"],
      })),
      emitNotices: vi.fn(async () => ({
        created: ["licence:lic-secret-0001:grace-started"],
        skipped: [] as string[],
      })),
      log,
    });

    await run();

    const logged = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).not.toContain("Acme Confidential Academy");
    expect(logged).not.toContain("kid-secret-key");
    expect(logged).not.toContain("lic-secret-0001");
    expect(logged).not.toContain("deployment-secret-id");
    expect(logged).not.toContain("acme-secret.example");
    expect(logged).toMatch(/^\[scheduled\] licence check: state=[A-Z_]+ transitions=\d+ notices=\d+ skipped=\d+$/);
  });
});
