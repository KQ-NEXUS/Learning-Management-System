import { describe, expect, it, vi } from "vitest";
import scheduledHandler, {
  config,
  createCleanupStaleUploadsHandler,
} from "../netlify/functions/cleanup-stale-uploads";

describe("Netlify cleanup-stale-uploads function", () => {
  it("is scheduled hourly", () => {
    expect(config.schedule).toBe("0 * * * *");
    expect(scheduledHandler).toBeTypeOf("function");
  });

  it("runs the bounded task exactly once", async () => {
    const run = vi.fn(async () => undefined);
    const handler = createCleanupStaleUploadsHandler(run);

    await handler();

    expect(run).toHaveBeenCalledOnce();
  });
});
