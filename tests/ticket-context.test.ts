import { describe, expect, it } from "vitest";
import { createStaffTicketContextAuthorizer, createTicketContextService } from "@/server/services/ticket-context-service";

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

describe("staff ticket context authorizer", () => {
  type Scope = { cohortId?: string; courseIds?: readonly string[] };

  function makeAuthorizer(allowed: Array<[string, Scope]>) {
    const calls: Array<[string, Scope]> = [];
    const authorize = createStaffTicketContextAuthorizer({
      can: async (permission, scope) => {
        calls.push([permission, scope]);
        return allowed.some(([p, s]) => p === permission && JSON.stringify(s) === JSON.stringify(scope));
      },
      cohortScope: async (id) => ({ cohortId: `scope-of-${id}` }),
      orderScope: async (id) => ({ cohortId: `cohort-of-${id}` }),
      enrolmentScope: async (id) => ({ cohortId: `cohort-of-${id}` }),
      findSubmission: async (id) =>
        id === "submission-1" ? { assessmentId: "assessment-1", enrolmentId: "enrolment-1", cohortId: "cohort-9" } : null,
      findCertificateEnrolment: async (id) => (id === "certificate-1" ? "enrolment-2" : null),
    });
    return { authorize, calls };
  }

  it.each([
    ["COURSE", "course-1", "courses.view", { courseIds: ["course-1"] }, "/staff/courses/course-1"],
    ["COHORT", "cohort-1", "cohorts.view", { cohortId: "scope-of-cohort-1" }, "/staff/cohorts/cohort-1"],
    ["ORDER", "order-1", "payments.view", { cohortId: "cohort-of-order-1" }, "/staff/payments/order-1"],
    [
      "SUBMISSION",
      "submission-1",
      "submissions.view",
      { cohortId: "cohort-of-enrolment-1" },
      "/staff/cohorts/cohort-9/grading/assessment-1/submission-1",
    ],
    [
      "CERTIFICATE",
      "certificate-1",
      "certificates.view",
      { cohortId: "cohort-of-enrolment-2" },
      "/staff/certificates/issued/certificate-1",
    ],
  ] as const)("links a permitted %s to its staff page", async (kind, id, permission, scope, href) => {
    const { authorize } = makeAuthorizer([[permission, scope]]);
    await expect(authorize({ kind, id })).resolves.toEqual({ href });
  });

  it.each(["COURSE", "COHORT", "ORDER", "SUBMISSION", "CERTIFICATE"] as const)(
    "locks a %s the role cannot view",
    async (kind) => {
      const { authorize } = makeAuthorizer([]);
      const id = `${kind.toLowerCase()}-1`;
      await expect(authorize({ kind, id })).resolves.toBeNull();
    },
  );

  it("locks USER context: there is no staff page for a learner account", async () => {
    const { authorize, calls } = makeAuthorizer([["users.view", {}]]);
    await expect(authorize({ kind: "USER", id: "user-1" })).resolves.toBeNull();
    expect(calls).toEqual([]);
  });

  it("locks a submission or certificate that no longer exists", async () => {
    const { authorize } = makeAuthorizer([["submissions.view", {}], ["certificates.view", {}]]);
    await expect(authorize({ kind: "SUBMISSION", id: "gone" })).resolves.toBeNull();
    await expect(authorize({ kind: "CERTIFICATE", id: "gone" })).resolves.toBeNull();
  });

  it("locks rather than throws when a scope lookup fails", async () => {
    const authorize = createStaffTicketContextAuthorizer({
      can: async () => true,
      cohortScope: async () => {
        throw new Error("db down");
      },
      orderScope: async () => ({}),
      enrolmentScope: async () => ({}),
      findSubmission: async () => null,
      findCertificateEnrolment: async () => null,
    });
    await expect(authorize({ kind: "COHORT", id: "cohort-1" })).resolves.toBeNull();
  });

  it("encodes ids into the href path", async () => {
    const { authorize } = makeAuthorizer([["courses.view", { courseIds: ["a/b?c"] }]]);
    await expect(authorize({ kind: "COURSE", id: "a/b?c" })).resolves.toEqual({ href: "/staff/courses/a%2Fb%3Fc" });
  });
});
