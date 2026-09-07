/**
 * The bounded, filter-parity attendance-exceptions CSV download (ATT-04,
 * D-19, T-05-91..T-05-94).
 *
 * Reads exactly the same `categories`/`search` parameters the Exceptions
 * tab's URL carries, calls the SAME `withPermission("attendance.view", ...)`
 * -gated `loadAttendanceExceptions` with them, and hands the result straight
 * to `exceptionsToCsv` — no second filter, no `.slice`, no re-derivation.
 * That is what makes the on-screen filters and the CSV output structurally
 * identical rather than something that merely happens to agree today
 * (T-05-91).
 *
 * Bound to the one cohort in the route param — there is no all-cohorts
 * export here; queued/processing/retry export infrastructure is Phase 8.
 *
 * On `AuthorizationError` (or `AuthenticationError`) this returns a generic
 * 403 body that never reveals whether the cohort exists (T-05-93) — the
 * filename is only ever built AFTER authorization has already succeeded.
 * The response's cache-control header keeps a scoped export out of any
 * shared cache (T-05-92) — see `NO_STORE_CACHE_CONTROL` below.
 */

import { NextResponse } from "next/server";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import {
  loadAttendanceExceptions,
  exceptionsToCsv,
  type ExceptionCategory,
} from "@/server/services/roster-service";

const NO_STORE_CACHE_CONTROL = "no-store";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: cohortId } = await ctx.params;
  const url = new URL(request.url);

  const categoriesParam = url.searchParams.get("categories");
  const categories =
    categoriesParam && categoriesParam.trim().length > 0
      ? (categoriesParam.split(",") as ExceptionCategory[])
      : undefined;
  const searchParam = url.searchParams.get("search");
  const search = searchParam && searchParam.trim().length > 0 ? searchParam : undefined;

  try {
    const rows = await loadAttendanceExceptions({ cohortId, categories, search });
    const csv = exceptionsToCsv(rows);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `attendance-exceptions-${cohortId}-${timestamp}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": NO_STORE_CACHE_CONTROL,
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      return new NextResponse("You do not have access to this export.", {
        status: 403,
        headers: { "Cache-Control": NO_STORE_CACHE_CONTROL },
      });
    }
    throw error;
  }
}
