import { createHash } from "node:crypto";
import { narrowScopeToCourse } from "@/server/permissions/scope";

export type TicketContextSource = Partial<{
  userId: string | null;
  courseId: string | null;
  cohortId: string | null;
  orderId: string | null;
  submissionId: string | null;
  certificateId: string | null;
}>;

export type TicketContextKind =
  | "USER"
  | "COURSE"
  | "COHORT"
  | "ORDER"
  | "SUBMISSION"
  | "CERTIFICATE";

export type TicketContextProjection = {
  kind: TicketContextKind;
  safeReference: string;
  href: string | null;
  locked: boolean;
};

export type TicketContextAuthorizationInput = {
  kind: TicketContextKind;
  id: string;
};

export type TicketContextServiceDeps = {
  authorize: (input: TicketContextAuthorizationInput) => Promise<{ href: string } | null>;
};

const CONTEXT_ORDER = [
  ["userId", "USER", "USR"],
  ["courseId", "COURSE", "CRS"],
  ["cohortId", "COHORT", "COH"],
  ["orderId", "ORDER", "ORD"],
  ["submissionId", "SUBMISSION", "SUB"],
  ["certificateId", "CERTIFICATE", "CRT"],
] as const satisfies readonly (readonly [keyof TicketContextSource, TicketContextKind, string])[];

export function ticketSafeContextReference(kind: TicketContextKind, id: string): string {
  const digest = createHash("sha256")
    .update(`${kind}:${id}`)
    .digest("hex")
    .slice(0, 10)
    .toUpperCase();
  return `${kind.slice(0, 3)}-${digest}`;
}

export function createTicketContextService(deps: TicketContextServiceDeps) {
  async function resolve(source: TicketContextSource): Promise<TicketContextProjection | null> {
    const match = CONTEXT_ORDER.find(([key]) => {
      const value = source[key];
      return typeof value === "string" && value.trim().length > 0;
    });
    if (!match) return null;

    const [key, kind] = match;
    const id = source[key]!.trim();
    const safeReference = ticketSafeContextReference(kind, id);
    const authorized = await deps.authorize({ kind, id });
    if (!authorized) {
      return { kind, safeReference, href: null, locked: true };
    }
    return { kind, safeReference, href: authorized.href, locked: false };
  }

  return { resolve };
}

type ContextScope = { cohortId?: string; programmeId?: string; courseIds?: string[] };

export type StaffTicketContextAuthorizerDeps = {
  can: (permission: string, scope: ContextScope) => Promise<boolean>;
  cohortScope: (cohortId: string) => Promise<ContextScope>;
  orderScope: (orderId: string) => Promise<ContextScope>;
  enrolmentScope: (enrolmentId: string) => Promise<ContextScope>;
  findSubmission: (
    submissionId: string,
  ) => Promise<{ assessmentId: string; enrolmentId: string; cohortId: string; courseId: string } | null>;
  findCertificateEnrolment: (certificateId: string) => Promise<string | null>;
};

/**
 * SUP-05 / D-18 — decides, per staff viewer, whether a ticket's linked record
 * opens. Each kind is checked against the same permission and scope its
 * staff page enforces, so a link only appears where the page would open; the
 * page still re-authorizes on arrival. Anything unresolvable stays locked.
 */
export function createStaffTicketContextAuthorizer(
  deps: StaffTicketContextAuthorizerDeps,
): TicketContextServiceDeps["authorize"] {
  const seg = encodeURIComponent;

  async function check({ kind, id }: TicketContextAuthorizationInput): Promise<{ href: string } | null> {
    switch (kind) {
      case "COURSE":
        return (await deps.can("courses.view", { courseIds: [id] })) ? { href: `/staff/courses/${seg(id)}` } : null;
      case "COHORT":
        return (await deps.can("cohorts.view", await deps.cohortScope(id)))
          ? { href: `/staff/cohorts/${seg(id)}` }
          : null;
      case "ORDER":
        return (await deps.can("payments.view", await deps.orderScope(id)))
          ? { href: `/staff/payments/${seg(id)}` }
          : null;
      case "SUBMISSION": {
        const submission = await deps.findSubmission(id);
        if (!submission) return null;
        // F-05 — the same assessment-course narrowing the grading page applies.
        const scope = narrowScopeToCourse(await deps.enrolmentScope(submission.enrolmentId), submission.courseId);
        if (!(await deps.can("submissions.view", scope))) return null;
        return {
          href: `/staff/cohorts/${seg(submission.cohortId)}/grading/${seg(submission.assessmentId)}/${seg(id)}`,
        };
      }
      case "CERTIFICATE": {
        const enrolmentId = await deps.findCertificateEnrolment(id);
        if (!enrolmentId) return null;
        return (await deps.can("certificates.view", await deps.enrolmentScope(enrolmentId)))
          ? { href: `/staff/certificates/issued/${seg(id)}` }
          : null;
      }
      default:
        // No staff page shows a learner account, so USER context never links.
        return null;
    }
  }

  return async (input) => {
    try {
      return await check(input);
    } catch {
      return null;
    }
  };
}
