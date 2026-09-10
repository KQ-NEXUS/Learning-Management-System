/**
 * Step 3 of the direct upload flow (CAT-04 / D-28, D-36).
 *
 * The browser calls this once the presigned `PUT` returns — and also when that
 * `PUT` fails with an ambiguous network error, because private storage may have
 * received the object before the browser lost the response. The service
 * re-authorizes `courses.edit`, `HeadObject`s the staged upload, requires its
 * byte count and content type to equal the row, promotes it to a final key the
 * browser could never write, and marks the row `READY`.
 *
 * A mismatch marks the row `ERROR` and returns 422 with that row so the
 * authoring panel can show the failure and a remove control. An authorization
 * failure returns an empty 404.
 */

import { NextResponse } from "next/server";
import * as permissions from "@/server/permissions";
import {
  completeLessonResourceUpload,
  ResourceUploadValidationError,
} from "@/server/services/lesson-resource-service";
import { toLessonResourceView } from "@/server/presenters/lesson-resource-view";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;

  try {
    const resource = await completeLessonResourceUpload(id);
    return NextResponse.json(
      { resource: toLessonResourceView(resource) },
      { status: 200, headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ResourceUploadValidationError) {
      return NextResponse.json(
        { error: err.message, resource: toLessonResourceView(err.resource) },
        { status: 422, headers: { "cache-control": "private, no-store" } },
      );
    }
    if (
      err instanceof permissions.AuthenticationError ||
      err instanceof permissions.AuthorizationError
    ) {
      return new NextResponse(null, { status: 404 });
    }
    throw err;
  }
}
