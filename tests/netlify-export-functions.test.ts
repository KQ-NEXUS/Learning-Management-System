import { beforeEach, describe, expect, it, vi } from "vitest";

const taskCalls = vi.hoisted(() => ({ process: vi.fn(), expire: vi.fn() }));
vi.mock("@/server/scheduled/process-export-jobs-task", () => ({ runProcessExportJobsTask: taskCalls.process }));
vi.mock("@/server/scheduled/expire-export-jobs-task", () => ({ runExpireExportJobsTask: taskCalls.expire }));

import { createDispatchExportJobsTask } from "@/server/scheduled/dispatch-export-jobs-task";
import dispatchExportJobs, { config as dispatchConfig, createDispatchExportJobsHandler } from "../netlify/functions/dispatch-export-jobs";
import processExportJobs, { config as backgroundConfig, createProcessExportJobsHandler } from "../netlify/functions/process-export-jobs-background";
import expireExportJobs, { config as expiryConfig, createExpireExportJobsHandler } from "../netlify/functions/expire-export-jobs";

const secret = "dispatch-secret-" + "x".repeat(40);
const endpoint = "https://lms.example.test/.netlify/functions/process-export-jobs-background";
beforeEach(() => { vi.clearAllMocks(); });

describe("Netlify export dispatch boundary", () => {
  it("sends only the deployment secret and constant body to the background URL every minute", async () => {
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    await createDispatchExportJobsTask({ baseUrl: "https://lms.example.test", secret, fetchImpl: send })();
    expect(send).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: "POST", body: "{}", headers: expect.objectContaining({ "x-export-dispatch-secret": secret }) }));
    expect(dispatchConfig.schedule).toBe("* * * * *");
    expect(createDispatchExportJobsHandler(vi.fn())).toBeTypeOf("function");
    expect(dispatchExportJobs).toBeTypeOf("function");
  });

  it("propagates a non-202 dispatch failure", async () => {
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    await expect(createDispatchExportJobsTask({ baseUrl: "https://lms.example.test", secret, fetchImpl: send })()).rejects.toThrow();
  });

  it("rejects missing, wrong, query and body instructions before running the worker", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const handler = createProcessExportJobsHandler({ secret, run });
    const request = (url: string, body: string, token?: string) => new Request(url, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-export-dispatch-secret": token } : {}) }, body });
    for (const forged of [
      request(endpoint, "{}"),
      request(endpoint, "{}", "wrong"),
      request(endpoint + "?jobId=private", "{}", secret),
      request(endpoint, '{"dataset":"audit"}', secret),
      request(endpoint, '{"limit":100}', secret),
    ]) expect((await handler(forged)).status).toBe(404);
    expect(run).not.toHaveBeenCalled();
    expect(backgroundConfig.background).toBe(true);
    expect(processExportJobs).toBeTypeOf("function");
  });

  it("delegates exactly once without HTTP instructions and permits safe replay", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const handler = createProcessExportJobsHandler({ secret, run });
    const request = () => new Request(endpoint, { method: "POST", headers: { "content-type": "application/json", "x-export-dispatch-secret": secret }, body: "{}" });
    expect((await handler(request())).status).toBe(204);
    expect((await handler(request())).status).toBe(204);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls).toEqual([[], []]);
  });
});

describe("Netlify export expiry adapter", () => {
  it("delegates once with no caller arguments and exposes a recurring schedule", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    await createExpireExportJobsHandler(run)();
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]).toEqual([]);
    expect(expiryConfig.schedule).toBe("*/15 * * * *");
    expect(expireExportJobs).toBeTypeOf("function");
  });

  it("propagates expiry task failures", async () => {
    const run = vi.fn().mockRejectedValue(new Error("database unavailable"));
    await expect(createExpireExportJobsHandler(run)()).rejects.toThrow("database unavailable");
  });
});
