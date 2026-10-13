/**
 * Cursor-paged notification list for the drawer (D-18, D-22, T-13-22).
 *
 * No `dynamic`/`revalidate` route config export and `Cache-Control:
 * private, no-store` on every response, same discipline as
 * `unread/route.ts` and the certificate download route: this list is
 * scoped to the caller and must never be served from a shared cache. An
 * invalid cursor maps to a 400 with no further detail (never leaking why),
 * and no session maps to a 401 with empty data.
 */

import { NextResponse } from "next/server";
import { getCurrentActor } from "@/server/auth/current-actor";
import { InvalidCursorError, notificationService } from "@/server/services/notification-service";
import { toNotificationDto } from "@/server/communications/notification-text";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export async function GET(request: Request): Promise<Response> {
  const actor = await getCurrentActor();
  if (!actor) {
    return NextResponse.json({ items: [], nextCursor: null }, { status: 401, headers: NO_STORE });
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam !== null ? Number(limitParam) : undefined;

  let page;
  try {
    page = await notificationService.list(actor, { cursor: cursor ?? undefined, limit });
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      return NextResponse.json({ items: [], nextCursor: null }, { status: 400, headers: NO_STORE });
    }
    throw error;
  }

  const now = new Date();
  return NextResponse.json(
    {
      items: page.items.map((row) => toNotificationDto(row, now)),
      nextCursor: page.nextCursor,
    },
    { status: 200, headers: NO_STORE },
  );
}
