import { describe, expect, it } from "vitest";
import { createTicketContextService } from "@/server/services/ticket-context-service";

const kinds = [
  ["requester", { userId: "user-1" }, "USER", "USR-user-1"],
  ["course", { courseId: "course-1" }, "COURSE", "CRS-course-1"],
  ["cohort", { cohortId: "cohort-1" }, "COHORT", "COH-cohort-1"],
  ["order", { orderId: "order-1" }, "ORDER", "ORD-order-1"],
  ["submission", { submissionId: "submission-1" }, "SUBMISSION", "SUB-submission-1"],
  ["certificate", { certificateId: "certificate-1" }, "CERTIFICATE", "CRT-certificate-1"],
] as const;

describe("ticket context service", () => {
  it.each(kinds)("returns a safe href for permitted %s contexts", async (_label, context, kind, safeReference) => {
    const service = createTicketContextService({
      authorize: async (input) => ({ href: `/staff/${input.kind.toLowerCase()}/${input.id}` }),
    });

    await expect(service.resolve(context)).resolves.toEqual({
      kind,
      safeReference,
      href: `/staff/${kind.toLowerCase()}/${Object.values(context)[0]}`,
      locked: false,
    });
  });

  it.each(kinds)("locks denied %s contexts without protected labels or values", async (_label, context, kind, safeReference) => {
    const service = createTicketContextService({
      authorize: async () => null,
    });

    const resolved = await service.resolve(context);

    expect(resolved).toEqual({ kind, safeReference, href: null, locked: true });
    expect(Object.keys(resolved).sort()).toEqual(["href", "kind", "locked", "safeReference"]);
    expect(JSON.stringify(resolved)).not.toMatch(/email|amount|grade|certificateRef|title|learner/i);
  });

  it("returns null when no context relation exists", async () => {
    const service = createTicketContextService({ authorize: async () => null });
    await expect(service.resolve({})).resolves.toBeNull();
  });
});
