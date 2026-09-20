/**
 * Authorized staff download for an Assignment submission file (ASM-05,
 * T-10-20 — plan 10-13's grade-entry screen).
 *
 * Mirrors `lesson-resources/[id]/download/route.ts`'s exact shape: a
 * presigned URL is resolved on click (never embedded statically in the
 * server-rendered page, where its short TTL would go stale before the
 * grader clicks it) and returned as a hand-built 302 so the `no-store`
 * header rides along — a shared cache must never retain the resolved
 * location.
 *
 * Authorization is `getGradingDetail`'s own `submissions.view` grant,
 * scoped from the submission's OWN enrolment (T-10-23) — this route does
 * not call the learner-path `getOwnSubmissionDownloadUrl` (plan 10-05),
 * per this plan's Task 1 interfaces note. Every non-success outcome is a
 * 404 with no body, so the response can never confirm whether the
 * submission id exists (RBAC-06's denial-parity rule, matching the lesson-
 * resource download route's own precedent).
 */

import { NextResponse } from "next/server";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { getGradingDetail, SubmissionNotFoundError } from "@/server/services/grading-service";
import { presignLessonObjectUrl } from "@/server/services/storage-service";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ submissionId: string }> },
): Promise<Response> {
  const { submissionId } = await ctx.params;

  try {
    const detail = await getGradingDetail({ submissionId });

    if (detail.submission.uploadStatus !== "READY") {
      return new NextResponse(null, { status: 409 });
    }

    const url = await presignLessonObjectUrl({
      key: detail.submission.storageKey,
      lessonType: "ASSIGNMENT",
      filename: detail.submission.filename,
      contentType: detail.submission.mimeType,
    });

    return new NextResponse(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    if (
      err instanceof AuthenticationError ||
      err instanceof AuthorizationError ||
      err instanceof SubmissionNotFoundError
    ) {
      return new NextResponse(null, { status: 404 });
    }
    throw err;
  }
}
