/**
 * Real-Postgres + real-object-storage proof for the second-pass certificate
 * criticals CR-01 and CR-01b (plan 11-32 Task 1).
 *
 * WHAT THIS PROVES THAT THE UNIT SUITES CANNOT
 *   - CR-01 (Unicode): a learner named in Yoruba, Polish, French/Spanish Latin
 *     extended, CJK or Arabic completes the issuing transaction, the certificate
 *     row and the COMPLETED enrolment are COMMITTED, and the PDF the real
 *     renderer draws with the bundled Noto Sans font is stored in the real
 *     MinIO bucket after commit with recoverable text. Before plan 11-29 the
 *     renderer threw `WinAnsi cannot encode "ọ" (0x1ecd)` inside the caller's
 *     transaction and nothing committed (the pre-fix failure recorded in the
 *     11-29 SUMMARY).
 *   - CR-01b (containment): a renderer or object-store failure, or a hung
 *     renderer, after commit leaves the caller's own write (a marker row written
 *     by the same transaction body), the certificate row and the COMPLETED
 *     enrolment intact; the file is produced later, on demand, idempotently.
 *     Before plan 11-30 the PDF work ran inside the caller's transaction, so a
 *     render failure or an invalid stored template layout aborted everything
 *     (`UnsupportedCertificateLayoutError` inside the transaction; 14 failures
 *     recorded in the 11-30 SUMMARY).
 *   - Plan 11-34: WebP / GIF logo bytes no longer throw in the renderer (5
 *     failures recorded in the 11-34 SUMMARY); the certificate renders without
 *     the image.
 *
 * WHY THE PRE-FIX FAILURE MODE IS CITED, NOT RE-RUN: the new APIs (the file
 * service, the settle wrapper, the not-eligible outcomes) do not exist in the
 * pre-fix tree, so this file cannot compile there. The earlier plans' SUMMARYs
 * record the unit-level failures against the pre-fix source.
 *
 * SAFETY (T-11-134): every database here is a throwaway Testcontainers Postgres
 * from `startTestDatabase()`; `DATABASE_URL` is overwritten with the container
 * URL inside `beforeAll` BEFORE the dynamic imports below, and asserted equal to
 * it. The remote database in `.env` is never contacted. Only synthetic learner
 * names are used (T-11-135); evidence PDFs are written only when
 * `CERTIFICATE_EVIDENCE_DIR` is set.
 *
 * ENV-VAR-BEFORE-IMPORT HAZARD: identical to
 * tests/certificate-concurrency.integration.test.ts and
 * tests/certificate-download.integration.test.ts. `S3_*` is set at top level
 * before the dynamic storage import, `DATABASE_URL` in `beforeAll` before the
 * dynamic service imports (which pull in the `@/server/db` singleton).
 *
 * PREREQUISITE: Docker running and the local MinIO at localhost:9002. If either
 * is missing the hooks fail (BLOCKED), never a silent pass.
 */

import { Buffer } from "node:buffer";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { extractPdfText } from "./support/pdf-content";
import { seedCohortFixture, seedEnrolmentFixture } from "./support/cohort-fixtures";
import { renderCertificatePdf } from "@/server/services/certificate-pdf-renderer";
import { parseCertificateTemplateLayout } from "@/server/services/certificate-template-layout";
import { generateVerificationRef } from "@/server/services/certificate-reference";
import type {
  CertificateIssuanceTxClient,
  IssueCertificateDeps,
  IssueCertificateOutcome,
} from "@/server/services/certificate-issuance-service";
import type { CertificateFileStore } from "@/server/services/certificate-file-service";

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
  getObjectBytes,
} = await import("@/server/services/storage-service");

let testDb: TestDatabase;
let issueCertificateForEnrolment: typeof import("@/server/services/certificate-issuance-service")["issueCertificateForEnrolment"];
let liveIssuanceDeps: typeof import("@/server/services/certificate-issuance-service")["liveIssuanceDeps"];
let createCertificateFileService: typeof import("@/server/services/certificate-file-service")["createCertificateFileService"];
let runTransactionThenSettleCertificateFiles: typeof import("@/server/services/certificate-file-service")["runTransactionThenSettleCertificateFiles"];

beforeAll(async () => {
  testDb = await startTestDatabase();

  // MUST happen before any dynamic import below — see file header.
  process.env.DATABASE_URL = testDb.url;
  expect(process.env.DATABASE_URL).toBe(testDb.url);

  const issuanceModule = await import("@/server/services/certificate-issuance-service");
  issueCertificateForEnrolment = issuanceModule.issueCertificateForEnrolment;
  liveIssuanceDeps = issuanceModule.liveIssuanceDeps;

  const fileModule = await import("@/server/services/certificate-file-service");
  createCertificateFileService = fileModule.createCertificateFileService;
  runTransactionThenSettleCertificateFiles = fileModule.runTransactionThenSettleCertificateFiles;
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REAL_NAMES = {
  yoruba: "Adébáyọ̀ Ṣolá",
  yorubaTwo: "Ọlọ́run Ẹlẹ́gbẹ́",
  polish: "Łukasz Żółć",
  latin: "François Müller-Ñandú",
  cjk: "山田 太郎",
  arabic: "محمد",
} as const;

const LOGO_KEY = "certificate-template-assets/tpl/logo";

function layoutElements(withImage: boolean) {
  const elements: unknown[] = [
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
    { kind: "text", field: "learnerName", x: 140, y: 440, width: 500, height: 32, fontSize: 22, color: "#000000", align: "left" },
    { kind: "text", field: "awardTitle", x: 140, y: 400, width: 500, height: 28, fontSize: 18, color: "#000000", align: "left" },
    { kind: "text", field: "issuedAt", x: 140, y: 360, width: 300, height: 24, fontSize: 14, color: "#000000", align: "left" },
    { kind: "text", field: "verificationRef", x: 140, y: 330, width: 300, height: 24, fontSize: 12, color: "#000000", align: "left" },
  ];
  if (withImage) {
    elements.push({ kind: "image", assetKey: LOGO_KEY, x: 40, y: 40, width: 60, height: 60 });
  }
  return elements;
}

function parsedLayout(withImage = false) {
  return parseCertificateTemplateLayout({
    schema: 1,
    pageSize: "A4",
    orientation: "landscape",
    elements: layoutElements(withImage),
  });
}

/** A valid 2x2 JPEG, so the image counter is proven to count a real image. */
const TWO_PIXEL_JPEG = new Uint8Array(
  Buffer.from(
    "/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAACAAIDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAABf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAEBv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ABwVQ//Z",
    "base64",
  ),
);
const WEBP_BYTES = new Uint8Array([
  ...Buffer.from("RIFF", "latin1"),
  0x1a, 0x00, 0x00, 0x00,
  ...Buffer.from("WEBPVP8L", "latin1"),
  0x0d, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

async function countImageXObjects(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  let count = 0;
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    const dict = (object as { dict?: { toString(): string } }).dict;
    if (dict && /\/Subtype\s*\/Image/.test(dict.toString())) count++;
  }
  return count;
}

let counter = 0;
function uniq(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}-${Date.now()}`;
}

function buildDeps(): IssueCertificateDeps {
  return {
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
  };
}

type FileServiceOverrides = Partial<Parameters<typeof createCertificateFileService>[0]>;

/** The post-commit file step bound to the container database and real MinIO, with optional failure injection. */
function buildFileService(overrides: FileServiceOverrides = {}) {
  return createCertificateFileService({
    store: testDb.prisma as unknown as CertificateFileStore,
    renderPdf: renderCertificatePdf,
    putObject: putGeneratedCertificateObject,
    buildKey: buildCertificateStorageKey,
    resolveAsset: async () => {
      throw new Error("unexpected asset resolve");
    },
    log: () => {},
    ...overrides,
  });
}

async function seedAutomaticCourse(input: {
  learnerName: string;
  templateLayout: unknown;
}) {
  const template = await testDb.prisma.certificateTemplate.create({
    data: { name: uniq("Unicode Template"), layout: input.templateLayout as never, isDefault: false },
    select: { id: true },
  });
  const course = await testDb.prisma.course.create({
    data: {
      slug: uniq("unicode-fixture-course"),
      title: "Applied Data Science",
      certificateEnabled: true,
      certificateIssuanceMode: "AUTOMATIC",
      certificateTemplateId: template.id,
    },
    select: { id: true },
  });
  const { cohortId } = await seedCohortFixture(testDb.prisma, { courseId: course.id });
  const learner = await testDb.prisma.user.create({
    data: { email: `${uniq("unicode-learner")}@fixture.test`, name: input.learnerName, status: "ACTIVE" },
    select: { id: true },
  });
  const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, {
    cohortId,
    userId: learner.id,
    status: "ACTIVE",
  });
  await testDb.prisma.completionRecord.create({
    data: { enrolmentId, scope: "COURSE", courseId: course.id, ruleVersion: 1, completedAt: new Date() },
  });
  return { enrolmentId, userId: learner.id, courseId: course.id };
}

/**
 * Issues inside a real transaction whose body ALSO writes a marker row (the
 * caller's own write), then settles after commit with the given file service.
 * Returns the outcome, the marker type and how long the whole wrapper took.
 */
async function issueWithCallerWrite(
  enrolmentId: string,
  fileService: ReturnType<typeof buildFileService>,
  deps: IssueCertificateDeps = buildDeps(),
) {
  const markerType = uniq("test.caller-write");
  const started = Date.now();
  const outcome: IssueCertificateOutcome = await runTransactionThenSettleCertificateFiles(
    (body: (tx: object) => Promise<IssueCertificateOutcome>) =>
      testDb.prisma.$transaction((tx) => body(tx as object)),
    async (tx) => {
      const issued = await issueCertificateForEnrolment(
        tx as CertificateIssuanceTxClient,
        { enrolmentId, scope: "COURSE", now: new Date(), actor: null },
        deps,
      );
      // The caller's own write, in the same transaction as the issuance.
      await (tx as unknown as CertificateIssuanceTxClient).domainEvent.create({
        data: { type: markerType, payload: { enrolmentId } as never, occurredAt: new Date() },
      });
      return issued;
    },
    fileService.settlePendingCertificateFiles,
  );
  return { outcome, markerType, elapsedMs: Date.now() - started };
}

function issuedId(outcome: IssueCertificateOutcome): string {
  if (outcome.kind !== "issued") throw new Error(`Expected an issued outcome, got ${JSON.stringify(outcome)}`);
  return outcome.certificateId;
}

async function countObjectsFor(certificateId: string): Promise<string | null> {
  const row = await testDb.prisma.certificate.findUniqueOrThrow({ where: { id: certificateId } });
  return row.storageKey;
}

// ---------------------------------------------------------------------------
// Scenario A — Unicode names through the real renderer, live wiring
// ---------------------------------------------------------------------------

describe("Scenario A: Unicode learner names issue and store a PDF after commit (CR-01, real Postgres + MinIO)", () => {
  const evidenceDir = process.env.CERTIFICATE_EVIDENCE_DIR
    ? path.resolve(process.env.CERTIFICATE_EVIDENCE_DIR)
    : null;
  const evidenceLabels: Record<string, string> = {
    [REAL_NAMES.yorubaTwo]: "yoruba",
    [REAL_NAMES.polish]: "polish",
    [REAL_NAMES.cjk]: "cjk",
  };

  const latinNames = [REAL_NAMES.yoruba, REAL_NAMES.yorubaTwo, REAL_NAMES.polish, REAL_NAMES.latin];

  it.each(latinNames)(
    "Latin-extended name %s: committed row, COMPLETED enrolment, stored %PDF with the recoverable NFC name",
    async (name) => {
      const { enrolmentId } = await seedAutomaticCourse({ learnerName: name, templateLayout: parsedLayout() });

      // The LIVE wrapper and LIVE settle (bound to the @/server/db singleton,
      // which reads the container DATABASE_URL), the live issuance deps.
      const outcome: IssueCertificateOutcome = await runTransactionThenSettleCertificateFiles(
        (body: (tx: object) => Promise<IssueCertificateOutcome>) =>
          testDb.prisma.$transaction((tx) => body(tx as object)),
        (tx) =>
          issueCertificateForEnrolment(
            tx as CertificateIssuanceTxClient,
            { enrolmentId, scope: "COURSE", now: new Date(), actor: null },
            liveIssuanceDeps,
          ),
      );
      const certificateId = issuedId(outcome);

      const certificate = await testDb.prisma.certificate.findUniqueOrThrow({ where: { id: certificateId } });
      expect(certificate.status).toBe("ACTIVE");
      expect(certificate.learnerName).toBe(name);
      const enrolment = await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: enrolmentId } });
      expect(enrolment.status).toBe("COMPLETED");

      expect(certificate.storageKey).toBeTruthy();
      const bytes = await getObjectBytes(certificate.storageKey as string);
      expect(Buffer.from(bytes.slice(0, 4)).toString("latin1")).toBe("%PDF");

      expect(extractPdfText(bytes)).toContain(name.normalize("NFC"));

      const label = evidenceLabels[name];
      if (evidenceDir && label) {
        mkdirSync(evidenceDir, { recursive: true });
        writeFileSync(path.join(evidenceDir, `${label}-certificate.pdf`), bytes);
      }
    },
    TEST_DB_TIMEOUT_MS,
  );

  it.each([
    [REAL_NAMES.cjk, "?? ??"],
    [REAL_NAMES.arabic, "???"],
  ])(
    "unsupported-script name %s: issuance and file production succeed and the drawn name is \"?\" placeholders (accepted limitation)",
    async (name, placeholders) => {
      const { enrolmentId } = await seedAutomaticCourse({ learnerName: name, templateLayout: parsedLayout() });

      const outcome: IssueCertificateOutcome = await runTransactionThenSettleCertificateFiles(
        (body: (tx: object) => Promise<IssueCertificateOutcome>) =>
          testDb.prisma.$transaction((tx) => body(tx as object)),
        (tx) =>
          issueCertificateForEnrolment(
            tx as CertificateIssuanceTxClient,
            { enrolmentId, scope: "COURSE", now: new Date(), actor: null },
            liveIssuanceDeps,
          ),
      );
      const certificateId = issuedId(outcome);

      const certificate = await testDb.prisma.certificate.findUniqueOrThrow({ where: { id: certificateId } });
      // The row keeps the real name; only the drawn text is substituted.
      expect(certificate.learnerName).toBe(name);
      expect((await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: enrolmentId } })).status).toBe(
        "COMPLETED",
      );
      expect(certificate.storageKey).toBeTruthy();

      const bytes = await getObjectBytes(certificate.storageKey as string);
      expect(Buffer.from(bytes.slice(0, 4)).toString("latin1")).toBe("%PDF");
      const text = extractPdfText(bytes);
      expect(text).toContain(placeholders);
      expect(text).not.toContain(name);

      const label = evidenceLabels[name];
      if (evidenceDir && label) {
        mkdirSync(evidenceDir, { recursive: true });
        writeFileSync(path.join(evidenceDir, `${label}-certificate.pdf`), bytes);
      }
    },
    TEST_DB_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// Scenario B — failure containment and on-demand recovery
// ---------------------------------------------------------------------------

describe("Scenario B: a renderer or storage failure after commit never breaks the caller's write (CR-01b)", () => {
  async function assertCommittedButFileless(enrolmentId: string, markerType: string, certificateId: string) {
    // The certificate row, the COMPLETED enrolment and the caller's marker write ARE committed.
    const certificate = await testDb.prisma.certificate.findUniqueOrThrow({ where: { id: certificateId } });
    expect(certificate.status).toBe("ACTIVE");
    expect(certificate.storageKey).toBeNull();
    expect((await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: enrolmentId } })).status).toBe(
      "COMPLETED",
    );
    const markers = await testDb.prisma.domainEvent.findMany({ where: { type: markerType } });
    expect(markers).toHaveLength(1);
  }

  it("a throwing renderer: the wrapper resolves, row + COMPLETED + caller marker committed, storageKey null; ensure later produces the file idempotently", async () => {
    const { enrolmentId } = await seedAutomaticCourse({
      learnerName: REAL_NAMES.polish,
      templateLayout: parsedLayout(),
    });

    const failing = buildFileService({
      renderPdf: async () => {
        throw new Error("renderer exploded");
      },
    });
    const { outcome, markerType } = await issueWithCallerWrite(enrolmentId, failing);
    const certificateId = issuedId(outcome);
    await assertCommittedButFileless(enrolmentId, markerType, certificateId);

    // On-demand recovery with a working renderer.
    const working = buildFileService();
    const key = await working.ensureCertificateFile(certificateId);
    expect(key).toBeTruthy();
    expect(await countObjectsFor(certificateId)).toBe(key);
    const bytes = await getObjectBytes(key as string);
    expect(Buffer.from(bytes.slice(0, 4)).toString("latin1")).toBe("%PDF");
    expect(extractPdfText(bytes)).toContain(REAL_NAMES.polish.normalize("NFC"));

    // Idempotent: same key again, and the row is unchanged (no second object recorded).
    expect(await working.ensureCertificateFile(certificateId)).toBe(key);
    expect(await countObjectsFor(certificateId)).toBe(key);
  }, TEST_DB_TIMEOUT_MS);

  it("a throwing object-store put: the wrapper resolves, row + COMPLETED + caller marker committed, storageKey null; ensure later completes it", async () => {
    const { enrolmentId } = await seedAutomaticCourse({
      learnerName: REAL_NAMES.yoruba,
      templateLayout: parsedLayout(),
    });

    const failing = buildFileService({
      putObject: async () => {
        throw new Error("object store unavailable");
      },
    });
    const { outcome, markerType } = await issueWithCallerWrite(enrolmentId, failing);
    const certificateId = issuedId(outcome);
    await assertCommittedButFileless(enrolmentId, markerType, certificateId);

    const key = await buildFileService().ensureCertificateFile(certificateId);
    expect(key).toBeTruthy();
    expect(await countObjectsFor(certificateId)).toBe(key);
    expect(Buffer.from((await getObjectBytes(key as string)).slice(0, 4)).toString("latin1")).toBe("%PDF");
  }, TEST_DB_TIMEOUT_MS);

  it("the failure log carries only the certificate id and the error name, never the learner name or message", async () => {
    const { enrolmentId } = await seedAutomaticCourse({
      learnerName: REAL_NAMES.yorubaTwo,
      templateLayout: parsedLayout(),
    });
    const logged: Array<{ message: string; detail: unknown }> = [];
    const failing = buildFileService({
      renderPdf: async () => {
        throw new TypeError(`cannot encode ${REAL_NAMES.yorubaTwo}`);
      },
      log: (message, detail) => logged.push({ message, detail }),
    });

    const { outcome } = await issueWithCallerWrite(enrolmentId, failing);
    const certificateId = issuedId(outcome);

    expect(logged).toHaveLength(1);
    expect(logged[0].detail).toEqual({ certificateId, errorName: "TypeError" });
    expect(JSON.stringify(logged)).not.toContain("Ọlọ́run");
  }, TEST_DB_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// Scenario C — timeout containment
// ---------------------------------------------------------------------------

describe("Scenario C: a hung renderer is bounded by the settle timeout (CR-01b)", () => {
  it("the wrapper resolves roughly within timeoutMs, the row stays file-less, and a later ensure completes it", async () => {
    const { enrolmentId } = await seedAutomaticCourse({
      learnerName: REAL_NAMES.latin,
      templateLayout: parsedLayout(),
    });

    const hung = buildFileService({
      renderPdf: () => new Promise<Uint8Array>(() => {}),
      timeoutMs: 400,
    });
    const { outcome, markerType, elapsedMs } = await issueWithCallerWrite(enrolmentId, hung);
    const certificateId = issuedId(outcome);

    // Bounded: the transaction plus the 400 ms deadline, nowhere near the 6 s default.
    expect(elapsedMs).toBeLessThan(4_000);

    const certificate = await testDb.prisma.certificate.findUniqueOrThrow({ where: { id: certificateId } });
    expect(certificate.storageKey).toBeNull();
    expect((await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: enrolmentId } })).status).toBe(
      "COMPLETED",
    );
    expect(await testDb.prisma.domainEvent.count({ where: { type: markerType } })).toBe(1);

    const key = await buildFileService().ensureCertificateFile(certificateId);
    expect(key).toBeTruthy();
    expect(await countObjectsFor(certificateId)).toBe(key);
  }, TEST_DB_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// Scenario D — template robustness
// ---------------------------------------------------------------------------

describe("Scenario D: a bad template or a bad logo never blocks issuance (CR-01b, CR-02)", () => {
  it("an invalid stored layout: the row and COMPLETED enrolment and caller marker still commit; the file step fails contained (storageKey null)", async () => {
    const { enrolmentId } = await seedAutomaticCourse({
      learnerName: REAL_NAMES.yoruba,
      // Not a v1 layout: parseCertificateTemplateLayout throws when the file step reads it.
      templateLayout: { version: 999, elements: "not-an-array" },
    });

    const logged: Array<{ message: string; detail: { certificateId: string; errorName: string } }> = [];
    const fileService = buildFileService({ log: (message, detail) => logged.push({ message, detail }) });
    const { outcome, markerType } = await issueWithCallerWrite(enrolmentId, fileService);
    const certificateId = issuedId(outcome);

    const certificate = await testDb.prisma.certificate.findUniqueOrThrow({ where: { id: certificateId } });
    expect(certificate.status).toBe("ACTIVE");
    expect(certificate.storageKey).toBeNull();
    expect((await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: enrolmentId } })).status).toBe(
      "COMPLETED",
    );
    expect(await testDb.prisma.domainEvent.count({ where: { type: markerType } })).toBe(1);
    expect(logged).toHaveLength(1);
    expect(logged[0].detail.certificateId).toBe(certificateId);
  }, TEST_DB_TIMEOUT_MS);

  it("an image element whose bytes are WebP renders a PDF (with the text) and without the image; a valid JPEG control keeps its image", async () => {
    const webp = await seedAutomaticCourse({
      learnerName: REAL_NAMES.polish,
      templateLayout: parsedLayout(true),
    });
    const webpFiles = buildFileService({ resolveAsset: async () => WEBP_BYTES });
    const webpIssue = await issueWithCallerWrite(webp.enrolmentId, webpFiles);
    const webpKey = await countObjectsFor(issuedId(webpIssue.outcome));
    expect(webpKey).toBeTruthy();
    const webpPdf = await getObjectBytes(webpKey as string);
    expect(Buffer.from(webpPdf.slice(0, 4)).toString("latin1")).toBe("%PDF");
    expect(extractPdfText(webpPdf)).toContain(REAL_NAMES.polish.normalize("NFC"));
    expect(await countImageXObjects(webpPdf)).toBe(0);

    const control = await seedAutomaticCourse({
      learnerName: REAL_NAMES.polish,
      templateLayout: parsedLayout(true),
    });
    const jpegFiles = buildFileService({ resolveAsset: async () => TWO_PIXEL_JPEG });
    const jpegIssue = await issueWithCallerWrite(control.enrolmentId, jpegFiles);
    const jpegKey = await countObjectsFor(issuedId(jpegIssue.outcome));
    expect(jpegKey).toBeTruthy();
    expect(await countImageXObjects(await getObjectBytes(jpegKey as string))).toBe(1);
  }, TEST_DB_TIMEOUT_MS);
});
