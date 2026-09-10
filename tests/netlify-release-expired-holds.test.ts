import { describe, expect, it, vi } from "vitest";
import scheduledHandler, {
  config,
  createReleaseExpiredHoldsHandler,
} from "../netlify/functions/release-expired-holds";

describe("Netlify release-expired-holds function", () => {
  it("is scheduled every five minutes", () => {
    expect(config.schedule).toBe("*/5 * * * *");
    expect(scheduledHandler).toBeTypeOf("function");
  });

  it("runs the bounded task exactly once", async () => {
    const run = vi.fn(async () => undefined);
    const handler = createReleaseExpiredHoldsHandler(run);

    await handler();

    expect(run).toHaveBeenCalledOnce();
  });
});
