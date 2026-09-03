/**
 * Authorized download for a lesson resource (CAT-04 / D-28, D-36, D-37).
 *
 * `getDownloadableResource` authorizes `courses.view` on the parent course and
 * refuses anything whose scan has not come back CLEAN. On success this handler
 * 302s to a presigned URL whose lifetime matches the content type (60s for
 * FILE/IMAGE, 4h for VIDEO) — the object bytes never traverse the Next.js
 * process, which is what protects availability for a 2 GB video (NFR-01/02).
 *
 * Status mapping:
 *   - PENDING  -> 409 (caller is authorized; the condition is temporary)
 *   - INFECTED / ERROR / any authorization failure -> 404 with an empty body
 *     (anything other than 404 on an infected file would confirm both that it
 *     exists and that it is infected — telling an uploader their payload landed)
 */

import { NextResponse } from "next/server";
import * as permissions from "@/server/permissions";
import {
  getDownloadableResource,
  ResourceInfectedError,
  ResourceNotScannedError,
} from "@/server/services/lesson-resource-service";
import * as storage from "@/server/services/storage-service";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;

  try {
    const resource = await getDownloadableResource(id);
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
    if (err instanceof ResourceNotScannedError) {
      return NextResponse.json(
        { error: "This file is still being scanned. Try again shortly." },
        { status: 409 },
      );
    }
    if (
      err instanceof ResourceInfectedError ||
      err instanceof permissions.AuthenticationError ||
      err instanceof permissions.AuthorizationError
    ) {
      return new NextResponse(null, { status: 404 });
    }
    throw err;
  }
}
