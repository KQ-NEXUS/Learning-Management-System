/**
 * Unread notification count for the bell poll (D-22, T-13-22).
 *
 * Deliberately no `dynamic`/`revalidate` route config export: this response
 * is scoped to the caller's session and must never be served from a shared
 * cache to a different visitor. `Cache-Control: private, no-store` on every
 * response (including the 401) is the explicit second layer, matching the
 * certificate download route's discipline.
 */

import { NextResponse } from "next/server";
import { getCurrentActor } from "@/server/auth/current-actor";
import { notificationService } from "@/server/services/notification-service";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export async function GET(): Promise<Response> {
  const actor = await getCurrentActor();
  if (!actor) {
    return NextResponse.json({ unread: 0 }, { status: 401, headers: NO_STORE });
  }

  const unread = await notificationService.unreadCount(actor);
  return NextResponse.json({ unread }, { status: 200, headers: NO_STORE });
}
