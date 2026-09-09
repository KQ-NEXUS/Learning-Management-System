/** Staff-only rescan request for a resource whose previous scan errored. */

import { NextResponse } from "next/server";
import * as permissions from "@/server/permissions";
import {
  markRetryEnqueueFailed,
  ResourceRetryNotAllowedError,
  retryLessonResource,
  type LessonResourceRecord,
} from "@/server/services/lesson-resource-service";
import { enqueueScan } from "@/server/jobs/queue";

type RouteContext = { params: Promise<{ id: string }> };

function toView(resource: LessonResourceRecord) {
  return {
    id: resource.id,
    title: resource.title,
    filename: resource.filename,
    mimeType: resource.mimeType,
    sizeBytes: resource.sizeBytes.toString(),
    scanStatus: resource.scanStatus,
    scanDetail: resource.scanDetail,
    position: resource.position,
  };
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  try {
    const resource = await retryLessonResource(id);

    try {
      await enqueueScan(id);
    } catch (enqueueError) {
      // The row is PENDING but no scan job was sent. Roll it back to ERROR now
      // so the UI is truthful and Retry stays available; the reconciliation
      // cron (queue.ts / findStuckPending) is only the backstop for a crash
      // between these two writes. The compensating write is best-effort — if it
      // also fails, the cron still recovers the stuck PENDING row.
      console.error("[lesson-resources] scan enqueue failed after retry", enqueueError);
      const reverted = await markRetryEnqueueFailed(id).catch((revertError: unknown) => {
        console.error("[lesson-resources] retry rollback also failed", revertError);
        return null;
      });
      return NextResponse.json(
        {
          error: "The scan could not be queued. Try again in a moment.",
          resource: reverted ? toView(reverted) : undefined,
        },
        { status: 503, headers: { "cache-control": "private, no-store" } },
      );
    }

    return NextResponse.json(
      { resource: toView(resource) },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (
      error instanceof permissions.AuthenticationError ||
      error instanceof permissions.AuthorizationError
    ) {
      return new NextResponse(null, { status: 404 });
    }
    if (error instanceof ResourceRetryNotAllowedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
