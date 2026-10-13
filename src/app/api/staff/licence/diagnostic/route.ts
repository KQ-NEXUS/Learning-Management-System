/**
 * Licence diagnostic report download (Phase 14, plan 14-15; LIC-02, LIC-06,
 * D-14, D-17, T-14-15-05, T-14-15-06).
 *
 * `GET /api/staff/licence/diagnostic` returns the allow-listed report from the
 * licence service as a JSON attachment. Authorization (`licence.view`, Global
 * only) and the `licence.diagnostic_downloaded` audit row, which carries the
 * actor, both live in the staff service, so a caller who is not authorized never
 * reaches the licence module and an authorized download is never unrecorded.
 *
 * Deliberately no `dynamic`/`revalidate` route config export: the response is
 * scoped to the caller's session and must never be served from a shared cache.
 * `Cache-Control: private, no-store` is the explicit second layer on every
 * response, errors included, matching `/api/notifications/unread`.
 *
 * Errors: no session is 401; a denied caller gets an empty 404 (the route does
 * not confirm that it exists to someone without access, the same mapping the
 * lesson-resource routes use); anything else is a fixed 500 body with no message,
 * stack or licence text. Only the error name is logged.
 */

import { NextResponse } from "next/server";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { licenceStaffService } from "@/server/services/licence-staff-service";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/** Letters, digits, dot, underscore and hyphen only, so a stored id can never break the header. */
function safeFilenamePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

function reportFilename(report: { licenceId: string | null; generatedAt: string }): string {
  const id = report.licenceId ? safeFilenamePart(report.licenceId) : "not-activated";
  // generatedAt is an ISO-8601 UTC instant: the first ten characters are YYYY-MM-DD.
  const date = report.generatedAt.slice(0, 10).replaceAll("-", "");
  return `licence-diagnostic-${id}-${date}.json`;
}

export async function GET(): Promise<Response> {
  try {
    const report = await licenceStaffService.getDiagnosticForStaff();
    return new NextResponse(JSON.stringify(report, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${reportFilename(report)}"`,
        "X-Content-Type-Options": "nosniff",
        ...NO_STORE,
      },
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });
    }
    if (error instanceof AuthorizationError) {
      return new NextResponse(null, { status: 404, headers: NO_STORE });
    }
    console.error("[licence] diagnostic download failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "diagnostic_unavailable" }, { status: 500, headers: NO_STORE });
  }
}
