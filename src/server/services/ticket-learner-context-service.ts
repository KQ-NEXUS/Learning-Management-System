/**
 * Server-side validation of a learner's "Get help with this" context hint.
 *
 * The query string is only a hint: this resolves the record and verifies it
 * belongs to the learner before anything is persisted on the ticket. Unknown
 * or foreign records return null (the form then simply has no context), so a
 * caller cannot probe for other learners' records.
 */

import { prisma } from "@/server/db";
import {
  ticketSafeContextReference,
  type TicketContextKind,
} from "@/server/services/ticket-context-service";
import type { TicketContextInput } from "@/server/services/ticket-service";

export type LearnerContextKind = Exclude<TicketContextKind, "USER">;

export type LearnerContextHint = { kind: LearnerContextKind; id: string };

export type ValidatedLearnerContext = {
  kind: LearnerContextKind;
  safeReference: string;
  input: TicketContextInput;
};

export type LearnerContextLookup = {
  ownsCourse(userId: string, id: string): Promise<boolean>;
  ownsCohort(userId: string, id: string): Promise<boolean>;
  ownsOrder(userId: string, id: string): Promise<boolean>;
  ownsSubmission(userId: string, id: string): Promise<boolean>;
  ownsCertificate(userId: string, id: string): Promise<boolean>;
};

const KINDS: readonly string[] = ["COURSE", "COHORT", "ORDER", "SUBMISSION", "CERTIFICATE"];

export function parseLearnerContextHint(
  kind: string | null | undefined,
  id: string | null | undefined,
): LearnerContextHint | null {
  const normalised = kind?.trim().toUpperCase();
  const trimmedId = id?.trim();
  if (!normalised || !trimmedId || trimmedId.length > 100 || !KINDS.includes(normalised)) return null;
  return { kind: normalised as LearnerContextKind, id: trimmedId };
}

export function createLearnerContextService(lookup: LearnerContextLookup) {
  async function validate(userId: string, hint: LearnerContextHint | null): Promise<ValidatedLearnerContext | null> {
    if (!hint) return null;
    const checks: Record<LearnerContextKind, [keyof TicketContextInput, () => Promise<boolean>]> = {
      COURSE: ["courseId", () => lookup.ownsCourse(userId, hint.id)],
      COHORT: ["cohortId", () => lookup.ownsCohort(userId, hint.id)],
      ORDER: ["orderId", () => lookup.ownsOrder(userId, hint.id)],
      SUBMISSION: ["submissionId", () => lookup.ownsSubmission(userId, hint.id)],
      CERTIFICATE: ["certificateId", () => lookup.ownsCertificate(userId, hint.id)],
    };
    const [field, owns] = checks[hint.kind];
    if (!(await owns())) return null;
    return {
      kind: hint.kind,
      safeReference: ticketSafeContextReference(hint.kind, hint.id),
      input: { [field]: hint.id },
    };
  }
  return { validate };
}

const live = createLearnerContextService({
  ownsCourse: async (userId, id) =>
    (await prisma.enrolment.count({ where: { userId, cohort: { courseId: id } } })) > 0,
  ownsCohort: async (userId, id) => (await prisma.enrolment.count({ where: { userId, cohortId: id } })) > 0,
  ownsOrder: async (userId, id) => (await prisma.order.count({ where: { id, userId } })) > 0,
  ownsSubmission: async (userId, id) =>
    (await prisma.submission.count({ where: { id, enrolment: { userId } } })) > 0,
  ownsCertificate: async (userId, id) => (await prisma.certificate.count({ where: { id, userId } })) > 0,
});

export const validateLearnerTicketContext = live.validate;
