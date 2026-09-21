import { createHash } from "node:crypto";

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
