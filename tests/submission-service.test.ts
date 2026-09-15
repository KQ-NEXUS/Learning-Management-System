import { describe, expect, it, vi } from "vitest";
import {
  createSubmissionService,
  SubmissionConstraintError,
  SubmissionNotAllowedError,
  SubmissionUploadValidationError,
  type SubmissionAssessmentContext,
  type SubmissionDelegate,
  type SubmissionRecord,
  type SubmissionStore,
  type SubmissionTxClient,
} from "@/server/services/submission-service";

const NOW = new Date("2026-09-10T12:00:00Z");
const learner = { userId: "learner-1" };
const otherLearner = { userId: "learner-2" };

// ---------------------------------------------------------------------------
// Fakes — no MinIO, no Postgres. Mirrors tests/lesson-resource-service.test.ts's harness shape.
// ---------------------------------------------------------------------------

function makeDelegate(initial: Partial<SubmissionRecord>[] = [], onUpdate?: () => void) {
  const rows: SubmissionRecord[] = initial.map((r, i) => ({
    id: r.id ?? `sub${i + 1}`,
    assessmentId: r.assessmentId ?? "a1",
    enrolmentId: r.enrolmentId ?? "enr1",
    attemptNumber: r.attemptNumber ?? 1,
    versionUsed: r.versionUsed ?? 1,
    receiptId: r.receiptId ?? `receipt${i + 1}`,
    submittedAt: r.submittedAt ?? NOW,
    isLate: r.isLate ?? false,
    storageKey: r.storageKey ?? `submission-uploads/enr1/a1/opaque${i + 1}`,
    filename: r.filename ?? "essay.pdf",
    mimeType: r.mimeType ?? "application/pdf",
    sizeBytes: r.sizeBytes ?? 1000,
    uploadStatus: r.uploadStatus ?? "UPLOADING",
  }));
  let next = rows.length + 1;

  const findMany = vi.fn(async ({ where }: { where: { assessmentId: string; enrolmentId: string } }) =>
    rows.filter((r) => r.assessmentId === where.assessmentId && r.enrolmentId === where.enrolmentId),
  );
  const findUnique = vi.fn(async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null);
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const row = {
      id: `sub${next++}`,
      receiptId: `receipt-new-${next}`,
      submittedAt: NOW,
      ...(data as Partial<SubmissionRecord>),
    } as SubmissionRecord;
    rows.push(row);
    return row;
  });
  const update = vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    onUpdate?.();
    const row = rows.find((r) => r.id === where.id);
    if (!row) throw new Error("not found");
    Object.assign(row, data);
    return row;
  });

  const delegate: SubmissionDelegate = { findMany, findUnique, create, update };
  return { delegate, rows };
}

function makeAssessment(overrides: Partial<SubmissionAssessmentContext> = {}): SubmissionAssessmentContext {
  return {
    id: "a1",
    courseId: "c1",
    type: "ASSIGNMENT",
    status: "PUBLISHED",
    version: 1,
    title: "Assignment 1",
    instructions: null,
    dueAt: null,
    availableUntil: null,
    allowedFileTypes: ["pdf"],
    maxFileSizeBytes: 5_000_000,
    allowResubmission: false,
    ...overrides,
  };
}

type FakeEnrolment = { id: string; userId: string; cohortId: string; status: string };
type FakeCohort = { id: string; courseId: string | null };
type FakeCohortCourse = { cohortId: string; courseId: string };

function makeStore(opts: {
  enrolments?: FakeEnrolment[];
  cohorts?: FakeCohort[];
  cohortCourses?: FakeCohortCourse[];
}): SubmissionStore {
  const enrolments = opts.enrolments ?? [{ id: "enr1", userId: "learner-1", cohortId: "cohort1", status: "ACTIVE" }];
  const cohorts = opts.cohorts ?? [{ id: "cohort1", courseId: "c1" }];
  const cohortCourses = opts.cohortCourses ?? [];

  return {
    enrolment: {
      findUnique: async ({ where }) => enrolments.find((e) => e.id === where.id) ?? null,
      findMany: async ({ where }) =>
        enrolments.filter((e) => e.userId === where.userId && e.status === where.status),
    },
    cohort: {
      findUnique: async ({ where }) => cohorts.find((c) => c.id === where.id) ?? null,
    },
    cohortCourse: {
      findFirst: async ({ where }) =>
        cohortCourses.find((cc) => cc.cohortId === where.cohortId && cc.courseId === where.courseId) ?? null,
    },
  };
}

function buildService(
  opts: {
    submissions?: Partial<SubmissionRecord>[];
    assessment?: Partial<SubmissionAssessmentContext> | null;
    enrolments?: FakeEnrolment[];
    cohorts?: FakeCohort[];
    cohortCourses?: FakeCohortCourse[];
  } = {},
) {
  const track: string[] = [];
  const { delegate, rows } = makeDelegate(opts.submissions ?? [], () => track.push("update"));

  const assessment = opts.assessment === null ? null : makeAssessment(opts.assessment ?? {});

  const store = makeStore({
    enrolments: opts.enrolments,
    cohorts: opts.cohorts,
    cohortCourses: opts.cohortCourses,
  });

  const events: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];

  const storage = {
    presign: vi.fn(async ({ key }: { key: string }) => `https://signed.example/${key}`),
    inspect: vi.fn(async () => {
      track.push("inspect");
      return { sizeBytes: 1000, contentType: "application/pdf" as string | null };
    }),
    promote: vi.fn(async () => {
      track.push("promote");
    }),
    remove: vi.fn(async () => {}),
    stagedKey: vi.fn(
      ({ enrolmentId, assessmentId }: { enrolmentId: string; assessmentId: string }) =>
        `submission-uploads/${enrolmentId}/${assessmentId}/opaque`,
    ),
    finalKey: (stagedKey: string) => stagedKey.replace(/^submission-uploads\//, "submissions/"),
  };

  const presignDownload = vi.fn(async ({ key }: { key: string }) => `https://download.example/${key}`);

  const service = createSubmissionService({
    delegate,
    resolveAssessment: async (assessmentId) => (assessmentId === "a1" ? assessment : null),
    store,
    storage,
    presignDownload,
    audit: async (entry) => {
      audits.push(entry as Record<string, unknown>);
    },
    writeEvent: async (_tx, event) => {
      events.push(event as unknown as Record<string, unknown>);
    },
    runInTransaction: async (fn) => fn({ submission: { update: delegate.update } } as unknown as SubmissionTxClient),
    now: () => NOW,
  });

  return { service, rows, storage, audits, events, presignDownload, delegate, track };
}

const uploadInput = { assessmentId: "a1", filename: "essay.pdf", mimeType: "application/pdf", sizeBytes: 1000 };

// ---------------------------------------------------------------------------

describe("beginSubmissionUpload — ASM-03 authored constraints", () => {
  it("throws file-type-not-permitted for an extension absent from allowedFileTypes, and never presigns", async () => {
    const { service, storage } = buildService({ assessment: { allowedFileTypes: ["pdf"] } });
    const error = await service
      .beginSubmissionUpload(learner, { ...uploadInput, filename: "essay.docx", mimeType: "application/msword" })
      .catch((e) => e);
    expect(error).toBeInstanceOf(SubmissionConstraintError);
    expect(error.reason).toBe("file-type-not-permitted");
    expect(storage.presign).not.toHaveBeenCalled();
  });

  it("throws file-too-large when sizeBytes exceeds maxFileSizeBytes, and never presigns", async () => {
    const { service, storage } = buildService({ assessment: { maxFileSizeBytes: 1000 } });
    const error = await service
      .beginSubmissionUpload(learner, { ...uploadInput, sizeBytes: 2000 })
      .catch((e) => e);
    expect(error).toBeInstanceOf(SubmissionConstraintError);
    expect(error.reason).toBe("file-too-large");
    expect(storage.presign).not.toHaveBeenCalled();
  });

  it.each([["pdf"], [".pdf"]])(
    "matches a case-insensitive extension against an allowedFileTypes entry of %s",
    async (entry) => {
      const { service } = buildService({ assessment: { allowedFileTypes: [entry] } });
      await expect(
        service.beginSubmissionUpload(learner, { ...uploadInput, filename: "ESSAY.PDF" }),
      ).resolves.toMatchObject({ attemptNumber: 1 });
    },
  );
});

describe("beginSubmissionUpload — D-03 lateness and the hard cutoff", () => {
  it("succeeds with isLate: true past dueAt but before availableUntil", async () => {
    const { service } = buildService({
      assessment: {
        dueAt: new Date("2026-09-09T00:00:00Z"),
        availableUntil: new Date("2026-09-20T00:00:00Z"),
      },
    });
    await expect(service.beginSubmissionUpload(learner, uploadInput)).resolves.toMatchObject({ isLate: true });
  });

  it("throws window-closed past availableUntil", async () => {
    const { service } = buildService({ assessment: { availableUntil: new Date("2026-09-01T00:00:00Z") } });
    const error = await service.beginSubmissionUpload(learner, uploadInput).catch((e) => e);
    expect(error).toBeInstanceOf(SubmissionNotAllowedError);
    expect(error.reason).toBe("window-closed");
  });
});

describe("beginSubmissionUpload — ownership and reachability", () => {
  it("throws not-an-assignment for a QUIZ-type assessment", async () => {
    const { service } = buildService({ assessment: { type: "QUIZ" } });
    const error = await service.beginSubmissionUpload(learner, uploadInput).catch((e) => e);
    expect(error).toBeInstanceOf(SubmissionNotAllowedError);
    expect(error.reason).toBe("not-an-assignment");
  });

  it("throws not-found for an actor with no enrolment covering the assessment's course — same reason as a non-existent assessment", async () => {
    const { service: noEnrolmentService } = buildService({ assessment: { courseId: "c-other" } });
    const notCovered = await noEnrolmentService.beginSubmissionUpload(learner, uploadInput).catch((e) => e);
    expect(notCovered).toBeInstanceOf(SubmissionNotAllowedError);
    expect(notCovered.reason).toBe("not-found");

    const { service: missingAssessmentService } = buildService({ assessment: null });
    const missing = await missingAssessmentService
      .beginSubmissionUpload(learner, { ...uploadInput, assessmentId: "missing" })
      .catch((e) => e);
    expect(missing).toBeInstanceOf(SubmissionNotAllowedError);
    expect(missing.reason).toBe("not-found");
  });

  it("creates an UPLOADING row whose storageKey starts with submission-uploads/", async () => {
    const { service, rows } = buildService();
    await service.beginSubmissionUpload(learner, uploadInput);
    expect(rows[0]).toMatchObject({ uploadStatus: "UPLOADING" });
    expect(rows[0].storageKey.startsWith("submission-uploads/")).toBe(true);
  });
});

describe("completeSubmissionUpload — never false success (ASM-04)", () => {
  const staged: Partial<SubmissionRecord> = {
    id: "sub1",
    uploadStatus: "UPLOADING",
    storageKey: "submission-uploads/enr1/a1/opaque",
    sizeBytes: 1000,
    mimeType: "application/pdf",
  };

  it("marks ERROR and throws when the object cannot be inspected at all", async () => {
    const { service, rows, storage, events } = buildService({ submissions: [staged] });
    storage.inspect.mockRejectedValueOnce(new Error("no such key"));
    const error = await service.completeSubmissionUpload(learner, { submissionId: "sub1" }).catch((e) => e);
    expect(error).toBeInstanceOf(SubmissionUploadValidationError);
    expect(rows[0].uploadStatus).toBe("ERROR");
    expect(storage.promote).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === "submission.created")).toBe(false);
  });

  it("marks ERROR and throws on a byte-size mismatch", async () => {
    const { service, rows, storage, events } = buildService({ submissions: [staged] });
    storage.inspect.mockResolvedValueOnce({ sizeBytes: 999, contentType: "application/pdf" });
    const error = await service.completeSubmissionUpload(learner, { submissionId: "sub1" }).catch((e) => e);
    expect(error).toBeInstanceOf(SubmissionUploadValidationError);
    expect(rows[0].uploadStatus).toBe("ERROR");
    expect(storage.promote).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === "submission.created")).toBe(false);
  });

  it("marks ERROR and throws on a content-type mismatch", async () => {
    const { service, rows, storage, events } = buildService({ submissions: [staged] });
    storage.inspect.mockResolvedValueOnce({ sizeBytes: 1000, contentType: "text/plain" });
    const error = await service.completeSubmissionUpload(learner, { submissionId: "sub1" }).catch((e) => e);
    expect(error).toBeInstanceOf(SubmissionUploadValidationError);
    expect(rows[0].uploadStatus).toBe("ERROR");
    expect(storage.promote).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === "submission.created")).toBe(false);
  });
});

describe("completeSubmissionUpload — happy path", () => {
  const staged: Partial<SubmissionRecord> = {
    id: "sub1",
    receiptId: "receipt-abc",
    uploadStatus: "UPLOADING",
    storageKey: "submission-uploads/enr1/a1/opaque",
    sizeBytes: 1000,
    mimeType: "application/pdf",
  };

  it("promotes once, marks READY, writes submission.created, and returns the row's receiptId", async () => {
    const { service, rows, storage, events } = buildService({ submissions: [staged] });
    const receipt = await service.completeSubmissionUpload(learner, { submissionId: "sub1" });
    expect(storage.promote).toHaveBeenCalledTimes(1);
    expect(rows[0].storageKey.startsWith("submissions/")).toBe(true);
    expect(rows[0].uploadStatus).toBe("READY");
    expect(events.some((e) => e.type === "submission.created")).toBe(true);
    expect(receipt.receiptId).toBe("receipt-abc");
  });

  it("resolves inspect before calling promote, and writes the READY update after promote", async () => {
    const { service, track } = buildService({ submissions: [staged] });
    await service.completeSubmissionUpload(learner, { submissionId: "sub1" });
    expect(track).toEqual(["inspect", "promote", "update"]);
  });

  it("called twice returns the same receipt and calls promote only once", async () => {
    const { service, storage } = buildService({ submissions: [staged] });
    const first = await service.completeSubmissionUpload(learner, { submissionId: "sub1" });
    const second = await service.completeSubmissionUpload(learner, { submissionId: "sub1" });
    expect(second).toEqual(first);
    expect(storage.promote).toHaveBeenCalledTimes(1);
  });
});

describe("resubmission (D-04) — a new numbered row, never an overwrite", () => {
  it("creates attemptNumber 2 and leaves the first READY row's receiptId/storageKey untouched, when allowResubmission is true", async () => {
    const { service, rows } = buildService({
      assessment: { allowResubmission: true },
      submissions: [
        {
          id: "sub1",
          attemptNumber: 1,
          uploadStatus: "READY",
          receiptId: "receipt-1",
          storageKey: "submissions/enr1/a1/first",
        },
      ],
    });
    await service.beginSubmissionUpload(learner, uploadInput);
    expect(rows).toHaveLength(2);
    const first = rows.find((r) => r.id === "sub1")!;
    expect(first.receiptId).toBe("receipt-1");
    expect(first.storageKey).toBe("submissions/enr1/a1/first");
    const second = rows.find((r) => r.id !== "sub1")!;
    expect(second.attemptNumber).toBe(2);
    expect(second.uploadStatus).toBe("UPLOADING");
  });

  it("throws resubmission-not-allowed when allowResubmission is false and a READY submission already exists", async () => {
    const { service } = buildService({
      assessment: { allowResubmission: false },
      submissions: [{ id: "sub1", attemptNumber: 1, uploadStatus: "READY" }],
    });
    const error = await service.beginSubmissionUpload(learner, uploadInput).catch((e) => e);
    expect(error).toBeInstanceOf(SubmissionNotAllowedError);
    expect(error.reason).toBe("resubmission-not-allowed");
  });

  it("throws upload-in-progress when an UPLOADING submission already exists", async () => {
    const { service } = buildService({
      submissions: [{ id: "sub1", attemptNumber: 1, uploadStatus: "UPLOADING" }],
    });
    const error = await service.beginSubmissionUpload(learner, uploadInput).catch((e) => e);
    expect(error).toBeInstanceOf(SubmissionNotAllowedError);
    expect(error.reason).toBe("upload-in-progress");
  });
});

describe("getOwnSubmissions", () => {
  it("returns both rows newest-attempt-first", async () => {
    const { service } = buildService({
      submissions: [
        { id: "sub1", attemptNumber: 1, uploadStatus: "READY" },
        { id: "sub2", attemptNumber: 2, uploadStatus: "READY" },
      ],
    });
    const result = await service.getOwnSubmissions(learner, { assessmentId: "a1" });
    expect(result.map((r) => r.attemptNumber)).toEqual([2, 1]);
  });

  it("returns an empty list for a different actor rather than throwing", async () => {
    const { service } = buildService({
      submissions: [{ id: "sub1", attemptNumber: 1, uploadStatus: "READY" }],
    });
    await expect(service.getOwnSubmissions(otherLearner, { assessmentId: "a1" })).resolves.toEqual([]);
  });
});

describe("getOwnSubmissionDownloadUrl (T-10-20)", () => {
  it("presigns only the row's storageKey when uploadStatus is READY", async () => {
    const { service, presignDownload } = buildService({
      submissions: [{ id: "sub1", uploadStatus: "READY", storageKey: "submissions/enr1/a1/final" }],
    });
    const url = await service.getOwnSubmissionDownloadUrl(learner, { submissionId: "sub1" });
    expect(url).toContain("submissions/enr1/a1/final");
    expect(presignDownload).toHaveBeenCalledWith(
      expect.objectContaining({ key: "submissions/enr1/a1/final" }),
    );
  });

  it("refuses a non-READY submission", async () => {
    const { service } = buildService({
      submissions: [{ id: "sub1", uploadStatus: "UPLOADING" }],
    });
    await expect(
      service.getOwnSubmissionDownloadUrl(learner, { submissionId: "sub1" }),
    ).rejects.toBeInstanceOf(SubmissionNotAllowedError);
  });
});
