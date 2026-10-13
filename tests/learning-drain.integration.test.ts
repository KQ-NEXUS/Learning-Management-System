/**
 * Real-Postgres proof for the result-release and certificate-lifecycle
 * mapper group (D-07, D-16, D-17, T-11-50, T-13-03, T-13-42) — properties a
 * JS fake cannot prove: the drain's own recipient-state/mute gating actually
 * persisting a SKIPPED `muted_by_recipient` row for a RESULT_NOTICES mute
 * while still writing the notification (D-19), certificate mail staying
 * QUEUED/SENT even with every mutable category muted (D-16's "always sent"
 * list), and that no score, pass status or staff reason ever reaches a
 * persisted column.
 *
 * PREREQUISITE: Docker must be running (`tests/support/pg.ts` starts the
 * container). If it is not, `beforeAll` fails with a container-start error —
 * every case reports BLOCKED, never a silent pass.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { startDrainHarness, writeEvent } from "./support/drain-harness";
import { seedCohortFixture, seedEnrolmentFixture } from "./support/cohort-fixtures";
import { MUTABLE_EMAIL_CATEGORIES } from "@/server/communications/contracts";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestDatabase();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

/** The drain's Pass 2 (`sendQueued`) runs in the same `drain()` call as Pass
 * 1 and immediately sends every row it just queued through the harness's
 * stub `send` — a successfully delivered row is `SENT`, not `QUEUED`, by the
 * time `drain()` resolves. Every "this mail actually goes out" assertion in
 * this file accepts either, since both mean "not skipped". */
function expectDelivered(status: string): void {
  expect(["QUEUED", "SENT"]).toContain(status);
}

afterEach(async () => {
  await testDb.prisma.notification.deleteMany();
  await testDb.prisma.emailPreference.deleteMany();
  await testDb.prisma.emailDispatch.deleteMany();
  await testDb.prisma.domainEvent.deleteMany();
  await testDb.prisma.certificate.deleteMany();
  await testDb.prisma.assessment.deleteMany();
  await testDb.prisma.enrolment.deleteMany({});
  await testDb.prisma.cohort.deleteMany({});
  await testDb.prisma.course.deleteMany({});
  await testDb.prisma.user.deleteMany({ where: { email: { contains: "@drain-harness.test" } } });
  await testDb.prisma.user.deleteMany({ where: { email: { contains: "@fixture.test" } } });
});

/** Seeds an ACTIVE enrolment in a fresh cohort and marks its learner's email
 * verified — every template this file exercises is RESULT_NOTICES or ALWAYS,
 * neither of which is AUTH, so an unverified address would be silently
 * SKIPPED (`email_unverified`) and mask the behaviour actually under test. */
async function seedActiveVerifiedEnrolment(overrides: Record<string, unknown> = {}) {
  const { cohortId, courseId } = await seedCohortFixture(testDb.prisma);
  const enrolment = await seedEnrolmentFixture(testDb.prisma, { cohortId, status: "ACTIVE", ...overrides });
  await testDb.prisma.user.update({ where: { id: enrolment.userId }, data: { emailVerified: new Date() } });
  return { cohortId, courseId, enrolmentId: enrolment.enrolmentId, userId: enrolment.userId };
}

async function seedAssessment(courseId: string, title: string) {
  const assessment = await testDb.prisma.assessment.create({
    data: {
      courseId,
      type: "QUIZ",
      title,
      status: "PUBLISHED",
      version: 1,
      totalMarks: 100,
      passMark: 50,
    },
    select: { id: true },
  });
  return assessment.id;
}

async function seedCertificate(overrides: {
  enrolmentId: string;
  userId: string;
  verificationRef: string;
  status?: "ACTIVE" | "REVOKED" | "SUPERSEDED";
}) {
  const certificate = await testDb.prisma.certificate.create({
    data: {
      enrolmentId: overrides.enrolmentId,
      userId: overrides.userId,
      scope: "COURSE",
      awardTitle: "Fixture Course",
      learnerName: "Drain Harness Learner",
      status: overrides.status ?? "ACTIVE",
      verificationRef: overrides.verificationRef,
    },
    select: { id: true },
  });
  return certificate.id;
}

// ---------------------------------------------------------------------------
// Task 1 — grade.released / grade.overridden
// ---------------------------------------------------------------------------

describe("grade.released / grade.overridden drain (D-07, D-17, T-13-03)", () => {
  it("a released grade (score, maxScore, passed present) mails the learner exactly once with no score in templateParams", async () => {
    const { enrolmentId, courseId } = await seedActiveVerifiedEnrolment();
    const assessmentId = await seedAssessment(courseId, "Module 1 Quiz");
    const harness = startDrainHarness(testDb.prisma);

    const event = await writeEvent(testDb.prisma, "grade.released", {
      gradeId: "grade-1",
      assessmentId,
      enrolmentId,
      attemptId: "att-1",
      score: 87.31,
      maxScore: 100,
      passed: true,
      releasedBy: "SYSTEM_AUTO",
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({});
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.template).toBe("grade-released");
    expectDelivered(dispatches[0]!.status);
    expect(dispatches[0]!.correlationId).toBe(event.id);
    expect(dispatches[0]!.templateParams).toEqual({
      assessmentTitle: "Module 1 Quiz",
      resultsPath: `/learn/${enrolmentId}/results`,
    });
    expect(Object.keys(dispatches[0]!.templateParams as Record<string, unknown>).sort()).toEqual(
      ["assessmentTitle", "resultsPath"].sort(),
    );

    const notifications = await testDb.prisma.notification.findMany({});
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe("grade.released");
    expect(notifications[0]!.targetType).toBe("LEARNER_RESULTS");
    expect(notifications[0]!.targetId).toBe(enrolmentId);

    const raw = JSON.stringify(dispatches) + JSON.stringify(notifications);
    expect(raw).not.toContain("87.31");
    expect(raw).not.toContain("maxScore");
    expect(raw).not.toContain("\"passed\"");
  });

  it("a grade.overridden event yields template grade-overridden and notification type grade.overridden, never previousScore/newScore/passedChanged", async () => {
    const { enrolmentId, courseId } = await seedActiveVerifiedEnrolment();
    const assessmentId = await seedAssessment(courseId, "Module 2 Quiz");
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(testDb.prisma, "grade.overridden", {
      gradeId: "grade-2",
      assessmentId,
      enrolmentId,
      previousScore: 40,
      newScore: 65,
      passedChanged: true,
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({});
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.template).toBe("grade-overridden");

    const notifications = await testDb.prisma.notification.findMany({});
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe("grade.overridden");

    const raw = JSON.stringify(dispatches) + JSON.stringify(notifications);
    expect(raw).not.toContain("previousScore");
    expect(raw).not.toContain("newScore");
    expect(raw).not.toContain("passedChanged");
  });

  it("with RESULT_NOTICES muted the dispatch is SKIPPED muted_by_recipient and the Notification still exists (D-19)", async () => {
    const { enrolmentId, userId, courseId } = await seedActiveVerifiedEnrolment();
    const assessmentId = await seedAssessment(courseId, "Module 3 Quiz");
    await testDb.prisma.emailPreference.create({ data: { userId, category: "RESULT_NOTICES", muted: true } });
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(testDb.prisma, "grade.released", {
      gradeId: "grade-3",
      assessmentId,
      enrolmentId,
      score: 70,
      maxScore: 100,
      passed: true,
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({});
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.status).toBe("SKIPPED");
    expect(dispatches[0]!.skipReason).toBe("muted_by_recipient");

    const notifications = await testDb.prisma.notification.findMany({});
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe("grade.released");
  });

  it("returns no rows when the enrolment no longer exists (edge)", async () => {
    const harness = startDrainHarness(testDb.prisma);
    await writeEvent(testDb.prisma, "grade.released", {
      gradeId: "grade-x",
      assessmentId: "assess-does-not-exist",
      enrolmentId: "does-not-exist",
      score: 1,
      maxScore: 1,
      passed: true,
    });
    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);
    expect(await testDb.prisma.emailDispatch.count()).toBe(0);
    expect(await testDb.prisma.notification.count()).toBe(0);
  });

  it("returns no rows when the assessment no longer exists (edge)", async () => {
    const { enrolmentId } = await seedActiveVerifiedEnrolment();
    const harness = startDrainHarness(testDb.prisma);
    await writeEvent(testDb.prisma, "grade.released", {
      gradeId: "grade-y",
      assessmentId: "assess-does-not-exist",
      enrolmentId,
      score: 1,
      maxScore: 1,
      passed: true,
    });
    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);
    expect(await testDb.prisma.emailDispatch.count()).toBe(0);
  });

  it("two different learners' grade.released events in one drain each receive only their own mail (multi-recipient isolation, edge)", async () => {
    const learnerA = await seedActiveVerifiedEnrolment();
    const learnerB = await seedActiveVerifiedEnrolment();
    const assessmentIdA = await seedAssessment(learnerA.courseId, "Shared-shape Assessment A");
    const assessmentIdB = await seedAssessment(learnerB.courseId, "Shared-shape Assessment B");
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(
      testDb.prisma,
      "grade.released",
      { gradeId: "grade-a", assessmentId: assessmentIdA, enrolmentId: learnerA.enrolmentId, score: 10, maxScore: 10, passed: true },
      new Date("2026-01-01T00:00:00.000Z"),
    );
    await writeEvent(
      testDb.prisma,
      "grade.released",
      { gradeId: "grade-b", assessmentId: assessmentIdB, enrolmentId: learnerB.enrolmentId, score: 20, maxScore: 20, passed: true },
      new Date("2026-01-01T00:00:01.000Z"),
    );

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(2);

    const dispatches = await testDb.prisma.emailDispatch.findMany({});
    expect(dispatches).toHaveLength(2);
    const recipients = dispatches.map((d) => d.userId).sort();
    expect(recipients).toEqual([learnerA.userId, learnerB.userId].sort());

    const dispatchForA = dispatches.find((d) => d.userId === learnerA.userId)!;
    const dispatchForB = dispatches.find((d) => d.userId === learnerB.userId)!;
    expect((dispatchForA.templateParams as Record<string, unknown>).assessmentTitle).toBe("Shared-shape Assessment A");
    expect((dispatchForB.templateParams as Record<string, unknown>).assessmentTitle).toBe("Shared-shape Assessment B");
  });
});

// ---------------------------------------------------------------------------
// Task 2 — certificate.issued / certificate.revoked / certificate.reissued
// ---------------------------------------------------------------------------

describe("certificate.issued / certificate.revoked / certificate.reissued drain (D-07, T-11-50, T-13-42)", () => {
  it("certificate.issued mails the certificate's own holder exactly once with the verification reference and dashboard link", async () => {
    const { enrolmentId, userId } = await seedActiveVerifiedEnrolment();
    const certificateId = await seedCertificate({ enrolmentId, userId, verificationRef: "CERT-ISSUED-0001" });
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(testDb.prisma, "certificate.issued", {
      certificateId,
      enrolmentId,
      scope: "COURSE",
      verificationRef: "CERT-ISSUED-0001",
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({});
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.template).toBe("certificate-issued");
    expect(dispatches[0]!.userId).toBe(userId);
    expect(dispatches[0]!.templateParams).toEqual({
      verificationRef: "CERT-ISSUED-0001",
      dashboardPath: "/dashboard",
    });

    const notifications = await testDb.prisma.notification.findMany({});
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe("certificate.issued");
    expect(notifications[0]!.targetType).toBe("LEARNER_DASHBOARD");
    expect(notifications[0]!.targetId).toBe(certificateId);
  });

  it("a certificate.issued event whose certificate row does not exist yields 0 rows and the event is processed (edge)", async () => {
    const harness = startDrainHarness(testDb.prisma);
    await writeEvent(testDb.prisma, "certificate.issued", {
      certificateId: "cert-does-not-exist",
      enrolmentId: "enr-does-not-exist",
      scope: "COURSE",
      verificationRef: "n/a",
    });
    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);
    expect(await testDb.prisma.emailDispatch.count()).toBe(0);
    expect(await testDb.prisma.notification.count()).toBe(0);
  });

  it("certificate.revoked with a hostile reason on the payload drains to 1 dispatch whose templateParams keys are exactly verificationRef, and the reason appears in no column", async () => {
    const { enrolmentId, userId } = await seedActiveVerifiedEnrolment();
    const certificateId = await seedCertificate({
      enrolmentId,
      userId,
      verificationRef: "CERT-REVOKED-0002",
      status: "REVOKED",
    });
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(testDb.prisma, "certificate.revoked", {
      certificateId,
      enrolmentId,
      verificationRef: "CERT-REVOKED-0002",
      reason: "SECRET-REVOCATION-REASON",
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({});
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.template).toBe("certificate-revoked");
    expect(Object.keys(dispatches[0]!.templateParams as Record<string, unknown>)).toEqual(["verificationRef"]);

    const notifications = await testDb.prisma.notification.findMany({});
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe("certificate.revoked");

    const raw = JSON.stringify(dispatches) + JSON.stringify(notifications);
    expect(raw).not.toContain("SECRET-REVOCATION-REASON");
  });

  it("certificate.reissued resolves the holder from the new certificate row, yields exactly 1 dispatch and 1 notification, and never leaks a reason", async () => {
    const { enrolmentId, userId } = await seedActiveVerifiedEnrolment();
    const newCertificateId = await seedCertificate({
      enrolmentId,
      userId,
      verificationRef: "CERT-REISSUED-0004",
    });
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(testDb.prisma, "certificate.reissued", {
      oldCertificateId: "cert-old-0003",
      newCertificateId,
      oldVerificationRef: "CERT-REISSUED-0003",
      newVerificationRef: "CERT-REISSUED-0004",
      reason: "SECRET-REISSUE-REASON",
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({});
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.template).toBe("certificate-reissued");
    expect(dispatches[0]!.userId).toBe(userId);
    expect(dispatches[0]!.templateParams).toEqual({
      oldVerificationRef: "CERT-REISSUED-0003",
      newVerificationRef: "CERT-REISSUED-0004",
      dashboardPath: "/dashboard",
    });

    const notifications = await testDb.prisma.notification.findMany({});
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe("certificate.reissued");
    expect(notifications[0]!.targetId).toBe(newCertificateId);

    const raw = JSON.stringify(dispatches) + JSON.stringify(notifications);
    expect(raw).not.toContain("SECRET-REISSUE-REASON");
  });

  it("with all four mutable categories muted, certificate dispatches are still QUEUED or SENT, never SKIPPED (D-16 always-sent)", async () => {
    const { enrolmentId, userId } = await seedActiveVerifiedEnrolment();
    const certificateId = await seedCertificate({ enrolmentId, userId, verificationRef: "CERT-ALWAYS-0005" });
    for (const category of MUTABLE_EMAIL_CATEGORIES) {
      await testDb.prisma.emailPreference.create({ data: { userId, category, muted: true } });
    }
    const harness = startDrainHarness(testDb.prisma);

    await writeEvent(testDb.prisma, "certificate.issued", {
      certificateId,
      enrolmentId,
      scope: "COURSE",
      verificationRef: "CERT-ALWAYS-0005",
    });

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const dispatches = await testDb.prisma.emailDispatch.findMany({});
    expect(dispatches).toHaveLength(1);
    expectDelivered(dispatches[0]!.status);
  });
});
