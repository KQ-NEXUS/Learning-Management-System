/**
 * Same-origin delivery of one WebVTT caption file (NFR-09 accessible media,
 * NFR-06 private files; plan 15-23).
 *
 * Why not a presigned redirect like the download route: a `<track>` element
 * fetches its `src` in CORS mode and cannot follow a redirect to object storage
 * unless the bucket sends CORS headers. A caption file is at most 1 MB, so the
 * app reads it and answers directly; video keeps its presigned redirect.
 *
 * Authorisation is the download route's: staff `courses.view` on the resource's
 * course first, otherwise a learner who may open the lesson (see
 * `readCaptionForLearnerOrStaff`). Every refusal is an empty 404 — no session,
 * unknown id, a resource that is not a caption, an upload that is not READY
 * (the only clean state), or no access — so the response can never be used to
 * probe which resources exist (RBAC-06 denial parity). The body is never
 * cacheable by a shared cache: `Cache-Control: private, no-store`.
 */

import { NextResponse } from "next/server";
import { getCurrentActor } from "@/server/auth/current-actor";
import { readCaptionForLearnerOrStaff } from "@/server/services/lesson-resource-service";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;

  const actor = await getCurrentActor();
  const caption = await readCaptionForLearnerOrStaff(actor, id);
  if (!caption) return new NextResponse(null, { status: 404 });

  return new NextResponse(caption.body, {
    status: 200,
    headers: {
      "Content-Type": "text/vtt; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
