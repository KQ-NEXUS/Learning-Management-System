/** Authenticated browser-safe list of a lesson's resources for the authoring panel. */

import { NextResponse } from "next/server";
import { z } from "zod";
import * as permissions from "@/server/permissions";
import { LICENCE_REFUSAL_MESSAGE } from "@/server/licence/policy";
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
    // Licence refusal (LIC-05): the caller already passed authorization, so this
    // reveals state only to them. Every genuine denial keeps the identical 404.
    if (permissions.isLicenceRestricted(error)) {
      return NextResponse.json({ error: LICENCE_REFUSAL_MESSAGE }, { status: 403 });
    }
    if (
      error instanceof permissions.AuthenticationError ||
      error instanceof permissions.AuthorizationError
    ) {
      return new NextResponse(null, { status: 404 });
    }
    throw error;
  }
}
