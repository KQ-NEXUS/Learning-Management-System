/** Authenticated browser-safe list used by UploadPanel status polling. */

import { NextResponse } from "next/server";
import { z } from "zod";
import * as permissions from "@/server/permissions";
import {
  listLessonResources,
  type LessonResourceRecord,
} from "@/server/services/lesson-resource-service";

const querySchema = z.object({ lessonId: z.string().min(1) });

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

export async function GET(request: Request): Promise<Response> {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing or malformed lessonId." }, { status: 400 });
  }

  try {
    const resources = await listLessonResources(parsed.data.lessonId);
    return NextResponse.json(
      { resources: resources.map(toView) },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (
      error instanceof permissions.AuthenticationError ||
      error instanceof permissions.AuthorizationError
    ) {
      return new NextResponse(null, { status: 404 });
    }
    throw error;
  }
}
