/**
 * Scope-target lookup for the four-scope assignment picker.
 *
 * Exists only to satisfy the service-layer Prisma boundary — even a
 * read-only lookup must live behind a service. Gated on `roles.manage`
 * alone (D-41): picking a scope target for a new assignment is not the same
 * as viewing that record's own content, so this does not also require
 * `programmes.view`/`cohorts.view`. The minimal three-field projection is
 * what keeps that reasoning true — never widen it with dates, status,
 * prices, or counts.
 *
 * Programme and Cohort tables are empty until Phases 4 and 5 land (D-18) —
 * each simply returns an empty array today. No stub, no placeholder data,
 * no feature flag.
 */

import { prisma } from "@/server/db";
import { withPermission } from "@/server/permissions";
import type { createWithPermission } from "@/server/permissions/with-permission";

type WithPermission = ReturnType<typeof createWithPermission>;

export const SCOPE_TARGET_LIMIT = 20;

/** Exactly three fields — id, a display label, and a public identifier. */
export type ScopeTarget = {
  id: string;
  label: string;
  identifier: string;
};

type NamedRow = { id: string; title: string };

function buildTitleWhere(query: string | undefined): Record<string, unknown> {
  if (!query) return {};
  return { title: { contains: query, mode: "insensitive" } };
}

/** The narrow slice of the Prisma client this service actually uses. */
export type ScopeLookupStore = {
  programme: {
    findMany(args: Record<string, unknown>): Promise<(NamedRow & { slug: string })[]>;
  };
  course: {
    findMany(args: Record<string, unknown>): Promise<(NamedRow & { slug: string })[]>;
  };
  cohort: {
    findMany(args: Record<string, unknown>): Promise<(NamedRow & { code: string })[]>;
  };
};

export function createScopeLookupService(deps: {
  store: ScopeLookupStore;
  withPermission: WithPermission;
}) {
  const { store, withPermission: authorize } = deps;

  const programmesInternal = authorize<string | undefined>(
    "roles.manage",
    () => ({}),
  )(async (query) => {
    const rows = await store.programme.findMany({
      where: buildTitleWhere(query),
      orderBy: { title: "asc" },
      take: SCOPE_TARGET_LIMIT,
    });
    return rows.map((row): ScopeTarget => ({ id: row.id, label: row.title, identifier: row.slug }));
  });

  const coursesInternal = authorize<string | undefined>(
    "roles.manage",
    () => ({}),
  )(async (query) => {
    const rows = await store.course.findMany({
      where: buildTitleWhere(query),
      orderBy: { title: "asc" },
      take: SCOPE_TARGET_LIMIT,
    });
    return rows.map((row): ScopeTarget => ({ id: row.id, label: row.title, identifier: row.slug }));
  });

  const cohortsInternal = authorize<string | undefined>(
    "roles.manage",
    () => ({}),
  )(async (query) => {
    const rows = await store.cohort.findMany({
      where: buildTitleWhere(query),
      orderBy: { title: "asc" },
      take: SCOPE_TARGET_LIMIT,
    });
    return rows.map((row): ScopeTarget => ({ id: row.id, label: row.title, identifier: row.code }));
  });

  return {
    programmes: (query?: string) => programmesInternal(query),
    courses: (query?: string) => coursesInternal(query),
    cohorts: (query?: string) => cohortsInternal(query),
  };
}

export const scopeLookupService = createScopeLookupService({
  store: prisma as unknown as ScopeLookupStore,
  withPermission,
});
