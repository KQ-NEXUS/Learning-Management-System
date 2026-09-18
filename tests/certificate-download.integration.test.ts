/**
 * Real-Postgres + real-object-storage proof for the certificate download
 * round trip (CRD-03, plan 11-16 Task 1).
 *
 * The unit suite for `certificate-issuance-service.ts` and
 * `certificate-service.ts` drives `issueCertificateForEnrolment` /
 * `getOwnCertificateForDownload` against in-memory fakes for storage and the
 * database. A fake cannot prove that a generated PDF is genuinely written to
 * an object store, that its `storageKey` round-trips through a real
 * presigned `GetObject` URL, or that the bytes a browser would actually
 * receive begin with the `%PDF` magic header and carry the real learner's
 * name — not a placeholder, not the field token. This file starts a
 * throwaway `postgres:16-alpine` (`tests/support/pg.ts`) and drives every
 * case through the real MinIO container this environment already has
 * healthy, reusing `storage-service.ts`'s own exported functions (never a
 * reimplementation).
 *
 * ENV-VAR-BEFORE-IMPORT HAZARD (mirrors `tests/checkout-webhook.integration.test.ts`
 * and `tests/submission-service.integration.test.ts`'s header discipline):
 * `storage-service.ts` constructs its module-scoped `S3Client` from
 * `process.env.S3_*` the first time it is evaluated, and
 * `certificate-issuance-service.ts` / `certificate-service.ts` both
 * transitively import `@/server/db`, which constructs the singleton
 * `PrismaClient` from `process.env.DATABASE_URL` the first time THAT module
 * is evaluated. This file therefore takes no static top-level import of
 * either module (or anything that transitively imports them) — `S3_*` is set
 * as a plain top-level statement below (before any dynamic import runs), and
 * `DATABASE_URL` is set inside `beforeAll` immediately after the
 * Testcontainers instance starts, both strictly before the one dynamic
 * `await import(...)` block that pulls in the app modules this file drives.
 *
 * The port below (9002) is this environment's actual published MinIO port —
 * the same one `tests/submission-service.integration.test.ts` already
 * verified reachable, holding the `lms-private` bucket with the
 * `.env.example` placeholder credentials.
 *
 * This file deliberately does NOT import
 * `goldenCertificateLayoutFixture` from `tests/certificate-pdf-renderer.test.ts`
 * even though that fixture exists and 11-16's own plan text suggested reuse:
 * importing another Vitest test file's module re-executes its top-level
 * `describe`/`it` calls in the importing file's own collection pass
 * (verified empirically while writing this file — all 13 cases in that file
 * doubled to 27 total when imported this way). That would silently duplicate
 * `certificate-pdf-renderer.test.ts`'s suite inside `npm test` every time
 * this file is collected. Instead this file builds its own equivalent
 * all-four-dynamic-field layout through the same
 * `parseCertificateTemplateLayout` pipeline (so a layout-schema regression
 * still fails here) and copies that file's byte-level `extractPdfText`
 * helper, which is pure and has no such side effect.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with
 * a container-start error and every case reports BLOCKED — the expected
 * failure mode, never a silent pass or a weakened mock.
 */

import { Buffer } from "node:buffer";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture, seedEnrolmentFixture, seedLearnerFixture } from "./support/cohort-fixtures";
import { renderCertificatePdf } from "@/server/services/certificate-pdf-renderer";
import { parseCertificateTemplateLayout } from "@/server/services/certificate-template-layout";
import { generateVerificationRef } from "@/server/services/certificate-reference";
import type {
  CertificateIssuanceTxClient,
  IssueCertificateDeps,
} from "@/server/services/certificate-issuance-service";

process.env.S3_BUCKET = "lms-private";
process.env.S3_ENDPOINT = "http://localhost:9002";
process.env.S3_PUBLIC_ENDPOINT = "http://localhost:9002";
process.env.S3_ACCESS_KEY_ID = "lms-minio";
process.env.S3_SECRET_ACCESS_KEY = "change-me-minio";
process.env.S3_FORCE_PATH_STYLE = "true";
process.env.S3_REGION = "us-east-1";

const {
  buildCertificateStorageKey,
  putGeneratedCertificateObject,
  presignCertificateObjectUrl,
  getObjectBytes,
} = await import("@/server/services/storage-service");

let testDb: TestDatabase;
let issueCertificateForEnrolment: typeof import("@/server/services/certificate-issuance-service")["issueCertificateForEnrolment"];
let getOwnCertificateForDownload: typeof import("@/server/services/certificate-service")["getOwnCertificateForDownload"];

beforeAll(async () => {
  testDb = await startTestDatabase();

  // MUST happen before any dynamic import below — see file header.
  process.env.DATABASE_URL = testDb.url;

  const issuanceModule = await import("@/server/services/certificate-issuance-service");
  issueCertificateForEnrolment = issuanceModule.issueCertificateForEnrolment;

  const certificateServiceModule = await import("@/server/services/certificate-service");
  getOwnCertificateForDownload = certificateServiceModule.getOwnCertificateForDownload;
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

/**
 * A real, all-four-dynamic-field layout parsed through
 * `parseCertificateTemplateLayout` — no image element, so this test never
 * needs `resolveTemplateAsset` to resolve a real object-store asset; the
 * renderer's image path is already covered by
 * `tests/certificate-pdf-renderer.test.ts`'s own fixture.
 */
const DOWNLOAD_TEST_LAYOUT = parseCertificateTemplateLayout({
  schema: 1,
  pageSize: "A4",
  orientation: "landscape",
  elements: [
    { kind: "border", style: "solid", color: "#123456", widthPt: 2 },
    {
      kind: "text",
      field: "literal",
      literal: "Certificate of Completion",
      x: 140,
      y: 500,
      width: 500,
      height: 40,
      fontSize: 28,
      color: "#123456",
      align: "left",
    },
    {
      kind: "text",
      field: "learnerName",
      x: 140,
      y: 440,
      width: 500,
      height: 32,
      fontSize: 22,
      color: "#000000",
      align: "left",
    },
    {
      kind: "text",
      field: "awardTitle",
      x: 140,
      y: 400,
      width: 500,
      height: 28,
      fontSize: 18,
      color: "#000000",
      align: "left",
    },
    {
      kind: "text",
      field: "issuedAt",
      x: 140,
      y: 360,
      width: 300,
      height: 24,
      fontSize: 14,
      color: "#000000",
      align: "left",
    },
    {
      kind: "text",
      field: "verificationRef",
      x: 140,
      y: 330,
      width: 300,
      height: 24,
      fontSize: 12,
      color: "#000000",
      align: "left",
    },
  ],
});

/**
 * Extracts the text shown by `Tj` operators from a pdf-lib-produced PDF's
 * content streams — copied from `tests/certificate-pdf-renderer.test.ts`
 * (see file header for why this is copied rather than imported).
 */
function extractPdfText(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  const latin1 = buffer.toString("latin1");
  let extracted = "";
  let searchFrom = 0;

  for (;;) {
    const streamIndex = latin1.indexOf("stream", searchFrom);
    if (streamIndex === -1) break;

    let start = streamIndex + "stream".length;
    if (latin1[start] === "\r") start++;
    if (latin1[start] === "\n") start++;

    const endIndex = latin1.indexOf("endstream", start);
    if (endIndex === -1) break;

    let raw = buffer.subarray(start, endIndex);
    while (raw.length > 0 && (raw[raw.length - 1] === 0x0a || raw[raw.length - 1] === 0x0d)) {
      raw = raw.subarray(0, raw.length - 1);
    }

    try {
      const inflated = zlib.inflateSync(raw).toString("latin1");
      const hexShowTextPattern = /<([0-9A-Fa-f]+)>\s*Tj/g;
      let match: RegExpExecArray | null;
      while ((match = hexShowTextPattern.exec(inflated)) !== null) {
        extracted += hexToLatin1(match[1]);
      }
    } catch {
      // Not a Flate-compressed text content stream — nothing to extract.
    }

    searchFrom = endIndex + "endstream".length;
  }

  return extracted;
}

function hexToLatin1(hex: string): string {
  let text = "";
  for (let i = 0; i < hex.length; i += 2) {
    text += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  return text;
}

/** Never invoked in this file's layout (no image element) — throws loudly if it ever is. */
const resolveTemplateAsset: IssueCertificateDeps["resolveTemplateAsset"] = async (assetKey) => {
  throw new Error(`certificate-download.integration.test.ts's layout has no image element; unexpected resolve for ${assetKey}`);
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

async function seedIssuedCourseCertificate() {
  const template = await testDb.prisma.certificateTemplate.create({
    data: { name: "Download Test Template", layout: DOWNLOAD_TEST_LAYOUT as never, isDefault: false },
    select: { id: true },
  });

  const course = await testDb.prisma.course.create({
    data: {
      slug: `download-fixture-course-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: "Applied Data Science",
      certificateEnabled: true,
      certificateIssuanceMode: "AUTOMATIC",
      certificateTemplateId: template.id,
    },
    select: { id: true },
  });

  const { cohortId } = await seedCohortFixture(testDb.prisma, { courseId: course.id });
  const { enrolmentId, userId } = await seedEnrolmentFixture(testDb.prisma, {
    cohortId,
    status: "ACTIVE",
  });

  await testDb.prisma.completionRecord.create({
    data: {
      enrolmentId,
      scope: "COURSE",
      courseId: course.id,
      ruleVersion: 1,
      completedAt: new Date(),
    },
  });

  const deps = buildDeps();
  const outcome = await testDb.prisma.$transaction((tx) =>
    issueCertificateForEnrolment(
      tx as unknown as CertificateIssuanceTxClient,
      { enrolmentId, scope: "COURSE", now: new Date(), actor: null },
      deps,
    ),
  );

  if (outcome.kind !== "issued") {
    throw new Error(`Fixture issuance did not succeed: ${JSON.stringify(outcome)}`);
  }

  const certificate = await testDb.prisma.certificate.findUniqueOrThrow({
    where: { id: outcome.certificateId },
  });

  return { certificate, userId, courseId: course.id };
}

describe("certificate download round trip — real Postgres + real object storage (CRD-03)", () => {
  it("writes a real object at the recorded storageKey, resolves a real presigned URL, and the fetched bytes are a genuine %PDF carrying the learner's real name", async () => {
    const { certificate, userId } = await seedIssuedCourseCertificate();

    expect(certificate.storageKey).toBeTruthy();
    const storageKey = certificate.storageKey as string;
    expect(storageKey.startsWith(`certificates/${certificate.id}/`)).toBe(true);

    // 1. The object genuinely exists in storage at the recorded key — a
    // direct GetObject, independent of the presigned-URL path below.
    const directBytes = await getObjectBytes(storageKey);
    const directHeader = Buffer.from(directBytes.slice(0, 4)).toString("latin1");
    expect(directHeader).toBe("%PDF");

    // 2. A real presigned URL, fetched for real — assertions are on the
    // bytes the URL actually returns, never on the URL string itself.
    const url = await presignCertificateObjectUrl({ key: storageKey });
    expect(url).toMatch(/^http/);

    const response = await fetch(url);
    expect(response.ok).toBe(true);
    const fetchedBytes = new Uint8Array(await response.arrayBuffer());

    const fetchedHeader = Buffer.from(fetchedBytes.slice(0, 4)).toString("latin1");
    expect(fetchedHeader).toBe("%PDF");

    const learner = await testDb.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const renderedText = extractPdfText(fetchedBytes);
    expect(renderedText).toContain(learner.name);
    expect(renderedText).toContain(certificate.verificationRef);

    // 3. The owning learner's own lookup resolves the same certificate.
    const own = await getOwnCertificateForDownload({ userId }, certificate.id);
    expect(own?.id).toBe(certificate.id);
    expect(own?.storageKey).toBe(storageKey);
  }, TEST_DB_TIMEOUT_MS);

  it("a second learner's request through getOwnCertificateForDownload returns null, never another learner's certificate", async () => {
    const { certificate } = await seedIssuedCourseCertificate();
    const { userId: otherLearnerId } = await seedLearnerFixture(testDb.prisma);

    const result = await getOwnCertificateForDownload({ userId: otherLearnerId }, certificate.id);
    expect(result).toBeNull();
  }, TEST_DB_TIMEOUT_MS);
});
