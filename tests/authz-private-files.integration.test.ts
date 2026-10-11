/**
 * Private file delivery, proven end to end (Phase 15, plan 15-27; NFR-06,
 * T-15-27-01..04, ledger P-07 and P-08).
 *
 * Every private download route is called as the people who must be refused and as
 * the people who may succeed, against a real Postgres (Testcontainers, never a
 * shared database) and a real S3-compatible object store (a local MinIO, never a
 * hosted bucket). What is proven:
 *
 *   1. Denial parity. For each route an unknown id, another person's file and a
 *      caller without permission get the SAME status and the SAME body, byte for
 *      byte, so a refusal never confirms that a file exists. (The staff export
 *      route answers every refusal with one fixed "Download unavailable" page,
 *      identical for all causes; every other route answers an empty 404.)
 *   2. Headers. A success carries `Cache-Control: private, no-store`.
 *   3. Lifetimes. The redirect target is a presigned URL whose `X-Amz-Expires` is
 *      the documented lifetime: 60 s for FILE and IMAGE resources, certificates,
 *      submissions and ticket attachments; the export lifetime (default 60,
 *      clamped to 30..120); 14,400 s for VIDEO (ledger P-08, accepted by the owner
 *      on the launch checklist). The URL is fetched for real, and a URL that has
 *      outlived its lifetime is refused by the storage itself.
 *   4. No permanent report links. An export past `expiresAt` cannot be downloaded,
 *      the sweep marks it Expired, and re-running creates a NEW job.
 *   5. No public object access. An unsigned GET of a stored object is refused
 *      (403), and so is a signed URL for a different key.
 *   6. Revocation. After a learner's access is removed (enrolment cancelled,
 *      certificate revoked), ten concurrent requests all get the denial and none
 *      is handed a URL; a URL issued before the removal stays valid only for its
 *      short lifetime.
 *
 * The route handlers are called directly with a constructed Request and a real
 * session cookie (the harness in `tests/support/authz-matrix.ts`), the same code
 * path the framework runs.
 *
 * SAFETY: the only database is a disposable Testcontainers instance that
 * `startMatrixDatabase()` guards against non-local hosts; the object store
 * endpoint is refused unless it is local. Nothing reads `.env`.
 *
 * PREREQUISITES: Docker must be running, and a local MinIO must answer on
 * TEST_MINIO_ENDPOINT (default http://localhost:9000) with the credentials in
 * `.env.example` (lms-minio / change-me-minio). If either is missing, `beforeAll`
 * fails and every case reports BLOCKED: the expected failure mode, never a silent
 * pass.
 *
 * ENV-VAR-BEFORE-IMPORT HAZARD: `storage-service` builds its S3 clients from
 * `process.env.S3_*` when first evaluated, so those variables are set as plain
 * top-level statements below, before any application module is imported.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ROUTE_REGISTRY } from "./support/authz-registry";
import { seedWorld, type World } from "./support/authz-inputs";
import {
  describeOutcome,
  invokeRoute,
  asPersona,
  seedPersonas,
  startMatrixDatabase,
  stopMatrixDatabase,
  type Persona,
  type PersonaName,
  type Personas,
} from "./support/authz-matrix";
import { seedCohortFixture, seedEnrolmentFixture } from "./support/cohort-fixtures";
import { TEST_DB_TIMEOUT_MS } from "./support/pg";

vi.mock("next/headers", async () => (await import("./support/authz-matrix")).nextHeadersMock());
vi.mock("next/cache", async () => (await import("./support/authz-matrix")).nextCacheMock());
vi.mock("next/navigation", async () => (await import("./support/authz-matrix")).nextNavigationMock());

process.env.S3_BUCKET = "lms-private";
process.env.S3_ENDPOINT = process.env.TEST_MINIO_ENDPOINT ?? "http://localhost:9000";
process.env.S3_PUBLIC_ENDPOINT = process.env.S3_ENDPOINT;
process.env.S3_ACCESS_KEY_ID = "lms-minio";
process.env.S3_SECRET_ACCESS_KEY = "change-me-minio";
process.env.S3_FORCE_PATH_STYLE = "true";
process.env.S3_REGION = "us-east-1";

const ENDPOINT = process.env.S3_ENDPOINT;
const BUCKET = process.env.S3_BUCKET;
const CASE_TIMEOUT_MS = 120_000;

const EVIDENCE_PATH = path.resolve(
  import.meta.dirname,
  "..",
  ".planning",
  "phases",
  "15-launch-readiness-nfr-verification-operational-cutover",
  "evidence",
  "private-files-local.json",
);

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n% plan 15-27 private file fixture\n%%EOF\n");
const FILE_BYTES = new TextEncoder().encode("plan 15-27 lesson file fixture");
const VTT_TEXT = "WEBVTT\n\n00:00.000 --> 00:02.000\nPlan 15-27 caption\n";
const UNKNOWN_ID = "cmunknownidthatdoesnotexist0001";

// ---------------------------------------------------------------------------
// State shared by the cases
// ---------------------------------------------------------------------------

type Fixture = {
  world: World;
  personas: Personas;
  /** Object keys put into the store, so each presigned URL can be fetched for real. */
  certificateStorageKey: string;
  courseId: string;
  enrolmentId: string;
  fileResourceId: string;
  imageResourceId: string;
  videoResourceId: string;
  captionResourceId: string;
  pendingResourceId: string;
  /** The FILE lesson's resource in a course the owner is NOT enrolled in. */
  strangerResourceId: string;
  exportPastId: string;
  exportDoneStorageKey: string;
};

let fx: Fixture;
let s3: S3Client;

type RouteRecord = {
  route: string;
  denialParity: boolean;
  denialBody: "empty" | "fixed-page";
  noStore: boolean;
  ttlSeconds: number | null;
  expiryEnforced: boolean | null;
  note?: string;
  ttlSecondsByKind?: Record<string, number>;
  denialStatus: number | null;
};

const records = new Map<string, RouteRecord>();
const evidenceExtras: { unsignedGetStatus: number | null; wrongKeySignedStatus: number | null; expiredUrlStatus: number | null } = {
  unsignedGetStatus: null,
  wrongKeySignedStatus: null,
  expiredUrlStatus: null,
};

function record(route: string, patch: Partial<RouteRecord>): RouteRecord {
  const current = records.get(route) ?? {
    route,
    denialParity: false,
    denialBody: "empty" as const,
    noStore: false,
    ttlSeconds: null,
    expiryEnforced: null,
    denialStatus: null,
  };
  const next = { ...current, ...patch };
  records.set(route, next);
  return next;
}

// ---------------------------------------------------------------------------
// Calling a route
// ---------------------------------------------------------------------------

type Snap = {
  status: number;
  body: string;
  cacheControl: string | null;
  contentType: string | null;
  location: string | null;
};

type Spec = {
  /** The pattern as the registry lists it. */
  route: string;
  /** The URL for an id (ignored for a route that takes none). */
  path: (id: string) => string;
  param: string | null;
  realId: () => string;
  /** Who gets through. */
  allowed: PersonaName[];
  /** Refused on the real id: no session, someone else, no permission, wrong scope. */
  refusedOnRealId: PersonaName[];
  /** Allowed people asking for an id that does not exist. */
  unknownIdBy: PersonaName[];
  /** "redirect" answers 302 to a presigned URL; "direct" answers 200 with the bytes. */
  success: { kind: "redirect"; ttl: number } | { kind: "direct"; contentType: string };
  /** Denial body: "empty", or the one fixed page the export route uses. */
  denialBody: "empty" | "fixed-page";
  /** Refusals that carry a status of their own (no session on a route that answers 401). */
  anonymousStatus?: number;
};

const registryEntry = (route: string) => {
  const entry = ROUTE_REGISTRY.find((candidate) => candidate.route === route && candidate.method === "GET");
  if (!entry) throw new Error(`The authorization registry has no GET entry for ${route}.`);
  return entry;
};

async function call(spec: Spec, persona: Persona, id: string): Promise<Snap> {
  const entry = registryEntry(spec.route);
  const outcome = await invokeRoute({ file: entry.file, method: "GET" }, persona, {
    url: `http://localhost:3000${spec.path(id)}`,
    params: spec.param ? { [spec.param]: id } : {},
  });
  if (outcome.kind !== "response") {
    throw new Error(`${spec.route} as ${persona.name}: expected an HTTP response, the handler ${describeOutcome(outcome)}`);
  }
  return {
    status: outcome.status,
    body: outcome.body,
    cacheControl: outcome.headers["cache-control"] ?? null,
    contentType: outcome.headers["content-type"] ?? null,
    location: outcome.headers["location"] ?? null,
  };
}

/** What a caller could compare between two refusals. */
const comparable = (snap: Snap) => ({ status: snap.status, body: snap.body, location: snap.location, contentType: snap.contentType });

function expiresOf(location: string): number {
  const url = new URL(location);
  const value = url.searchParams.get("X-Amz-Expires");
  if (value === null) throw new Error(`Redirect target is not a presigned URL: ${url.origin}${url.pathname}`);
  return Number(value);
}

function expectPresigned(location: string | null, ttl: number): URL {
  expect(location, "a successful download redirects to a URL").toBeTruthy();
  const url = new URL(location!);
  expect(url.origin).toBe(new URL(ENDPOINT).origin);
  expect(url.pathname.startsWith(`/${BUCKET}/`)).toBe(true);
  expect(url.searchParams.get("X-Amz-Signature"), "the URL is signed").toBeTruthy();
  expect(expiresOf(location!)).toBe(ttl);
  // The bytes are served as an attachment, so a stored HTML file cannot render in the storage origin.
  expect(url.searchParams.get("response-content-disposition") ?? "").toMatch(/^attachment/);
  return url;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function put(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
}

async function ensureBucket(): Promise<void> {
  const host = new URL(ENDPOINT).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(`Refusing to run against a non-local object store (${host}).`);
  }
  s3 = new S3Client({
    endpoint: ENDPOINT,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 404) {
      throw new Error(`BLOCKED: the local object store at ${ENDPOINT} is not reachable (${(error as Error).message}).`);
    }
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  }
}

async function seedFixture(world: World, personas: Personas): Promise<Fixture> {
  const prisma = world.prisma;
  const storage = await import("@/server/services/storage-service");

  // --- a certificate with a real stored PDF ---
  const certificateStorageKey = storage.buildCertificateStorageKey({ certificateId: world.certificateId });
  await put(certificateStorageKey, PDF_BYTES, "application/pdf");
  await prisma.certificate.update({ where: { id: world.certificateId }, data: { storageKey: certificateStorageKey } });

  // --- a published self-paced course the owner is genuinely enrolled in ---
  const course = await prisma.course.create({
    data: { slug: "private-files-course", title: "Private files course" },
    select: { id: true },
  });
  const courseModule = await prisma.module.create({
    data: { courseId: course.id, title: "Private files module", position: 0 },
    select: { id: true },
  });
  const lesson = (type: "FILE" | "IMAGE" | "VIDEO", position: number) =>
    prisma.lesson.create({
      data: { moduleId: courseModule.id, title: `Private ${type} lesson`, type, position, required: false, allowManualComplete: true },
      select: { id: true },
    });
  const fileLesson = await lesson("FILE", 0);
  const imageLesson = await lesson("IMAGE", 1);
  const videoLesson = await lesson("VIDEO", 2);
  const payload = {
    schema: 1,
    completionRule: { version: 1, requireAllRequiredLessons: true },
    completionRuleVersion: 1,
    modules: [
      {
        id: courseModule.id,
        position: 0,
        lessons: [
          { id: fileLesson.id, position: 0, required: false, type: "FILE", assessmentId: null },
          { id: imageLesson.id, position: 1, required: false, type: "IMAGE", assessmentId: null },
          { id: videoLesson.id, position: 2, required: false, type: "VIDEO", assessmentId: null },
        ],
      },
    ],
  };
  const publication = await prisma.coursePublication.create({
    data: { courseId: course.id, version: 1, payload, payloadSchema: 1, publishedById: personas.staffGlobal.userId! },
    select: { id: true },
  });
  const { cohortId } = await seedCohortFixture(prisma, {
    courseId: course.id,
    deliveryMode: "SELF_PACED",
    accessDurationDays: 30,
    attendanceThresholdPct: 75,
    coursePublicationId: publication.id,
    capacity: 10,
  });
  const { enrolmentId } = await seedEnrolmentFixture(prisma, {
    cohortId,
    userId: personas.learnerOwner.userId!,
    status: "ACTIVE",
    activatedAt: new Date(),
  });

  const resource = async (
    lessonId: string,
    title: string,
    mimeType: string,
    body: Uint8Array,
    extra: Record<string, unknown> = {},
    store = true,
  ) => {
    const key = storage.buildStorageKey({ lessonId });
    if (store) await put(key, body, mimeType);
    const row = await prisma.lessonResource.create({
      data: {
        lessonId, title, storageKey: key, filename: `${title}.bin`, mimeType, sizeBytes: BigInt(body.byteLength),
        uploadStatus: "READY", ...extra,
      } as never,
      select: { id: true },
    });
    return row.id;
  };
  const fileResourceId = await resource(fileLesson.id, "private-file", "application/pdf", FILE_BYTES);
  const imageResourceId = await resource(imageLesson.id, "private-image", "image/png", FILE_BYTES);
  const videoResourceId = await resource(videoLesson.id, "private-video", "video/mp4", FILE_BYTES);
  const captionResourceId = await resource(videoLesson.id, "private-caption", "text/vtt", new TextEncoder().encode(VTT_TEXT), {
    captionForResourceId: videoResourceId, captionLanguage: "en", captionLabel: "English",
  });
  const pendingResourceId = await resource(fileLesson.id, "private-pending", "application/pdf", FILE_BYTES, { uploadStatus: "UPLOADING" }, false);

  // --- objects behind the 15-25 world's records, so each presigned URL can be fetched ---
  const [submission, attachment] = await Promise.all([
    prisma.submission.findUniqueOrThrow({ where: { id: world.submissionDraftId }, select: { storageKey: true } }),
    prisma.ticketAttachment.findUniqueOrThrow({ where: { id: world.ticketAttachmentReadyId }, select: { storageKey: true } }),
  ]);
  await put(submission.storageKey, FILE_BYTES, "application/pdf");
  await put(attachment.storageKey, FILE_BYTES, "image/png");
  const exportDone = await prisma.exportJob.findUniqueOrThrow({ where: { id: world.exportDoneId }, select: { storageKey: true } });
  await put(exportDone.storageKey!, new TextEncoder().encode("id\nplan-15-27\n"), "text/csv");

  // --- a resource in a course the owner is not enrolled in (a stranger's file) ---
  const otherCourse = await prisma.course.create({
    data: { slug: "private-files-other-course", title: "Private files other course" },
    select: { id: true },
  });
  const otherModule = await prisma.module.create({
    data: { courseId: otherCourse.id, title: "Other module", position: 0 },
    select: { id: true },
  });
  const otherLesson = await prisma.lesson.create({
    data: { moduleId: otherModule.id, title: "Other FILE lesson", type: "FILE", position: 0 },
    select: { id: true },
  });
  const strangerResourceId = await resource(otherLesson.id, "stranger-file", "application/pdf", FILE_BYTES);

  // --- an export whose lifetime has already ended ---
  const exportPast = await prisma.exportJob.create({
    data: {
      requestedById: personas.staffGlobal.userId!, dataset: "registrations", status: "SUCCEEDED", rowCount: 0,
      scopeSnapshot: { kind: "GLOBAL", programmeIds: [], courseIds: [], cohortIds: [] },
      columnSnapshot: [{ key: "id", label: "Registration", valueType: "TEXT" }],
      storageKey: "exports/pastexportjob0001/1.0.csv",
      completedAt: new Date(Date.now() - 3_600_000),
      expiresAt: new Date(Date.now() - 1_000),
    },
    select: { id: true },
  });
  await put("exports/pastexportjob0001/1.0.csv", new TextEncoder().encode("id\n"), "text/csv");

  return {
    world, personas, certificateStorageKey, courseId: course.id, enrolmentId,
    fileResourceId, imageResourceId, videoResourceId, captionResourceId, pendingResourceId,
    strangerResourceId, exportPastId: exportPast.id, exportDoneStorageKey: exportDone.storageKey!,
  };
}

beforeAll(async () => {
  await ensureBucket();
  const database = await startMatrixDatabase();
  const world = await seedWorld(database.prisma);
  const personas = await seedPersonas(database.prisma, { cohortAId: world.cohortAId, cohortBId: world.cohortBId });
  await world.attachOwner(personas);
  fx = await seedFixture(world, personas);
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  try {
    if (records.size === 0) return;
    const routes = [...records.values()]
      .sort((a, b) => (a.route < b.route ? -1 : a.route > b.route ? 1 : 0))
      .map((entry) => ({
        route: entry.route,
        denialParity: entry.denialParity,
        denialStatus: entry.denialStatus,
        denialBody: entry.denialBody,
        noStore: entry.noStore,
        ttlSeconds: entry.ttlSeconds,
        expiryEnforced: entry.expiryEnforced,
        ...(entry.ttlSecondsByKind ? { ttlSecondsByKind: entry.ttlSecondsByKind } : {}),
        ...(entry.note ? { note: entry.note } : {}),
      }));
    const keyBuilders = await describeKeyBuilders();
    const summary = {
      plan: "15-27",
      note: "Local Testcontainers Postgres and a local MinIO. No timestamps or ids: the file is identical from run to run.",
      routes,
      unsignedGetStatus: evidenceExtras.unsignedGetStatus,
      wrongKeySignedStatus: evidenceExtras.wrongKeySignedStatus,
      expiredSignedUrlStatus: evidenceExtras.expiredUrlStatus,
      keyBuilders,
    };
    mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
    writeFileSync(EVIDENCE_PATH, `${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await stopMatrixDatabase();
  }
}, TEST_DB_TIMEOUT_MS);

async function describeKeyBuilders() {
  const storage = await import("@/server/services/storage-service");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const shape = (name: string, sample: string, random: "uuid-v4" | "job-id") => ({
    builder: name,
    shape: sample.replace(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/, "<uuid-v4>").replace("tkt-1", "<id>").replace("lesson-1", "<id>").replace("enr-1/asm-1", "<id>/<id>").replace("cert-1", "<id>").replace("tpl-1", "<id>"),
    randomSegment: random,
    endsInUuidV4: uuid.test(sample.split("/").at(-1) ?? ""),
  });
  return [
    shape("buildStorageKey", storage.buildStorageKey({ lessonId: "lesson-1" }), "uuid-v4"),
    shape("buildStagedStorageKey", storage.buildStagedStorageKey({ lessonId: "lesson-1" }), "uuid-v4"),
    shape("buildSubmissionStorageKey", storage.buildSubmissionStorageKey({ enrolmentId: "enr-1", assessmentId: "asm-1" }), "uuid-v4"),
    shape("buildStagedSubmissionStorageKey", storage.buildStagedSubmissionStorageKey({ enrolmentId: "enr-1", assessmentId: "asm-1" }), "uuid-v4"),
    shape("buildStagedTicketAttachmentKey", storage.buildStagedTicketAttachmentKey({ ticketId: "tkt-1" }), "uuid-v4"),
    shape("buildCertificateStorageKey", storage.buildCertificateStorageKey({ certificateId: "cert-1" }), "uuid-v4"),
    shape("buildTemplateAssetStorageKey", storage.buildTemplateAssetStorageKey({ templateId: "tpl-1" }), "uuid-v4"),
    shape("buildStagedTemplateAssetStorageKey", storage.buildStagedTemplateAssetStorageKey({ templateId: "tpl-1" }), "uuid-v4"),
    {
      builder: "buildExportStorageKey",
      shape: "exports/<export job id>/<dataset version>.csv",
      randomSegment: "job-id",
      endsInUuidV4: false,
    },
  ];
}

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

const P = (name: PersonaName) => fx.personas[name];

const SPECS: Spec[] = [
  {
    route: "/api/certificates/[id]/download",
    path: (id) => `/api/certificates/${id}/download`,
    param: "id",
    realId: () => fx.world.certificateId,
    allowed: ["learnerOwner", "staffGlobal"],
    refusedOnRealId: ["anonymous", "learnerOther", "staffNone", "staffCohortB"],
    unknownIdBy: ["learnerOwner", "staffGlobal", "learnerOther"],
    success: { kind: "redirect", ttl: 60 },
    denialBody: "empty",
  },
  {
    route: "/api/lesson-resources/[id]/download",
    path: (id) => `/api/lesson-resources/${id}/download`,
    param: "id",
    realId: () => fx.fileResourceId,
    allowed: ["learnerOwner", "staffGlobal"],
    refusedOnRealId: ["anonymous", "learnerOther", "staffNone", "staffCohortB"],
    unknownIdBy: ["learnerOwner", "staffGlobal", "learnerOther"],
    success: { kind: "redirect", ttl: 60 },
    denialBody: "empty",
  },
  {
    route: "/api/lesson-resources/[id]/captions",
    path: (id) => `/api/lesson-resources/${id}/captions`,
    param: "id",
    realId: () => fx.captionResourceId,
    allowed: ["learnerOwner", "staffGlobal"],
    refusedOnRealId: ["anonymous", "learnerOther", "staffNone", "staffCohortB"],
    unknownIdBy: ["learnerOwner", "staffGlobal", "learnerOther"],
    success: { kind: "direct", contentType: "text/vtt; charset=utf-8" },
    denialBody: "empty",
  },
  {
    route: "/api/submissions/[submissionId]/download",
    path: (id) => `/api/submissions/${id}/download`,
    param: "submissionId",
    realId: () => fx.world.submissionDraftId,
    allowed: ["staffGlobal"],
    // The learner who made the submission is refused too: this route is the grader's.
    refusedOnRealId: ["anonymous", "learnerOwner", "learnerOther", "staffNone", "staffCohortB"],
    unknownIdBy: ["staffGlobal", "learnerOther"],
    success: { kind: "redirect", ttl: 60 },
    denialBody: "empty",
  },
  {
    route: "/api/ticket-attachments/[attachmentId]/download",
    path: (id) => `/api/ticket-attachments/${id}/download`,
    param: "attachmentId",
    realId: () => fx.world.ticketAttachmentReadyId,
    allowed: ["learnerOwner", "staffGlobal"],
    refusedOnRealId: ["anonymous", "learnerOther", "staffNone"],
    unknownIdBy: ["learnerOwner", "staffGlobal", "learnerOther"],
    success: { kind: "redirect", ttl: 60 },
    denialBody: "empty",
  },
  {
    route: "/api/staff/reports/exports/[jobId]/download",
    path: (id) => `/api/staff/reports/exports/${id}/download`,
    param: "jobId",
    realId: () => fx.world.exportDoneId,
    allowed: ["staffGlobal"],
    // Another staff member (even one who can view everything) is not the requester.
    refusedOnRealId: ["anonymous", "learnerOther", "staffNone", "staffViewOnly", "staffCohortB"],
    unknownIdBy: ["staffGlobal", "learnerOther"],
    success: { kind: "redirect", ttl: 60 },
    denialBody: "fixed-page",
  },
  {
    route: "/api/staff/licence/diagnostic",
    path: () => "/api/staff/licence/diagnostic",
    param: null,
    realId: () => "",
    allowed: ["staffGlobal"],
    refusedOnRealId: ["learnerOther", "staffNone"],
    unknownIdBy: [],
    success: { kind: "direct", contentType: "application/json" },
    denialBody: "empty",
    anonymousStatus: 401,
  },
  {
    route: "/staff/cohorts/[id]/exceptions/csv",
    path: (id) => `/staff/cohorts/${id}/exceptions/csv`,
    param: "id",
    realId: () => fx.world.cohortAId,
    allowed: ["staffGlobal", "staffCohortA"],
    refusedOnRealId: ["anonymous", "learnerOther", "learnerOwner", "staffNone", "staffCohortB"],
    // A staff member scoped to one cohort asking for a cohort that does not exist.
    unknownIdBy: ["staffCohortA", "learnerOther"],
    success: { kind: "direct", contentType: "text/csv; charset=utf-8" },
    denialBody: "empty",
  },
];

describe("the registry lists every private download route this file covers", () => {
  it("every spec names a GET entry in ROUTE_REGISTRY, and no download-shaped GET route is missing", () => {
    for (const spec of SPECS) expect(registryEntry(spec.route).method).toBe("GET");

    const covered = new Set(SPECS.map((spec) => spec.route));
    const downloadShaped = ROUTE_REGISTRY.filter(
      (entry) =>
        entry.method === "GET" &&
        (/\/download$/.test(entry.route) || /\/captions$/.test(entry.route) || /\/csv$/.test(entry.route) || /licence\/diagnostic$/.test(entry.route)),
    ).map((entry) => entry.route);
    expect(downloadShaped.length).toBeGreaterThanOrEqual(8);
    expect(downloadShaped.filter((route) => !covered.has(route))).toEqual([]);
  });

  it("every one of them is registered with the empty-404 refusal (the licence diagnostic also answers 401 to a visitor)", () => {
    for (const spec of SPECS) {
      const statuses = [...registryEntry(spec.route).deniedStatuses].sort();
      expect(statuses, spec.route).toEqual(spec.anonymousStatus ? [401, 404] : [404]);
    }
  });
});

describe.each(SPECS.map((spec) => [spec.route, spec] as const))("%s", (route, spec) => {
  it(
    "answers every refusal (no session, someone else's file, no permission, wrong scope, unknown id) with the same status and body",
    async () => {
      const refusals: Array<{ label: string; snap: Snap }> = [];
      for (const name of spec.refusedOnRealId) {
        refusals.push({ label: `${name} on the real id`, snap: await call(spec, P(name), spec.realId()) });
      }
      for (const name of spec.unknownIdBy) {
        refusals.push({ label: `${name} on an unknown id`, snap: await call(spec, P(name), UNKNOWN_ID) });
      }
      expect(refusals.length).toBeGreaterThan(0);

      const [first, ...rest] = refusals;
      for (const refusal of rest) {
        expect(comparable(refusal.snap), `${refusal.label} must look exactly like ${first!.label}`).toEqual(comparable(first!.snap));
      }
      expect(first!.snap.status).toBe(404);
      expect(first!.snap.location).toBeNull();
      if (spec.denialBody === "empty") {
        for (const refusal of refusals) expect(refusal.snap.body, refusal.label).toBe("");
      } else {
        // One fixed page: it names no job, file or person.
        for (const refusal of refusals) {
          expect(refusal.snap.body, refusal.label).toBe(first!.snap.body);
          expect(refusal.snap.body).not.toContain(spec.realId());
          expect(refusal.snap.body).not.toContain(UNKNOWN_ID);
        }
      }

      if (spec.anonymousStatus) {
        const anonymous = await call(spec, P("anonymous"), spec.realId());
        expect(anonymous.status).toBe(spec.anonymousStatus);
        expect(anonymous.location).toBeNull();
      }

      record(route, { denialParity: true, denialStatus: first!.snap.status, denialBody: spec.denialBody });
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "a permitted caller succeeds with Cache-Control private, no-store and the documented delivery",
    async () => {
      for (const name of spec.allowed) {
        const snap = await call(spec, P(name), spec.realId());
        const expectedStatus = spec.success.kind === "redirect" ? 302 : 200;
        expect(snap.status, `${name} must get through`).toBe(expectedStatus);
        expect(snap.cacheControl, `${name}: Cache-Control`).toBe("private, no-store");

        if (spec.success.kind === "redirect") {
          expectPresigned(snap.location, spec.success.ttl);
          expect(snap.body).toBe("");
        } else {
          expect(snap.contentType).toBe(spec.success.contentType);
          expect(snap.location).toBeNull();
        }
      }
      record(route, {
        noStore: true,
        ttlSeconds: spec.success.kind === "redirect" ? spec.success.ttl : null,
      });
    },
    CASE_TIMEOUT_MS,
  );

  if (spec.success.kind === "redirect") {
    it(
      "the presigned URL it hands out is fetched for real and returns the stored object",
      async () => {
        const snap = await call(spec, P(spec.allowed[0]!), spec.realId());
        expect(snap.status).toBe(302);
        const response = await fetch(snap.location!);
        expect(response.status).toBe(200);
        const bytes = new Uint8Array(await response.arrayBuffer());
        expect(bytes.byteLength).toBeGreaterThan(0);
        if (route.startsWith("/api/certificates")) {
          expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("%PDF");
          expect(Array.from(bytes)).toEqual(Array.from(PDF_BYTES));
        }
        expect(response.headers.get("content-disposition") ?? "").toMatch(/^attachment/);
      },
      CASE_TIMEOUT_MS,
    );
  }
});

describe("lifetimes of the lesson resource URLs by kind (ledger P-08)", () => {
  it("is 60 s for FILE and IMAGE and 14,400 s for VIDEO, for a learner and for staff alike", async () => {
    const spec = SPECS.find((candidate) => candidate.route === "/api/lesson-resources/[id]/download")!;
    const expectations: Array<[string, string, number]> = [
      ["FILE", fx.fileResourceId, 60],
      ["IMAGE", fx.imageResourceId, 60],
      ["VIDEO", fx.videoResourceId, 14_400],
    ];
    for (const persona of ["learnerOwner", "staffGlobal"] as const) {
      for (const [kind, id, ttl] of expectations) {
        const snap = await call(spec, P(persona), id);
        expect(snap.status, `${persona} ${kind}`).toBe(302);
        expect(snap.cacheControl).toBe("private, no-store");
        expectPresigned(snap.location, ttl);
      }
    }
    record("/api/lesson-resources/[id]/download", { ttlSecondsByKind: { FILE: 60, IMAGE: 60, VIDEO: 14_400 } });
    // Nothing but a video lives longer than a minute.
    const { DOWNLOAD_TTL_SECONDS, downloadTtlFor } = await import("@/lib/upload-limits");
    expect(DOWNLOAD_TTL_SECONDS).toEqual({ FILE: 60, IMAGE: 60, VIDEO: 14_400 });
    expect(downloadTtlFor("ASSIGNMENT")).toBe(60);
    expect(downloadTtlFor("something-new")).toBe(60);
  }, CASE_TIMEOUT_MS);

  it("an upload that is not finished is refused to everyone but the permitted, and looks like any other refusal to the rest", async () => {
    const spec = SPECS.find((candidate) => candidate.route === "/api/lesson-resources/[id]/download")!;
    const unknown = await call(spec, P("learnerOther"), UNKNOWN_ID);
    for (const name of ["anonymous", "learnerOther", "staffNone"] as const) {
      expect(comparable(await call(spec, P(name), fx.pendingResourceId)), name).toEqual(comparable(unknown));
    }
    // A permitted caller learns only that it is not ready, and is never handed a URL.
    const permitted = await call(spec, P("staffGlobal"), fx.pendingResourceId);
    expect(permitted.status).toBe(409);
    expect(permitted.location).toBeNull();
  }, CASE_TIMEOUT_MS);

  it("a resource in a course the learner is not enrolled in is refused exactly like an unknown id", async () => {
    const spec = SPECS.find((candidate) => candidate.route === "/api/lesson-resources/[id]/download")!;
    const stranger = await call(spec, P("learnerOwner"), fx.strangerResourceId);
    const unknown = await call(spec, P("learnerOwner"), UNKNOWN_ID);
    expect(comparable(stranger)).toEqual(comparable(unknown));
    expect(stranger.status).toBe(404);
  }, CASE_TIMEOUT_MS);
});

describe("the export download lifetime and expiry (no permanent report links)", () => {
  const spec = () => SPECS.find((candidate) => candidate.route === "/api/staff/reports/exports/[jobId]/download")!;

  async function withTtl<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
    const previous = process.env.EXPORT_DOWNLOAD_TTL_SECONDS;
    if (value === undefined) delete process.env.EXPORT_DOWNLOAD_TTL_SECONDS;
    else process.env.EXPORT_DOWNLOAD_TTL_SECONDS = value;
    try {
      return await run();
    } finally {
      if (previous === undefined) delete process.env.EXPORT_DOWNLOAD_TTL_SECONDS;
      else process.env.EXPORT_DOWNLOAD_TTL_SECONDS = previous;
    }
  }

  it("uses the configured lifetime, clamped to 30..120 s, and 60 s when it is unset or not a whole number", async () => {
    const cases: Array<[string | undefined, number]> = [
      [undefined, 60],
      ["90", 90],
      ["30", 30],
      ["120", 120],
      ["5", 30],
      ["0", 30],
      ["-20", 30],
      ["500", 120],
      ["45.5", 60],
      ["not-a-number", 60],
    ];
    for (const [configured, expected] of cases) {
      const snap = await withTtl(configured, () => call(spec(), P("staffGlobal"), fx.world.exportDoneId));
      expect(snap.status, `configured ${configured}`).toBe(302);
      expect(expiresOf(snap.location!), `configured ${configured}`).toBe(expected);
    }
  }, CASE_TIMEOUT_MS);

  it("an export past its expiry cannot be downloaded, whoever asks, and the refusal looks like any other", async () => {
    const refusal = await call(spec(), P("learnerOther"), UNKNOWN_ID);
    const past = await call(spec(), P("staffGlobal"), fx.exportPastId);
    expect(comparable(past)).toEqual(comparable(refusal));
    expect(past.status).toBe(404);
    expect(past.location).toBeNull();
  }, CASE_TIMEOUT_MS);

  it("failed and expired jobs are refused the same way", async () => {
    const refusal = await call(spec(), P("learnerOther"), UNKNOWN_ID);
    for (const id of [fx.world.exportFailedId, fx.world.exportExpiredId]) {
      expect(comparable(await call(spec(), P("staffGlobal"), id))).toEqual(comparable(refusal));
    }
  }, CASE_TIMEOUT_MS);

  it("the sweep marks it Expired and removes its object; the history shows Expired, with no download; re-running creates a NEW job", async () => {
    const prisma = fx.world.prisma;
    const { exportWorkerService } = await import("@/server/services/export-worker-service");
    const { exportReadService } = await import("@/server/services/export-read-service");
    const { exportService } = await import("@/server/services/export-service");

    // Before the sweep the file still sits in storage, but the history already offers no download.
    asPersona(P("staffGlobal"));
    const before = (await exportReadService.list()).find((row) => row.id === fx.exportPastId);
    expect(before?.status).toBe("SUCCEEDED");
    expect(before?.canDownload).toBe(false);

    const swept = await exportWorkerService.expireBatch(50);
    expect(swept).toBeGreaterThanOrEqual(1);

    const job = await prisma.exportJob.findUniqueOrThrow({ where: { id: fx.exportPastId } });
    expect(job.status).toBe("EXPIRED");
    expect(job.storageKey).toBeNull();
    await expect(s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: "exports/pastexportjob0001/1.0.csv" }))).rejects.toThrow();

    asPersona(P("staffGlobal"));
    const after = (await exportReadService.list()).find((row) => row.id === fx.exportPastId);
    expect(after?.status).toBe("EXPIRED");
    expect(after?.canDownload).toBe(false);
    // The history page labels this state "Expired" and offers a re-run, not a link.
    const history = readFileSync(path.resolve(import.meta.dirname, "..", "src", "app", "staff", "reports", "exports", "ExportHistory.tsx"), "utf8");
    expect(history).toContain('EXPIRED: "Expired"');
    expect(history).toContain("Rerun export");

    // The download route still refuses it.
    const refusal = await call(spec(), P("learnerOther"), UNKNOWN_ID);
    expect(comparable(await call(spec(), P("staffGlobal"), fx.exportPastId))).toEqual(comparable(refusal));

    // Re-running starts a different job; the expired one is untouched.
    asPersona(P("staffGlobal"));
    const rerun = await exportService.rerunExpiredExport(fx.exportPastId);
    expect(rerun.jobId).not.toBe(fx.exportPastId);
    const created = await prisma.exportJob.findUniqueOrThrow({ where: { id: rerun.jobId } });
    expect(created.status).toBe("QUEUED");
    expect(created.storageKey).toBeNull();
    expect((await prisma.exportJob.findUniqueOrThrow({ where: { id: fx.exportPastId } })).status).toBe("EXPIRED");

    record("/api/staff/reports/exports/[jobId]/download", {
      expiryEnforced: true,
      note: "Past expiresAt: refused. The sweep marks the job Expired and deletes the object. Re-running creates a new job. Refusals are one fixed page for every cause, not an empty body.",
    });
  }, CASE_TIMEOUT_MS);
});

describe("the object store refuses anything unsigned (NFR-06)", () => {
  it("an unsigned GET of a stored certificate is refused", async () => {
    const response = await fetch(`${ENDPOINT}/${BUCKET}/${fx.certificateStorageKey}`);
    expect(response.status).toBe(403);
    evidenceExtras.unsignedGetStatus = response.status;
    await response.arrayBuffer();
  }, CASE_TIMEOUT_MS);

  it("an unsigned GET of every other kind of stored object is refused, and the bucket cannot be listed anonymously", async () => {
    const keys = [fx.exportDoneStorageKey, "lessons/none/none", "submissions/none/none/none"];
    const rows = await fx.world.prisma.lessonResource.findMany({ where: { id: { in: [fx.fileResourceId, fx.captionResourceId] } }, select: { storageKey: true } });
    keys.push(...rows.map((row) => row.storageKey));
    for (const key of keys) {
      const response = await fetch(`${ENDPOINT}/${BUCKET}/${key}`);
      expect(response.status, key).toBe(403);
      await response.arrayBuffer();
    }
    const listing = await fetch(`${ENDPOINT}/${BUCKET}/`);
    expect(listing.status).toBe(403);
    await listing.arrayBuffer();
  }, CASE_TIMEOUT_MS);

  it("a signature for one key does not open another key", async () => {
    const spec = SPECS.find((candidate) => candidate.route === "/api/certificates/[id]/download")!;
    const snap = await call(spec, P("learnerOwner"), fx.world.certificateId);
    const url = new URL(snap.location!);
    url.pathname = `/${BUCKET}/${fx.exportDoneStorageKey}`;
    const response = await fetch(url);
    expect(response.status).toBe(403);
    evidenceExtras.wrongKeySignedStatus = response.status;
    await response.arrayBuffer();
  }, CASE_TIMEOUT_MS);

  it("a presigned URL stops working once its lifetime has passed (the storage enforces it)", async () => {
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: fx.certificateStorageKey }), { expiresIn: 1 });
    const early = await fetch(url);
    expect(early.status).toBe(200);
    await early.arrayBuffer();
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    const late = await fetch(url);
    expect(late.status).toBe(403);
    evidenceExtras.expiredUrlStatus = late.status;
    await late.arrayBuffer();

    for (const entry of records.values()) {
      if (entry.ttlSeconds !== null && entry.expiryEnforced === null) {
        record(entry.route, { expiryEnforced: true, note: `The URL expires after ${entry.ttlSeconds} s; the store refuses it afterwards (proven with a 1 s URL).` });
      }
      if (entry.ttlSeconds === null && entry.note === undefined) {
        record(entry.route, { note: "Delivered by the app itself, so no storage URL exists to expire; the response is private, no-store." });
      }
    }
  }, CASE_TIMEOUT_MS);

  it("the bucket is not public: the storage layer answers a bucket policy read with no public policy", async () => {
    const response = await fetch(`${ENDPOINT}/${BUCKET}/?policy`);
    expect([403, 404]).toContain(response.status);
    await response.arrayBuffer();
  }, CASE_TIMEOUT_MS);
});

describe("after access is removed, no new URL is issued (edge probe, T-15-27-04)", () => {
  const BURST = 10;

  it("a cancelled enrolment: ten concurrent download and caption requests are all refused and none carries a URL", async () => {
    const download = SPECS.find((candidate) => candidate.route === "/api/lesson-resources/[id]/download")!;
    const captions = SPECS.find((candidate) => candidate.route === "/api/lesson-resources/[id]/captions")!;

    // While the enrolment is active the learner gets a URL.
    const before = await call(download, P("learnerOwner"), fx.fileResourceId);
    expect(before.status).toBe(302);
    expectPresigned(before.location, 60);
    expect((await call(captions, P("learnerOwner"), fx.captionResourceId)).status).toBe(200);

    await fx.world.prisma.enrolment.update({ where: { id: fx.enrolmentId }, data: { status: "CANCELLED" } });

    const unknown = await call(download, P("learnerOther"), UNKNOWN_ID);
    const downloads = await Promise.all(Array.from({ length: BURST }, () => call(download, P("learnerOwner"), fx.fileResourceId)));
    const videos = await Promise.all(Array.from({ length: BURST }, () => call(download, P("learnerOwner"), fx.videoResourceId)));
    const tracks = await Promise.all(Array.from({ length: BURST }, () => call(captions, P("learnerOwner"), fx.captionResourceId)));
    for (const snap of [...downloads, ...videos, ...tracks]) {
      expect(comparable(snap)).toEqual(comparable(unknown));
      expect(snap.location).toBeNull();
      expect(snap.body).toBe("");
    }

    // The URL issued before the removal is a bearer link: it works only for its short lifetime,
    // which is why that lifetime is 60 s (and the owner accepted 4 h for video, ledger P-08).
    expect(expiresOf(before.location!)).toBe(60);
    const stillValid = await fetch(before.location!);
    expect(stillValid.status).toBe(200);
    await stillValid.arrayBuffer();
  }, CASE_TIMEOUT_MS);

  it("a revoked certificate: ten concurrent download requests are all refused and none carries a URL", async () => {
    const spec = SPECS.find((candidate) => candidate.route === "/api/certificates/[id]/download")!;

    const before = await call(spec, P("learnerOwner"), fx.world.certificateId);
    expect(before.status).toBe(302);
    expectPresigned(before.location, 60);

    await fx.world.prisma.certificate.update({
      where: { id: fx.world.certificateId },
      data: { status: "REVOKED", revokedAt: new Date(), revocationReason: "plan 15-27 revocation probe" },
    });

    const unknown = await call(spec, P("learnerOther"), UNKNOWN_ID);
    const burst = await Promise.all(Array.from({ length: BURST }, () => call(spec, P("learnerOwner"), fx.world.certificateId)));
    for (const snap of burst) {
      expect(comparable(snap)).toEqual(comparable(unknown));
      expect(snap.location).toBeNull();
    }

    const stillValid = await fetch(before.location!);
    expect(stillValid.status).toBe(200);
    await stillValid.arrayBuffer();
  }, CASE_TIMEOUT_MS);
});
