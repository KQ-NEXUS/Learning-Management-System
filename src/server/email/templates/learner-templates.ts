/**
 * The 20 learner-facing transactional templates (D-07).
 *
 * Each template declares an allow-listed params interface and its render
 * function reads only those declared fields, so a spread of an event payload
 * can never carry a staff reason, message body, filename or score into a mail
 * (T-13-03). certificate-revoked and every ticket template take a reference
 * only (T-11-50). Links are built from an internal path with
 * `buildAbsoluteUrl` (D-15). Copy: sentence case, no emoji, no marketing.
 */

import { buildAbsoluteUrl } from "@/server/email/config";
import type { EmailContent } from "@/server/email/templates/layout";
import { formatDateTimeShort } from "@/lib/format-timestamp";

export type LearnerParamsMap = {
  "enrolment-confirmed": {
    cohortTitle: string;
    orderReference?: string;
    amountLabel?: string;
    enrolmentPath: string;
  };
  "enrolment-withdrawn": { cohortTitle: string };
  "enrolment-cancelled": { cohortTitle: string };
  "enrolment-transferred": {
    fromCohortTitle: string;
    toCohortTitle: string;
    enrolmentPath: string;
  };
  "payment-failed": { cohortTitle: string; orderReference: string; orderPath: string };
  "payment-refunded": {
    cohortTitle: string;
    orderReference: string;
    amountLabel: string;
    orderPath: string;
  };
  "order-payment-exception": {
    cohortTitle: string;
    orderReference: string;
    orderPath: string;
  };
  "session-updated": {
    sessionTitle: string;
    cohortTitle: string;
    startsAtIso: string;
    endsAtIso: string;
    location?: string;
    sessionsPath: string;
  };
  "session-cancelled": {
    sessionTitle: string;
    cohortTitle: string;
    startsAtIso: string;
    sessionsPath: string;
  };
  "cohort-cancelled": { cohortTitle: string };
  "grade-released": { assessmentTitle: string; resultsPath: string };
  "grade-overridden": { assessmentTitle: string; resultsPath: string };
  "certificate-issued": { verificationRef: string; dashboardPath: string };
  "certificate-revoked": { verificationRef: string };
  "certificate-reissued": {
    oldVerificationRef: string;
    newVerificationRef: string;
    dashboardPath: string;
  };
  "ticket-created": { reference: string; ticketPath: string };
  "ticket-reply": { reference: string; ticketPath: string };
  "ticket-resolved": { reference: string; ticketPath: string };
  "ticket-reopened": { reference: string; ticketPath: string };
  "ticket-closed": { reference: string; ticketPath: string };
};

type Definition<P> = (params: P) => EmailContent;

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "a time to be confirmed";
  return `${formatDateTimeShort(date)} UTC`;
}

function ticketTemplate(
  subjectTail: string,
  heading: string,
  sentence: string,
): Definition<{ reference: string; ticketPath: string }> {
  return (p) => ({
    subject: `Ticket ${p.reference} ${subjectTail}`,
    heading,
    paragraphs: [`${sentence.replace("{ref}", p.reference)} Open the ticket to see the details.`],
    button: { label: "View ticket", href: buildAbsoluteUrl(p.ticketPath) },
  });
}

export const LEARNER_TEMPLATES: { [K in keyof LearnerParamsMap]: Definition<LearnerParamsMap[K]> } = {
  "enrolment-confirmed": (p) => ({
    subject: p.orderReference
      ? `You are enrolled in ${p.cohortTitle} (order ${p.orderReference})`
      : `You are enrolled in ${p.cohortTitle}`,
    heading: "You are enrolled",
    paragraphs: [
      `Your place in ${p.cohortTitle} is confirmed.`,
      ...(p.orderReference
        ? [
            `Order reference: ${p.orderReference}.${p.amountLabel ? ` Amount: ${p.amountLabel}.` : ""}`,
          ]
        : []),
    ],
    button: { label: "View your enrolment", href: buildAbsoluteUrl(p.enrolmentPath) },
  }),

  "enrolment-withdrawn": (p) => ({
    subject: `Your enrolment in ${p.cohortTitle} has been withdrawn`,
    heading: "Your enrolment was withdrawn",
    paragraphs: [
      `Your enrolment in ${p.cohortTitle} has been withdrawn.`,
      "If you think this is a mistake, contact support.",
    ],
    button: { label: "Open your dashboard", href: buildAbsoluteUrl("/dashboard") },
  }),

  "enrolment-cancelled": (p) => ({
    subject: `Your enrolment in ${p.cohortTitle} has been cancelled`,
    heading: "Your enrolment was cancelled",
    paragraphs: [
      `Your enrolment in ${p.cohortTitle} has been cancelled.`,
      "If you think this is a mistake, contact support.",
    ],
    button: { label: "Open your dashboard", href: buildAbsoluteUrl("/dashboard") },
  }),

  "enrolment-transferred": (p) => ({
    subject: `Your enrolment moved to ${p.toCohortTitle}`,
    heading: "Your enrolment was moved",
    paragraphs: [
      `You have been moved from ${p.fromCohortTitle} to ${p.toCohortTitle}.`,
    ],
    button: { label: "View your enrolment", href: buildAbsoluteUrl(p.enrolmentPath) },
  }),

  "payment-failed": (p) => ({
    subject: `Payment failed for order ${p.orderReference}`,
    heading: "Your payment did not go through",
    paragraphs: [
      `We could not take payment for ${p.cohortTitle} (order ${p.orderReference}).`,
      "No enrolment has been made. You can review the order and try again.",
    ],
    button: { label: "Review your order", href: buildAbsoluteUrl(p.orderPath) },
  }),

  "payment-refunded": (p) => ({
    subject: `Refund issued for order ${p.orderReference}`,
    heading: "Your payment was refunded",
    paragraphs: [
      `A refund of ${p.amountLabel} has been issued for ${p.cohortTitle} (order ${p.orderReference}).`,
      "Refunds can take a few days to appear with your bank.",
    ],
    button: { label: "Review your order", href: buildAbsoluteUrl(p.orderPath) },
  }),

  "order-payment-exception": (p) => ({
    subject: `We received your payment for order ${p.orderReference}`,
    heading: "We received your payment",
    paragraphs: [
      `Your payment for ${p.cohortTitle} (order ${p.orderReference}) was received.`,
      "Our team is finishing your enrolment and will be in touch if anything else is needed.",
    ],
    button: { label: "Review your order", href: buildAbsoluteUrl(p.orderPath) },
  }),

  "session-updated": (p) => ({
    subject: `Session updated: ${p.sessionTitle}`,
    heading: "A session has changed",
    paragraphs: [
      `${p.sessionTitle} in ${p.cohortTitle} now runs from ${when(p.startsAtIso)} to ${when(p.endsAtIso)}.`,
      ...(p.location ? [`Location: ${p.location}.`] : []),
    ],
    button: { label: "View your sessions", href: buildAbsoluteUrl(p.sessionsPath) },
  }),

  "session-cancelled": (p) => ({
    subject: `Session cancelled: ${p.sessionTitle}`,
    heading: "A session was cancelled",
    paragraphs: [
      `${p.sessionTitle} in ${p.cohortTitle}, planned for ${when(p.startsAtIso)}, has been cancelled.`,
    ],
    button: { label: "View your sessions", href: buildAbsoluteUrl(p.sessionsPath) },
  }),

  "cohort-cancelled": (p) => ({
    subject: `${p.cohortTitle} has been cancelled`,
    heading: "Your cohort was cancelled",
    paragraphs: [
      `${p.cohortTitle} has been cancelled.`,
      "Contact support if you have questions about your enrolment or payment.",
    ],
    button: { label: "Open your dashboard", href: buildAbsoluteUrl("/dashboard") },
  }),

  "grade-released": (p) => ({
    subject: `Your result is available: ${p.assessmentTitle}`,
    heading: "Your result is available",
    paragraphs: [`A result has been released for ${p.assessmentTitle}.`],
    button: { label: "View your results", href: buildAbsoluteUrl(p.resultsPath) },
  }),

  "grade-overridden": (p) => ({
    subject: `Your result was updated: ${p.assessmentTitle}`,
    heading: "Your result was updated",
    paragraphs: [`Your result for ${p.assessmentTitle} has been updated.`],
    button: { label: "View your results", href: buildAbsoluteUrl(p.resultsPath) },
  }),

  "certificate-issued": (p) => ({
    subject: `Your certificate ${p.verificationRef} is ready`,
    heading: "Your certificate is ready",
    paragraphs: [`Certificate ${p.verificationRef} has been issued to you.`],
    button: { label: "Open your certificate", href: buildAbsoluteUrl(p.dashboardPath) },
  }),

  "certificate-revoked": (p) => ({
    subject: `Certificate ${p.verificationRef} has been revoked`,
    heading: "A certificate was revoked",
    paragraphs: [
      `Certificate ${p.verificationRef} has been revoked and no longer verifies.`,
      "Contact support if you have questions.",
    ],
  }),

  "certificate-reissued": (p) => ({
    subject: `Certificate ${p.newVerificationRef} replaces ${p.oldVerificationRef}`,
    heading: "Your certificate was reissued",
    paragraphs: [
      `Certificate ${p.oldVerificationRef} has been replaced by ${p.newVerificationRef}.`,
    ],
    button: { label: "Open your certificate", href: buildAbsoluteUrl(p.dashboardPath) },
  }),

  "ticket-created": ticketTemplate(
    "was received",
    "We received your ticket",
    "Your ticket {ref} has been received.",
  ),
  "ticket-reply": ticketTemplate(
    "has a new reply",
    "You have a new reply",
    "Support has replied to ticket {ref}.",
  ),
  "ticket-resolved": ticketTemplate(
    "was resolved",
    "Your ticket was resolved",
    "Ticket {ref} has been marked resolved.",
  ),
  "ticket-reopened": ticketTemplate(
    "was reopened",
    "Your ticket was reopened",
    "Ticket {ref} has been reopened.",
  ),
  "ticket-closed": ticketTemplate(
    "was closed",
    "Your ticket was closed",
    "Ticket {ref} has been closed.",
  ),
};

export const LEARNER_SAMPLES: LearnerParamsMap = {
  "enrolment-confirmed": {
    cohortTitle: "Project Management Foundations - March cohort",
    orderReference: "KQO-1042",
    amountLabel: "NGN 50,000",
    enrolmentPath: "/dashboard",
  },
  "enrolment-withdrawn": { cohortTitle: "Project Management Foundations - March cohort" },
  "enrolment-cancelled": { cohortTitle: "Project Management Foundations - March cohort" },
  "enrolment-transferred": {
    fromCohortTitle: "March cohort",
    toCohortTitle: "April cohort",
    enrolmentPath: "/dashboard",
  },
  "payment-failed": {
    cohortTitle: "Project Management Foundations",
    orderReference: "KQO-1042",
    orderPath: "/orders/KQO-1042",
  },
  "payment-refunded": {
    cohortTitle: "Project Management Foundations",
    orderReference: "KQO-1042",
    amountLabel: "NGN 50,000",
    orderPath: "/orders/KQO-1042",
  },
  "order-payment-exception": {
    cohortTitle: "Project Management Foundations",
    orderReference: "KQO-1042",
    orderPath: "/orders/KQO-1042",
  },
  "session-updated": {
    sessionTitle: "Week 2 workshop",
    cohortTitle: "March cohort",
    startsAtIso: "2026-10-05T09:00:00.000Z",
    endsAtIso: "2026-10-05T11:00:00.000Z",
    location: "Room 4",
    sessionsPath: "/dashboard/sessions",
  },
  "session-cancelled": {
    sessionTitle: "Week 2 workshop",
    cohortTitle: "March cohort",
    startsAtIso: "2026-10-05T09:00:00.000Z",
    sessionsPath: "/dashboard/sessions",
  },
  "cohort-cancelled": { cohortTitle: "March cohort" },
  "grade-released": { assessmentTitle: "Module 1 assessment", resultsPath: "/dashboard/results" },
  "grade-overridden": { assessmentTitle: "Module 1 assessment", resultsPath: "/dashboard/results" },
  "certificate-issued": { verificationRef: "CERT-2026-0001", dashboardPath: "/dashboard" },
  "certificate-revoked": { verificationRef: "CERT-2026-0001" },
  "certificate-reissued": {
    oldVerificationRef: "CERT-2026-0001",
    newVerificationRef: "CERT-2026-0002",
    dashboardPath: "/dashboard",
  },
  "ticket-created": { reference: "KQT-1", ticketPath: "/support/KQT-1" },
  "ticket-reply": { reference: "KQT-1", ticketPath: "/support/KQT-1" },
  "ticket-resolved": { reference: "KQT-1", ticketPath: "/support/KQT-1" },
  "ticket-reopened": { reference: "KQT-1", ticketPath: "/support/KQT-1" },
  "ticket-closed": { reference: "KQT-1", ticketPath: "/support/KQT-1" },
};
