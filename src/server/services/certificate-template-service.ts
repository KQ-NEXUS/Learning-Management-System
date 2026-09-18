/**
 * Certificate-template authoring (D-09, D-10, CRD-03).
 *
 * Base CRUD (`list`/`get`/`create`/`update`/`archive`) comes from
 * `createResourceService` — a service that re-implements scope checks,
 * permission gating or auditing is doing it wrong (`course-service.ts:5-7`).
 * What lives here on top of the factory is what it has no concept of:
 *
 *   1. Layout validation (ASVS V5) — `parseCertificateTemplateLayout` runs on
 *      the incoming `layout` before the delegate write on both `create` and
 *      `update`, so the store can never hold a blob the renderer cannot
 *      draw. A `create` with no `layout` supplied stores `EMPTY_LAYOUT_V1`;
 *      an `update` that omits `layout` entirely leaves the stored layout
 *      untouched rather than silently blanking it (Rule 1 — a rename-only
 *      edit must never wipe a working layout).
 *
 *   2. `setDefaultTemplate` — a transactional two-step default-swap the
 *      factory has no concept of. Rejects an archived target.
 *
 *   3. `listSelectableTemplates` — `archivedAt: null` only, for the
 *      Course/Programme picker (plan 11-08) and the editor's "load
 *      template" surfaces. Kept separate from the factory's own `list` so
 *      the templates-list page can still show archived rows read-only
 *      (UI-SPEC §7.3.1).
 *
 *   4. The archive-the-only-default guard (`DefaultTemplateRequiredError`),
 *      wired through the factory's own `archiveData` hook so it runs AFTER
 *      the permission check (T-11-18) — D-10's "defaults to whichever
 *      template is marked default" must never resolve to null.
 *
 * Templates are a single, institution-wide library (D-10), not scoped to a
 * Programme or Course — `certificateTemplateScope` always returns `{}`,
 * reachable only by a GLOBAL grant, the same pattern `roleScope()` uses in
 * `role-service.ts`.
 *
 * No hard deletes anywhere in this file (CAT-08, T-11-20) — `archive` only
 * ever sets `archivedAt`; an archived template stays readable by
 * already-issued certificates (Pitfall 5), it is only removed from future
 * *selection*.
 */

import { prisma } from "@/server/db";
import { withPermission as liveWithPermission } from "@/server/permissions";
import type { createWithPermission } from "@/server/permissions/with-permission";
import type { ResourceScope } from "@/server/permissions/scope";
import { recordAudit } from "@/server/services/audit-service";
import {
  createResourceService,
  type Delegate,
  type ResourceAuditEntry,
} from "./resource-service";
import {
  parseCertificateTemplateLayout,
  EMPTY_LAYOUT_V1,
} from "./certificate-template-layout";

type WithPermissionFn = ReturnType<typeof createWithPermission>;

export type CertificateTemplateRecord = {
  id: string;
  name: string;
  layout: unknown;
  layoutSchemaVersion: number;
  isDefault: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Templates are a single, global library (D-10) — reachable only by a GLOBAL grant. */
export function certificateTemplateScope(): ResourceScope {
  return {};
}

/**
 * `archive` was refused because the target is the only template marked
 * `isDefault` — archiving it would leave D-10's Course/Programme fallback
 * selection with nothing to resolve to (T-11-18).
 */
export class DefaultTemplateRequiredError extends Error {
  constructor(
    message = "At least one certificate template must stay marked as default. Mark a different template as default before archiving this one.",
  ) {
    super(message);
    this.name = "DefaultTemplateRequiredError";
  }
}

/** `setDefaultTemplate` was called with an archived target — only a selectable template may become the default. */
export class ArchivedTemplateError extends Error {
  constructor(
    message = "An archived certificate template cannot be set as the default.",
  ) {
    super(message);
    this.name = "ArchivedTemplateError";
  }
}

/**
 * The transaction client `setDefaultTemplate` needs — structurally
 * satisfied by a Prisma `tx` and by a unit-test fake, mirroring
 * `AssessmentTx` (`assessment-service.ts`).
 */
export type CertificateTemplateTx = {
  certificateTemplate: {
    findUnique(args: {
      where: { id: string };
    }): Promise<CertificateTemplateRecord | null>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<CertificateTemplateRecord>;
  };
};

export type CreateCertificateTemplateServiceDeps = {
  delegate: Delegate<CertificateTemplateRecord>;
  db: {
    $transaction: <R>(fn: (tx: CertificateTemplateTx) => Promise<R>) => Promise<R>;
  };
  withPermission: WithPermissionFn;
  audit: (entry: ResourceAuditEntry) => Promise<void>;
};

/** `create`'s validated payload: a missing/absent `layout` stores `EMPTY_LAYOUT_V1`. */
function validatedCreateData(data: Record<string, unknown>): Record<string, unknown> {
  const layout =
    data.layout == null ? EMPTY_LAYOUT_V1 : parseCertificateTemplateLayout(data.layout);
  return { ...data, layout, layoutSchemaVersion: layout.schema };
}

/**
 * `update`'s validated payload: only re-validates and re-stamps
 * `layoutSchemaVersion` when the caller actually supplied a `layout` —
 * a rename-only edit that never mentions `layout` leaves it untouched.
 */
function validatedUpdateData(data: Record<string, unknown>): Record<string, unknown> {
  if (!("layout" in data) || data.layout == null) return data;
  const layout = parseCertificateTemplateLayout(data.layout);
  return { ...data, layout, layoutSchemaVersion: layout.schema };
}

export function createCertificateTemplateService(deps: CreateCertificateTemplateServiceDeps) {
  const baseService = createResourceService<CertificateTemplateRecord>({
    name: "CertificateTemplate",
    delegate: deps.delegate,
    permissions: {
      view: "certificates.view",
      create: "certificates.manage",
      edit: "certificates.manage",
    },
    toScope: certificateTemplateScope,
    withPermission: deps.withPermission,
    audit: deps.audit,
    // CertificateTemplate has no `status` column (the factory's default
    // `{ status: "ARCHIVED" }` payload would be a no-op write) — D-10 gives
    // it `archivedAt` instead. Runs inside the permission-gated closure
    // (resource-service.ts's `archive`), so the isDefault read below only
    // ever happens for an already-authorized actor.
    archiveData: async (id) => {
      const current = await deps.delegate.findUnique({ where: { id } });
      if (current?.isDefault) {
        throw new DefaultTemplateRequiredError();
      }
      return { archivedAt: new Date() };
    },
  });

  const certificateTemplateService = {
    ...baseService,
    create: async (data: Record<string, unknown>) => baseService.create(validatedCreateData(data)),
    update: async (id: string, data: Record<string, unknown>, reason?: string) =>
      baseService.update(id, validatedUpdateData(data), reason),
  };

  /**
   * Clears the current default and sets `id` as the new one inside one
   * transaction, so no read ever observes zero or two default templates.
   * Audits before/after explicitly (T-11-19), on top of — not instead of —
   * the factory's own audit-first path.
   */
  const setDefaultTemplateInternal = deps.withPermission<{ id: string }>(
    "certificates.manage",
    () => certificateTemplateScope(),
  )(async (input, ctx) => {
    const { before, after } = await deps.db.$transaction(async (tx) => {
      const target = await tx.certificateTemplate.findUnique({ where: { id: input.id } });
      if (!target) throw new Error("Certificate template not found.");
      if (target.archivedAt) throw new ArchivedTemplateError();

      await tx.certificateTemplate.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
      const after = await tx.certificateTemplate.update({
        where: { id: input.id },
        data: { isDefault: true },
      });
      return { before: target, after };
    });

    await deps.audit({
      action: "certificatetemplate.default_set",
      targetType: "CertificateTemplate",
      targetId: input.id,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: null,
      before: { isDefault: before.isDefault },
      after: { isDefault: after.isDefault },
    });
    return after;
  });

  /**
   * Selectable-only view for the Course/Programme picker (plan 11-08) and
   * the editor's "load template" surfaces (Pitfall 5) — excludes archived
   * rows without touching the factory's own `list`, which still returns
   * them so the templates-list page can render archived rows read-only
   * (UI-SPEC §7.3.1).
   */
  const listSelectableTemplatesInternal = deps.withPermission<Record<string, never>>(
    "certificates.view",
    () => certificateTemplateScope(),
  )(async () => deps.delegate.findMany({ where: { archivedAt: null } }));

  return {
    certificateTemplateService,
    setDefaultTemplate: (id: string) => setDefaultTemplateInternal({ id }),
    listSelectableTemplates: () => listSelectableTemplatesInternal({}),
  };
}

const built = createCertificateTemplateService({
  delegate: prisma.certificateTemplate as unknown as Delegate<CertificateTemplateRecord>,
  db: {
    $transaction: (fn) =>
      prisma.$transaction((tx) => fn(tx as unknown as CertificateTemplateTx)),
  },
  withPermission: liveWithPermission,
  audit: (entry) =>
    recordAudit({
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      before: entry.before,
      after: entry.after,
      reason: entry.reason,
      outcome: entry.outcome,
    }),
});

export const certificateTemplateService = built.certificateTemplateService;
export const setDefaultTemplate = built.setDefaultTemplate;
export const listSelectableTemplates = built.listSelectableTemplates;
