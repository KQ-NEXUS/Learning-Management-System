/**
 * The result-release and certificate-lifecycle mapper group (D-07, D-16,
 * D-17, T-11-50, T-13-03).
 *
 * `grade.released` and `grade.overridden` share one mapper — both mean "a
 * result changed for this enrolment's learner" and differ only in template
 * and notification type, exactly like `enrolment-session.ts`'s
 * `enrolmentStatusChangeMail` precedent (Plan 09). `certificate.issued`,
 * `certificate.revoked` and `certificate.reissued` each resolve their
 * recipient from the Certificate row's own `userId` — never a payload field
 * (T-13-42) — and never read a revocation/reissue reason even when one is
 * present on the payload (T-11-50, T-13-03): the score, maximum score, pass
 * status, previous/new score, `passedChanged` and any staff reason are read
 * by NOTHING in this file.
 */

import {
  requireString,
  type EventMapper,
  type MapperGroup,
} from "@/server/services/event-intent-mappers";
import { buildCorrelationId } from "@/server/communications/contracts";
import { DASHBOARD_PATH, resultsPath } from "@/server/communications/links";

// ---------------------------------------------------------------------------
// grade.released / grade.overridden (D-07)
// ---------------------------------------------------------------------------

/**
 * `grade.released` and `grade.overridden` share this mapper. Loads the
 * enrolment's `userId` and the assessment's `title` through the SAME
 * transaction the drain opened; returns no intents when either row is
 * missing. Never reads `score`, `maxScore`, `passed`, `previousScore`,
 * `newScore` or `passedChanged` off the payload (T-13-03).
 */
const gradeResultMail: EventMapper = async (event, ctx) => {
  const enrolmentId = requireString(event.payload, "enrolmentId");
  const assessmentId = requireString(event.payload, "assessmentId");

  const enrolment = await ctx.tx.enrolment.findUnique({
    where: { id: enrolmentId },
    select: { userId: true },
  });
  if (!enrolment) return [];

  const assessment = await ctx.tx.assessment.findUnique({
    where: { id: assessmentId },
    select: { title: true },
  });
  if (!assessment) return [];

  const isReleased = event.type === "grade.released";
  const template = isReleased ? "grade-released" : "grade-overridden";
  const notificationType = isReleased ? "grade.released" : "grade.overridden";

  return [
    {
      recipientUserId: enrolment.userId,
      email: {
        template,
        params: {
          assessmentTitle: assessment.title,
          resultsPath: resultsPath(enrolmentId),
        },
        correlationId: buildCorrelationId(event.id),
      },
      notification: {
        type: notificationType,
        targetType: "LEARNER_RESULTS",
        targetId: enrolmentId,
        params: { assessmentTitle: assessment.title },
      },
    },
  ];
};

// ---------------------------------------------------------------------------
// certificate.issued / certificate.revoked / certificate.reissued (D-07,
// T-11-50)
// ---------------------------------------------------------------------------

/**
 * `certificate.issued` loads the Certificate by `certificateId` and mails its
 * own `userId` (never any payload user id — T-13-42) with the public
 * verification reference and the learner dashboard link (A-18). A missing
 * certificate row returns no intents.
 */
const certificateIssuedMail: EventMapper = async (event, ctx) => {
  const certificateId = requireString(event.payload, "certificateId");

  const certificate = await ctx.tx.certificate.findUnique({
    where: { id: certificateId },
    select: { userId: true, verificationRef: true },
  });
  if (!certificate) return [];

  return [
    {
      recipientUserId: certificate.userId,
      email: {
        template: "certificate-issued",
        params: {
          verificationRef: certificate.verificationRef,
          dashboardPath: DASHBOARD_PATH,
        },
        correlationId: buildCorrelationId(event.id),
      },
      notification: {
        type: "certificate.issued",
        targetType: "LEARNER_DASHBOARD",
        targetId: certificateId,
        params: { verificationRef: certificate.verificationRef },
      },
    },
  ];
};

/**
 * `certificate.revoked` mails only the public verification reference — never
 * a revocation reason, even though the payload may carry one (T-11-50). A
 * missing certificate row returns no intents.
 */
const certificateRevokedMail: EventMapper = async (event, ctx) => {
  const certificateId = requireString(event.payload, "certificateId");

  const certificate = await ctx.tx.certificate.findUnique({
    where: { id: certificateId },
    select: { userId: true, verificationRef: true },
  });
  if (!certificate) return [];

  return [
    {
      recipientUserId: certificate.userId,
      email: {
        template: "certificate-revoked",
        params: { verificationRef: certificate.verificationRef },
        correlationId: buildCorrelationId(event.id),
      },
      notification: {
        type: "certificate.revoked",
        targetType: "LEARNER_DASHBOARD",
        targetId: certificateId,
        params: { verificationRef: certificate.verificationRef },
      },
    },
  ];
};

/**
 * `certificate.reissued` resolves the holder from the NEW certificate row
 * (never the old, superseded one) and mails both verification references —
 * never a reissue reason. A missing new-certificate row returns no intents.
 */
const certificateReissuedMail: EventMapper = async (event, ctx) => {
  const newCertificateId = requireString(event.payload, "newCertificateId");
  const oldVerificationRef = requireString(event.payload, "oldVerificationRef");

  const certificate = await ctx.tx.certificate.findUnique({
    where: { id: newCertificateId },
    select: { userId: true, verificationRef: true },
  });
  if (!certificate) return [];

  return [
    {
      recipientUserId: certificate.userId,
      email: {
        template: "certificate-reissued",
        params: {
          oldVerificationRef,
          newVerificationRef: certificate.verificationRef,
          dashboardPath: DASHBOARD_PATH,
        },
        correlationId: buildCorrelationId(event.id),
      },
      notification: {
        type: "certificate.reissued",
        targetType: "LEARNER_DASHBOARD",
        targetId: newCertificateId,
        params: {
          oldVerificationRef,
          newVerificationRef: certificate.verificationRef,
        },
      },
    },
  ];
};

export function createLearningMappers(): MapperGroup {
  return {
    "grade.released": gradeResultMail,
    "grade.overridden": gradeResultMail,
    "certificate.issued": certificateIssuedMail,
    "certificate.revoked": certificateRevokedMail,
    "certificate.reissued": certificateReissuedMail,
  };
}
