/**
 * Input builders for the authorization matrix (Phase 15, plan 15-25; D-09).
 *
 * Each registry entry names an `inputId`. The builder here returns the exact
 * arguments to hand the exported action (or the request for a route) so the call
 * is schema-valid and names a REAL record in the matrix database. That matters:
 * a denial must come from the authorization wiring, not from the input being
 * rejected first. The matrix proves it by requiring an `authorization.denied`
 * audit row for every permission-guarded entry that uses the audited choke point.
 *
 * `World` is the shared set of records every builder draws on. It is created once
 * per matrix database: `seedWorld()` makes the cohorts and fee schedule,
 * `seedPersonas()` (authz-matrix.ts) makes the people, and `world.attachOwner()`
 * then creates the records the owning learner holds (order, enrolment, ticket,
 * notification, certificate, submissions and grades) and the staff-side records
 * (programme, role, assignment, export jobs, reconciliation case).
 *
 * Builders only NAME these records. A denied call must not change them, which the
 * matrix proves with a snapshot of every table before and after.
 *
 * ESLint boundary note: this file lives under `tests/`, outside the `src/**` glob
 * that confines `@prisma/client`, so importing the client type here is intentional.
 */

import type { PrismaClient } from "@prisma/client";
import { calculatePlatformFeeMinor } from "@/server/payments/pricing";
import {
  seedLearnerFixture,
  seedPaystackNgnFeeScheduleFixture,
  seedPublishedCohortFixture,
  seedSessionFixture,
} from "./cohort-fixtures";
import type { Personas, RouteRequest } from "./authz-matrix";

/** Base price of every cohort in the world, in kobo. */
export const BASE_AMOUNT_MINOR = 45_000_000;

const BASE_URL = "http://localhost:3000";

export type FreshOrder = { orderId: string; totalMinor: number; learnerUserId: string };

export type World = {
  prisma: PrismaClient;
  personas: Personas;
  cohortAId: string;
  courseAId: string;
  cohortBId: string;
  courseBId: string;
  spareCourseId: string;

  ownerUserId: string;
  /** A pending order for the owning learner in cohort A; denied calls never change it. */
  orderAId: string;
  orderATotalMinor: number;
  enrolmentAId: string;
  sessionAId: string;

  moduleId: string;
  lessonId: string;
  videoLessonId: string;
  quizLessonId: string;
  fileLessonId: string;
  resourceFileId: string;
  resourceVideoId: string;
  resourceCaptionId: string;
  resourcePendingId: string;

  quizId: string;
  quizQuestionId: string;
  quizOptionId: string;
  assignmentId: string;
  attemptId: string;
  submissionDraftId: string;
  submissionReleasedId: string;
  gradeDraftId: string;
  gradeReleasedId: string;

  programmeId: string;
  programmeCourseId: string;

  ticketReference: string;
  ticketMessageId: string;
  ticketAttachmentReadyId: string;
  ticketAttachmentUploadingId: string;
  notificationId: string;

  templateId: string;
  certificateId: string;

  exportFailedId: string;
  exportExpiredId: string;
  exportDoneId: string;
  reconciliationCaseId: string;
  emailDispatchId: string;

  roleId: string;
  staffTargetUserId: string;
  targetAssignmentId: string;

  /** A new pending order for a brand-new learner in the chosen cohort. */
  freshOrder(cohort: "A" | "B"): Promise<FreshOrder>;
  attachOwner(personas: Personas): Promise<void>;
};

/**
 * Creates the two cohorts (each on its own published course) and the Paystack fee
 * schedule checkout needs. Call after `startMatrixDatabase()`.
 */
export async function seedWorld(prisma: PrismaClient): Promise<World> {
  await seedPaystackNgnFeeScheduleFixture(prisma);

  const cohortOptions = {
    capacity: 200,
    seatsTaken: 0,
    priceNgnMinor: BASE_AMOUNT_MINOR,
    priceUsdMinor: null,
    currency: "NGN",
    holdMinutes: 30,
  };
  const a = await seedPublishedCohortFixture(prisma, cohortOptions);
  const b = await seedPublishedCohortFixture(prisma, cohortOptions);

  const totalMinor = BASE_AMOUNT_MINOR + calculatePlatformFeeMinor(BASE_AMOUNT_MINOR);

  async function startOrder(cohortId: string, learnerUserId: string): Promise<string> {
    // Imported late: checkout-service binds `@/server/db` to DATABASE_URL on first evaluation.
    const checkout = await import("@/server/services/checkout-service");
    const { orderId } = await checkout.startCheckout({ userId: learnerUserId }, cohortId, "NGN");
    return orderId;
  }

  const world = {
    prisma,
    cohortAId: a.cohortId,
    courseAId: a.courseId,
    cohortBId: b.cohortId,
    courseBId: b.courseId,
    orderATotalMinor: totalMinor,
    async freshOrder(cohort: "A" | "B") {
      const { userId } = await seedLearnerFixture(prisma, { emailVerified: new Date() });
      const orderId = await startOrder(cohort === "A" ? world.cohortAId : world.cohortBId, userId);
      return { orderId, totalMinor, learnerUserId: userId };
    },
    async attachOwner(personas: Personas) {
      await attachOwnerRecords(world as unknown as World, personas, startOrder);
    },
  };
  return world as unknown as World;
}

async function attachOwnerRecords(
  world: World,
  personas: Personas,
  startOrder: (cohortId: string, learnerUserId: string) => Promise<string>,
): Promise<void> {
  const prisma = world.prisma;
  const ownerUserId = personas.learnerOwner.userId!;
  const staffGlobalId = personas.staffGlobal.userId!;
  world.personas = personas;
  world.ownerUserId = ownerUserId;

  // --- orders, enrolment, session ---
  world.orderAId = await startOrder(world.cohortAId, ownerUserId);
  const enrolment = await prisma.enrolment.findFirstOrThrow({ where: { orderId: world.orderAId }, select: { id: true } });
  world.enrolmentAId = enrolment.id;
  world.sessionAId = (await seedSessionFixture(prisma, { cohortId: world.cohortAId })).sessionId;
  world.spareCourseId = (
    await prisma.course.create({ data: { slug: "matrix-spare-course", title: "Matrix spare course" }, select: { id: true } })
  ).id;

  // --- course content on course A ---
  const courseModule = await prisma.module.create({
    data: { courseId: world.courseAId, title: "Matrix module", position: 0 },
    select: { id: true },
  });
  world.moduleId = courseModule.id;
  const textLesson = await prisma.lesson.create({
    data: { moduleId: courseModule.id, title: "Matrix text lesson", type: "TEXT", position: 0, body: "<p>Matrix body</p>" },
    select: { id: true },
  });
  world.lessonId = textLesson.id;
  const videoLesson = await prisma.lesson.create({
    data: { moduleId: courseModule.id, title: "Matrix video lesson", type: "VIDEO", position: 1, videoDurationSeconds: 100 },
    select: { id: true },
  });
  world.videoLessonId = videoLesson.id;

  const readyResource = (lessonId: string, title: string, mimeType: string, extra: Record<string, unknown> = {}) =>
    prisma.lessonResource.create({
      data: {
        lessonId,
        title,
        storageKey: `lessons/${lessonId}/${title.replace(/\s+/g, "-").toLowerCase()}`,
        filename: `${title.replace(/\s+/g, "-").toLowerCase()}.bin`,
        mimeType,
        sizeBytes: BigInt(1024),
        uploadStatus: "READY",
        ...extra,
      } as never,
      select: { id: true },
    });
  world.resourceFileId = (await readyResource(textLesson.id, "Matrix file", "application/pdf")).id;
  world.resourceVideoId = (await readyResource(videoLesson.id, "Matrix video", "video/mp4")).id;
  world.resourceCaptionId = (
    await readyResource(videoLesson.id, "Matrix caption", "text/vtt", {
      captionForResourceId: world.resourceVideoId,
      captionLanguage: "en",
      captionLabel: "English",
    })
  ).id;
  world.resourcePendingId = (
    await readyResource(textLesson.id, "Matrix pending", "application/pdf", { uploadStatus: "UPLOADING" })
  ).id;

  // --- assessments, attempt, submissions, grades ---
  const quiz = await prisma.assessment.create({
    data: {
      courseId: world.courseAId, type: "QUIZ", title: "Matrix quiz", status: "PUBLISHED",
      maxAttempts: 3, passMark: 1, totalMarks: 1,
    },
    select: { id: true },
  });
  world.quizId = quiz.id;
  const question = await prisma.quizQuestion.create({
    data: {
      assessmentId: quiz.id, position: 0, prompt: "Matrix question?", type: "SINGLE_CHOICE", marks: 1,
      options: { create: [{ position: 0, label: "Right", isCorrect: true }, { position: 1, label: "Wrong", isCorrect: false }] },
    },
    select: { id: true, options: { select: { id: true }, orderBy: { position: "asc" } } },
  });
  world.quizQuestionId = question.id;
  world.quizOptionId = question.options[0]!.id;
  const quizLesson = await prisma.lesson.create({
    data: { moduleId: courseModule.id, title: "Matrix quiz lesson", type: "QUIZ", position: 2, assessmentId: quiz.id },
    select: { id: true },
  });
  world.quizLessonId = quizLesson.id;
  world.fileLessonId = (
    await prisma.lesson.create({
      data: { moduleId: courseModule.id, title: "Matrix file lesson", type: "FILE", position: 3 },
      select: { id: true },
    })
  ).id;
  const assignment = await prisma.assessment.create({
    data: {
      courseId: world.courseAId, type: "ASSIGNMENT", title: "Matrix assignment", status: "PUBLISHED",
      allowedFileTypes: ["pdf"], maxFileSizeBytes: 10_000_000, totalMarks: 10,
    },
    select: { id: true },
  });
  world.assignmentId = assignment.id;
  world.attemptId = (
    await prisma.attempt.create({
      data: { assessmentId: quiz.id, enrolmentId: world.enrolmentAId, attemptNumber: 1, versionUsed: 1, status: "IN_PROGRESS" },
      select: { id: true },
    })
  ).id;
  const submission = (attemptNumber: number) =>
    prisma.submission.create({
      data: {
        assessmentId: assignment.id, enrolmentId: world.enrolmentAId, attemptNumber, versionUsed: 1,
        storageKey: `submissions/${world.enrolmentAId}/${assignment.id}/matrix-${attemptNumber}`,
        filename: "work.pdf", mimeType: "application/pdf", sizeBytes: 1000, uploadStatus: "READY",
      },
      select: { id: true },
    });
  world.submissionDraftId = (await submission(1)).id;
  world.submissionReleasedId = (await submission(2)).id;
  world.gradeDraftId = (
    await prisma.grade.create({
      data: {
        assessmentId: assignment.id, enrolmentId: world.enrolmentAId, submissionId: world.submissionDraftId,
        score: 3, maxScore: 10, status: "DRAFT",
      },
      select: { id: true },
    })
  ).id;
  world.gradeReleasedId = (
    await prisma.grade.create({
      data: {
        assessmentId: assignment.id, enrolmentId: world.enrolmentAId, submissionId: world.submissionReleasedId,
        score: 6, maxScore: 10, passed: true, status: "RELEASED", releasedAt: new Date(),
      },
      select: { id: true },
    })
  ).id;

  // --- programme ---
  const programme = await prisma.programme.create({
    data: { slug: "matrix-programme", title: "Matrix programme" },
    select: { id: true },
  });
  world.programmeId = programme.id;
  world.programmeCourseId = (
    await prisma.programmeCourse.create({
      data: { programmeId: programme.id, courseId: world.courseAId, position: 0 },
      select: { id: true },
    })
  ).id;

  // --- the owning learner's support ticket, notification, certificate ---
  world.ticketReference = "TKT-MATRIX-0001";
  const ticket = await prisma.ticket.create({
    data: { reference: world.ticketReference, userId: ownerUserId, category: "OTHER", subject: "Matrix ticket", status: "OPEN" },
    select: { id: true },
  });
  const message = await prisma.ticketMessage.create({
    data: { ticketId: ticket.id, authorId: ownerUserId, kind: "INITIAL", visibility: "PUBLIC", body: "Matrix ticket body" },
    select: { id: true },
  });
  world.ticketMessageId = message.id;
  await prisma.ticketEvent.create({ data: { ticketId: ticket.id, actorId: ownerUserId, type: "CREATED" } });
  const attachment = (uploadStatus: "READY" | "UPLOADING", name: string) =>
    prisma.ticketAttachment.create({
      data: {
        ticketId: ticket.id, messageId: message.id, uploadedById: ownerUserId,
        storageKey: `ticket-uploads/${ticket.id}/${name}`, filename: `${name}.png`, mimeType: "image/png",
        sizeBytes: BigInt(1000), uploadStatus,
      },
      select: { id: true },
    });
  world.ticketAttachmentReadyId = (await attachment("READY", "matrix-ready")).id;
  world.ticketAttachmentUploadingId = (await attachment("UPLOADING", "matrix-uploading")).id;
  world.notificationId = (
    await prisma.notification.create({
      data: {
        recipientId: ownerUserId, type: "enrolment.activated", targetType: "ENROLMENT",
        targetId: world.enrolmentAId, params: {}, sourceEventId: "matrix-event-1",
      },
      select: { id: true },
    })
  ).id;
  world.templateId = (
    await prisma.certificateTemplate.create({
      data: { name: "Matrix template", layout: { schema: 1, pageSize: "A4", orientation: "landscape", elements: [] } },
      select: { id: true },
    })
  ).id;
  world.certificateId = (
    await prisma.certificate.create({
      data: {
        verificationRef: "MATRIX-REF-0001", enrolmentId: world.enrolmentAId, userId: ownerUserId,
        scope: "COURSE", courseId: world.courseAId, awardTitle: "Matrix course", learnerName: "Matrix learnerOwner",
      },
      select: { id: true },
    })
  ).id;

  // --- staff-side records: exports owned by the Global staff member, a case, mail, a role ---
  const exportJob = (status: "FAILED" | "EXPIRED" | "SUCCEEDED") =>
    prisma.exportJob.create({
      data: {
        requestedById: staffGlobalId, dataset: "registrations", status, rowCount: 0,
        scopeSnapshot: { kind: "GLOBAL", programmeIds: [], courseIds: [], cohortIds: [] },
        columnSnapshot: [{ key: "id", label: "Registration", valueType: "TEXT" }],
        ...(status === "SUCCEEDED"
          ? { storageKey: "exports/matrixexportjob/1.0.csv", expiresAt: new Date(Date.now() + 3_600_000) }
          : {}),
      },
      select: { id: true },
    });
  world.exportFailedId = (await exportJob("FAILED")).id;
  world.exportExpiredId = (await exportJob("EXPIRED")).id;
  world.exportDoneId = (await exportJob("SUCCEEDED")).id;
  const attempt = await prisma.paymentAttempt.create({
    data: {
      orderId: world.orderAId, provider: "PAYSTACK", amountMinor: world.orderATotalMinor, currency: "NGN",
      idempotencyKey: "matrix-attempt-1",
    },
    select: { id: true },
  });
  world.reconciliationCaseId = (
    await prisma.reconciliationCase.create({
      data: {
        subject: "PAYMENT", risk: "CAPTURED_MONEY", evidence: {}, evidenceFingerprint: "matrix-fingerprint",
        lastEvidenceAt: new Date(), paymentAttemptId: attempt.id,
      },
      select: { id: true },
    })
  ).id;
  world.emailDispatchId = (
    await prisma.emailDispatch.create({
      data: {
        template: "matrix.template", toEmail: "matrix-dispatch@authz-matrix.test", userId: ownerUserId,
        correlationId: "matrix-correlation-1", status: "FAILED", attempts: 1, failedAt: new Date(), error: "matrix",
      },
      select: { id: true },
    })
  ).id;
  world.roleId = (
    await prisma.role.create({ data: { name: "Matrix target role", permissions: ["reports.view"] }, select: { id: true } })
  ).id;
  const staffTarget = await prisma.user.create({
    data: { email: "stafftarget@authz-matrix.test", name: "Matrix staffTarget", status: "ACTIVE", isStaff: true },
    select: { id: true },
  });
  world.staffTargetUserId = staffTarget.id;
  world.targetAssignmentId = (
    await prisma.assignment.create({
      data: { userId: staffTarget.id, roleId: world.roleId, scopeType: "GLOBAL", scopeId: null },
      select: { id: true },
    })
  ).id;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export type ActionInputBuilder = (world: World) => Promise<readonly unknown[]> | readonly unknown[];
export type RouteInputBuilder = (world: World) => Promise<RouteRequest> | RouteRequest;

const REASON = "Matrix reason that is long enough.";
const NOW_ISO = () => new Date().toISOString();
/** An `asOf` the export service accepts: in the past, within five minutes. */
const AS_OF = () => new Date(Date.now() - 1_000).toISOString();
const TOKEN = () => String(Date.now());

function form(fields: Record<string, string | readonly string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string") data.append(key, value);
    else for (const item of value) data.append(key, item);
  }
  return data;
}

/** The manual-payment input for an order, matching the action's strict schema. */
export function confirmManualPaymentInput(orderId: string, totalMinor: number, reference = `REF-${orderId}`) {
  return {
    orderId,
    amountMinor: totalMinor,
    currency: "NGN" as const,
    manualPaidAt: new Date().toISOString(),
    manualChannel: "bank_transfer",
    manualReference: reference,
    manualEvidenceKey: `evidence/${orderId}.pdf`,
    reason: "Confirmed against the bank statement.",
  };
}

export function recordRefundInput(orderId: string, amountMinor = 1_000) {
  return {
    orderId,
    amountMinor,
    reason: "Refund recorded for the authorization matrix.",
    accessDecision: "RETAINED" as const,
  };
}

const cohortFields = (world: World) => ({
  code: "MATRIX-NEW",
  title: "Matrix new cohort",
  courseId: world.spareCourseId,
  deliveryMode: "SELF_PACED",
  timezone: "Africa/Lagos",
  startsAt: "2027-02-01T09:00",
  endsAt: "2027-03-01T09:00",
  enrolmentOpensAt: "2027-01-01T09:00",
  enrolmentClosesAt: "2027-01-31T09:00",
  capacity: "10",
  priceNgnMinor: "100000",
});

const sessionFields = (world: World) => ({
  title: "Matrix session",
  date: "2027-01-04",
  startTime: "09:00",
  endTime: "10:00",
  cohortId: world.cohortAId,
});

const supportBase = (world: World) => ({ reference: world.ticketReference, expectedVersion: 1 });

export const ACTION_INPUTS: Readonly<Record<string, ActionInputBuilder>> = {
  // ---- (auth) ----
  "auth.forgotPassword": () => [{ error: null, sent: false }, form({ email: "matrix-nobody@authz-matrix.test" })],
  "auth.register": () => [
    { error: null, sent: false },
    form({ name: "Matrix New", email: "matrix-new@authz-matrix.test", password: "Passw0rd-matrix-1", acceptTerms: "on", acceptPrivacy: "on" }),
  ],
  "auth.resendVerification": () => [{ error: null, sent: false }, form({ email: "matrix-nobody@authz-matrix.test" })],
  "auth.resetPassword": () => [{ error: null }, form({ token: "matrix-token", password: "Passw0rd-matrix-1" })],
  "auth.signIn": () => [{ error: null }, form({ email: "matrix-nobody@authz-matrix.test", password: "wrong-password-1" })],
  "auth.signOut": () => [],

  // ---- (checkout) ----
  "checkout.enroll": (world) => [form({ cohortId: world.cohortBId, currency: "NGN" })],
  "checkout.pay": (world) => [form({ orderId: world.orderAId })],

  // ---- (learner) support ----
  "learnerSupport.close": (world) => [supportBase(world)],
  "learnerSupport.create": () => [{ category: "OTHER", subject: "Matrix subject", message: "Matrix message body" }],
  "learnerSupport.reopen": (world) => [{ ...supportBase(world), reason: "Matrix reopen reason" }],
  "learnerSupport.reply": (world) => [{ ...supportBase(world), body: "Matrix reply body" }],

  // ---- (lesson) ----
  "lesson.markComplete": (world) => [form({ enrolmentId: world.enrolmentAId, lessonId: world.lessonId })],
  "lesson.undoComplete": (world) => [form({ enrolmentId: world.enrolmentAId, lessonId: world.lessonId })],
  "lesson.watchProgress": (world) => [
    { enrolmentId: world.enrolmentAId, lessonId: world.videoLessonId, secondsWatched: 10, durationSeconds: 100 },
  ],
  "quiz.start": (world) => [{ enrolmentId: world.enrolmentAId, lessonId: world.quizLessonId, assessmentId: world.quizId }],
  "quiz.saveAnswers": (world) => [
    {
      enrolmentId: world.enrolmentAId, lessonId: world.quizLessonId, attemptId: world.attemptId,
      responses: [{ questionId: world.quizQuestionId, selectedOptionIds: [world.quizOptionId] }],
    },
  ],
  "quiz.submit": (world) => [
    {
      enrolmentId: world.enrolmentAId, lessonId: world.quizLessonId, attemptId: world.attemptId,
      responses: [{ questionId: world.quizQuestionId, selectedOptionIds: [world.quizOptionId] }],
    },
  ],
  "submission.begin": (world) => [
    { assessmentId: world.assignmentId, enrolmentId: world.enrolmentAId, filename: "work.pdf", mimeType: "application/pdf", sizeBytes: 1000 },
  ],
  "submission.complete": (world) => [{ submissionId: world.submissionDraftId }],
  "submission.fail": (world) => [{ submissionId: world.submissionDraftId, detail: "Matrix failure detail" }],
  "submission.loadView": (world) => [{ assessmentId: world.assignmentId, enrolmentId: world.enrolmentAId }],

  // ---- account and notifications ----
  "account.requestEmailChange": () => [
    { error: null, requested: false },
    form({ currentPassword: "not-the-password", newEmail: "matrix-change@authz-matrix.test" }),
  ],
  "account.setMarketing": () => [{ error: null, accepted: false }, form({ marketingOptIn: "on" })],
  "account.updateProfile": () => [
    { error: null, saved: false, saveCount: 0, savedProfile: null },
    form({ name: "Matrix Name", phone: "" }),
  ],
  "notifications.markAllRead": () => [],
  "notifications.open": (world) => [{ id: world.notificationId }],
  "notifications.savePreferences": () => [{ muted: [] }],

  // ---- staff: audit and certificates ----
  "audit.requestExport": () => [{ filters: {}, columns: ["eventId", "createdAt", "action"] }],
  "certificates.confirmFlagged": (world) => [{ certificateId: world.certificateId, reason: REASON }],
  "certificates.issue": (world) => [{ enrolmentId: world.enrolmentAId, scope: "COURSE" }],
  "certificates.reissue": (world) => [{ certificateId: world.certificateId, reason: REASON }],
  "certificates.revoke": (world) => [{ certificateId: world.certificateId, reason: REASON }],
  "certificates.validateReissue": (world) => [{ certificateId: world.certificateId, reason: REASON }],
  "certificates.validateRevoke": (world) => [{ certificateId: world.certificateId, reason: REASON }],
  "templates.archive": (world) => [{ id: world.templateId, reason: REASON }],
  "templates.confirmAsset": () => [{ stagedKey: "template-assets/staged/matrix", contentType: "image/png", sizeBytes: 100 }],
  "templates.create": () => [{ name: "Matrix new template" }],
  "templates.presignAsset": (world) => [{ templateId: world.templateId, filename: "logo.png", mimeType: "image/png", sizeBytes: 100 }],
  "templates.saveLayout": (world) => [
    {
      id: world.templateId,
      name: "Matrix template",
      layout: { schema: 1, pageSize: "A4", orientation: "landscape", elements: [{ kind: "border", style: "solid", color: "#123456", widthPt: 2 }] },
    },
  ],
  "templates.setDefault": (world) => [{ id: world.templateId }],

  // ---- staff: cohorts ----
  "attendance.correct": (world) => [
    { cohortId: world.cohortAId, sessionId: world.sessionAId, enrolmentId: world.enrolmentAId, state: "PRESENT", reason: REASON },
  ],
  "attendance.save": (world) => [
    { cohortId: world.cohortAId, sessionId: world.sessionAId, entries: [{ enrolmentId: world.enrolmentAId, state: "EXCUSED" }] },
  ],
  "enrolments.add": (world) => [
    { cohortId: world.cohortAId, userId: world.personas.learnerOther.userId!, target: "ACTIVE", reason: REASON },
  ],
  "enrolments.addMany": (world) => [
    { cohortId: world.cohortAId, userIds: [world.personas.learnerOther.userId!], target: "ACTIVE", reason: REASON },
  ],
  "enrolments.approve": (world) => [{ cohortId: world.cohortAId, enrolmentId: world.enrolmentAId, reason: REASON }],
  "enrolments.cancel": (world) => [{ cohortId: world.cohortAId, enrolmentId: world.enrolmentAId, reason: REASON }],
  "enrolments.listCandidates": (world) => [{ cohortId: world.cohortAId }],
  "enrolments.transfer": (world) => [
    { cohortId: world.cohortAId, enrolmentId: world.enrolmentAId, targetCohortId: world.cohortBId, reason: REASON },
  ],
  "enrolments.withdraw": (world) => [{ cohortId: world.cohortAId, enrolmentId: world.enrolmentAId, reason: REASON }],
  "grading.override": (world) => [
    {
      cohortId: world.cohortAId, assessmentId: world.assignmentId, submissionId: world.submissionReleasedId,
      gradeId: world.gradeReleasedId, newScore: 5, reason: REASON,
    },
  ],
  "grading.release": (world) => [
    { cohortId: world.cohortAId, assessmentId: world.assignmentId, submissionId: world.submissionDraftId, gradeId: world.gradeDraftId },
  ],
  "grading.releaseBatch": (world) => [{ cohortId: world.cohortAId, gradeIds: [world.gradeDraftId] }],
  "grading.saveDraft": (world) => [
    { cohortId: world.cohortAId, assessmentId: world.assignmentId, submissionId: world.submissionDraftId, score: 4, feedback: null },
  ],
  "instructors.assign": (world) => [{ cohortId: world.cohortAId, userId: world.personas.staffNone.userId! }],
  "instructors.listCandidates": (world) => [{ cohortId: world.cohortAId }],
  "instructors.remove": (world) => [{ cohortId: world.cohortAId, userId: world.personas.staffNone.userId! }],
  "progress.override": (world) => [
    form({ cohortId: world.cohortAId, enrolmentId: world.enrolmentAId, lessonId: world.lessonId, complete: "true", reason: REASON }),
  ],
  "cohorts.cancel": (world) => [{ cohortId: world.cohortAId, expectedUpdatedAt: NOW_ISO(), reason: REASON }],
  "cohorts.publish": (world) => [{ cohortId: world.cohortAId, expectedUpdatedAt: NOW_ISO() }],
  "cohorts.create": (world) => [{ ok: false, errors: [], message: null }, form(cohortFields(world))],
  "cohorts.update": (world) => [
    { ok: false, errors: [], message: null },
    form({ ...cohortFields(world), cohortId: world.cohortAId, expectedUpdatedAt: NOW_ISO() }),
  ],
  "sessions.cancel": (world) => [{ sessionId: world.sessionAId, reason: REASON }],
  "sessions.create": (world) => [sessionFields(world)],
  "sessions.repeatWeekly": (world) => [{ ...sessionFields(world), occurrences: 2 }],
  "sessions.update": (world) => {
    const { cohortId: _cohortId, ...rest } = sessionFields(world);
    void _cohortId;
    return [{ ...rest, sessionId: world.sessionAId }];
  },

  // ---- staff: courses ----
  "arrange.createModule": (world) => [{ courseId: world.courseAId, title: "Matrix new module" }],
  "arrange.renameModule": (world) => [{ courseId: world.courseAId, moduleId: world.moduleId, title: "Matrix renamed module" }],
  "arrange.restoreItem": (world) => [{ courseId: world.courseAId, kind: "module", id: world.moduleId }],
  "arrange.saveLessons": (world) => [
    { courseId: world.courseAId, token: TOKEN(), arrangement: [{ moduleId: world.moduleId, lessonIds: [world.lessonId] }] },
  ],
  "arrange.saveModules": (world) => [{ courseId: world.courseAId, token: TOKEN(), moduleIds: [world.moduleId] }],
  "arrange.withdrawItem": (world) => [{ courseId: world.courseAId, kind: "lesson", id: world.lessonId, reason: "Matrix withdraw" }],
  "assessments.archive": (world) => [{ assessmentId: world.quizId, courseId: world.courseAId, reason: REASON }],
  "assessments.create": (world) => [
    { ok: null, errors: [], message: null },
    form({ courseId: world.courseAId, type: "QUIZ", title: "Matrix new quiz", feedbackBehaviour: "ON_RELEASE", attemptGradingMethod: "HIGHEST" }),
  ],
  "assessments.publish": (world) => [{ assessmentId: world.quizId }],
  "assessments.saveQuestions": (world) => [
    {
      assessmentId: world.quizId,
      questions: [
        {
          prompt: "Matrix question?", type: "SINGLE_CHOICE", marks: 1, explanation: null,
          options: [{ label: "Right", isCorrect: true }, { label: "Wrong", isCorrect: false }],
        },
      ],
    },
  ],
  "assessments.update": (world) => [
    world.quizId,
    { ok: null, errors: [], message: null },
    form({ courseId: world.courseAId, type: "QUIZ", title: "Matrix renamed quiz", feedbackBehaviour: "ON_RELEASE", attemptGradingMethod: "HIGHEST" }),
  ],
  "lessons.save": (world) => [
    { ok: null, errors: [], message: null },
    form({
      lessonId: world.lessonId, courseId: world.courseAId, type: "TEXT", title: "Matrix renamed lesson",
      body: "<p>Matrix edited body</p>", required: "on", allowManualComplete: "on",
    }),
  ],
  "lessons.withdraw": (world) => [{ lessonId: world.lessonId, courseId: world.courseAId, reason: REASON }],
  "coursePublish.archive": (world) => [{ courseId: world.courseAId, reason: REASON }],
  "coursePublish.publish": (world) => [{ courseId: world.courseAId, expectedUpdatedAt: NOW_ISO(), migrateCohortIds: [] }],
  "coursePublish.setListing": (world) => [{ courseId: world.courseAId, listed: false }],
  "coursePublish.unarchive": (world) => [{ courseId: world.courseAId, reason: REASON }],
  "coursePublish.unpublish": (world) => [{ courseId: world.courseAId, reason: REASON }],
  "courses.create": () => [{ ok: false, errors: [], message: null }, form({ title: "Matrix new course", slug: "matrix-new-course" })],
  "courses.update": (world) => [
    { ok: false, errors: [], message: null },
    form({ courseId: world.courseAId, title: "Matrix edited course", slug: "matrix-edited-course" }),
  ],

  // ---- staff: email, learner numbers, licence, payments, privacy ----
  "emailLog.resend": (world) => [{ dispatchId: world.emailDispatchId, reason: REASON }],
  "learnerNumbers.backfill": () => [],
  "learnerNumbers.savePattern": () => [{ pattern: "KQL-######" }],
  "licence.activate": () => [{ raw: "matrix-licence-text" }],
  "licence.inspect": () => [{ raw: "matrix-licence-text" }],
  "payments.confirmManual": (world) => [confirmManualPaymentInput(world.orderAId, world.orderATotalMinor)],
  "payments.recordRefund": (world) => [recordRefundInput(world.orderAId)],
  "privacy.anonymise": (world) => [{ userId: world.ownerUserId, reason: "Matrix anonymise reason, long enough." }],
  "privacy.requestExport": (world) => [{ userId: world.ownerUserId, reason: REASON }],

  // ---- staff: programmes ----
  "programmeArrange.addCourse": (world) => [{ programmeId: world.programmeId, courseId: world.spareCourseId }],
  "programmeArrange.removeCourse": (world) => [{ programmeId: world.programmeId, courseId: world.courseAId }],
  "programmeArrange.saveOrder": (world) => [
    { programmeId: world.programmeId, token: TOKEN(), membershipIds: [world.programmeCourseId] },
  ],
  "programmePublish.archive": (world) => [{ programmeId: world.programmeId, reason: REASON }],
  "programmePublish.publish": (world) => [{ programmeId: world.programmeId, expectedUpdatedAt: NOW_ISO(), migrateCohortIds: [] }],
  "programmePublish.setListing": (world) => [{ programmeId: world.programmeId, listed: false }],
  "programmePublish.unarchive": (world) => [{ programmeId: world.programmeId, reason: REASON }],
  "programmePublish.unpublish": (world) => [{ programmeId: world.programmeId, reason: REASON }],
  "programmes.create": () => [{ ok: false, errors: [], message: null }, form({ title: "Matrix new programme", slug: "matrix-new-programme" })],
  "programmes.update": (world) => [
    { ok: false, errors: [], message: null },
    form({ programmeId: world.programmeId, title: "Matrix edited programme" }),
  ],

  // ---- staff: reconciliation, reports ----
  "reconciliation.assign": (world) => [{ caseIds: [world.reconciliationCaseId], assigneeId: world.personas.staffGlobal.userId! }],
  "reconciliation.requestRefundExport": () => [{ filters: {}, columns: ["reference", "amountMinor"], asOf: AS_OF() }],
  "reconciliation.resolve": (world) => [{ caseId: world.reconciliationCaseId, reason: "OTHER", note: "Matrix resolution note" }],
  "reports.rerun": (world) => [{ jobId: world.exportExpiredId }],
  "reports.rerunHistory": (world) => [world.exportExpiredId],
  "reports.requestExport": () => [{ dataset: "registrations", asOf: AS_OF() }],
  "reports.retry": (world) => [{ jobId: world.exportFailedId }],
  "reports.retryHistory": (world) => [world.exportFailedId],
  "reports.sensitiveColumns": () => ["registrations"],

  // ---- staff: roles, support, users ----
  "roles.create": () => [{ errors: [] }, form({ name: "Matrix new role", permission: ["reports.view"] })],
  "roles.setActive": (world) => [world.roleId, false, "Matrix deactivation reason"],
  "roles.update": (world) => [
    { errors: [] },
    form({ id: world.roleId, expectedVersion: "1", name: "Matrix target role", permission: ["reports.view"], reason: "Matrix update reason" }),
  ],
  "support.acceptEscalation": (world) => [supportBase(world)],
  "support.assign": (world) => [{ ...supportBase(world), assigneeId: world.personas.staffGlobal.userId! }],
  "support.changePriority": (world) => [{ ...supportBase(world), priority: "HIGH" }],
  "support.claim": (world) => [supportBase(world)],
  "support.escalate": (world) => [{ ...supportBase(world), queue: "FINANCE", reason: "Matrix escalation reason" }],
  "support.internalNote": (world) => [{ ...supportBase(world), body: "Matrix internal note" }],
  "support.moveQueue": (world) => [{ ...supportBase(world), queue: "ACCOUNTS", reason: "Matrix queue reason" }],
  "support.publicReply": (world) => [{ ...supportBase(world), body: "Matrix public reply" }],
  "support.resolve": (world) => [{ ...supportBase(world), reason: "Matrix resolution reason" }],
  "users.createAssignment": (world) => [
    { errors: [], success: false },
    form({ userId: world.staffTargetUserId, roleId: world.roleId, scopeType: "GLOBAL" }),
  ],
  "users.createStaff": (world) => [
    { errors: [], created: null },
    form({ name: "Matrix New Staff", email: "matrix-new-staff@authz-matrix.test", roleId: world.roleId, scopeType: "GLOBAL" }),
  ],
  "users.deactivate": (world) => [world.staffTargetUserId, "Matrix deactivation reason"],
  "users.reactivate": (world) => [world.staffTargetUserId],
  "users.revokeAssignment": (world) => [world.targetAssignmentId, "Matrix revocation reason"],
  "users.searchScopeTargets": () => ["COURSE", "matrix"],
  "users.searchStaff": () => ["matrix"],
};

function get(path: string, params: Record<string, string> = {}, headers?: Record<string, string>): RouteRequest {
  return { url: `${BASE_URL}${path}`, params, headers };
}

function json(path: string, body: unknown, params: Record<string, string> = {}): RouteRequest {
  return { url: `${BASE_URL}${path}`, params, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export const ROUTE_INPUTS: Readonly<Record<string, RouteInputBuilder>> = {
  "route.captionRead": (world) => get(`/api/lesson-resources/${world.resourceCaptionId}/captions`, { id: world.resourceCaptionId }),
  "route.certificateDownload": (world) =>
    get(`/api/certificates/${world.certificateId}/download`, { id: world.certificateId }),
  "route.exceptionsCsv": (world) => get(`/staff/cohorts/${world.cohortAId}/exceptions/csv`, { id: world.cohortAId }),
  "route.exportDownload": (world) =>
    get(`/api/staff/reports/exports/${world.exportDoneId}/download`, { jobId: world.exportDoneId }),
  "route.health": () => get("/api/health"),
  "route.licenceDiagnostic": () => get("/api/staff/licence/diagnostic"),
  "route.notificationList": () => get("/api/notifications"),
  "route.notificationPreferences": () => get("/api/notifications/preferences"),
  "route.notificationUnread": () => get("/api/notifications/unread"),
  "route.paystackWebhook": () => ({
    url: `${BASE_URL}/api/webhooks/paystack`,
    headers: { "content-type": "application/json", "x-paystack-signature": "0".repeat(128) },
    body: JSON.stringify({ event: "charge.success", data: { id: 424242, reference: "matrix-ref", status: "success", amount: 100, currency: "NGN" } }),
  }),
  "route.resourceComplete": (world) =>
    ({ ...json(`/api/lesson-resources/${world.resourcePendingId}/complete`, {}, { id: world.resourcePendingId }) }),
  "route.resourceDownload": (world) =>
    get(`/api/lesson-resources/${world.resourceFileId}/download`, { id: world.resourceFileId }),
  "route.resourceList": (world) => get(`/api/lesson-resources?lessonId=${world.lessonId}`),
  "route.resourceListCaptions": (world) => get(`/api/lesson-resources?lessonId=${world.videoLessonId}&includeCaptions=1`),
  "route.resourceRemove": (world) => get(`/api/lesson-resources/${world.resourceFileId}`, { id: world.resourceFileId }),
  "route.resourceRemoveCaption": (world) =>
    get(`/api/lesson-resources/${world.resourceCaptionId}?caption=1`, { id: world.resourceCaptionId }),
  "route.resourceUploadIntent": (world) =>
    json("/api/lesson-resources/upload-intent", {
      lessonId: world.fileLessonId, title: "Matrix upload", filename: "upload.pdf", mimeType: "application/pdf", sizeBytes: 1000,
    }),
  "route.resourceUploadIntentCaption": (world) =>
    json("/api/lesson-resources/upload-intent", {
      lessonId: world.videoLessonId, title: "Matrix caption upload", filename: "captions.vtt", mimeType: "text/vtt", sizeBytes: 100,
      kind: "CAPTION", captionForResourceId: world.resourceVideoId, captionLanguage: "fr", captionLabel: "Francais",
    }),
  "route.stripeWebhook": () => ({
    url: `${BASE_URL}/api/webhooks/stripe`,
    headers: { "content-type": "application/json", "stripe-signature": "t=1700000000,v1=" + "0".repeat(64) },
    body: JSON.stringify({ id: "evt_matrix_1", type: "checkout.session.completed", data: { object: {} } }),
  }),
  "route.submissionDownload": (world) =>
    get(`/api/submissions/${world.submissionDraftId}/download`, { submissionId: world.submissionDraftId }),
  "route.ticketAttachmentComplete": (world) =>
    json("/api/ticket-attachments/complete", { attachmentId: world.ticketAttachmentUploadingId }),
  "route.ticketAttachmentDownload": (world) =>
    get(`/api/ticket-attachments/${world.ticketAttachmentReadyId}/download`, { attachmentId: world.ticketAttachmentReadyId }),
  "route.ticketAttachmentIntent": (world) =>
    json("/api/ticket-attachments/upload-intent", {
      messageId: world.ticketMessageId, filename: "photo.png", mimeType: "image/png", sizeBytes: 1000,
    }),
};

/**
 * Arguments of the same shape as `args` with every value emptied: FormData becomes
 * an empty form, an object becomes `{}`, a string becomes "", an array becomes [].
 * This is the "empty or schema-invalid input" probe: nothing about it can satisfy a
 * schema, so a call that still reaches a write is a bypass.
 */
export function emptyArgs(args: readonly unknown[]): unknown[] {
  return args.map((value) => {
    if (typeof FormData !== "undefined" && value instanceof FormData) return new FormData();
    if (Array.isArray(value)) return [];
    if (typeof value === "string") return "";
    if (typeof value === "number") return Number.NaN;
    if (typeof value === "boolean") return value;
    if (value && typeof value === "object") return {};
    return value;
  });
}
