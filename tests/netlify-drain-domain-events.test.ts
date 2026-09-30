import { describe, expect, it, vi } from "vitest";
import scheduledHandler, {
  config,
  createDrainDomainEventsHandler,
} from "../netlify/functions/drain-domain-events";

describe("Netlify drain-domain-events function", () => {
  it("is scheduled every minute", () => {
    expect(config.schedule).toBe("* * * * *");
    expect(scheduledHandler).toBeTypeOf("function");
  });

  it("runs the bounded task exactly once", async () => {
    const run = vi.fn(async () => undefined);
    const handler = createDrainDomainEventsHandler(run);

    await handler();

    expect(run).toHaveBeenCalledOnce();
  });
});
