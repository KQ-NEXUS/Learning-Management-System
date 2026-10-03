/**
 * `links.ts` — every builder, every rejected segment, and `notificationHref`
 * for all eleven `NOTIFICATION_TARGET_TYPES` (T-13-10).
 */

import { describe, expect, it } from "vitest";
import {
  DASHBOARD_PATH,
  EMAIL_LOG_PATH,
  LICENCE_PATH,
  orderPath,
  enrolmentPath,
  resultsPath,
  sessionsPath,
  learnerTicketPath,
  staffTicketPath,
  staffPaymentPath,
  staffSubmissionPath,
  notificationHref,
} from "@/server/communications/links";
import { NOTIFICATION_TARGET_TYPES } from "@/server/communications/contracts";

const VALID_SEGMENT = "KQT-20260927-AB12CD34";
const BAD_SEGMENTS = ["../x", "a/b", "a:b", "a b", "", "..", "a.b", "a\nb", "a\tb"];

describe("links.ts constants", () => {
  it("DASHBOARD_PATH and EMAIL_LOG_PATH are fixed absolute paths", () => {
    expect(DASHBOARD_PATH).toBe("/dashboard");
    expect(EMAIL_LOG_PATH).toBe("/staff/email-log");
  });
});

type SingleArgCase = {
  name: string;
  fn: (segment: string) => string;
  expected: string;
};

const SINGLE_ARG_CASES: SingleArgCase[] = [
  { name: "orderPath", fn: orderPath, expected: `/orders/${VALID_SEGMENT}` },
  { name: "enrolmentPath", fn: enrolmentPath, expected: `/learn/${VALID_SEGMENT}` },
  { name: "resultsPath", fn: resultsPath, expected: `/learn/${VALID_SEGMENT}/results` },
  { name: "sessionsPath", fn: sessionsPath, expected: `/learn/${VALID_SEGMENT}/sessions` },
  { name: "learnerTicketPath", fn: learnerTicketPath, expected: `/support/${VALID_SEGMENT}` },
  { name: "staffTicketPath", fn: staffTicketPath, expected: `/staff/support/${VALID_SEGMENT}` },
  { name: "staffPaymentPath", fn: staffPaymentPath, expected: `/staff/payments/${VALID_SEGMENT}` },
];

describe.each(SINGLE_ARG_CASES)("$name", ({ fn, expected }) => {
  it("builds the expected path for a valid segment", () => {
    expect(fn(VALID_SEGMENT)).toBe(expected);
  });

  it.each(BAD_SEGMENTS)("throws for %j", (bad) => {
    expect(() => fn(bad)).toThrow();
  });
});

describe("learnerTicketPath — literal acceptance criteria", () => {
  it("returns /support/<reference> for a valid reference", () => {
    expect(learnerTicketPath("KQT-20260927-AB12CD34")).toBe("/support/KQT-20260927-AB12CD34");
  });

  it("throws for ../x, a/b and a:b", () => {
    expect(() => learnerTicketPath("../x")).toThrow();
    expect(() => learnerTicketPath("a/b")).toThrow();
    expect(() => learnerTicketPath("a:b")).toThrow();
  });
});

describe("staffSubmissionPath", () => {
  it("builds /staff/cohorts/{cohortId}/grading/{assessmentId}/{submissionId}", () => {
    expect(staffSubmissionPath("cohort1", "assess1", "sub1")).toBe(
      "/staff/cohorts/cohort1/grading/assess1/sub1",
    );
  });

  it.each(BAD_SEGMENTS)("throws when cohortId is %j", (bad) => {
    expect(() => staffSubmissionPath(bad, "assess1", "sub1")).toThrow();
  });

  it.each(BAD_SEGMENTS)("throws when assessmentId is %j", (bad) => {
    expect(() => staffSubmissionPath("cohort1", bad, "sub1")).toThrow();
  });

  it.each(BAD_SEGMENTS)("throws when submissionId is %j", (bad) => {
    expect(() => staffSubmissionPath("cohort1", "assess1", bad)).toThrow();
  });
});

describe("notificationHref", () => {
  it("covers every NOTIFICATION_TARGET_TYPES member", () => {
    const covered = new Set<string>();

    covered.add("LEARNER_DASHBOARD");
    expect(notificationHref("LEARNER_DASHBOARD", "anything")).toBe(DASHBOARD_PATH);

    covered.add("LEARNER_ORDER");
    expect(notificationHref("LEARNER_ORDER", "order-ref-1")).toBe("/orders/order-ref-1");

    covered.add("LEARNER_ENROLMENT");
    expect(notificationHref("LEARNER_ENROLMENT", "enr-1")).toBe("/learn/enr-1");

    covered.add("LEARNER_RESULTS");
    expect(notificationHref("LEARNER_RESULTS", "enr-1")).toBe("/learn/enr-1/results");

    covered.add("LEARNER_SESSIONS");
    expect(notificationHref("LEARNER_SESSIONS", "enr-1")).toBe("/learn/enr-1/sessions");

    covered.add("LEARNER_TICKET");
    expect(notificationHref("LEARNER_TICKET", "KQT-1")).toBe("/support/KQT-1");

    covered.add("STAFF_TICKET");
    expect(notificationHref("STAFF_TICKET", "KQT-1")).toBe("/staff/support/KQT-1");

    covered.add("STAFF_PAYMENT");
    expect(notificationHref("STAFF_PAYMENT", "order-1")).toBe("/staff/payments/order-1");

    covered.add("STAFF_SUBMISSION");
    expect(
      notificationHref("STAFF_SUBMISSION", "sub-1", { cohortId: "cohort-1", assessmentId: "assess-1" }),
    ).toBe("/staff/cohorts/cohort-1/grading/assess-1/sub-1");

    covered.add("STAFF_EMAIL_LOG");
    expect(notificationHref("STAFF_EMAIL_LOG", "anything")).toBe(EMAIL_LOG_PATH);

    covered.add("STAFF_LICENCE");
    expect(notificationHref("STAFF_LICENCE", "anything")).toBe(LICENCE_PATH);
    expect(LICENCE_PATH).toBe("/staff/licence");

    expect([...covered].sort()).toEqual([...NOTIFICATION_TARGET_TYPES].sort());
  });

  it("throws for STAFF_SUBMISSION when cohortId or assessmentId params are missing or hostile", () => {
    expect(() => notificationHref("STAFF_SUBMISSION", "sub-1", {})).toThrow();
    expect(() =>
      notificationHref("STAFF_SUBMISSION", "sub-1", { cohortId: "../x", assessmentId: "assess-1" }),
    ).toThrow();
  });

  it("throws when the stored targetId itself is hostile", () => {
    expect(() => notificationHref("LEARNER_ORDER", "../x")).toThrow();
    expect(() => notificationHref("LEARNER_TICKET", "a:b")).toThrow();
  });
});
