/**
 * Real-Postgres proof of learner anonymisation (Phase 15, plan 15-16; D-12,
 * NFR-11, P3): one authorised call rewrites the User row in place, ends every
 * session, removes only the ancillary rows the policy lists, keeps every
 * retained record byte-for-byte, and leaves a hashed audit row. Refusals, the
 * concurrency race, the permission denial and the licence write block are
 * proven against the same database.
 *
 * `@/server/db` is pointed at the Testcontainers client so the real
 * `getActorBySessionToken`, `recordAuthorizationAudit` and `signIn` run against
 * it, never against the configured DATABASE_URL. EMAIL_TRANSPORT is irrelevant:
 * no email is sent.
 *
 * PREREQUISITE: Docker must be running (tests/support/pg.ts starts a
 * throwaway postgres:16-alpine container). If it is not, `beforeAll` fails with
 * a container-start error: every case reports BLOCKED, never a silent pass.
 */

import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

const dbHolder = vi.hoisted(() => ({ prisma: null as unknown as object }));
vi.mock("@/server/db", () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, key) {
        const client = dbHolder.prisma as Record<PropertyKey, unknown>;
        const value = Reflect.get(client, key);
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(client) : value;
      },
    },
  ),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

import { hashToken } from "@/server/auth/token-hash";
import {
  AuthorizationError,
  createWithPermission,
  LicenceRestrictedError,
  type RawGrant,
} from "@/server/permissions/with-permission";
import { createAuthService } from "@/server/services/auth-service";
import { recordAuthorizationAudit } from "@/server/services/audit-service";
import {
  AnonymiseConflictError,
  AnonymiseNotAllowedError,
  ANONYMISE_POLICY,
  ANONYMISED_NAME,
  anonymisedEmailFor,
  createPrivacyAnonymiseService,
} from "@/server/services/privacy-anonymise-service";
import { getActorBySessionToken } from "@/server/services/session-service";
import { seedAttendanceFixture, seedCohortFixture, seedSessionFixture } from "./support/cohort-fixtures";
import { grant } from "./support/harness";
import { activateAt, guardedWithPermission, makeClock, resetLicenceFlow } from "./support/licence-flow";
import { FIXTURE_NOW } from "./support/licence-fixtures";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";

// Real Postgres, scrypt-free (verify is stubbed) but several transactions per case.
vi.setConfig({ testTimeout: 60_000 });

let db: TestDatabase;
let prisma: PrismaClient;
let actorId: string;
let sequence = 0;

const REASON = "Learner asked for erasure in writing, ref PRIV-1";
const CORRELATION = "corr-privacy-test";

beforeAll(async () => {
  db = await startTestDatabase();
  prisma = db.prisma;
  dbHolder.prisma = prisma;
  actorId = (
    await prisma.user.create({
      data: {
        email: "privacy-actor@privacy-anonymise.test",
        name: "Privacy Actor",
        status: "ACTIVE",
        isStaff: true,
      },
    })
  ).id;
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await db?.stop();
}, TEST_DB_TIMEOUT_MS);

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function buildService(options: { grants?: RawGrant[]; userId?: string; now?: () => Date } = {}) {
  const withPermission = createWithPermission({
    getActor: async () => ({ userId: options.userId ?? actorId }),
    loadGrants: async () => options.grants ?? [grant("privacy.manage")],
    audit: recordAuthorizationAudit,
  });
  return createPrivacyAnonymiseService({
    store: prisma as never,
    withPermission,
    correlationId: async () => CORRELATION,
    ...(options.now ? { now: options.now } : {}),
  });
}

type Seeded = Awaited<ReturnType<typeof seedLearner>>;

/** A learner with a record in every table the policy removes and every table it keeps. */
async function seedLearner() {
  sequence += 1;
  const tag = `${sequence}-${randomUUID().slice(0, 8)}`;
  const email = `ada.${tag}@privacy-anonymise.test`;
  const pendingEmail = `ada.new.${tag}@privacy-anonymise.test`;
  const name = `Ada Okafor ${tag}`;
  const user = await prisma.user.create({
    data: {
      email,
      name,
      phone: "+2348012345678",
      pendingEmail,
      passwordHash: "scrypt:fixture-hash",
      status: "ACTIVE",
      emailVerified: new Date(),
      learnerNumber: `KQL-PRIV-${tag}`,
    },
  });
  const { cohortId, courseId } = await seedCohortFixture(prisma);
  const enrolment = await prisma.enrolment.create({ data: { cohortId, userId: user.id, status: "ACTIVE" } });
  const order = await prisma.order.create({
    data: {
      reference: `ORD-${tag}`,
      userId: user.id,
      cohortId,
      amountMinor: 50_000,
      idempotencyKey: `idem-order-${tag}`,
      status: "PAID",
    },
  });
  const attempt = await prisma.paymentAttempt.create({
    data: {
      orderId: order.id,
      provider: "MANUAL",
      amountMinor: 50_000,
      currency: "NGN",
      status: "SUCCEEDED",
      idempotencyKey: `idem-attempt-${tag}`,
    },
  });
  const refund = await prisma.refund.create({
    data: {
      orderId: order.id,
      paymentAttemptId: attempt.id,
      amountMinor: 5_000,
      currency: "NGN",
      provider: "MANUAL",
      reason: "Partial refund for a missed session",
      accessDecision: "KEEP",
    },
  });
  const { sessionId } = await seedSessionFixture(prisma, { cohortId });
  const attendance = await seedAttendanceFixture(prisma, { sessionId, enrolmentId: enrolment.id, state: "PRESENT" });
  const assessment = await prisma.assessment.create({
    data: { courseId, type: "ASSIGNMENT", title: `Assignment ${tag}` },
  });
  const submission = await prisma.submission.create({
    data: {
      assessmentId: assessment.id,
      enrolmentId: enrolment.id,
      versionUsed: 1,
      storageKey: `submissions/${tag}.pdf`,
      filename: "work.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1234,
    },
  });
  const grade = await prisma.grade.create({
    data: { assessmentId: assessment.id, enrolmentId: enrolment.id, submissionId: submission.id, score: 8, maxScore: 10 },
  });
  const completion = await prisma.completionRecord.create({
    data: { enrolmentId: enrolment.id, scope: "COURSE", courseId, ruleVersion: 1 },
  });
  const certificate = await prisma.certificate.create({
    data: {
      verificationRef: `VER-${tag}`,
      enrolmentId: enrolment.id,
      userId: user.id,
      scope: "COURSE",
      courseId,
      awardTitle: "Certificate of completion",
      learnerName: name,
    },
  });
  const ticket = await prisma.ticket.create({
    data: { reference: `TKT-${tag}`, userId: user.id, category: "OTHER", subject: "Help with my account" },
  });
  const ticketMessage = await prisma.ticketMessage.create({
    data: { ticketId: ticket.id, authorId: user.id, kind: "INITIAL", visibility: "PUBLIC", body: "Please help" },
  });
  const policy = await prisma.policyAcceptance.create({
    data: { userId: user.id, policyType: "terms", version: "1", accepted: true },
  });
  const earlierAudit = await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "user.email_changed",
      targetType: "User",
      targetId: user.id,
      after: { email },
      outcome: "SUCCESS",
    },
  });

  // Rows the policy removes.
  await prisma.account.create({
    data: { userId: user.id, type: "oauth", provider: "fixture", providerAccountId: `acct-${tag}` },
  });
  await prisma.emailPreference.create({ data: { userId: user.id, category: "MARKETING", muted: true } });
  await prisma.notification.create({
    data: {
      recipientId: user.id,
      type: "fixture",
      targetType: "Fixture",
      targetId: "t",
      params: {},
      sourceEventId: `evt-${tag}`,
    },
  });
  await prisma.verificationToken.create({
    data: { identifier: email, token: `tok-old-${tag}`, expires: new Date(Date.now() + 3_600_000), purpose: "EMAIL_VERIFICATION" },
  });
  await prisma.verificationToken.create({
    data: { identifier: pendingEmail, userId: user.id, token: `tok-pending-${tag}`, expires: new Date(Date.now() + 3_600_000), purpose: "EMAIL_CHANGE" },
  });
  await prisma.loginThrottle.create({
    data: { key: `ip-email:203.0.113.9|${email}`, email, failures: 2, windowStartedAt: new Date() },
  });

  // Two sessions: one through the real sign-in (so its token can be replayed), one direct.
  const auth = createAuthService({ store: prisma, verify: async () => true, audit: async () => {} });
  const signedIn = await auth.signIn(email, "right-password", { ip: "203.0.113.9" });
  if (!signedIn.ok) throw new Error("fixture sign-in failed");
  await prisma.session.create({
    data: { sessionToken: hashToken(`second-${tag}`), userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });

  // A bystander whose rows must never be touched.
  const bystander = await prisma.user.create({
    data: { email: `bystander.${tag}@privacy-anonymise.test`, name: "Bystander", status: "ACTIVE" },
  });
  await prisma.emailPreference.create({ data: { userId: bystander.id, category: "MARKETING", muted: true } });
  await prisma.verificationToken.create({
    data: { identifier: bystander.email, token: `tok-bystander-${tag}`, expires: new Date(Date.now() + 3_600_000), purpose: "EMAIL_VERIFICATION" },
  });
  await prisma.loginThrottle.create({
    data: { key: `ip-email:203.0.113.9|${bystander.email}`, email: bystander.email, failures: 1, windowStartedAt: new Date() },
  });

  return {
    user,
    email,
    pendingEmail,
    name,
    sessionToken: signedIn.token,
    bystander,
    ids: {
      order: order.id,
      attempt: attempt.id,
      refund: refund.id,
      enrolment: enrolment.id,
      attendance: attendance.attendanceId,
      submission: submission.id,
      grade: grade.id,
      completion: completion.id,
      certificate: certificate.id,
      ticket: ticket.id,
      ticketMessage: ticketMessage.id,
      policy: policy.id,
      earlierAudit: earlierAudit.id,
    },
  };
}

/** Every retained row as JSON, so before and after can be compared exactly. */
async function retainedSnapshot(seeded: Seeded) {
  const { ids, user } = seeded;
  const json = (value: unknown) => JSON.parse(JSON.stringify(value));
  return json({
    order: await prisma.order.findUnique({ where: { id: ids.order } }),
    attempt: await prisma.paymentAttempt.findUnique({ where: { id: ids.attempt } }),
    refund: await prisma.refund.findUnique({ where: { id: ids.refund } }),
    enrolment: await prisma.enrolment.findUnique({ where: { id: ids.enrolment } }),
    attendance: await prisma.attendanceRecord.findUnique({ where: { id: ids.attendance } }),
    submission: await prisma.submission.findUnique({ where: { id: ids.submission } }),
    grade: await prisma.grade.findUnique({ where: { id: ids.grade } }),
    completion: await prisma.completionRecord.findUnique({ where: { id: ids.completion } }),
    certificate: await prisma.certificate.findUnique({ where: { id: ids.certificate } }),
    ticket: await prisma.ticket.findUnique({ where: { id: ids.ticket } }),
    ticketMessage: await prisma.ticketMessage.findUnique({ where: { id: ids.ticketMessage } }),
    policy: await prisma.policyAcceptance.findUnique({ where: { id: ids.policy } }),
    earlierAudit: await prisma.auditEvent.findUnique({ where: { id: ids.earlierAudit } }),
    keptUserFields: await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, learnerNumber: true, emailVerified: true, createdAt: true, isStaff: true },
    }),
  });
}

async function anonymisedAuditRows(userId: string) {
  return prisma.auditEvent.findMany({ where: { action: "privacy.learner_anonymised", targetId: userId } });
}

async function expectUnchanged(seeded: Seeded) {
  const row = await prisma.user.findUniqueOrThrow({ where: { id: seeded.user.id } });
  expect(row.email).toBe(seeded.email);
  expect(row.name).toBe(seeded.name);
  expect(row.status).toBe("ACTIVE");
  expect(row.anonymisedAt).toBeNull();
  expect(row.passwordHash).toBe("scrypt:fixture-hash");
  expect(await prisma.session.count({ where: { userId: seeded.user.id, revokedAt: null } })).toBe(2);
  expect(await anonymisedAuditRows(seeded.user.id)).toHaveLength(0);
}

describe("tracer: anonymise one learner end to end (D-12, NFR-11)", () => {
  it("rewrites the User row in place, ends sessions, removes only the listed rows, keeps every retained record and writes a hashed audit row", async () => {
    const seeded = await seedLearner();
    const { user, email, pendingEmail, name } = seeded;
    const retainedBefore = await retainedSnapshot(seeded);
    expect(await getActorBySessionToken(seeded.sessionToken)).toEqual({ userId: user.id, isStaff: false });

    const at = new Date("2026-10-08T09:30:00.000Z");
    const service = buildService({ now: () => at });
    const result = await service.anonymiseLearner({ userId: user.id, reason: `  ${REASON}  ` });
    expect(result).toEqual({ userId: user.id, anonymisedAt: at });

    // The User row still exists and carries the anonymised fields.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.name).toBe(ANONYMISED_NAME);
    expect(after.email).toBe(`anonymised-${user.id}@invalid.example`);
    expect(after.email).toBe(anonymisedEmailFor(user.id));
    expect(after.phone).toBeNull();
    expect(after.pendingEmail).toBeNull();
    expect(after.passwordHash).toBeNull();
    expect(after.status).toBe("DEACTIVATED");
    expect(after.anonymisedAt).toEqual(at);
    expect(after.anonymisedById).toBe(actorId);

    // Every session is revoked: the replayed token no longer resolves.
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2);
    expect(await getActorBySessionToken(seeded.sessionToken)).toBeNull();

    // The ancillary rows the policy lists are gone.
    expect(await prisma.account.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.emailPreference.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { recipientId: user.id } })).toBe(0);
    expect(await prisma.verificationToken.count({ where: { OR: [{ identifier: email }, { identifier: pendingEmail }, { userId: user.id }] } })).toBe(0);
    expect(await prisma.loginThrottle.count({ where: { email } })).toBe(0);

    // Sign-in with the old address fails (no account answers to it any more). Checked after
    // the throttle assertion above, because a failed attempt writes a fresh counter row.
    const auth = createAuthService({ store: prisma, verify: async () => true, audit: async () => {} });
    const signIn = await auth.signIn(email, "right-password", { ip: "198.51.100.77" });
    expect(signIn.ok).toBe(false);

    // Nothing belonging to anyone else was touched.
    expect(await prisma.emailPreference.count({ where: { userId: seeded.bystander.id } })).toBe(1);
    expect(await prisma.verificationToken.count({ where: { identifier: seeded.bystander.email } })).toBe(1);
    expect(await prisma.loginThrottle.count({ where: { email: seeded.bystander.email } })).toBe(1);

    // Every retained record is byte-for-byte unchanged, including the printed certificate name.
    const retainedAfter = await retainedSnapshot(seeded);
    expect(retainedAfter).toEqual(retainedBefore);
    expect(retainedAfter.certificate.learnerName).toBe(name);
    expect(retainedAfter.keptUserFields.learnerNumber).toBe(user.learnerNumber);

    // One audit row: actor, target, reason, outcome, correlationId, hashes only.
    const audits = await anonymisedAuditRows(user.id);
    expect(audits).toHaveLength(1);
    const audit = audits[0];
    expect(audit.actorId).toBe(actorId);
    expect(audit.targetType).toBe("User");
    expect(audit.outcome).toBe("SUCCESS");
    expect(audit.reason).toBe(REASON);
    expect(audit.correlationId).toBe(CORRELATION);
    expect(audit.scopeType).toBe("GLOBAL");
    expect(audit.before).toEqual({ emailSha256: sha256(email), nameSha256: sha256(name) });
    expect(audit.after).toEqual({ status: "DEACTIVATED", anonymisedAt: at.toISOString() });
    const stored = JSON.stringify([audit.before, audit.after, audit.reason]);
    expect(stored).not.toContain(email);
    expect(stored).not.toContain(pendingEmail);
    expect(stored).not.toContain(name);
    expect(stored).not.toContain("Ada Okafor");
  });

  it("the policy constant lists the seven changes, the four removals and the kept records the service honours", () => {
    expect(ANONYMISE_POLICY.changes).toHaveLength(7);
    expect(ANONYMISE_POLICY.removes).toHaveLength(4);
    expect(ANONYMISE_POLICY.keeps.length).toBeGreaterThanOrEqual(14);
    expect(ANONYMISE_POLICY.keeps.join(" ")).toMatch(/Certificates, including the printed learner name/);
    expect(ANONYMISE_POLICY.keeps.join(" ")).toMatch(/append-only/);
  });
});

describe("refusals change nothing (T-15-16-01)", () => {
  it("a reason under 20 characters is refused with the generic error", async () => {
    const seeded = await seedLearner();
    const service = buildService();
    await expect(service.anonymiseLearner({ userId: seeded.user.id, reason: "too short reason" })).rejects.toBeInstanceOf(
      AnonymiseNotAllowedError,
    );
    // 19 characters after trimming, with padding that must not count.
    await expect(
      service.anonymiseLearner({ userId: seeded.user.id, reason: `   ${"x".repeat(19)}   ` }),
    ).rejects.toBeInstanceOf(AnonymiseNotAllowedError);
    await expectUnchanged(seeded);
  });

  it("a 20-character reason is accepted", async () => {
    const seeded = await seedLearner();
    await buildService().anonymiseLearner({ userId: seeded.user.id, reason: "x".repeat(20) });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: seeded.user.id } })).anonymisedAt).not.toBeNull();
  });

  it("a staff account is refused, flagged by isStaff or by holding an assignment", async () => {
    const flagged = await prisma.user.create({
      data: { email: `flagged.${randomUUID()}@privacy-anonymise.test`, name: "Flagged Staff", status: "ACTIVE", isStaff: true },
    });
    const assigned = await prisma.user.create({
      data: { email: `assigned.${randomUUID()}@privacy-anonymise.test`, name: "Assigned Person", status: "ACTIVE" },
    });
    const role = await prisma.role.create({ data: { name: `privacy-role-${randomUUID()}`, permissions: ["courses.view"] } });
    await prisma.assignment.create({ data: { userId: assigned.id, roleId: role.id } });

    const service = buildService();
    for (const target of [flagged, assigned]) {
      await expect(service.anonymiseLearner({ userId: target.id, reason: REASON })).rejects.toBeInstanceOf(
        AnonymiseNotAllowedError,
      );
      const row = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      expect(row.name).toBe(target.name);
      expect(row.email).toBe(target.email);
      expect(row.anonymisedAt).toBeNull();
      expect(await anonymisedAuditRows(target.id)).toHaveLength(0);
    }
  });

  it("an unknown id is refused with the same error and writes no audit row", async () => {
    const id = `missing-${randomUUID()}`;
    await expect(buildService().anonymiseLearner({ userId: id, reason: REASON })).rejects.toBeInstanceOf(
      AnonymiseNotAllowedError,
    );
    expect(await anonymisedAuditRows(id)).toHaveLength(0);
  });

  it("an already anonymised learner is refused and the first audit row stays the only one", async () => {
    const seeded = await seedLearner();
    const service = buildService();
    await service.anonymiseLearner({ userId: seeded.user.id, reason: REASON });
    const first = await prisma.user.findUniqueOrThrow({ where: { id: seeded.user.id } });

    await expect(service.anonymiseLearner({ userId: seeded.user.id, reason: REASON })).rejects.toBeInstanceOf(
      AnonymiseNotAllowedError,
    );
    const second = await prisma.user.findUniqueOrThrow({ where: { id: seeded.user.id } });
    expect(second.anonymisedAt).toEqual(first.anonymisedAt);
    expect(second.anonymisedById).toBe(first.anonymisedById);
    expect(await anonymisedAuditRows(seeded.user.id)).toHaveLength(1);
  });
});

describe("two concurrent calls produce exactly one anonymisation (T-15-16-06)", () => {
  it("exactly one succeeds, the other is refused, and exactly one audit row exists", async () => {
    const seeded = await seedLearner();
    const service = buildService();

    const settled = await Promise.allSettled([
      service.anonymiseLearner({ userId: seeded.user.id, reason: REASON }),
      service.anonymiseLearner({ userId: seeded.user.id, reason: `${REASON} (second)` }),
    ]);

    const fulfilled = settled.filter((outcome) => outcome.status === "fulfilled");
    const rejected = settled.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // The loser either lost the compare-and-set (conflict) or arrived after the winner committed (not allowed).
    expect([AnonymiseConflictError, AnonymiseNotAllowedError].some((type) => rejected[0].reason instanceof type)).toBe(true);
    expect(await anonymisedAuditRows(seeded.user.id)).toHaveLength(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: seeded.user.id } })).status).toBe("DEACTIVATED");
  });
});

describe("authorization and the licence boundary (T-15-16-02)", () => {
  it("a caller without privacy.manage gets AuthorizationError and an authorization.denied audit row, and nothing changes", async () => {
    const seeded = await seedLearner();
    const service = buildService({ grants: [grant("users.manage"), grant("audit.view")] });
    await expect(service.anonymiseLearner({ userId: seeded.user.id, reason: REASON })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expectUnchanged(seeded);
    const denied = await prisma.auditEvent.findMany({
      where: { action: "authorization.denied", actorId, targetId: "privacy.manage" },
    });
    expect(denied.length).toBeGreaterThanOrEqual(1);
  });

  it("privacy.manage held only at a narrower scope does not authorise (Global only)", async () => {
    const seeded = await seedLearner();
    const service = buildService({ grants: [grant("privacy.manage", "COHORT", "some-cohort")] });
    await expect(service.anonymiseLearner({ userId: seeded.user.id, reason: REASON })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expectUnchanged(seeded);
  });

  describe("licence restricted continuity mode", () => {
    beforeEach(async () => {
      await resetLicenceFlow(db);
    });

    it("works while the licence is in grace and is refused as a write once it is restricted", async () => {
      const seeded = await seedLearner();
      const activated = await activateAt(db, { now: FIXTURE_NOW, actorId });
      expect(activated.result.ok).toBe(true);
      const clock = makeClock(new Date(activated.graceEndsAt.getTime() - 1));

      const serviceFor = () => {
        const { withPermission } = guardedWithPermission(db, clock, {
          grants: [grant("privacy.manage")],
          userId: actorId,
        });
        return createPrivacyAnonymiseService({
          store: prisma as never,
          withPermission,
          correlationId: async () => CORRELATION,
        });
      };

      // Restricted: refused before the handler runs, nothing changes.
      clock.set(activated.graceEndsAt);
      await expect(serviceFor().anonymiseLearner({ userId: seeded.user.id, reason: REASON })).rejects.toBeInstanceOf(
        LicenceRestrictedError,
      );
      await expectUnchanged(seeded);

      // The same call a moment earlier (still in grace) goes through.
      clock.set(new Date(activated.graceEndsAt.getTime() - 1));
      await serviceFor().anonymiseLearner({ userId: seeded.user.id, reason: REASON });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: seeded.user.id } })).anonymisedAt).not.toBeNull();
    });
  });
});
