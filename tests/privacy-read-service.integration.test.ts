/**
 * Real-Postgres proof for the learner privacy lookups behind the staff screens
 * (Phase 15, plan 15-22; D-12, NFR-11, T-15-22-02).
 *
 * Proves, against stored rows in a disposable database:
 *   - `findLearnerForPrivacy` matches ONE learner by exact email (case
 *     insensitive, surrounding spaces ignored) or exact learner number, and
 *     returns null for every partial value, wildcard, malformed value, unknown
 *     value, staff account and role holder;
 *   - `getPrivacyRecord` returns the fields the record page shows (name, email,
 *     learner number, status, registered date, enrolment count), the latest
 *     export state for the signed-in staff member, and the anonymised-by name
 *     once an account has been anonymised;
 *   - a caller without `privacy.manage` at Global scope is refused identically
 *     for a real learner and for an unknown value, so the lookup is not an
 *     oracle for which accounts exist;
 *   - both reads keep working in licence restricted mode (the reviewed
 *     continuity override), while a write-effect permission on the same
 *     choke point is still refused.
 *
 * SAFETY: the only database here is a disposable Testcontainers instance from
 * `startTestDatabase()`. Nothing reads `.env` or reaches a shared database.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with a
 * container-start error, which is the expected failure mode (every case reports
 * BLOCKED), not a code bug.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture, seedEnrolmentFixture } from "./support/cohort-fixtures";
import { grant } from "./support/harness";
import {
  AuthenticationError,
  AuthorizationError,
  createWithPermission,
  LicenceRestrictedError,
  type RawGrant,
} from "@/server/permissions/with-permission";
import { createPrivacyExportService, type LearnerExportPipeline } from "@/server/services/privacy-export-service";
import {
  createPrivacyReadService,
  PRIVACY_LOOKUP_MAX_LENGTH,
  type PrivacyReadStore,
} from "@/server/services/privacy-read-service";

let database: TestDatabase;
let prisma: PrismaClient;
let staffId: string;
let staffName: string;
let counter = 0;

beforeAll(async () => {
  database = await startTestDatabase();
  prisma = database.prisma;
  staffName = "Privacy Staff Member";
  staffId = (
    await prisma.user.create({
      data: { email: "privacy-staff@privacy-read.test", name: staffName, status: "ACTIVE", isStaff: true },
    })
  ).id;
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await database?.stop();
}, TEST_DB_TIMEOUT_MS);

const NOW = new Date("2026-10-08T12:00:00.000Z");

/** A pipeline that must never be reached: these tests only read. */
const unusedPipeline: LearnerExportPipeline = {
  requestExport: async () => {
    throw new Error("the read service must not request an export");
  },
};

function buildService(
  options: {
    grants?: RawGrant[];
    actorId?: string | null;
    restricted?: boolean;
  } = {},
) {
  const checks: string[] = [];
  const withPermission = createWithPermission({
    getActor: async () => (options.actorId === null ? null : { userId: options.actorId ?? staffId }),
    loadGrants: async () => options.grants ?? [grant("privacy.manage")],
    audit: async () => {},
    licence: {
      check: async ({ permission }) => {
        checks.push(permission);
        return options.restricted ? { allowed: false } : { allowed: true };
      },
    },
  });
  const exportService = createPrivacyExportService({
    store: prisma as never,
    withPermission,
    pipeline: unusedPipeline,
    correlationId: async () => "corr-privacy-read",
    now: () => NOW,
  });
  const service = createPrivacyReadService({
    store: prisma as unknown as PrivacyReadStore,
    withPermission,
    exportStatus: (input) => exportService.getLearnerExportStatus(input),
  });
  return { service, withPermission, checks };
}

async function seedLearner(overrides: Record<string, unknown> = {}) {
  counter += 1;
  const tag = `${counter}-${randomUUID().slice(0, 8)}`;
  const user = await prisma.user.create({
    data: {
      email: `ada.${tag}@privacy-read.test`,
      name: `Ada Okafor ${tag}`,
      status: "ACTIVE",
      learnerNumber: `KQL-R${tag.toUpperCase()}`,
      ...overrides,
    },
    select: { id: true, email: true, name: true, learnerNumber: true, createdAt: true },
  });
  return user;
}

describe("findLearnerForPrivacy: exact match only", () => {
  it("finds a learner by exact email, ignoring case and surrounding spaces", async () => {
    const learner = await seedLearner();
    const { service } = buildService();
    expect(await service.findLearnerForPrivacy({ query: learner.email })).toEqual({ userId: learner.id });
    expect(await service.findLearnerForPrivacy({ query: `  ${learner.email.toUpperCase()}\n` })).toEqual({
      userId: learner.id,
    });
  });

  it("finds a learner by exact learner number", async () => {
    const learner = await seedLearner();
    const { service } = buildService();
    expect(await service.findLearnerForPrivacy({ query: learner.learnerNumber! })).toEqual({ userId: learner.id });
    expect(await service.findLearnerForPrivacy({ query: ` ${learner.learnerNumber} ` })).toEqual({
      userId: learner.id,
    });
  });

  it("returns null for partial values, wildcards, malformed input and unknown values", async () => {
    const learner = await seedLearner();
    const { service } = buildService();
    const [local, domain] = learner.email.split("@");
    const misses = [
      local, // the part before the @
      `@${domain}`,
      domain,
      learner.email.slice(0, -3),
      learner.email.slice(1),
      learner.learnerNumber!.slice(0, -1), // a learner-number prefix
      learner.learnerNumber!.slice(1),
      "%",
      "%@%",
      `${local}%`,
      "ada._%",
      "_".repeat(learner.email.length),
      "ada okafor", // internal whitespace
      `${learner.email} ${learner.learnerNumber}`,
      "",
      "   ",
      "x".repeat(PRIVACY_LOOKUP_MAX_LENGTH + 1),
      "nobody@privacy-read.test",
      "KQL-DOES-NOT-EXIST",
    ];
    for (const query of misses) {
      expect(await service.findLearnerForPrivacy({ query }), JSON.stringify(query)).toBeNull();
    }
    // Not a string at all (a direct caller can send anything).
    expect(await service.findLearnerForPrivacy({ query: undefined as unknown as string })).toBeNull();
    expect(await service.findLearnerForPrivacy({ query: { email: learner.email } as unknown as string })).toBeNull();
  });

  it("returns null for a staff account and for a learner who holds a role, by email and by learner number", async () => {
    const staff = await seedLearner({ isStaff: true });
    const roleHolder = await seedLearner();
    const role = await prisma.role.create({
      data: { name: `privacy-read-role-${randomUUID()}`, permissions: ["courses.view"] },
    });
    await prisma.assignment.create({ data: { userId: roleHolder.id, roleId: role.id } });
    const { service } = buildService();
    for (const person of [staff, roleHolder]) {
      expect(await service.findLearnerForPrivacy({ query: person.email })).toBeNull();
      expect(await service.findLearnerForPrivacy({ query: person.learnerNumber! })).toBeNull();
      expect(await service.getPrivacyRecord({ userId: person.id })).toBeNull();
    }
  });
});

describe("getPrivacyRecord", () => {
  it("returns the facts the record page shows, with no export yet", async () => {
    const learner = await seedLearner({ phone: "+2348012345678" });
    const { cohortId } = await seedCohortFixture(prisma, { capacity: 20 });
    await seedEnrolmentFixture(prisma, { cohortId, userId: learner.id });
    const second = await seedCohortFixture(prisma, { capacity: 20 });
    await seedEnrolmentFixture(prisma, { cohortId: second.cohortId, userId: learner.id });

    const { service } = buildService();
    const record = await service.getPrivacyRecord({ userId: learner.id });
    expect(record).toMatchObject({
      userId: learner.id,
      name: learner.name,
      email: learner.email,
      learnerNumber: learner.learnerNumber,
      accountStatus: "ACTIVE",
      enrolmentCount: 2,
      anonymisedAt: null,
      anonymisedByName: null,
    });
    expect(record!.registeredAt.getTime()).toBe(learner.createdAt.getTime());
    expect(record!.exportStatus).toMatchObject({ state: "none", inFlight: false, canDownload: false, canRetry: false });
    // Nothing the screen does not show is returned: no phone, no password hash.
    expect(Object.keys(record!).sort()).toEqual(
      [
        "accountStatus",
        "anonymisedAt",
        "anonymisedByName",
        "email",
        "enrolmentCount",
        "exportStatus",
        "learnerNumber",
        "name",
        "registeredAt",
        "userId",
      ].sort(),
    );
  });

  it("reports pending verification, deactivated and a missing learner number", async () => {
    const pending = await seedLearner({ status: "PENDING_VERIFICATION", learnerNumber: null });
    const deactivated = await seedLearner({ status: "DEACTIVATED" });
    const { service } = buildService();
    expect(await service.getPrivacyRecord({ userId: pending.id })).toMatchObject({
      accountStatus: "PENDING_VERIFICATION",
      learnerNumber: null,
    });
    expect(await service.getPrivacyRecord({ userId: deactivated.id })).toMatchObject({ accountStatus: "DEACTIVATED" });
  });

  it("returns the latest export state for the signed-in staff member only", async () => {
    const learner = await seedLearner();
    const otherStaff = await prisma.user.create({
      data: { email: `other-staff-${randomUUID()}@privacy-read.test`, name: "Other Staff", isStaff: true },
    });
    const expiresAt = new Date(NOW.getTime() + 60 * 60_000);
    // Another staff member's finished export must not be offered to this one.
    await prisma.exportJob.create({
      data: {
        requestedById: otherStaff.id,
        dataset: "learner-subject",
        filters: { userId: learner.id },
        status: "SUCCEEDED",
        storageKey: "exports/other.csv",
        expiresAt,
      },
    });
    const { service } = buildService();
    expect((await service.getPrivacyRecord({ userId: learner.id }))!.exportStatus.state).toBe("none");

    const mine = await prisma.exportJob.create({
      data: {
        requestedById: staffId,
        dataset: "learner-subject",
        filters: { userId: learner.id },
        status: "SUCCEEDED",
        storageKey: "exports/mine.csv",
        expiresAt,
      },
    });
    const ready = (await service.getPrivacyRecord({ userId: learner.id }))!.exportStatus;
    expect(ready).toMatchObject({ state: "succeeded", jobId: mine.id, canDownload: true });
    expect(ready.expiresAt!.getTime()).toBe(expiresAt.getTime());
  });

  it("shows an anonymised account as Anonymised, with who did it and nothing left to export", async () => {
    const anonymisedAt = new Date("2026-10-07T09:30:00.000Z");
    const learner = await seedLearner({
      name: "Anonymised learner",
      status: "DEACTIVATED",
      anonymisedAt,
      anonymisedById: staffId,
    });
    const { service } = buildService();
    const record = await service.getPrivacyRecord({ userId: learner.id });
    expect(record).toMatchObject({ accountStatus: "ANONYMISED", anonymisedByName: staffName });
    expect(record!.anonymisedAt!.getTime()).toBe(anonymisedAt.getTime());
    expect(record!.exportStatus.state).toBe("none");
  });

  it("returns null for an unknown, empty or oversized id", async () => {
    const { service } = buildService();
    expect(await service.getPrivacyRecord({ userId: "no-such-user" })).toBeNull();
    expect(await service.getPrivacyRecord({ userId: "" })).toBeNull();
    expect(await service.getPrivacyRecord({ userId: "x".repeat(200) })).toBeNull();
    expect(await service.getPrivacyRecord({ userId: undefined as unknown as string })).toBeNull();
  });
});

describe("permission: nobody else learns whether an account exists", () => {
  it("refuses a caller without privacy.manage identically for a real learner and an unknown value", async () => {
    const learner = await seedLearner();
    const { service } = buildService({ grants: [grant("users.manage"), grant("audit.view")] });

    const refusals: unknown[] = [];
    for (const call of [
      () => service.findLearnerForPrivacy({ query: learner.email }),
      () => service.findLearnerForPrivacy({ query: "nobody@privacy-read.test" }),
      () => service.getPrivacyRecord({ userId: learner.id }),
      () => service.getPrivacyRecord({ userId: "no-such-user" }),
    ]) {
      refusals.push(await call().then(() => null, (error: unknown) => error));
    }
    for (const error of refusals) expect(error).toBeInstanceOf(AuthorizationError);
    expect(new Set(refusals.map((error) => (error as Error).message)).size).toBe(1);
  });

  it("refuses a privacy.manage grant that is not Global (the permission is Global-only)", async () => {
    const learner = await seedLearner();
    const { service } = buildService({ grants: [grant("privacy.manage", "COHORT", "some-cohort")] });
    await expect(service.getPrivacyRecord({ userId: learner.id })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(service.findLearnerForPrivacy({ query: learner.email })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("refuses an anonymous caller with the authentication error", async () => {
    const learner = await seedLearner();
    const { service } = buildService({ actorId: null });
    await expect(service.getPrivacyRecord({ userId: learner.id })).rejects.toBeInstanceOf(AuthenticationError);
  });
});

describe("licence restricted mode (LIC-08 permitted data access)", () => {
  it("keeps both reads working when the deployment is restricted, without consulting the write guard", async () => {
    const learner = await seedLearner();
    const { service, checks } = buildService({ restricted: true });
    expect(await service.findLearnerForPrivacy({ query: learner.email })).toEqual({ userId: learner.id });
    expect((await service.getPrivacyRecord({ userId: learner.id }))!.userId).toBe(learner.id);
    expect(checks).toEqual([]);
  });

  it("still blocks a write-effect use of the same permission in restricted mode (anonymise is unchanged)", async () => {
    const { withPermission, checks } = buildService({ restricted: true });
    // No override: the permission's own classification is write, as in privacy-anonymise-service.
    const write = withPermission("privacy.manage", () => ({}))(async () => "ran");
    await expect(write(undefined)).rejects.toBeInstanceOf(LicenceRestrictedError);
    expect(checks).toEqual(["privacy.manage"]);
  });
});
