/**
 * Plan 11-05: the CertificateTemplate authoring service — CRUD, layout
 * validation at the write boundary (V5), and the single-default invariant.
 *
 * Driven by in-memory fake delegates plus a harness-built `withPermission`
 * (`createTestWithPermission` — GLOBAL grants only, since templates are a
 * single, institution-wide library, D-10). No real Postgres: layout
 * rejection, the archive-the-only-default guard, the default-swap
 * transaction and every denial case are all provable against fakes.
 */

import { describe, expect, it, vi } from "vitest";
import { createTestWithPermission, grant } from "./support/harness";
import {
  createCertificateTemplateService,
  DefaultTemplateRequiredError,
  ArchivedTemplateError,
  type CertificateTemplateRecord,
  type CertificateTemplateTx,
} from "@/server/services/certificate-template-service";
import { UnsupportedCertificateLayoutError, EMPTY_LAYOUT_V1 } from "@/server/services/certificate-template-layout";
import { AuthorizationError } from "@/server/permissions/with-permission";
import { type Delegate } from "@/server/services/resource-service";
import type { RawGrant } from "@/server/permissions/with-permission";

const VALID_LAYOUT = {
  schema: 1,
  pageSize: "A4",
  orientation: "landscape",
  elements: [
    {
      kind: "text",
      field: "learnerName",
      x: 40,
      y: 400,
      width: 400,
      height: 40,
      fontSize: 20,
      color: "#000000",
      align: "left",
    },
  ],
};

const MALFORMED_LAYOUT = {
  schema: 1,
  pageSize: "A4",
  orientation: "landscape",
  elements: [{ kind: "sparkle", x: 0, y: 0 }],
};

function makeTemplateRow(
  overrides: Partial<CertificateTemplateRecord> = {},
): CertificateTemplateRecord {
  return {
    id: "tpl-1",
    name: "Default certificate",
    layout: VALID_LAYOUT,
    layoutSchemaVersion: 1,
    isDefault: false,
    archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeTemplateDelegate(initial: CertificateTemplateRecord[] = []) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]));
  let nextId = initial.length + 1;

  const delegate: Delegate<CertificateTemplateRecord> = {
    findMany: vi.fn(async ({ where }: { where?: unknown } = {}) => {
      const all = [...rows.values()];
      const filter = where as { archivedAt?: null } | undefined;
      if (filter && "archivedAt" in filter && filter.archivedAt === null) {
        return all.filter((row) => row.archivedAt === null);
      }
      return all;
    }),
    findUnique: vi.fn(async ({ where }) => rows.get(where.id) ?? null),
    create: vi.fn(async ({ data }) => {
      const row = {
        id: `tpl-${nextId++}`,
        isDefault: false,
        archivedAt: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        ...(data as Partial<CertificateTemplateRecord>),
      } as CertificateTemplateRecord;
      rows.set(row.id, row);
      return row;
    }),
    update: vi.fn(async ({ where, data }) => {
      const existing = rows.get(where.id);
      if (!existing) throw new Error("not found");
      const next = { ...existing, ...(data as Partial<CertificateTemplateRecord>) };
      rows.set(where.id, next);
      return next;
    }),
  };

  return { delegate, rows };
}

function makeTx(
  delegate: Delegate<CertificateTemplateRecord>,
  rows: Map<string, CertificateTemplateRecord>,
): CertificateTemplateTx {
  return {
    certificateTemplate: {
      findUnique: vi.fn(async ({ where }) => delegate.findUnique({ where })),
      updateMany: vi.fn(async ({ where, data }) => {
        let count = 0;
        for (const [id, row] of rows) {
          if ((where as { isDefault?: boolean }).isDefault === true && row.isDefault === true) {
            rows.set(id, { ...row, ...(data as Partial<CertificateTemplateRecord>) });
            count += 1;
          }
        }
        return { count };
      }),
      update: vi.fn(async ({ where, data }) => delegate.update({ where, data })),
    },
  };
}

function harness(opts?: { templateRows?: CertificateTemplateRecord[]; grants?: RawGrant[] }) {
  const { delegate, rows } = makeTemplateDelegate(opts?.templateRows ?? []);
  const tx = makeTx(delegate, rows);
  const audits: Array<Record<string, unknown>> = [];
  const { withPermission } = createTestWithPermission(
    opts?.grants ?? [grant("certificates.view"), grant("certificates.manage")],
  );

  const built = createCertificateTemplateService({
    delegate,
    db: { $transaction: async (fn) => fn(tx) },
    withPermission,
    audit: async (entry) => {
      audits.push(entry as unknown as Record<string, unknown>);
    },
  });

  return { ...built, delegate, rows, tx, audits };
}

describe("certificateTemplateService.create", () => {
  it("persists a valid layout and returns the row, with an audit entry carrying actor + record", async () => {
    const { certificateTemplateService, audits } = harness();

    const created = await certificateTemplateService.create({ name: "New template", layout: VALID_LAYOUT });

    expect(created.name).toBe("New template");
    expect(created.layoutSchemaVersion).toBe(1);
    expect(audits[0]).toMatchObject({
      action: "certificatetemplate.created",
      actorId: "user-1",
    });
    expect((audits[0].after as CertificateTemplateRecord).id).toBe(created.id);
  });

  it("rejects a layout with an unrecognised element kind, and writes no row", async () => {
    const { certificateTemplateService, delegate, rows } = harness();

    await expect(
      certificateTemplateService.create({ name: "Bad template", layout: MALFORMED_LAYOUT }),
    ).rejects.toThrow(UnsupportedCertificateLayoutError);
    expect(delegate.create).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
  });

  it("stores EMPTY_LAYOUT_V1 when no layout is supplied", async () => {
    const { certificateTemplateService } = harness();

    const created = await certificateTemplateService.create({ name: "Blank template" });

    expect(created.layout).toEqual(EMPTY_LAYOUT_V1);
    expect(created.layoutSchemaVersion).toBe(EMPTY_LAYOUT_V1.schema);
  });

  it("denies create for an actor lacking certificates.manage", async () => {
    const { certificateTemplateService } = harness({ grants: [grant("certificates.view")] });

    await expect(
      certificateTemplateService.create({ name: "Nope", layout: VALID_LAYOUT }),
    ).rejects.toThrow(AuthorizationError);
  });
});

describe("certificateTemplateService.update", () => {
  it("rejects a malformed layout and leaves the stored layout unchanged", async () => {
    const { certificateTemplateService } = harness({
      templateRows: [makeTemplateRow({ id: "tpl-1", layout: VALID_LAYOUT })],
    });

    await expect(
      certificateTemplateService.update("tpl-1", { layout: MALFORMED_LAYOUT }),
    ).rejects.toThrow(UnsupportedCertificateLayoutError);

    const reloaded = await certificateTemplateService.get("tpl-1");
    expect(reloaded?.layout).toEqual(VALID_LAYOUT);
  });

  it("leaves the layout untouched when the update omits it entirely (rename-only edit)", async () => {
    const { certificateTemplateService } = harness({
      templateRows: [makeTemplateRow({ id: "tpl-1", name: "Old name", layout: VALID_LAYOUT })],
    });

    const updated = await certificateTemplateService.update("tpl-1", { name: "New name" });

    expect(updated.name).toBe("New name");
    expect(updated.layout).toEqual(VALID_LAYOUT);
  });

  it("denies update for an actor lacking certificates.manage", async () => {
    const { certificateTemplateService } = harness({
      templateRows: [makeTemplateRow({ id: "tpl-1" })],
      grants: [grant("certificates.view")],
    });

    await expect(
      certificateTemplateService.update("tpl-1", { name: "x" }),
    ).rejects.toThrow(AuthorizationError);
  });
});

describe("setDefaultTemplate", () => {
  it("makes exactly one row isDefault: true, clearing the previous default in the same transaction", async () => {
    const { setDefaultTemplate, rows } = harness({
      templateRows: [
        makeTemplateRow({ id: "tpl-1", isDefault: true }),
        makeTemplateRow({ id: "tpl-2", isDefault: false }),
      ],
    });

    await setDefaultTemplate("tpl-2");

    expect(rows.get("tpl-1")?.isDefault).toBe(false);
    expect(rows.get("tpl-2")?.isDefault).toBe(true);
    const defaults = [...rows.values()].filter((row) => row.isDefault);
    expect(defaults).toHaveLength(1);
  });

  it("audits before/after with the actor id", async () => {
    const { setDefaultTemplate, audits } = harness({
      templateRows: [
        makeTemplateRow({ id: "tpl-1", isDefault: true }),
        makeTemplateRow({ id: "tpl-2", isDefault: false }),
      ],
    });

    await setDefaultTemplate("tpl-2");

    expect(audits[0]).toMatchObject({
      action: "certificatetemplate.default_set",
      actorId: "user-1",
      before: { isDefault: false },
      after: { isDefault: true },
    });
  });

  it("rejects setting an archived template as default", async () => {
    const { setDefaultTemplate } = harness({
      templateRows: [
        makeTemplateRow({ id: "tpl-1", isDefault: true }),
        makeTemplateRow({ id: "tpl-2", isDefault: false, archivedAt: new Date("2026-02-01T00:00:00.000Z") }),
      ],
    });

    await expect(setDefaultTemplate("tpl-2")).rejects.toThrow(ArchivedTemplateError);
  });

  it("denies setDefaultTemplate for an actor lacking certificates.manage", async () => {
    const { setDefaultTemplate } = harness({
      templateRows: [makeTemplateRow({ id: "tpl-1" })],
      grants: [grant("certificates.view")],
    });

    await expect(setDefaultTemplate("tpl-1")).rejects.toThrow(AuthorizationError);
  });
});

describe("certificateTemplateService.archive", () => {
  it("sets archivedAt and never deletes the row — get(id) still returns it", async () => {
    const { certificateTemplateService } = harness({
      templateRows: [makeTemplateRow({ id: "tpl-1", isDefault: false })],
    });

    const archived = await certificateTemplateService.archive("tpl-1", "No longer used");
    expect(archived.archivedAt).toBeInstanceOf(Date);

    const reloaded = await certificateTemplateService.get("tpl-1");
    expect(reloaded).not.toBeNull();
    expect(reloaded?.archivedAt).toBeInstanceOf(Date);
  });

  it("rejects archiving the only isDefault template", async () => {
    const { certificateTemplateService, delegate } = harness({
      templateRows: [makeTemplateRow({ id: "tpl-1", isDefault: true })],
    });

    await expect(
      certificateTemplateService.archive("tpl-1", "No longer used"),
    ).rejects.toThrow(DefaultTemplateRequiredError);
    expect(delegate.update).not.toHaveBeenCalled();
  });

  it("denies archive for an actor lacking certificates.manage", async () => {
    const { certificateTemplateService } = harness({
      templateRows: [makeTemplateRow({ id: "tpl-1", isDefault: false })],
      grants: [grant("certificates.view")],
    });

    await expect(
      certificateTemplateService.archive("tpl-1", "No longer used"),
    ).rejects.toThrow(AuthorizationError);
  });
});

describe("listSelectableTemplates", () => {
  it("excludes archived templates, while the factory's own list() still returns them", async () => {
    const { listSelectableTemplates, certificateTemplateService } = harness({
      templateRows: [
        makeTemplateRow({ id: "tpl-1", archivedAt: null }),
        makeTemplateRow({ id: "tpl-2", archivedAt: new Date("2026-02-01T00:00:00.000Z") }),
      ],
    });

    const selectable = await listSelectableTemplates();
    expect(selectable.map((row) => row.id)).toEqual(["tpl-1"]);

    const all = await certificateTemplateService.list();
    expect(all.map((row) => row.id).sort()).toEqual(["tpl-1", "tpl-2"]);
  });
});
