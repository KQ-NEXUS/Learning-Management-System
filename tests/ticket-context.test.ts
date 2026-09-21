import { describe, expect, it } from "vitest";
import { createTicketContextService } from "@/server/services/ticket-context-service";

const kinds = [
  ["requester", { userId: "user-1" }, "USER"],
  ["course", { courseId: "course-1" }, "COURSE"],
  ["cohort", { cohortId: "cohort-1" }, "COHORT"],
  ["order", { orderId: "order-1" }, "ORDER"],
  ["submission", { submissionId: "submission-1" }, "SUBMISSION"],
  ["certificate", { certificateId: "certificate-1" }, "CERTIFICATE"],
] as const;

describe("ticket context service", () => {
  it.each(kinds)("returns a safe href for permitted %s contexts", async (_label, context, kind) => {
    const service = createTicketContextService({
      authorize: async (input) => ({ href: `/staff/${input.kind.toLowerCase()}/${input.id}` }),
    });

    await expect(service.resolve(context)).resolves.toEqual({
      kind,
      safeReference: expect.stringMatching(new RegExp(`^${kind.slice(0, 3)}-[0-9A-F]{10}$`)),
      href: `/staff/${kind.toLowerCase()}/${Object.values(context)[0]}`,
      locked: false,
    });
  });

  it.each(kinds)("locks denied %s contexts without protected labels or values", async (_label, context, kind) => {
    const service = createTicketContextService({
      authorize: async () => null,
    });

    const resolved = await service.resolve(context);

    expect(resolved).toEqual({
      kind,
      safeReference: expect.stringMatching(new RegExp(`^${kind.slice(0, 3)}-[0-9A-F]{10}$`)),
      href: null,
      locked: true,
    });
    if (resolved === null) throw new Error("Expected locked context projection.");
    expect(Object.keys(resolved).sort()).toEqual(["href", "kind", "locked", "safeReference"]);
    expect(JSON.stringify(resolved)).not.toMatch(/email|amount|grade|certificateRef|title|learner/i);
    expect(JSON.stringify(resolved)).not.toContain(String(Object.values(context)[0]));
  });

  it("returns null when no context relation exists", async () => {
    const service = createTicketContextService({ authorize: async () => null });
    await expect(service.resolve({})).resolves.toBeNull();
  });
});
