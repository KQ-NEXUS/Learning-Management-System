/**
 * The Netlify `check-licence` scheduled function — hourly cron and a single
 * run per invocation (plan 14-16, D-16, A4). Mirrors
 * `netlify-cleanup-notifications.test.ts`.
 */

import { describe, expect, it, vi } from "vitest";
import scheduledHandler, {
  config,
  createCheckLicenceHandler,
} from "../netlify/functions/check-licence";

describe("Netlify check-licence function", () => {
  it("is scheduled hourly in UTC", () => {
    expect(config.schedule).toBe("0 * * * *");
    expect(scheduledHandler).toBeTypeOf("function");
  });

  it("runs the task exactly once per invocation", async () => {
    const run = vi.fn(async () => undefined);
    const handler = createCheckLicenceHandler(run);

    await handler();

    expect(run).toHaveBeenCalledOnce();
  });
});
