/**
 * Best-effort startup licence check and the `instrumentation.ts` hook (plan
 * 14-16, LIC-04, T-14-16-01). The check must never throw and never delay boot
 * past its bound; `register()` must never reject.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LicenceStatusSnapshot } from "@/server/licence/types";

const startupHarness = vi.hoisted(() => ({
  factoryRuns: 0,
  runStartupLicenceCheck: vi.fn(async () => ({ status: "ok" as const })),
}));

// The factory only runs when something imports the mocked module, so
// `factoryRuns` proves whether `register()` imported the startup service.
vi.mock("@/server/services/licence-startup-service", () => {
  startupHarness.factoryRuns += 1;
  return { runStartupLicenceCheck: startupHarness.runStartupLicenceCheck };
});

type StartupModule = typeof import("@/server/services/licence-startup-service");
let runLicenceStartupCheck: StartupModule["runLicenceStartupCheck"];

const snapshot = { state: "ACTIVE" } as unknown as LicenceStatusSnapshot;

describe("runLicenceStartupCheck", () => {
  beforeAll(async () => {
    // The real module, bypassing the mock the register() tests below rely on.
    ({ runLicenceStartupCheck } = await vi.importActual<StartupModule>(
      "@/server/services/licence-startup-service",
    ));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves ok when evaluation and emission succeed, evaluating with source STARTUP", async () => {
    const evaluateAndRecord = vi.fn(async (options: { source: "STARTUP" }) => {
      void options;
      return { snapshot, transitions: [], noticeKeys: ["expiring-60"] };
    });
    const emitNotices = vi.fn(async () => ({ created: ["x"], skipped: [] as string[] }));
    const log = vi.fn();

    const result = await runLicenceStartupCheck({ evaluateAndRecord, emitNotices, log });

    expect(result).toEqual({ status: "ok" });
    expect(evaluateAndRecord).toHaveBeenCalledTimes(1);
    expect(evaluateAndRecord).toHaveBeenCalledWith({ source: "STARTUP" });
    expect(emitNotices).toHaveBeenCalledWith({ snapshot, noticeKeys: ["expiring-60"] });
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("status=ok");
  });

  it("does not emit when no notice keys are due", async () => {
    const emitNotices = vi.fn(async () => ({ created: [] as string[], skipped: [] as string[] }));
    const result = await runLicenceStartupCheck({
      evaluateAndRecord: vi.fn(async () => ({ snapshot, transitions: [], noticeKeys: [] as string[] })),
      emitNotices,
      log: vi.fn(),
    });

    expect(result).toEqual({ status: "ok" });
    expect(emitNotices).not.toHaveBeenCalled();
  });

  it("resolves error and never rejects when evaluation rejects, logging only the error name", async () => {
    const log = vi.fn();
    const failure = new Error("connect ECONNREFUSED postgres://user:secret@db/lms");
    failure.name = "PrismaClientInitializationError";

    const result = await runLicenceStartupCheck({
      evaluateAndRecord: vi.fn(async () => {
        throw failure;
      }),
      emitNotices: vi.fn(async () => ({ created: [] as string[], skipped: [] as string[] })),
      log,
    });

    expect(result).toEqual({ status: "error" });
    const logged = String(log.mock.calls[0][0]);
    expect(logged).toContain("status=error");
    expect(logged).toContain("PrismaClientInitializationError");
    expect(logged).not.toContain("secret");
    expect(logged).not.toContain("ECONNREFUSED");
  });

  it("resolves error when notice emission rejects", async () => {
    const result = await runLicenceStartupCheck({
      evaluateAndRecord: vi.fn(async () => ({ snapshot, transitions: [], noticeKeys: ["expiring-60"] })),
      emitNotices: vi.fn(async () => {
        throw new TypeError("boom");
      }),
      log: vi.fn(),
    });

    expect(result).toEqual({ status: "error" });
  });

  it("resolves timeout at exactly timeoutMs (default 3000) and does not wait further", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const evaluateAndRecord = vi.fn(() => new Promise<never>(() => undefined));
    let settled: { status: string } | null = null;

    const pending = runLicenceStartupCheck({
      evaluateAndRecord,
      emitNotices: vi.fn(async () => ({ created: [] as string[], skipped: [] as string[] })),
      log,
    }).then((value) => {
      settled = value;
      return value;
    });

    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toEqual({ status: "timeout" });
    await expect(pending).resolves.toEqual({ status: "timeout" });
    expect(String(log.mock.calls[0][0])).toContain("status=timeout");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honours a custom timeoutMs and swallows a late rejection after the timeout", async () => {
    vi.useFakeTimers();
    let rejectLate: (reason: Error) => void = () => undefined;
    const evaluateAndRecord = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectLate = reject;
        }),
    );

    const pending = runLicenceStartupCheck({
      evaluateAndRecord,
      emitNotices: vi.fn(async () => ({ created: [] as string[], skipped: [] as string[] })),
      log: vi.fn(),
      timeoutMs: 500,
    });

    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toEqual({ status: "timeout" });

    // A rejection after the race is lost must not surface as an unhandled rejection.
    rejectLate(new Error("late failure"));
    await vi.advanceTimersByTimeAsync(0);
  });

  it("still resolves when the logger itself throws", async () => {
    const result = await runLicenceStartupCheck({
      evaluateAndRecord: vi.fn(async () => ({ snapshot, transitions: [], noticeKeys: [] as string[] })),
      emitNotices: vi.fn(async () => ({ created: [] as string[], skipped: [] as string[] })),
      log: () => {
        throw new Error("logger down");
      },
    });

    expect(result).toEqual({ status: "ok" });
  });
});

describe("instrumentation register()", () => {
  beforeEach(() => {
    startupHarness.runStartupLicenceCheck.mockClear();
    startupHarness.runStartupLicenceCheck.mockResolvedValue({ status: "ok" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns immediately without importing the startup service outside the Node runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const { register } = await import("@/instrumentation");

    await expect(register()).resolves.toBeUndefined();

    expect(startupHarness.factoryRuns).toBe(0);
    expect(startupHarness.runStartupLicenceCheck).not.toHaveBeenCalled();
  });

  it("returns immediately when NEXT_RUNTIME is unset", async () => {
    vi.stubEnv("NEXT_RUNTIME", "");
    const { register } = await import("@/instrumentation");

    await expect(register()).resolves.toBeUndefined();

    expect(startupHarness.factoryRuns).toBe(0);
    expect(startupHarness.runStartupLicenceCheck).not.toHaveBeenCalled();
  });

  it("calls the startup check once under the Node runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const { register } = await import("@/instrumentation");

    await register();

    expect(startupHarness.factoryRuns).toBe(1);
    expect(startupHarness.runStartupLicenceCheck).toHaveBeenCalledTimes(1);
  });

  it("never rejects even when the startup function rejects", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    startupHarness.runStartupLicenceCheck.mockRejectedValue(new Error("startup exploded"));
    const { register } = await import("@/instrumentation");

    await expect(register()).resolves.toBeUndefined();

    expect(startupHarness.runStartupLicenceCheck).toHaveBeenCalledTimes(1);
  });
});
