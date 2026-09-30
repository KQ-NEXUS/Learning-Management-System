/**
 * The Netlify `cleanup-notifications` scheduled function — daily cron and a
 * single bounded run per invocation. Mirrors
 * `netlify-release-expired-holds.test.ts` exactly.
 */

import { describe, expect, it, vi } from "vitest";
import scheduledHandler, {
  config,
  createCleanupNotificationsHandler,
} from "../netlify/functions/cleanup-notifications";

describe("Netlify cleanup-notifications function", () => {
  it("is scheduled daily at 03:00", () => {
    expect(config.schedule).toBe("0 3 * * *");
    expect(scheduledHandler).toBeTypeOf("function");
  });

  it("runs the bounded task exactly once", async () => {
    const run = vi.fn(async () => undefined);
    const handler = createCleanupNotificationsHandler(run);

    await handler();

    expect(run).toHaveBeenCalledOnce();
  });
});
