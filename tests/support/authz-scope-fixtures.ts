/**
 * Fixtures for the wrong-scope and wrong-record-state authorization matrix
 * (Phase 15, plan 15-26; NFR-05, D-09).
 *
 * Plan 15-25 proved identity and permission presence. This file adds the people and
 * records needed to prove the other two inputs of the NFR-05 decision, assignment
 * scope and record state, on a real database:
 *
 *   - `seedScopeWorld()` builds the 15-25 world (cohort A on course A, cohort B on
 *     course B, the owning learner's records) and adds staff who hold EVERY
 *     cohort-scopable permission, but only at a scope that does not reach the target
 *     record: cohort B, course B and a second programme (Z). It also adds the matching
 *     "right scope" staff for each level (cohort A, course A, programme A) so a refusal
 *     is never the result of a dead call: the same call by the correctly scoped person
 *     must get through.
 *   - `resetScopeDatabase()` returns the database to the state it had straight after
 *     the migrations, so a case that writes (a positive control, or a record moved into
 *     a final state) starts from pristine records. Rows the migrations themselves insert
 *     (the licence singleton, ticket and learner-number defaults) are put back.
 *   - `STATE_CASES` names, for each entry that declares `recordStates`, the exact mutation
 *     that puts the target record into each disallowed state, keyed by the state names the
 *     registry uses.
 *
 * Builders only NAME or MUTATE records through Prisma. Nothing here reads `.env`; the
 * database is whatever `startMatrixDatabase()` returned (a disposable Testcontainers
 * Postgres, never a shared one).
 *
 * `tests/support/authz-inputs.ts` is not edited by plan 15-26: every input still comes
 * from its builders, which already name cohort A, course A and the owning learner.
 *
 * ESLint boundary note: this file lives under `tests/`, outside the `src/**` glob that
 * confines `@prisma/client`, so importing the client type here is intentional.
 */

import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { hashToken } from "@/server/auth/token-hash";
import { seedWorld, type World } from "./authz-inputs";
import {
  SCOPED_PERMISSIONS,
  seedPersonas,
  type Persona,
  type PersonaName,
  type Personas,
} from "./authz-matrix";

// ---------------------------------------------------------------------------
// Database reset
// ---------------------------------------------------------------------------

type BaselineTable = { table: string; rows: unknown[] };

let baseline: BaselineTable[] | null = null;
let publicTables: string[] = [];

/**
 * Records which rows the migrations leave behind. Call once, straight after
 * `startMatrixDatabase()` and before any seed.
 */
export async function captureBaseline(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
    ORDER BY table_name`;
  publicTables = tables.map((row) => row.table_name);
  const captured: BaselineTable[] = [];
  for (const table of publicTables) {
    const rows = await prisma.$queryRawUnsafe<Array<{ j: unknown }>>(`SELECT to_jsonb(r) AS j FROM "${table}" r`);
    if (rows.length > 0) captured.push({ table, rows: rows.map((row) => row.j) });
  }
  baseline = captured;
}

/** The tables that held rows right after the migrations (for the evidence and the tests). */
export function baselineTables(): string[] {
  return (baseline ?? []).map((entry) => entry.table);
}

/**
 * Empties every table and puts back the rows the migrations inserted. Foreign keys and
 * triggers are bypassed for the reload only (`session_replication_role = replica`, which
 * the disposable database's superuser may set), so the order of tables does not matter.
 */
export async function resetScopeDatabase(prisma: PrismaClient): Promise<void> {
  if (!baseline) throw new Error("captureBaseline() has not been called.");
  const quoted = publicTables.map((table) => `"${table}"`).join(", ");
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
      for (const entry of baseline!) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "${entry.table}" SELECT * FROM jsonb_populate_recordset(NULL::"${entry.table}", $1::jsonb)`,
          JSON.stringify(entry.rows),
        );
      }
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
}

// ---------------------------------------------------------------------------
// Scoped staff
// ---------------------------------------------------------------------------

/**
 * Names the scope matrix adds to the 15-25 personas. The `Persona` type of the shared
 * harness only lists the 15-25 names; the label is for messages only, so the extra names
 * are cast in once, here.
 */
export type ScopePersonaName =
  | "staffCourseA"
  | "staffCourseB"
  | "staffProgrammeA"
  | "staffProgrammeZ";

export type ScopePersonas = Personas & Record<ScopePersonaName, Persona>;

export type ScopeWorld = {
  world: World;
  personas: ScopePersonas;
  /** A programme that holds no course the target records belong to. */
  programmeZId: string;
};

/** A staff member with a session and one assignment of `roleId` at the given scope. */
export async function createScopedStaff(
  prisma: PrismaClient,
  label: string,
  roleId: string,
  scopeType: "COHORT" | "COURSE" | "PROGRAMME",
  scopeId: string,
): Promise<Persona> {
  const user = await prisma.user.create({
    data: {
      email: `${label.toLowerCase()}@authz-scope.test`,
      name: `Scope ${label}`,
      status: "ACTIVE",
      emailVerified: new Date(),
      isStaff: true,
    },
    select: { id: true },
  });
  const token = randomBytes(24).toString("hex");
  await prisma.session.create({
    data: { sessionToken: hashToken(token), userId: user.id, expires: new Date(Date.now() + 7 * 86_400_000) },
  });
  await prisma.assignment.create({ data: { userId: user.id, roleId, scopeType, scopeId } });
  return { name: label as unknown as PersonaName, userId: user.id, token };
}

/**
 * The 15-25 world and personas, plus the course- and programme-scoped staff.
 *
 *   staffCohortA / staffCourseA / staffProgrammeA   hold every scopable permission at the
 *                                                   RIGHT level for their kind of record
 *   staffCohortB / staffCourseB / staffProgrammeZ   hold the same permissions where the
 *                                                   target records are not
 *
 * Which of the "A" people is the right one for an entry depends on the record the entry
 * acts on (`rightScopePersona`).
 */
export async function seedScopeWorld(prisma: PrismaClient): Promise<ScopeWorld> {
  const world = await seedWorld(prisma);
  const base = await seedPersonas(prisma, { cohortAId: world.cohortAId, cohortBId: world.cohortBId });
  await world.attachOwner(base);

  const programmeZ = await prisma.programme.create({
    data: { slug: "scope-matrix-programme-z", title: "Scope matrix programme Z" },
    select: { id: true },
  });
  const role = await prisma.role.create({
    data: { name: "Scope matrix scoped staff", permissions: [...SCOPED_PERMISSIONS] },
    select: { id: true },
  });

  const personas = {
    ...base,
    staffCourseA: await createScopedStaff(prisma, "staffCourseA", role.id, "COURSE", world.courseAId),
    staffCourseB: await createScopedStaff(prisma, "staffCourseB", role.id, "COURSE", world.courseBId),
    staffProgrammeA: await createScopedStaff(prisma, "staffProgrammeA", role.id, "PROGRAMME", world.programmeId),
    staffProgrammeZ: await createScopedStaff(prisma, "staffProgrammeZ", role.id, "PROGRAMME", programmeZ.id),
  } as ScopePersonas;
  return { world, personas, programmeZId: programmeZ.id };
}

/** The level a scoped entry's record sits at, which decides who counts as "correctly scoped". */
export type ScopeLevel = "COHORT" | "COURSE" | "PROGRAMME";

/**
 * The level of the record an entry acts on. Course content (modules, lessons, assessments,
 * the course itself and the lesson resources behind it) is scoped at the course; the
 * programme composition and publication actions at the programme; everything else resolves
 * through the record's cohort (an enrolment, an order, a session, a certificate, a grade).
 */
export function scopeLevelOf(entry: { domain: string; file: string }): ScopeLevel {
  if (entry.domain === "programmes") return "PROGRAMME";
  if (entry.domain === "courses" || entry.domain === "assessments" || entry.domain === "catalogue") return "COURSE";
  return "COHORT";
}

/** Staff scoped to the RIGHT record, for a level. */
export function rightScopePersona(personas: ScopePersonas, level: ScopeLevel): Persona {
  switch (level) {
    case "COHORT":
      return personas.staffCohortA;
    case "COURSE":
      return personas.staffCourseA;
    case "PROGRAMME":
      return personas.staffProgrammeA;
  }
}

/** Staff holding every scopable permission, but only on records that are NOT the target. */
export function wrongScopePersonas(personas: ScopePersonas): Array<{ label: string; persona: Persona }> {
  return [
    { label: "staffCohortB", persona: personas.staffCohortB },
    { label: "staffCourseB", persona: personas.staffCourseB },
    { label: "staffProgrammeZ", persona: personas.staffProgrammeZ },
  ];
}

// ---------------------------------------------------------------------------
// Claimed-scope variants
// ---------------------------------------------------------------------------

function deepReplaceKey(value: unknown, key: string, from: string, to: string, counter: { n: number }): unknown {
  if (typeof FormData !== "undefined" && value instanceof FormData) {
    const copy = new FormData();
    for (const [name, entry] of value.entries()) {
      if (name === key && entry === from) {
        copy.append(name, to);
        counter.n += 1;
      } else {
        copy.append(name, entry);
      }
    }
    return copy;
  }
  if (Array.isArray(value)) return value.map((item) => deepReplaceKey(item, key, from, to, counter));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
      if (name === key && entry === from) {
        out[name] = to;
        counter.n += 1;
      } else {
        out[name] = deepReplaceKey(entry, key, from, to, counter);
      }
    }
    return out;
  }
  return value;
}

/**
 * A copy of `args` where every field named `key` whose value is `from` now says `to`.
 * Used to send the caller's OWN cohort or course id beside a record of another scope,
 * which is how a real attacker would try to make the server authorize the wrong thing.
 */
export function claimScope(
  args: readonly unknown[],
  key: string,
  from: string,
  to: string,
): { args: unknown[]; replaced: number } {
  const counter = { n: 0 };
  const copy = args.map((arg) => deepReplaceKey(arg, key, from, to, counter));
  return { args: copy, replaced: counter.n };
}

function collectStrings(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    into.add(value);
  } else if (typeof FormData !== "undefined" && value instanceof FormData) {
    for (const [, entry] of value.entries()) if (typeof entry === "string") into.add(entry);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, into);
  }
}

/**
 * The ids in `args` that name a record of the target world other than the cohort, course
 * and programme themselves (an enrolment, a module, a grade, ...). A claimed-scope variant
 * only makes sense when one of these rides along: with none, claiming another scope would
 * just be a legitimate request for that scope.
 */
export function otherRecordIds(args: readonly unknown[], world: World): string[] {
  const scopeIds = new Set([world.cohortAId, world.cohortBId, world.courseAId, world.courseBId, world.programmeId, world.spareCourseId]);
  const known = new Set<string>();
  for (const [key, value] of Object.entries(world)) {
    if (key === "prisma" || key === "personas") continue;
    if (typeof value === "string" && value.length >= 20 && !scopeIds.has(value)) known.add(value);
  }
  const found = new Set<string>();
  for (const arg of args) collectStrings(arg, found);
  return [...found].filter((value) => known.has(value));
}

// ---------------------------------------------------------------------------
// Record-state cases
// ---------------------------------------------------------------------------

/**
 * One disallowed state of one entry's record, and how to put the record there.
 *
 *   entryKey   `file#exportName` or `file#METHOD`, as the registry's own `keyOf`
 *   state      the name listed in the entry's `recordStates`
 *   caller     who calls: fully authorised Global staff, or the owning learner
 *   inputId    an input builder other than the entry's own, where the state needs one
 *   args       replaces the input entirely (for a concurrency token that must be the
 *              record's real `updatedAt`, so the state check is what refuses)
 *   message    text the domain refusal must contain, so the refusal is known to come from
 *              the state check and not from an unrelated rejection
 *   arrange    moves the record into the state on a fresh database
 */
export type StateCase = {
  entryKey: string;
  state: string;
  caller: "staff" | "owner";
  inputId?: string;
  args?: (scope: ScopeWorld, prisma: PrismaClient) => Promise<unknown>;
  message?: RegExp;
  /**
   * Set only where the domain deliberately answers a repeat with a harmless success: the
   * call must then write nothing but the audit trail, and the reason says why that is by
   * design. Every other case must be REFUSED.
   */
  idempotent?: string;
  /** For a route: the statuses that are the domain refusal (default: the entry's denied statuses). */
  statuses?: readonly number[];
  /**
   * A learner calling a route that first probes the staff permission leaves an
   * `authorization.denied` row for that probe before the learner path answers. The reason
   * says so; the "no denial row for a fully authorised caller" check is skipped for it.
   */
  staffProbeDenial?: string;
  arrange: (scope: ScopeWorld, prisma: PrismaClient) => Promise<void>;
};

type Arrange = StateCase["arrange"];

/** The world's enrolment holds a live certificate, which (correctly) blocks many transitions. Set it aside. */
export const certificateOut: Arrange = async (scope, prisma) => {
  await prisma.certificate.update({
    where: { id: scope.world.certificateId },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
};

const enrolmentIs =
  (status: "ACTIVE" | "COMPLETED" | "WITHDRAWN" | "TRANSFERRED" | "CANCELLED"): Arrange =>
  async (scope, prisma) => {
    await certificateOut(scope, prisma);
    await prisma.enrolment.update({
      where: { id: scope.world.enrolmentAId },
      data: {
        status,
        holdExpiresAt: null,
        ...(status === "ACTIVE" || status === "COMPLETED" ? { activatedAt: new Date() } : {}),
        ...(status === "WITHDRAWN" ? { withdrawnAt: new Date() } : {}),
      },
    });
  };

const cohortIs =
  (status: "PUBLISHED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED", which: "A" | "B" = "A"): Arrange =>
  async (scope, prisma) => {
    await prisma.cohort.update({
      where: { id: which === "A" ? scope.world.cohortAId : scope.world.cohortBId },
      data: { status },
    });
  };

const orderIs =
  (status: "PENDING" | "PAID" | "CANCELLED" | "REFUNDED" | "PARTIALLY_REFUNDED"): Arrange =>
  async (scope, prisma) => {
    await prisma.order.update({
      where: { id: scope.world.orderAId },
      data: { status, ...(status === "PAID" || status === "REFUNDED" || status === "PARTIALLY_REFUNDED" ? { paidAt: new Date() } : {}) },
    });
  };

const certificateIs =
  (status: "REVOKED" | "SUPERSEDED"): Arrange =>
  async (scope, prisma) => {
    await prisma.certificate.update({
      where: { id: scope.world.certificateId },
      data: { status, ...(status === "REVOKED" ? { revokedAt: new Date(), revocationReason: "Set by the state matrix." } : {}) },
    });
  };

const sessionCancelled: Arrange = async (scope, prisma) => {
  await prisma.scheduledSession.update({
    where: { id: scope.world.sessionAId },
    data: { cancelledAt: new Date(), cancellationReason: "Set by the state matrix." },
  });
};

const ticketIs =
  (status: "RESOLVED" | "CLOSED"): Arrange =>
  async (scope, prisma) => {
    await prisma.ticket.update({
      where: { reference: scope.world.ticketReference },
      data: { status, ...(status === "CLOSED" ? { closedAt: new Date(), resolvedAt: new Date() } : { resolvedAt: new Date() }) },
    });
  };

const courseIs =
  (status: "PUBLISHED" | "ARCHIVED"): Arrange =>
  async (scope, prisma) => {
    await prisma.course.update({ where: { id: scope.world.courseAId }, data: { status } });
  };

const programmeIs =
  (status: "PUBLISHED" | "ARCHIVED"): Arrange =>
  async (scope, prisma) => {
    await prisma.programme.update({ where: { id: scope.world.programmeId }, data: { status } });
  };

const gradeIs =
  (which: "draft" | "released", status: "DRAFT" | "RELEASED"): Arrange =>
  async (scope, prisma) => {
    await prisma.grade.update({
      where: { id: which === "draft" ? scope.world.gradeDraftId : scope.world.gradeReleasedId },
      data: { status, releasedAt: status === "RELEASED" ? new Date() : null },
    });
  };

const templateArchived: Arrange = async (scope, prisma) => {
  await prisma.certificateTemplate.update({ where: { id: scope.world.templateId }, data: { archivedAt: new Date() } });
};

const caseResolved: Arrange = async (scope, prisma) => {
  await prisma.reconciliationCase.update({
    where: { id: scope.world.reconciliationCaseId },
    data: {
      status: "RESOLVED",
      resolutionReason: "OTHER",
      resolutionNote: "Set by the state matrix.",
      resolvedAt: new Date(),
      resolvedById: scope.personas.staffGlobal.userId!,
    },
  });
};

const iso = (date: Date) => date.toISOString();

const E = "src/app/staff/cohorts/[id]/enrolment-actions.ts";
const COHORT_PUBLISH = "src/app/staff/cohorts/[id]/publish-actions.ts";
const SESSIONS = "src/app/staff/cohorts/[id]/session-actions.ts";
const ATTENDANCE = "src/app/staff/cohorts/[id]/attendance-actions.ts";
const PROGRESS = "src/app/staff/cohorts/[id]/progress-actions.ts";
const CERT_ISSUE = "src/app/staff/certificates/certificate-actions.ts";
const CERT_RECORD = "src/app/staff/certificates/issued/[id]/certificate-record-actions.ts";
const SUPPORT = "src/app/staff/support/[reference]/actions.ts";
const LEARNER_SUPPORT = "src/app/(learner)/support/[reference]/actions.ts";
const COURSE_PUBLISH = "src/app/staff/courses/[id]/publish-actions.ts";
const PROGRAMME_PUBLISH = "src/app/staff/programmes/[id]/publish-actions.ts";
const GRADE_ACTIONS = "src/app/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/actions.ts";
const TEMPLATES = "src/app/staff/certificates/templates/template-actions.ts";
const PAYMENTS = "src/app/staff/payments/actions.ts";
const LESSON = "src/app/(lesson)/learn/[enrolmentId]/lessons/[lessonId]";
const REPORT_ACTIONS = "src/app/staff/reports/actions.ts";
const USERS = "src/app/staff/users/actions.ts";

/** The order is paid: a captured payment attempt exists (the world's attempt, settled). */
const orderPaid: Arrange = async (scope, prisma) => {
  await prisma.order.update({ where: { id: scope.world.orderAId }, data: { status: "PAID", paidAt: new Date() } });
  await prisma.paymentAttempt.updateMany({
    where: { orderId: scope.world.orderAId },
    data: { status: "SUCCEEDED", confirmedAt: new Date() },
  });
};

/** The whole order has already been refunded: a completed refund for its full amount, order REFUNDED. */
const orderFullyRefunded: Arrange = async (scope, prisma) => {
  await orderPaid(scope, prisma);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: scope.world.orderAId } });
  const attempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { orderId: scope.world.orderAId } });
  await prisma.refund.create({
    data: {
      orderId: order.id,
      paymentAttemptId: attempt.id,
      amountMinor: order.amountMinor,
      currency: order.currency,
      provider: "PAYSTACK",
      reason: "Set by the state matrix.",
      accessDecision: "RETAINED",
      status: "RECORDED_MANUALLY",
      completedAt: new Date(),
    },
  });
  await prisma.order.update({ where: { id: order.id }, data: { status: "REFUNDED" } });
};

const attemptSubmitted: Arrange = async (scope, prisma) => {
  await prisma.attempt.update({
    where: { id: scope.world.attemptId },
    data: { status: "SUBMITTED", submittedAt: new Date(), score: 1, maxScore: 1, passed: true },
  });
};

const exportIs =
  (status: "SUCCEEDED" | "FAILED" | "EXPIRED"): Arrange =>
  async (scope, prisma) => {
    await prisma.exportJob.updateMany({ where: { id: { in: [scope.world.exportFailedId, scope.world.exportDoneId, scope.world.exportExpiredId] } }, data: { status } });
  };

const resourceUploading: Arrange = async (scope, prisma) => {
  await prisma.lessonResource.update({ where: { id: scope.world.resourceFileId }, data: { uploadStatus: "UPLOADING" } });
};

const ticketAttachmentUploading: Arrange = async (scope, prisma) => {
  await prisma.ticketAttachment.update({ where: { id: scope.world.ticketAttachmentReadyId }, data: { uploadStatus: "UPLOADING" } });
};

const submissionUploading: Arrange = async (scope, prisma) => {
  await prisma.submission.update({ where: { id: scope.world.submissionDraftId }, data: { uploadStatus: "UPLOADING" } });
};

const staffTargetDeactivated: Arrange = async (scope, prisma) => {
  await prisma.user.update({ where: { id: scope.world.staffTargetUserId }, data: { status: "DEACTIVATED", deactivatedAt: new Date() } });
};

const ownerAnonymised: Arrange = async (scope, prisma) => {
  await prisma.user.update({
    where: { id: scope.world.ownerUserId },
    data: { status: "DEACTIVATED", deactivatedAt: new Date(), anonymisedAt: new Date() },
  });
};

const cohortUpdatedAtArgs = (scope: ScopeWorld, prisma: PrismaClient) => prisma.cohort.findUniqueOrThrow({ where: { id: scope.world.cohortAId } });

export const STATE_CASES: readonly StateCase[] = [
  // ---- enrolments: the transition table and the closed-cohort rule ----
  ...(["CANCELLED", "COMPLETED"] as const).flatMap((status) =>
    ["addEnrolmentAction", "addEnrolmentsAction"].map(
      (name): StateCase => ({ entryKey: `${E}#${name}`, state: `cohort:${status}`, caller: "staff", message: /cannot accept new enrolments/i, arrange: cohortIs(status) }),
    ),
  ),
  ...(["CANCELLED", "WITHDRAWN"] as const).flatMap((status) =>
    ["approveEnrolmentAction", "cancelEnrolmentAction", "withdrawEnrolmentAction"].map(
      (name): StateCase => ({ entryKey: `${E}#${name}`, state: `enrolment:${status}`, caller: "staff", message: /cannot be changed to/i, arrange: enrolmentIs(status) }),
    ),
  ),
  // A transfer needs a target of the same offer, so the sibling cohort of the same course is the target
  // and the enrolment's own state is what refuses it.
  ...(["CANCELLED", "WITHDRAWN"] as const).map(
    (status): StateCase => ({
      entryKey: `${E}#transferEnrolmentAction`,
      state: `enrolment:${status}`,
      caller: "staff",
      message: /cannot be changed to/i,
      arrange: enrolmentIs(status),
      args: async (scope, prisma) => [
        {
          cohortId: scope.world.cohortAId,
          enrolmentId: scope.world.enrolmentAId,
          targetCohortId: await seedSiblingCohort(prisma, scope),
          reason: "Moved to the sibling cohort of the same course.",
        },
      ],
    }),
  ),
  { entryKey: `${E}#approveEnrolmentAction`, state: "cohort:COMPLETED", caller: "staff", message: /cannot accept new enrolments/i, arrange: cohortIs("COMPLETED") },
  { entryKey: `${PROGRESS}#overrideLessonProgressAction`, state: "enrolment:CANCELLED", caller: "staff", message: /enrolled path/i, arrange: enrolmentIs("CANCELLED") },
  { entryKey: `${CERT_ISSUE}#issueCertificateAction`, state: "enrolment:CANCELLED", caller: "staff", arrange: enrolmentIs("CANCELLED") },
  { entryKey: `${CERT_ISSUE}#issueCertificateAction`, state: "certificate:ACTIVE", caller: "staff", arrange: async () => {} },

  // ---- cohorts ----
  ...(["CANCELLED", "COMPLETED"] as const).map(
    (status): StateCase => ({
      entryKey: `${COHORT_PUBLISH}#publishCohortAction`,
      state: `cohort:${status}`,
      caller: "staff",
      message: /cannot accept new enrolments/i,
      arrange: cohortIs(status),
      args: async (scope, prisma) => [
        { cohortId: scope.world.cohortAId, expectedUpdatedAt: iso((await cohortUpdatedAtArgs(scope, prisma)).updatedAt) },
      ],
    }),
  ),
  {
    entryKey: `${COHORT_PUBLISH}#cancelCohortAction`,
    state: "cohort:CANCELLED",
    caller: "staff",
    arrange: cohortIs("CANCELLED"),
    args: async (scope, prisma) => [
      {
        cohortId: scope.world.cohortAId,
        expectedUpdatedAt: iso((await cohortUpdatedAtArgs(scope, prisma)).updatedAt),
        reason: "Cancelling a cohort that is already cancelled.",
      },
    ],
  },
  { entryKey: `${SESSIONS}#cancelSessionAction`, state: "session:CANCELLED", caller: "staff", message: /cancelled session cannot be changed/i, arrange: sessionCancelled },
  { entryKey: `${SESSIONS}#updateSessionAction`, state: "session:CANCELLED", caller: "staff", message: /cancelled session cannot be changed/i, arrange: sessionCancelled },
  { entryKey: `${ATTENDANCE}#saveAttendanceAction`, state: "session:CANCELLED", caller: "staff", arrange: sessionCancelled },
  { entryKey: `${ATTENDANCE}#correctAttendanceAction`, state: "session:CANCELLED", caller: "staff", arrange: sessionCancelled },

  // ---- payments ----
  { entryKey: `${PAYMENTS}#confirmManualPaymentAction`, state: "order:PAID", caller: "staff", idempotent: "A paid order answers ALREADY_PAID with the existing transaction and writes nothing (PAY-04).", message: /ALREADY_PAID/, arrange: orderPaid },
  { entryKey: `${PAYMENTS}#confirmManualPaymentAction`, state: "order:REFUNDED", caller: "staff", idempotent: "A refunded order is still a historically paid order: ALREADY_PAID, nothing written (PAY-04).", message: /ALREADY_PAID/, arrange: orderFullyRefunded },
  { entryKey: `${PAYMENTS}#recordRefundAction`, state: "order:PENDING", caller: "staff", message: /no successful payment attempt/i, arrange: async () => {} },
  { entryKey: `${PAYMENTS}#recordRefundAction`, state: "order:CANCELLED", caller: "staff", message: /no successful payment attempt/i, arrange: orderIs("CANCELLED") },
  { entryKey: `${PAYMENTS}#recordRefundAction`, state: "order:REFUNDED", caller: "staff", message: /exceeds|eligible|refundable/i, arrange: orderFullyRefunded },
  { entryKey: "src/app/(checkout)/checkout/[orderId]/actions.ts#payAction", state: "order:PAID", caller: "owner", message: /"kind":"redirect"/, arrange: orderPaid },
  { entryKey: "src/app/(checkout)/checkout/[orderId]/actions.ts#payAction", state: "order:CANCELLED", caller: "owner", message: /"kind":"redirect"/, arrange: orderIs("CANCELLED") },

  // ---- certificates ----
  // (reissue is left out on purpose: a revoked certificate may be reissued once the learner completes
  // again, and a superseded one is refused by the completion check first, so the state is not what
  // the refusal isolates.)
  ...(["REVOKED", "SUPERSEDED"] as const).flatMap((status) =>
    ["revokeCertificateAction", "confirmFlaggedCertificateAction"].map(
      (name): StateCase => ({ entryKey: `${CERT_RECORD}#${name}`, state: `certificate:${status}`, caller: "staff", arrange: certificateIs(status) }),
    ),
  ),

  // ---- support: a closed ticket's chronology is read-only ----
  ...[
    "acceptEscalationAction",
    "addInternalNoteAction",
    "assignTicketAction",
    "changePriorityAction",
    "claimTicketAction",
    "escalateTicketAction",
    "moveQueueAction",
    "resolveTicketAction",
    "sendPublicReplyAction",
  ].map((name): StateCase => ({ entryKey: `${SUPPORT}#${name}`, state: "ticket:CLOSED", caller: "staff", arrange: ticketIs("CLOSED") })),
  { entryKey: `${LEARNER_SUPPORT}#replyToTicketAction`, state: "ticket:CLOSED", caller: "owner", arrange: ticketIs("CLOSED") },
  { entryKey: `${LEARNER_SUPPORT}#replyToTicketAction`, state: "ticket:RESOLVED", caller: "owner", arrange: ticketIs("RESOLVED") },
  { entryKey: `${LEARNER_SUPPORT}#closeTicketAction`, state: "ticket:CLOSED", caller: "owner", arrange: ticketIs("CLOSED") },
  { entryKey: `${LEARNER_SUPPORT}#closeTicketAction`, state: "ticket:OPEN", caller: "owner", arrange: async () => {} },
  { entryKey: `${LEARNER_SUPPORT}#reopenTicketAction`, state: "ticket:CLOSED", caller: "owner", arrange: ticketIs("CLOSED") },
  { entryKey: `${LEARNER_SUPPORT}#reopenTicketAction`, state: "ticket:OPEN", caller: "owner", arrange: async () => {} },

  // ---- courses and programmes: restoring is only for an archived record ----
  {
    entryKey: `${COURSE_PUBLISH}#publishCourseAction`,
    state: "course:ARCHIVED",
    caller: "staff",
    // Ready in every other respect, so the readiness check cannot be what refuses it.
    arrange: async (scope, prisma) => {
      await prisma.course.update({ where: { id: scope.world.courseAId }, data: { summary: "A ready summary for the state matrix." } });
      await courseIs("ARCHIVED")(scope, prisma);
    },
    args: async (scope, prisma) => [
      {
        courseId: scope.world.courseAId,
        expectedUpdatedAt: iso((await prisma.course.findUniqueOrThrow({ where: { id: scope.world.courseAId } })).updatedAt),
        migrateCohortIds: [],
      },
    ],
  },
  { entryKey: `${COURSE_PUBLISH}#unarchiveCourseAction`, state: "course:PUBLISHED", caller: "staff", message: /not archived/i, arrange: courseIs("PUBLISHED") },
  { entryKey: `${COURSE_PUBLISH}#unarchiveCourseAction`, state: "course:DRAFT", caller: "staff", message: /not archived/i, arrange: async () => {} },
  {
    entryKey: `${PROGRAMME_PUBLISH}#publishProgrammeAction`,
    state: "programme:ARCHIVED",
    caller: "staff",
    arrange: async (scope, prisma) => {
      await prisma.programme.update({ where: { id: scope.world.programmeId }, data: { summary: "A ready summary for the state matrix." } });
      await programmeIs("ARCHIVED")(scope, prisma);
    },
    args: async (scope, prisma) => [
      {
        programmeId: scope.world.programmeId,
        expectedUpdatedAt: iso((await prisma.programme.findUniqueOrThrow({ where: { id: scope.world.programmeId } })).updatedAt),
        migrateCohortIds: [],
      },
    ],
  },
  { entryKey: `${PROGRAMME_PUBLISH}#unarchiveProgrammeAction`, state: "programme:PUBLISHED", caller: "staff", message: /not archived/i, arrange: programmeIs("PUBLISHED") },
  { entryKey: `${PROGRAMME_PUBLISH}#unarchiveProgrammeAction`, state: "programme:DRAFT", caller: "staff", message: /not archived/i, arrange: async () => {} },

  // ---- grading ----
  { entryKey: `${GRADE_ACTIONS}#releaseGradeAction`, state: "grade:RELEASED", caller: "staff", idempotent: "Releasing a released grade returns the existing grade and writes nothing.", arrange: gradeIs("draft", "RELEASED") },
  { entryKey: `${GRADE_ACTIONS}#saveDraftGradeAction`, state: "grade:RELEASED", caller: "staff", arrange: gradeIs("draft", "RELEASED") },
  { entryKey: `${GRADE_ACTIONS}#overrideGradeAction`, state: "grade:DRAFT", caller: "staff", arrange: gradeIs("released", "DRAFT") },

  // ---- reconciliation, certificate templates ----
  { entryKey: "src/app/staff/reconciliation/actions.ts#resolveReconciliationCaseAction", state: "case:RESOLVED", caller: "staff", idempotent: "Resolving a resolved case is a no-op that writes nothing.", arrange: caseResolved },
  { entryKey: `${TEMPLATES}#setDefaultTemplateAction`, state: "template:ARCHIVED", caller: "staff", arrange: templateArchived },

  // ---- learner records ----
  { entryKey: `${LESSON}/assessment-actions.ts#submitAttemptAction`, state: "attempt:SUBMITTED", caller: "owner", arrange: attemptSubmitted },
  { entryKey: `${LESSON}/assessment-actions.ts#saveAttemptAnswersAction`, state: "attempt:SUBMITTED", caller: "owner", arrange: attemptSubmitted },
  ...["markLessonCompleteAction", "undoLessonCompleteAction", "recordWatchProgressAction"].map(
    (name): StateCase => ({ entryKey: `${LESSON}/actions.ts#${name}`, state: "enrolment:CANCELLED", caller: "owner", arrange: enrolmentIs("CANCELLED") }),
  ),
  { entryKey: `${LESSON}/assessment-actions.ts#startAttemptAction`, state: "enrolment:CANCELLED", caller: "owner", arrange: enrolmentIs("CANCELLED") },
  { entryKey: `${LESSON}/submission-actions.ts#beginSubmissionUploadAction`, state: "enrolment:CANCELLED", caller: "owner", arrange: enrolmentIs("CANCELLED") },

  // ---- exports and downloads ----
  { entryKey: `${REPORT_ACTIONS}#retryExportAction`, state: "job:SUCCEEDED", caller: "staff", arrange: exportIs("SUCCEEDED") },
  { entryKey: `${REPORT_ACTIONS}#rerunExportAction`, state: "job:SUCCEEDED", caller: "staff", arrange: exportIs("SUCCEEDED") },
  { entryKey: "src/app/api/staff/reports/exports/[jobId]/download/route.ts#GET", state: "job:EXPIRED", caller: "staff", arrange: exportIs("EXPIRED") },
  { entryKey: "src/app/api/staff/reports/exports/[jobId]/download/route.ts#GET", state: "job:FAILED", caller: "staff", arrange: exportIs("FAILED") },
  { entryKey: "src/app/api/lesson-resources/[id]/download/route.ts#GET", state: "resource:UPLOADING", caller: "staff", statuses: [409], arrange: resourceUploading },
  { entryKey: "src/app/api/ticket-attachments/[attachmentId]/download/route.ts#GET", state: "attachment:UPLOADING", caller: "owner", arrange: ticketAttachmentUploading },
  { entryKey: "src/app/api/submissions/[submissionId]/download/route.ts#GET", state: "submission:UPLOADING", caller: "staff", statuses: [409], arrange: submissionUploading },
  { entryKey: "src/app/api/certificates/[id]/download/route.ts#GET", state: "certificate:REVOKED", caller: "owner", staffProbeDenial: "The route tries the staff permission first and records that denial before the learner path answers.", arrange: certificateIs("REVOKED") },

  // ---- accounts ----
  { entryKey: `${USERS}#deactivateStaffAccountAction`, state: "user:DEACTIVATED", caller: "staff", idempotent: "Deactivating a deactivated account returns without writing.", arrange: staffTargetDeactivated },
  { entryKey: "src/app/staff/privacy/actions.ts#anonymiseLearnerAction", state: "user:ANONYMISED", caller: "staff", arrange: ownerAnonymised },
];

export { enrolmentIs, cohortIs, orderIs, ticketIs, courseIs };

// ---------------------------------------------------------------------------
// Positive-control overrides
// ---------------------------------------------------------------------------

/**
 * Entries whose positive control cannot be the generic one (the level's "right" staff
 * member with the entry's own input). Each says why.
 */
export type PositiveOverride = {
  /** Who is correctly scoped for this call. */
  persona: (personas: ScopePersonas) => Persona;
  /** Builds the input on the fresh database (default: the entry's own input). */
  args?: (scope: ScopeWorld, prisma: PrismaClient) => Promise<unknown>;
  note: string;
};

/** A second cohort on course A, so a transfer within the same offer is possible. */
export async function seedSiblingCohort(prisma: PrismaClient, scope: ScopeWorld): Promise<string> {
  const source = await prisma.cohort.findUniqueOrThrow({ where: { id: scope.world.cohortAId } });
  const {
    id: _id,
    code: _code,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    seatsTaken: _seatsTaken,
    ...rest
  } = source;
  void _id;
  void _code;
  void _createdAt;
  void _updatedAt;
  void _seatsTaken;
  const sibling = await prisma.cohort.create({
    data: { ...rest, code: "SCOPE-SIBLING-A2", title: "Scope sibling cohort", seatsTaken: 0 },
    select: { id: true },
  });
  return sibling.id;
}

export const POSITIVE_OVERRIDES: Readonly<Record<string, PositiveOverride>> = {
  "src/app/staff/cohorts/[id]/enrolment-actions.ts#transferEnrolmentAction": {
    persona: (personas) => personas.staffCourseA,
    args: async (scope, prisma) => {
      await certificateOut(scope, prisma);
      const targetCohortId = await seedSiblingCohort(prisma, scope);
      return [
        { cohortId: scope.world.cohortAId, enrolmentId: scope.world.enrolmentAId, targetCohortId, reason: "Moved to the sibling cohort of the same course." },
      ];
    },
    note:
      "A transfer needs enrolments.manage on BOTH cohorts and the same offer, so the right person is staff scoped to the course (reaching both cohorts of it), moving the enrolment to a sibling cohort of the same course.",
  },
  "src/app/staff/courses/[id]/assessments/actions.ts#createAssessmentAction": {
    persona: (personas) => personas.staffGlobal,
    note:
      "Creating an assessment resolves its scope to {} (the resource service's create has no record to scope by), so only a Global grant can create. Course-scoped staff are refused, which fails safe; recorded in the summary as an observation.",
  },
};

// ---------------------------------------------------------------------------
// Collection-scope data
// ---------------------------------------------------------------------------

export type ExportData = {
  enrolmentAId: string;
  enrolmentBId: string;
  orderAReference: string;
  orderBReference: string;
};

/**
 * One active enrolment and one refund in each of cohort A and cohort B, so an export requested
 * by staff scoped to one cohort has rows of the other cohort to (wrongly) include.
 */
export async function seedExportData(prisma: PrismaClient, scope: ScopeWorld): Promise<ExportData> {
  const { world } = scope;
  const activatedAt = new Date(Date.now() - 3_600_000);
  await prisma.enrolment.update({
    where: { id: world.enrolmentAId },
    data: { status: "ACTIVE", holdExpiresAt: null, activatedAt },
  });
  const orderB = await world.freshOrder("B");
  const enrolmentB = await prisma.enrolment.findFirstOrThrow({ where: { orderId: orderB.orderId }, select: { id: true } });
  await prisma.enrolment.update({
    where: { id: enrolmentB.id },
    data: { status: "ACTIVE", holdExpiresAt: null, activatedAt },
  });

  const orderA = await prisma.order.findUniqueOrThrow({ where: { id: world.orderAId } });
  const orderBRow = await prisma.order.findUniqueOrThrow({ where: { id: orderB.orderId } });
  const attemptA = await prisma.paymentAttempt.findFirstOrThrow({ where: { orderId: orderA.id } });
  const attemptB = await prisma.paymentAttempt.create({
    data: {
      orderId: orderBRow.id,
      provider: "PAYSTACK",
      amountMinor: orderBRow.amountMinor,
      currency: "NGN",
      idempotencyKey: "scope-matrix-attempt-b",
    },
    select: { id: true },
  });
  for (const [order, attemptId] of [
    [orderA, attemptA.id],
    [orderBRow, attemptB.id],
  ] as const) {
    await prisma.refund.create({
      data: {
        orderId: order.id,
        paymentAttemptId: attemptId,
        amountMinor: 1_000,
        currency: "NGN",
        provider: "PAYSTACK",
        reason: "Seeded for the collection-scope check.",
        accessDecision: "RETAINED",
        status: "RECORDED_MANUALLY",
        completedAt: new Date(),
      },
    });
  }
  return {
    enrolmentAId: world.enrolmentAId,
    enrolmentBId: enrolmentB.id,
    orderAReference: orderA.reference,
    orderBReference: orderBRow.reference,
  };
}
