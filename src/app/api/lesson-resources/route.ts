/** Authenticated browser-safe list of a lesson's resources for the authoring panel. */

import { NextResponse } from "next/server";
import { z } from "zod";
import * as permissions from "@/server/permissions";
import { listLessonResources } from "@/server/services/lesson-resource-service";
import { toLessonResourceView } from "@/server/presenters/lesson-resource-view";

const querySchema = z.object({ lessonId: z.string().min(1) });

export async function GET(request: Request): Promise<Response> {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing or malformed lessonId." }, { status: 400 });
  }

  try {
    const resources = await listLessonResources(parsed.data.lessonId);
    return NextResponse.json(
      { resources: resources.map(toLessonResourceView) },
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
