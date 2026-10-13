/**
 * Authenticated browser-safe list of a lesson's resources for the authoring panel.
 *
 * NFR-09 (plan 15-24): `?includeCaptions=1` also returns the lesson's caption
 * tracks (every upload state, no storage key) so the video row can list them. The
 * ordinary `resources` list never contains caption rows.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import * as permissions from "@/server/permissions";
import { LICENCE_REFUSAL_MESSAGE } from "@/server/licence/policy";
import { listLessonCaptions, listLessonResources } from "@/server/services/lesson-resource-service";
import { toLessonResourceView } from "@/server/presenters/lesson-resource-view";

const querySchema = z.object({
  lessonId: z.string().min(1),
  includeCaptions: z.literal("1").optional(),
});

export async function GET(request: Request): Promise<Response> {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing or malformed lessonId." }, { status: 400 });
  }

  try {
    const resources = await listLessonResources(parsed.data.lessonId);
    const captions =
      parsed.data.includeCaptions === "1" ? await listLessonCaptions(parsed.data.lessonId) : undefined;
    return NextResponse.json(
      {
        resources: resources.map(toLessonResourceView),
        ...(captions ? { captions } : {}),
      },
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
