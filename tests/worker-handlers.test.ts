import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createScanLessonResourceHandler } from "../worker/handlers/scan-lesson-resource";
import { createReconcileLessonResourcesHandler } from "../worker/handlers/reconcile-lesson-resources";
import { createReleaseExpiredHoldsHandler } from "../worker/handlers/release-expired-holds";

function scanHarness(result: { isInfected: boolean; viruses: string[] }) {
  const markResult = vi.fn(async () => undefined);
  const getObject = vi.fn(async () => Readable.from("lesson bytes"));
  const scanStream = vi.fn(async () => ({ file: "stream", ...result }));
  const handler = createScanLessonResourceHandler({
    findTarget: async () => ({ storageKey: "lessons/lesson-1/object-1" }),
    getObject,
    scanStream,
    markResult,
    timeoutMs: 100,
  });
  return { handler, getObject, scanStream, markResult };
}

describe("scan lesson resource worker handler", () => {
  it("marks a clean object CLEAN after streaming it through the scanner", async () => {
    const { handler, getObject, scanStream, markResult } = scanHarness({
      isInfected: false,
      viruses: [],
    });

    await handler("resource-1");

    expect(getObject).toHaveBeenCalledWith("lessons/lesson-1/object-1");
    expect(scanStream).toHaveBeenCalledOnce();
    expect(markResult).toHaveBeenCalledWith({
      id: "resource-1",
      status: "CLEAN",
      detail: null,
    });
  });

  it("marks an infected object INFECTED and preserves the signature names", async () => {
    const { handler, markResult } = scanHarness({
      isInfected: true,
      viruses: ["Eicar-Test-Signature"],
    });

    await handler("resource-2");

    expect(markResult).toHaveBeenCalledWith({
      id: "resource-2",
      status: "INFECTED",
      detail: "Eicar-Test-Signature",
    });
  });

  it("marks scanner failures ERROR instead of leaving the resource PENDING", async () => {
    const { handler, scanStream, markResult } = scanHarness({
      isInfected: false,
      viruses: [],
    });
    scanStream.mockRejectedValueOnce(new Error("clamd unavailable"));

    await handler("resource-3");

    expect(markResult).toHaveBeenCalledWith({
      id: "resource-3",
      status: "ERROR",
      detail: "clamd unavailable",
    });
  });

  it("bounds a hung scan and records a timeout as ERROR", async () => {
    const markResult = vi.fn(async () => undefined);
    const handler = createScanLessonResourceHandler({
      findTarget: async () => ({ storageKey: "lessons/lesson-1/object-4" }),
      getObject: async () => Readable.from("lesson bytes"),
      scanStream: async () => new Promise(() => undefined),
      markResult,
      timeoutMs: 5,
    });

    await handler("resource-4");

    expect(markResult).toHaveBeenCalledWith({
      id: "resource-4",
      status: "ERROR",
      detail: "ClamAV scan timed out after 5ms.",
    });
  });
});

describe("lesson resource reconciliation worker handler", () => {
  it("re-enqueues every resource stuck PENDING for more than ten minutes", async () => {
    const enqueue = vi.fn(async () => undefined);
    const log = vi.fn();
    const reconcile = createReconcileLessonResourcesHandler({
      findStuckPending: async (minutes) => {
        expect(minutes).toBe(10);
        return [{ id: "old-1" }, { id: "old-2" }];
      },
      enqueue,
      log,
    });

    await reconcile();

    expect(enqueue.mock.calls).toEqual([["old-1"], ["old-2"]]);
    expect(log).toHaveBeenCalledWith("[worker] re-enqueued 2 stuck lesson resources");
  });
});

describe("hold-release worker handler", () => {
  it("calls the injected sweep once per invocation and logs the released count", async () => {
    const releaseExpiredHolds = vi.fn(async () => ({ released: 3, failed: 0 }));
    const log = vi.fn();
    const handler = createReleaseExpiredHoldsHandler({
      releaseExpiredHolds,
      log,
    });

    await handler();

    expect(releaseExpiredHolds).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("[worker] released 3 expired seat holds");
  });

  it("propagates a thrown error so pg-boss records the failure and retries", async () => {
    const releaseExpiredHolds = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    const log = vi.fn();
    const handler = createReleaseExpiredHoldsHandler({
      releaseExpiredHolds,
      log,
    });

    await expect(handler()).rejects.toThrow("database unavailable");
    expect(log).not.toHaveBeenCalled();
  });
});
