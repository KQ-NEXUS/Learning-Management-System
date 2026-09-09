import { describe, expect, it, vi } from "vitest";
import { createWithPermission, type RawGrant } from "@/server/permissions/with-permission";
import {
  createScopeLookupService,
  SCOPE_TARGET_LIMIT,
  type ScopeLookupStore,
} from "@/server/services/scope-lookup-service";

const grant = (
  permission: string,
  scopeType: RawGrant["scopeType"] = "GLOBAL",
  scopeId: string | null = null,
): RawGrant => ({
  permission: permission as RawGrant["permission"],
  scopeType,
  scopeId,
  active: true,
  revokedAt: null,
  startsAt: null,
  endsAt: null,
});

function harness(grants: RawGrant[], rows: { programme: unknown[]; course: unknown[]; cohort: unknown[] }) {
  const store: ScopeLookupStore = {
    programme: { findMany: vi.fn(async () => rows.programme as never) },
    course: { findMany: vi.fn(async () => rows.course as never) },
    cohort: { findMany: vi.fn(async () => rows.cohort as never) },
  };

  const withPermission = createWithPermission({
    getActor: async () => ({ userId: "user-1" }),
    loadGrants: async () => grants,
    audit: async () => {},
  });

  const service = createScopeLookupService({ store, withPermission });
  return { service, store };
}

const METHODS = ["programmes", "courses", "cohorts"] as const;

describe("scope lookup service", () => {
  it.each(METHODS)("%s refuses without a roles.manage grant", async (method) => {
    const { service, store } = harness([grant("roles.view")], {
      programme: [],
      course: [],
      cohort: [],
    });
    await expect(service[method]()).rejects.toThrow();
    expect(store[method === "programmes" ? "programme" : method === "courses" ? "course" : "cohort"].findMany).not.toHaveBeenCalled();
  });

  it.each(METHODS)("%s refuses when the only roles.manage grant is Course-scoped", async (method) => {
    const { service } = harness([grant("roles.manage", "COURSE", "c1")], {
      programme: [],
      course: [],
      cohort: [],
    });
    await expect(service[method]()).rejects.toThrow();
  });

  it.each(METHODS)("%s succeeds with a GLOBAL grant", async (method) => {
    const { service } = harness([grant("roles.manage")], { programme: [], course: [], cohort: [] });
    await expect(service[method]()).resolves.toEqual([]);
  });

  it("maps a programme row to exactly the three ScopeTarget keys", async () => {
    const { service } = harness([grant("roles.manage")], {
      programme: [{ id: "p1", title: "Data Analytics", slug: "data-analytics" }],
      course: [],
      cohort: [],
    });
    const [target] = await service.programmes();
    expect(Object.keys(target).sort()).toEqual(["id", "identifier", "label"]);
    expect(target).toEqual({ id: "p1", label: "Data Analytics", identifier: "data-analytics" });
  });

  it("maps a course row to exactly the three ScopeTarget keys", async () => {
    const { service } = harness([grant("roles.manage")], {
      programme: [],
      course: [{ id: "c1", title: "Intro to SQL", slug: "intro-sql" }],
      cohort: [],
    });
    const [target] = await service.courses();
    expect(Object.keys(target).sort()).toEqual(["id", "identifier", "label"]);
  });

  it("maps a cohort row's identifier from code, not slug", async () => {
    const { service } = harness([grant("roles.manage")], {
      programme: [],
      course: [],
      cohort: [{ id: "ch1", title: "March Cohort", code: "CH-2603-A" }],
    });
    const [target] = await service.cohorts();
    expect(target).toEqual({ id: "ch1", label: "March Cohort", identifier: "CH-2603-A" });
  });

  it.each(METHODS)("%s passes SCOPE_TARGET_LIMIT as the take argument", async (method) => {
    const { service, store } = harness([grant("roles.manage")], {
      programme: [],
      course: [],
      cohort: [],
    });
    await service[method]();
    const delegate = store[method === "programmes" ? "programme" : method === "courses" ? "course" : "cohort"];
    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: SCOPE_TARGET_LIMIT }),
    );
  });

  it.each(METHODS)("%s returns an empty array when the store returns no rows", async (method) => {
    const { service } = harness([grant("roles.manage")], { programme: [], course: [], cohort: [] });
    await expect(service[method]()).resolves.toEqual([]);
  });

  it("passes the query argument as a case-insensitive title filter", async () => {
    const { service, store } = harness([grant("roles.manage")], {
      programme: [],
      course: [],
      cohort: [],
    });
    await service.programmes("data");
    expect(store.programme.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { title: { contains: "data", mode: "insensitive" } },
      }),
    );
  });
});
