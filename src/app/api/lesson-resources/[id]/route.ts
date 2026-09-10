/**
 * Remove a lesson resource (CAT-04 / D-28).
 *
 * Staff use this to clear a failed or unwanted attachment so they can upload
 * again. The service authorizes `courses.edit` through the resource's parent
 * course, deletes the stored object idempotently, deletes the row, and audits
 * the removal. An authorization failure returns an empty 404.
 */

import { NextResponse } from "next/server";
import * as permissions from "@/server/permissions";
import { removeLessonResource } from "@/server/services/lesson-resource-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;

  try {
    await removeLessonResource(id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (
      err instanceof permissions.AuthenticationError ||
      err instanceof permissions.AuthorizationError
    ) {
      return new NextResponse(null, { status: 404 });
    }
    throw err;
  }
}
