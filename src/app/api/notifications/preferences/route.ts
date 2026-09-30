/**
 * The caller's own muted email categories (D-16, T-13-22).
 *
 * No `dynamic`/`revalidate` route config export and `Cache-Control:
 * private, no-store` on every response — same discipline as the other
 * notification routes. No session means a 401 with no data, and this route
 * never returns another user's rows: `emailPreferenceService` always scopes
 * to `actor.userId`.
 */

import { NextResponse } from "next/server";
import { getCurrentActor } from "@/server/auth/current-actor";
import { emailPreferenceService } from "@/server/services/email-preference-service";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export async function GET(): Promise<Response> {
  const actor = await getCurrentActor();
  if (!actor) {
    return NextResponse.json({ muted: [] }, { status: 401, headers: NO_STORE });
  }

  const muted = await emailPreferenceService.getMutedCategories(actor);
  return NextResponse.json({ muted }, { status: 200, headers: NO_STORE });
}
