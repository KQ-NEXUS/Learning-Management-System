/**
 * Authorized download for a lesson resource (CAT-04 / D-28, D-36, D-37, LRN-03).
 *
 * Two authorization predicates share this one route: staff `courses.view`
 * (`getDownloadableResource`) and an ACTIVE enrolment covering the lesson's
 * course (`getDownloadableResourceForLearner`, D-07/DD-14). The staff path is
 * tried first; an `AuthenticationError`/`AuthorizationError`/`null` from it
 * falls through to the learner path rather than failing the request. Both
 * predicates funnel into the SAME `presignLessonObjectUrl` call with the SAME
 * TTLs (60s for FILE/IMAGE, 4h for VIDEO) — the object bytes never traverse
 * the Next.js process, which is what protects availability for a 2 GB video
 * (NFR-01/02). Every authorization outcome other than success is a 404 (this
 * file has no forbidden-status branch) so the response can never be used to
 * probe which resources exist (RBAC-06's denial-parity rule, T-09-03).
 *
 * Status mapping:
 *   - UPLOADING -> 409 (caller is authorized; the upload just is not finished)
 *   - ERROR / any authorization failure / no enrolment covering the course ->
 *     404 with an empty body (anything other than 404 would confirm the
 *     resource exists or reveal which predicate failed)
 */

import { NextResponse } from "next/server";
import * as permissions from "@/server/permissions";
import { getCurrentActor } from "@/server/auth/current-actor";
import {
  getDownloadableResource,
  getDownloadableResourceForLearner,
  ResourceUploadPendingError,
  ResourceUploadUnavailableError,
} from "@/server/services/lesson-resource-service";
import * as storage from "@/server/services/storage-service";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;

  try {
    // Staff path first. A failed `courses.view` check (Authentication or
    // Authorization) is swallowed to `null` here so it can fall through to
    // the learner path below, rather than failing the request outright.
    let resource = await getDownloadableResource(id).catch((err) => {
      if (
        err instanceof permissions.AuthenticationError ||
        err instanceof permissions.AuthorizationError
      ) {
        return null;
      }
      throw err;
    });

    if (!resource) {
      // No session at all -> 404 without attempting a learner lookup with a
      // null actor.
      const actor = await getCurrentActor();
      resource = actor ? await getDownloadableResourceForLearner(actor, id) : null;
    }

    if (!resource) return new NextResponse(null, { status: 404 });

    const url = await storage.presignLessonObjectUrl({
      key: resource.storageKey,
      lessonType: resource.lesson.type,
      filename: resource.filename,
      contentType: resource.mimeType,
    });

    // Built by hand rather than via Response.redirect so the no-store header
    // rides along: no shared cache may retain the resolved location.
    return new NextResponse(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    if (err instanceof ResourceUploadPendingError) {
      return NextResponse.json({ error: "This upload is not ready yet." }, { status: 409 });
    }
    if (
      err instanceof ResourceUploadUnavailableError ||
      err instanceof permissions.AuthenticationError ||
      err instanceof permissions.AuthorizationError
    ) {
      return new NextResponse(null, { status: 404 });
    }
    throw err;
  }
}
