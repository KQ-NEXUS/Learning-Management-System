import { describe, expect, it, vi } from "vitest";
import scheduledHandler, {
  config,
  createReconcilePaymentsHandler,
} from "../netlify/functions/reconcile-payments";

describe("Netlify reconcile-payments function", () => {
  it("is scheduled every fifteen minutes", () => {
    expect(config.schedule).toBe("*/15 * * * *");
    expect(scheduledHandler).toBeTypeOf("function");
  });

  it("runs the bounded task exactly once", async () => {
    const run = vi.fn(async () => undefined);
    const handler = createReconcilePaymentsHandler(run);

    await handler();

    expect(run).toHaveBeenCalledOnce();
  });
});
