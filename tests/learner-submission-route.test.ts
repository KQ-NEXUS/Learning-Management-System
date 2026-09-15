import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/app/(learner)/learn/[enrolmentId]/lessons/[lessonId]/submission-actions.ts`
 * (10-14 Task 1/3).
 *
 * Mirrors `tests/learner-lesson-actions.test.ts`'s convention: a full mock
 * of `@/server/services/submission-service` with fake error classes
 * standing in for the real ones — the action's own `instanceof` checks are
 * against whatever the module import resolves to, so a fake class at the
 * same export name satisfies them without constructing the real
 * live-Prisma service.
 */

const mocks = vi.hoisted(() => {
  class FakeSubmissionNotAllowedError extends Error {
    reason: string;
    constructor(reason: string, message: string) {
      super(message);
      this.name = "SubmissionNotAllowedError";
      this.reason = reason;
    }
  }
  class FakeSubmissionConstraintError extends Error {
    reason: string;
    value: string | number;
    limit: string | number | null;
    constructor(reason: string, message: string, value: string | number, limit: string | number | null) {
      super(message);
      this.name = "SubmissionConstraintError";
      this.reason = reason;
      this.value = value;
      this.limit = limit;
    }
  }
  return {
    getCurrentActor: vi.fn(),
    beginSubmissionUpload: vi.fn(),
    completeSubmissionUpload: vi.fn(),
    failSubmissionUpload: vi.fn(),
    getOwnAssignmentView: vi.fn(),
    revalidatePath: vi.fn(),
    FakeSubmissionNotAllowedError,
    FakeSubmissionConstraintError,
  };
});

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/auth/current-actor", () => ({ getCurrentActor: mocks.getCurrentActor }));
vi.mock("@/server/services/submission-service", () => ({
  beginSubmissionUpload: mocks.beginSubmissionUpload,
  completeSubmissionUpload: mocks.completeSubmissionUpload,
  failSubmissionUpload: mocks.failSubmissionUpload,
  getOwnAssignmentView: mocks.getOwnAssignmentView,
  SubmissionNotAllowedError: mocks.FakeSubmissionNotAllowedError,
  SubmissionConstraintError: mocks.FakeSubmissionConstraintError,
}));

import {
  beginSubmissionUploadAction,
  completeSubmissionUploadAction,
  failSubmissionUploadAction,
  loadAssignmentSubmissionView,
} from "@/app/(learner)/learn/[enrolmentId]/lessons/[lessonId]/submission-actions";

const ACTOR = { userId: "learner-1", roles: [] };

const validBegin = {
  assessmentId: "a1",
  filename: "essay.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1000,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentActor.mockResolvedValue(ACTOR);
});

describe("beginSubmissionUploadAction", () => {
  it("rejects a payload containing receiptId at the zod boundary", async () => {
    const result = await beginSubmissionUploadAction({ ...validBegin, receiptId: "r1" });
    expect(result.ok).toBe(false);
    expect(mocks.beginSubmissionUpload).not.toHaveBeenCalled();
  });

  it("rejects a payload containing isLate at the zod boundary", async () => {
    const result = await beginSubmissionUploadAction({ ...validBegin, isLate: true });
    expect(result.ok).toBe(false);
    expect(mocks.beginSubmissionUpload).not.toHaveBeenCalled();
  });

  it("rejects a payload containing actorId at the zod boundary", async () => {
    const result = await beginSubmissionUploadAction({ ...validBegin, actorId: "someone-else" });
    expect(result.ok).toBe(false);
    expect(mocks.beginSubmissionUpload).not.toHaveBeenCalled();
  });

  it("rejects a payload containing storageKey at the zod boundary", async () => {
    const result = await beginSubmissionUploadAction({
      ...validBegin,
      storageKey: "submission-uploads/enr1/a1/opaque",
    });
    expect(result.ok).toBe(false);
    expect(mocks.beginSubmissionUpload).not.toHaveBeenCalled();
  });

  it("rejects a zero sizeBytes", async () => {
    const result = await beginSubmissionUploadAction({ ...validBegin, sizeBytes: 0 });
    expect(result.ok).toBe(false);
    expect(mocks.beginSubmissionUpload).not.toHaveBeenCalled();
  });

  it("rejects a negative sizeBytes", async () => {
    const result = await beginSubmissionUploadAction({ ...validBegin, sizeBytes: -5 });
    expect(result.ok).toBe(false);
    expect(mocks.beginSubmissionUpload).not.toHaveBeenCalled();
  });

  it("maps a file-too-large SubmissionConstraintError to a field-level message naming the authored limit", async () => {
    mocks.beginSubmissionUpload.mockRejectedValue(
      new mocks.FakeSubmissionConstraintError(
        "file-too-large",
        "This file exceeds the 5000000 byte limit for this assignment.",
        6_000_000,
        5_000_000,
      ),
    );

    const result = await beginSubmissionUploadAction(validBegin);

    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toBe(
      "This file exceeds the 5000000 byte limit for this assignment.",
    );
  });

  it("maps a file-type-not-permitted SubmissionConstraintError to a field-level message naming the value and the authored limit", async () => {
    mocks.beginSubmissionUpload.mockRejectedValue(
      new mocks.FakeSubmissionConstraintError(
        "file-type-not-permitted",
        '"exe" is not an accepted file type for this assignment (accepted: pdf, docx).',
        "exe",
        "pdf, docx",
      ),
    );

    const result = await beginSubmissionUploadAction(validBegin);

    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toBe(
      '"exe" is not an accepted file type for this assignment (accepted: pdf, docx).',
    );
  });

  it("maps SubmissionNotAllowedError window-closed to its UI-SPEC copy", async () => {
    mocks.beginSubmissionUpload.mockRejectedValue(
      new mocks.FakeSubmissionNotAllowedError(
        "window-closed",
        "The submission window for this assignment has closed.",
      ),
    );

    const result = await beginSubmissionUploadAction(validBegin);

    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toBe(
      "The submission window for this assignment has closed.",
    );
  });

  it("calls the service with the session-derived actor and returns no receiptId on success", async () => {
    mocks.beginSubmissionUpload.mockResolvedValue({
      submissionId: "sub1",
      uploadUrl: "https://storage.example/put",
      stagedKey: "staged/key",
      attemptNumber: 1,
      isLate: false,
    });

    const result = await beginSubmissionUploadAction(validBegin);

    expect(mocks.beginSubmissionUpload).toHaveBeenCalledWith(ACTOR, validBegin);
    expect(result).toEqual({
      ok: true,
      submissionId: "sub1",
      uploadUrl: "https://storage.example/put",
      stagedKey: "staged/key",
      attemptNumber: 1,
      isLate: false,
    });
    expect(result).not.toHaveProperty("receiptId");
  });

  it("returns a sign-in refusal for a signed-out caller without calling the service", async () => {
    mocks.getCurrentActor.mockResolvedValue(null);

    const result = await beginSubmissionUploadAction(validBegin);

    expect(result.ok).toBe(false);
    expect(mocks.beginSubmissionUpload).not.toHaveBeenCalled();
  });
});

describe("completeSubmissionUploadAction", () => {
  it("maps a validation failure from the complete step to the ASM-04 failure copy and returns no receipt field", async () => {
    mocks.completeSubmissionUpload.mockRejectedValue(
      new Error("The uploaded file could not be verified."),
    );

    const result = await completeSubmissionUploadAction({ submissionId: "sub1" });

    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toBe("Your file couldn't be uploaded");
    expect((result as { body: string }).body).toBe(
      "Nothing was submitted. Check your connection and try again.",
    );
    expect(result).not.toHaveProperty("receipt");
  });

  it("maps a SubmissionNotAllowedError from the complete step to its own message", async () => {
    mocks.completeSubmissionUpload.mockRejectedValue(
      new mocks.FakeSubmissionNotAllowedError("not-found", "This assignment is not part of your enrolled path."),
    );

    const result = await completeSubmissionUploadAction({ submissionId: "sub1" });

    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toBe(
      "This assignment is not part of your enrolled path.",
    );
  });

  it("revalidates the lesson-page route pattern and returns the verified receipt on success", async () => {
    const receipt = {
      submissionId: "sub1",
      receiptId: "receipt1",
      attemptNumber: 1,
      filename: "essay.pdf",
      sizeBytes: 1000,
      submittedAt: new Date("2026-01-01T00:00:00Z"),
      isLate: false,
      uploadStatus: "READY" as const,
    };
    mocks.completeSubmissionUpload.mockResolvedValue(receipt);

    const result = await completeSubmissionUploadAction({ submissionId: "sub1" });

    expect(result).toEqual({ ok: true, receipt });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/learn/[enrolmentId]/lessons/[lessonId]", "page");
  });

  it("rejects a malformed payload without calling the service", async () => {
    const result = await completeSubmissionUploadAction({});

    expect(result.ok).toBe(false);
    expect(mocks.completeSubmissionUpload).not.toHaveBeenCalled();
  });
});

describe("failSubmissionUploadAction", () => {
  it("calls the service with the session-derived actor", async () => {
    mocks.failSubmissionUpload.mockResolvedValue(undefined);

    const result = await failSubmissionUploadAction({
      submissionId: "sub1",
      detail: "The storage upload failed.",
    });

    expect(mocks.failSubmissionUpload).toHaveBeenCalledWith(ACTOR, {
      submissionId: "sub1",
      detail: "The storage upload failed.",
    });
    expect(result).toEqual({ ok: true });
  });

  it("returns the ASM-04 failure copy when the service call itself throws", async () => {
    mocks.failSubmissionUpload.mockRejectedValue(new Error("db exploded"));

    const result = await failSubmissionUploadAction({ submissionId: "sub1", detail: "network" });

    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toBe("Your file couldn't be uploaded");
  });
});

describe("loadAssignmentSubmissionView", () => {
  it("returns the assessment's published constraints so the learner sees them before submitting", async () => {
    mocks.getOwnAssignmentView.mockResolvedValue({
      assessmentId: "a1",
      title: "Essay",
      instructions: "<p>Write about it</p>",
      dueAt: new Date("2026-01-01T00:00:00Z"),
      availableUntil: new Date("2026-01-08T00:00:00Z"),
      allowedFileTypes: ["pdf"],
      maxFileSizeBytes: 5_000_000,
      allowResubmission: true,
      submissions: [],
    });

    const result = await loadAssignmentSubmissionView({ assessmentId: "a1", enrolmentId: "enr1" });

    expect(mocks.getOwnAssignmentView).toHaveBeenCalledWith(ACTOR, { assessmentId: "a1", enrolmentId: "enr1" });
    expect(result).toMatchObject({
      assessmentId: "a1",
      title: "Essay",
      allowedFileTypes: ["pdf"],
      maxFileSizeBytes: 5_000_000,
      allowResubmission: true,
      dueAt: "2026-01-01T00:00:00.000Z",
      availableUntil: "2026-01-08T00:00:00.000Z",
    });
  });

  it("returns null for a signed-out caller without calling the service", async () => {
    mocks.getCurrentActor.mockResolvedValue(null);

    const result = await loadAssignmentSubmissionView({ assessmentId: "a1", enrolmentId: "enr1" });

    expect(result).toBeNull();
    expect(mocks.getOwnAssignmentView).not.toHaveBeenCalled();
  });

  it("returns null when the service finds no covering assignment", async () => {
    mocks.getOwnAssignmentView.mockResolvedValue(null);

    const result = await loadAssignmentSubmissionView({ assessmentId: "a1", enrolmentId: "enr1" });

    expect(result).toBeNull();
  });
});
