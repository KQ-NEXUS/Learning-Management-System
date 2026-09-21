/** Staff corrections apply only to released grades. Phase 11 hooks this
 * transaction directly via `reactToGradeOverride` (plan 11-10), immediately
 * after `writeEvent` and before the final read — not by polling the outbox
 * (DD-12/DD-13). */
import { prisma } from "@/server/db";
import { withPermission } from "@/server/permissions";
import type { createWithPermission } from "@/server/permissions/with-permission";
import type { ResourceScope } from "@/server/permissions/scope";
import { enrolmentCohortScope } from "./cohort-scope";
import { recordAudit } from "./audit-service";
import type { ResourceAuditEntry } from "./resource-service";
import { writeDomainEvent, type DomainEventTxClient } from "./domain-event-service";
import {
  flagCertificatesForGradeCorrection,
  liveIssuanceDeps,
  type CertificateIssuanceTxClient,
} from "./certificate-issuance-service";

export class GradeNotReleasedError extends Error {
  constructor() { super("Only a released grade can be corrected. Edit a draft grade directly."); this.name = "GradeNotReleasedError"; }
}
export class OverrideReasonRequiredError extends Error {
  constructor() { super("Explain the correction using at least 10 characters."); this.name = "OverrideReasonRequiredError"; }
}
export class GradeChangedError extends Error {
  constructor() { super("This grade changed during the correction. Reload it and try again."); this.name = "GradeChangedError"; }
}
export type OverrideGradeRow = { id: string; assessmentId: string; enrolmentId: string; score: number; maxScore: number; passed: boolean | null; status: string };
export type OverrideHistoryRow = { id: string; gradeId: string; previousScore: number; newScore: number; reason: string; actorId: string | null; createdAt: Date };
export type GradeOverrideResult = { override: OverrideHistoryRow; grade: OverrideGradeRow; overrides: OverrideHistoryRow[] };
type Input = { gradeId: string; newScore: number; reason: string };
export type GradeOverrideTx = DomainEventTxClient & {
  grade: {
    findUnique(args: { where: { id: string } }): Promise<OverrideGradeRow | null>;
    updateMany(args: { where: { id: string; status: string; score: number }; data: { score: number; passed: boolean | null } }): Promise<{ count: number }>;
  };
  assessment: { findUnique(args: { where: { id: string }; select: { passMark: true } }): Promise<{ passMark: number | null } | null> };
  gradeOverride: {
    create(args: { data: Omit<OverrideHistoryRow, "id" | "createdAt"> }): Promise<OverrideHistoryRow>;
    findMany(args: { where: { gradeId: string }; orderBy: { createdAt: "asc" } }): Promise<OverrideHistoryRow[]>;
  };
};
export type GradeOverrideDeps = {
  grade: GradeOverrideTx["grade"] extends { findUnique: infer F } ? { findUnique: F } : never;
  enrolmentScope(enrolmentId: string): Promise<ResourceScope> | ResourceScope;
  withPermission: ReturnType<typeof createWithPermission>;
  runInTransaction<R>(fn: (tx: GradeOverrideTx) => Promise<R>): Promise<R>;
  writeEvent: typeof writeDomainEvent;
  audit(entry: ResourceAuditEntry): Promise<void>;
  /**
   * CRD-06's grade half (plan 11-10): flags the enrolment's certificate for
   * review inside this same transaction — never re-derives a completion
   * verdict (grades carry no `completionRule` v1 key). `actorId` is the
   * overriding staff member, not `SYSTEM` (T-11-42) — deviates from the
   * plan's literal 3-field args shape by adding this required field; without
   * it the certificate audit row cannot carry an attributable actor.
   */
  reactToGradeOverride(
    tx: GradeOverrideTx,
    args: { enrolmentId: string; assessmentId: string; passedChanged: boolean; actorId: string },
  ): Promise<void>;
};

export function createGradeOverrideService(deps: GradeOverrideDeps) {
  const overrideGrade = deps.withPermission<Input>("grades.manage", async ({ gradeId }) => {
    const grade = await deps.grade.findUnique({ where: { id: gradeId } });
    return grade ? deps.enrolmentScope(grade.enrolmentId) : {};
  })(async (input, ctx): Promise<GradeOverrideResult> => {
    const reason = input.reason.trim();
    if (reason.length < 10) throw new OverrideReasonRequiredError();
    const result = await deps.runInTransaction(async (tx) => {
      const before = await tx.grade.findUnique({ where: { id: input.gradeId } });
      if (!before) throw new Error("Grade not found.");
      if (before.status !== "RELEASED") throw new GradeNotReleasedError();
      if (!Number.isInteger(input.newScore) || input.newScore < 0 || input.newScore > before.maxScore) throw new RangeError("Enter a whole-number score within the grading scale.");
      const assessment = await tx.assessment.findUnique({ where: { id: before.assessmentId }, select: { passMark: true } });
      if (!assessment) throw new Error("Assessment not found.");
      const passed = assessment.passMark === null ? null : input.newScore >= assessment.passMark;
      // Compare-and-set prevents simultaneous corrections from overwriting
      // each other or recording a previous score that was never current.
      const update = await tx.grade.updateMany({ where: { id: before.id, status: "RELEASED", score: before.score }, data: { score: input.newScore, passed } });
      if (update.count !== 1) throw new GradeChangedError();
      const override = await tx.gradeOverride.create({ data: { gradeId: before.id, previousScore: before.score, newScore: input.newScore, reason, actorId: ctx.actor.userId } });
      const grade = { ...before, score: input.newScore, passed };
      await deps.writeEvent(tx, { type: "grade.overridden", payload: { gradeId: before.id, assessmentId: before.assessmentId, enrolmentId: before.enrolmentId, previousScore: before.score, newScore: input.newScore, passedChanged: before.passed !== passed } });
      await deps.reactToGradeOverride(tx, { enrolmentId: before.enrolmentId, assessmentId: before.assessmentId, passedChanged: before.passed !== passed, actorId: ctx.actor.userId });
      const overrides = await tx.gradeOverride.findMany({ where: { gradeId: before.id }, orderBy: { createdAt: "asc" } });
      return { override, grade, overrides, before };
    });
    await deps.audit({ action: "grade.overridden", targetType: "Grade", targetId: input.gradeId, actorId: ctx.actor.userId, outcome: "SUCCESS", reason, before: { score: result.before.score, passed: result.before.passed }, after: { score: result.grade.score, passed: result.grade.passed } });
    return { override: result.override, grade: result.grade, overrides: result.overrides };
  });
  return { overrideGrade };
}

const built = createGradeOverrideService({
  grade: prisma.grade,
  enrolmentScope: enrolmentCohortScope,
  withPermission,
  runInTransaction: (fn) => prisma.$transaction((tx) => fn(tx as unknown as GradeOverrideTx)),
  writeEvent: writeDomainEvent,
  audit: (entry) => recordAudit(entry),
  // `tx` is narrowed to `CertificateIssuanceTxClient` via a structural cast
  // through `unknown` — the same idiom the certificate-issuance module's own
  // completion-and-issue wrapper and `enrolment-transitions.ts`'s
  // `applyEnrolmentActivation` use for their own tx-client narrowing (plan
  // 11-10). This path never re-derives a completion verdict — grades carry
  // no key the v1 completion rule recognises, so it only flags.
  reactToGradeOverride: (tx, args) =>
    flagCertificatesForGradeCorrection(
      tx as unknown as CertificateIssuanceTxClient,
      { ...args, now: new Date() },
      liveIssuanceDeps,
    ),
});
export const overrideGrade = built.overrideGrade;
