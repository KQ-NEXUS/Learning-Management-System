/**
 * Real-Postgres proof for the duplicate-issuance race (CRD-01, T-11-01,
 * plan 11-16 Task 1) — the phase's highest architectural risk: two
 * simultaneous completion triggers for the same enrolment/scope must
 * converge on exactly one `ACTIVE` certificate, arbitrated by the partial
 * unique index `certificate_one_active_per_enrolment_scope`
 * (`ON ("enrolmentId","scope") WHERE status = 'ACTIVE'`,
 * `prisma/migrations/20260916162101_certificates_issuance_mode_and_templates/migration.sql`).
 *
 * The unit suite for `certificate-issuance-service.ts` drives this same code
 * path against an in-memory fake whose `certificate.create` throws a
 * synthetic P2002 on the SECOND sequential call — that proves the catch
 * branch's logic, but a sequential fake cannot prove what only Postgres
 * itself can arbitrate: two genuinely concurrent transactions, each opened
 * before the other commits, both observing "no ACTIVE row yet" under READ
 * COMMITTED, with only the unique index deciding which one's INSERT
 * actually lands. This file exercises that race for real —
 * `Promise.all` over two independent `$transaction` calls against the same
 * throwaway `postgres:16-alpine` (`tests/support/pg.ts`) — for both
 * completion scopes (`COURSE` and `PROGRAMME`).
 *
 * ENV-VAR-BEFORE-IMPORT HAZARD (mirrors `tests/checkout-webhook.integration.test.ts`
 * and `tests/certificate-download.integration.test.ts`'s header discipline):
 * `certificate-issuance-service.ts` transitively imports `@/server/db`,
 * which constructs the singleton `PrismaClient` from
 * `process.env.DATABASE_URL` the first time that module is evaluated, and
 * transitively imports `storage-service.ts`, which constructs its
 * module-scoped `S3Client` from `process.env.S3_*` the first time IT is
 * evaluated. This file takes no static top-level import of either module —
 * `S3_*` is set as a plain top-level statement below, and `DATABASE_URL` is
 * set inside `beforeAll` immediately after the Testcontainers instance
 * starts, both strictly before the one dynamic `await import(...)` that
 * pulls in `certificate-issuance-service.ts`.
 *
 * Only the WINNING transaction in each race ever reaches the real
 * render/store step (`issueCertificateForEnrolment`'s create-then-render
 * ordering — see that file's own header — means the loser's `P2002` is
 * caught before any PDF is rendered or any object written), so this file's
 * real-object-storage usage is incidental to proving the Postgres race, not
 * a second target of what this file sets out to prove.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with
 * a container-start error and every case reports BLOCKED — the expected
 * failure mode, never a silent pass or a weakened mock.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture, seedEnrolmentFixture } from "./support/cohort-fixtures";
import { renderCertificatePdf } from "@/server/services/certificate-pdf-renderer";
import { parseCertificateTemplateLayout, EMPTY_LAYOUT_V1 } from "@/server/services/certificate-template-layout";
import { generateVerificationRef } from "@/server/services/certificate-reference";
import type {
  CertificateIssuanceTxClient,
  IssueCertificateDeps,
  IssueCertificateOutcome,
} from "@/server/services/certificate-issuance-service";

process.env.S3_BUCKET = "lms-private";
process.env.S3_ENDPOINT = "http://localhost:9002";
process.env.S3_PUBLIC_ENDPOINT = "http://localhost:9002";
process.env.S3_ACCESS_KEY_ID = "lms-minio";
process.env.S3_SECRET_ACCESS_KEY = "change-me-minio";
process.env.S3_FORCE_PATH_STYLE = "true";
process.env.S3_REGION = "us-east-1";

const { putGeneratedCertificateObject, buildCertificateStorageKey } = await import(
  "@/server/services/storage-service"
);

let testDb: TestDatabase;
let issueCertificateForEnrolment: typeof import("@/server/services/certificate-issuance-service")["issueCertificateForEnrolment"];

beforeAll(async () => {
  testDb = await startTestDatabase();

  // MUST happen before the dynamic import below — see file header.
  process.env.DATABASE_URL = testDb.url;

  const issuanceModule = await import("@/server/services/certificate-issuance-service");
  issueCertificateForEnrolment = issuanceModule.issueCertificateForEnrolment;
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

/** No image element — never exercises `resolveTemplateAsset` in this file. */
const RACE_TEST_LAYOUT = parseCertificateTemplateLayout(EMPTY_LAYOUT_V1);

const resolveTemplateAsset: IssueCertificateDeps["resolveTemplateAsset"] = async (assetKey) => {
  throw new Error(`certificate-concurrency.integration.test.ts's layout has no image element; unexpected resolve for ${assetKey}`);
};

function buildDeps(): IssueCertificateDeps {
  return {
    renderPdf: renderCertificatePdf,
    putObject: putGeneratedCertificateObject,
    buildKey: buildCertificateStorageKey,
    generateRef: generateVerificationRef,
    audit: async (event) => {
      await testDb.prisma.auditEvent.create({
        data: {
          actorId: event.actorId,
          actorType: event.actorType ?? "USER",
          action: event.action,
          targetType: event.targetType,
          targetId: event.targetId ?? null,
          outcome: event.outcome,
          reason: event.reason ?? null,
        },
      });
    },
    writeEvent: async (tx, event) => {
      await tx.domainEvent.create({
        data: {
          type: event.type,
          payload: event.payload as never,
          occurredAt: event.occurredAt ?? new Date(),
        },
      });
    },
    resolveTemplateAsset,
  };
}

let counter = 0;
function uniq(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}-${Date.now()}`;
}

async function seedCourseFixture() {
  const template = await testDb.prisma.certificateTemplate.create({
    data: { name: "Concurrency Test Template", layout: RACE_TEST_LAYOUT as never, isDefault: false },
    select: { id: true },
  });

  const course = await testDb.prisma.course.create({
    data: {
      slug: uniq("concurrency-fixture-course"),
      title: "Concurrency Fixture Course",
      certificateEnabled: true,
      certificateIssuanceMode: "AUTOMATIC",
      certificateTemplateId: template.id,
    },
    select: { id: true },
  });

  const { cohortId } = await seedCohortFixture(testDb.prisma, { courseId: course.id });
  const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, { cohortId, status: "ACTIVE" });

  return { enrolmentId };
}

async function seedProgrammeFixture() {
  const template = await testDb.prisma.certificateTemplate.create({
    data: { name: "Concurrency Test Programme Template", layout: RACE_TEST_LAYOUT as never, isDefault: false },
    select: { id: true },
  });

  const programme = await testDb.prisma.programme.create({
    data: {
      slug: uniq("concurrency-fixture-programme"),
      title: "Concurrency Fixture Programme",
      certificateEnabled: true,
      certificateTemplateId: template.id,
    },
    select: { id: true },
  });

  const now = Date.now();
  const DAY_MS = 86_400_000;
  const cohort = await testDb.prisma.cohort.create({
    data: {
      code: uniq("CONC-PROG-COH"),
      title: "Concurrency Fixture Programme Cohort",
      programmeId: programme.id,
      deliveryMode: "INSTRUCTOR_LED",
      timezone: "Africa/Lagos",
      startsAt: new Date(now + 7 * DAY_MS),
      endsAt: new Date(now + 30 * DAY_MS),
      enrolmentOpensAt: new Date(now - 7 * DAY_MS),
      enrolmentClosesAt: new Date(now + 5 * DAY_MS),
      capacity: 1,
      seatsTaken: 0,
      priceMinor: 0,
      currency: "NGN",
      holdMinutes: 30,
    },
    select: { id: true },
  });

  const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, {
    cohortId: cohort.id,
    status: "ACTIVE",
  });

  return { enrolmentId };
}

/**
 * Fires two genuinely concurrent `issueCertificateForEnrolment` calls, each
 * in its OWN `$transaction`, via `Promise.all` — never sequential awaits.
 * Both transactions open before either commits, so both observe "no ACTIVE
 * row yet" under READ COMMITTED; only the unique index arbitrates which
 * INSERT actually lands.
 */
async function fireConcurrentIssuance(
  enrolmentId: string,
  scope: "COURSE" | "PROGRAMME",
): Promise<IssueCertificateOutcome[]> {
  const deps = buildDeps();
  const now = new Date();

  return Promise.all([
    testDb.prisma.$transaction((tx) =>
      issueCertificateForEnrolment(
        tx as unknown as CertificateIssuanceTxClient,
        { enrolmentId, scope, now, actor: null },
        deps,
      ),
    ),
    testDb.prisma.$transaction((tx) =>
      issueCertificateForEnrolment(
        tx as unknown as CertificateIssuanceTxClient,
        { enrolmentId, scope, now, actor: null },
        deps,
      ),
    ),
  ]);
}

describe("certificate duplicate-issuance race — real Postgres (CRD-01, T-11-01)", () => {
  it("COURSE scope: two concurrent issuance calls for the same enrolment converge on exactly one ACTIVE certificate; the loser reports already-issued, never throws", async () => {
    const { enrolmentId } = await seedCourseFixture();

    const [first, second] = await fireConcurrentIssuance(enrolmentId, "COURSE");

    const outcomes = [first, second];
    const issued = outcomes.filter((o) => o.kind === "issued");
    const alreadyIssued = outcomes.filter((o) => o.kind === "already-issued");
    expect(issued).toHaveLength(1);
    expect(alreadyIssued).toHaveLength(1);

    const activeCount = await testDb.prisma.certificate.count({
      where: { enrolmentId, scope: "COURSE", status: "ACTIVE" },
    });
    expect(activeCount).toBe(1);
  }, TEST_DB_TIMEOUT_MS);

  it("PROGRAMME scope: two concurrent issuance calls for the same enrolment converge on exactly one ACTIVE certificate; the loser reports already-issued, never throws", async () => {
    const { enrolmentId } = await seedProgrammeFixture();

    const [first, second] = await fireConcurrentIssuance(enrolmentId, "PROGRAMME");

    const outcomes = [first, second];
    const issued = outcomes.filter((o) => o.kind === "issued");
    const alreadyIssued = outcomes.filter((o) => o.kind === "already-issued");
    expect(issued).toHaveLength(1);
    expect(alreadyIssued).toHaveLength(1);

    const activeCount = await testDb.prisma.certificate.count({
      where: { enrolmentId, scope: "PROGRAMME", status: "ACTIVE" },
    });
    expect(activeCount).toBe(1);
  }, TEST_DB_TIMEOUT_MS);
});
