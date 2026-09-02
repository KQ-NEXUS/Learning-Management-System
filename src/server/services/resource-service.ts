/**
 * The resource service factory.
 *
 * Most of the PRD's domains — courses, modules, lessons, cohorts, tickets —
 * are the same shape: list, get, create, update, archive, each gated by a
 * permission and a scope, each auditing what it changed. Writing that per
 * domain produces a dozen chances to forget the scope check or the audit row.
 * Writing it once produces one.
 *
 * Two behaviours are deliberate and worth knowing before you use this:
 *
 *   1. There is no delete. PRD CAT-08 requires archiving that preserves
 *      historical enrolments, results, and certificates.
 *
 *   2. `list` with no scope requires a GLOBAL grant. A scoped user must say
 *      which scope they are listing within. This is deny-by-default applied
 *      to collections: the alternative — listing everything and filtering
 *      afterwards — leaks row counts and is the classic way scoped access
 *      becomes global access.
 */

import type { Permission } from "@/server/permissions/catalogue";
import type { ResourceScope } from "@/server/permissions/scope";
import type { createWithPermission } from "@/server/permissions/with-permission";

type WithPermission = ReturnType<typeof createWithPermission>;

/** The subset of a Prisma model delegate this factory uses. */
export type Delegate<T> = {
  findMany(args: { where?: unknown }): Promise<T[]>;
  findUnique(args: { where: { id: string } }): Promise<T | null>;
  create(args: { data: Record<string, unknown> }): Promise<T>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<T>;
};

export type ResourceAuditEntry = {
  action: string;
  targetType: string;
  targetId: string | null;
  actorId: string;
  outcome: string;
  reason: string | null;
  before?: unknown;
  after?: unknown;
};

/**
 * Thrown when a payload builder's write loses a race against another writer
 * for the same position slot.
 *
 * The `@@unique([parent, position])` index — not this transaction, not this
 * retry — is what makes two rows sharing a slot impossible: the second
 * writer's `update` is REJECTED by Postgres with `P2002`. That outcome is
 * fail-safe already. What this error exists for is to make the loser's
 * experience sane: `archive`/`restore` catch a `P2002`, retry the payload
 * build and update exactly once against fresh data, and only throw this
 * typed error if the retry *also* collides — which the caller can catch and
 * turn into "someone else changed this list — reload and try again" instead
 * of a raw Prisma error string.
 */
export class PositionContentionError extends Error {
  constructor(
    message = "Someone else changed this list — reload and try again.",
  ) {
    super(message);
    this.name = "PositionContentionError";
  }
}

/**
 * True for a Prisma `PrismaClientKnownRequestError` with code `P2002`
 * (unique-constraint violation), duck-typed on `code` rather than an
 * `instanceof` check — the factory stays free of a Prisma client import so
 * it can be unit-tested with a fake delegate and used from a folder the
 * ESLint boundary rule does not exempt for Prisma imports otherwise.
 */
function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

export type ResourceServiceConfig<T> = {
  /** Used for audit action names and target type, e.g. "Course". */
  name: string;
  delegate: Delegate<T>;
  permissions: {
    view: Permission;
    create: Permission;
    edit: Permission;
  };
  /**
   * Maps a record id to the scope a grant must match to reach it.
   *
   * May return a Promise. Course's scope IS the record — `toScope: (id) =>
   * ({ courseIds: [id] })` — but a Module or Lesson has no scope of its own;
   * its parent Course id can only be known by reading the row from the
   * database. A caller-supplied parent id would be a scope the caller
   * *asserted*, which `with-permission.ts` explicitly warns against
   * ("Resolved before the check so the scope reflects the real record and
   * its parents, not something the caller asserted"). `withPermission`'s own
   * `ScopeResolver` already accepts `ResourceScope | Promise<ResourceScope>`,
   * so widening this field only extends the factory's type — the
   * authorization core in `src/server/permissions/**` does not change.
   */
  toScope: (id: string) => ResourceScope | Promise<ResourceScope>;
  withPermission: WithPermission;
  audit: (entry: ResourceAuditEntry) => Promise<void>;
  /**
   * Overrides the archive write. Default: `{ status: "ARCHIVED" }`, exactly
   * today's behaviour.
   *
   * `Module` and `Lesson` have no `status` column at all — D-17 gives them
   * `withdrawnAt` instead — and Phase 12's `TicketAttachment` will hit the
   * same wall. May be async because withdrawing must park the row below
   * every live sibling (`src/lib/positions.ts`'s `parkedWithdrawnPosition`),
   * which requires a query a synchronous `() => ({...})` cannot express.
   * Receives the record id.
   */
  archiveData?: (
    id: string,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /**
   * Enables a `restore` operation on the returned service. Absent by
   * default — a service configured without `restoreData` exposes no
   * `restore` at all (Course un-archives through ordinary `update` back to
   * DRAFT per D-16; it has no withdrawn band to restore from).
   *
   * D-34 requires a withdrawn Module or Lesson to be recoverable through the
   * product, but restoring must NOT return the row to its original
   * position — that slot is very likely occupied by now, and the position
   * index is total, so the naive `{ withdrawnAt: null }` payload is a
   * unique-violation waiting to happen. Must be async for the same reason
   * as `archiveData`: computing the append slot
   * (`src/lib/positions.ts`'s `nextAppendPosition`) requires a query.
   * Receives the record id.
   */
  restoreData?: (
    id: string,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /**
   * Groups the read-before-write, the payload build and the update for
   * `archive`/`restore` into one unit of work, so a failed write cannot
   * leave a half-applied audit trail. Injected rather than imported so this
   * factory stays free of a Prisma client import; the caller supplies
   * `(fn) => prisma.$transaction(fn)`.
   *
   * Be precise about what this does NOT do: it is not the concurrency
   * guarantee. The payload builder's sibling query is an ordinary read
   * inside the transaction; two concurrent restores can both observe the
   * same `max(position)` and both compute the same landing slot, and no
   * isolation level short of SERIALIZABLE would serialise two identical
   * read-compute-write sequences anyway. The `@@unique([parent, position])`
   * index is the actual guarantee — see `PositionContentionError`.
   *
   * When omitted, `archive`/`restore` behave exactly as they do today: no
   * transaction wrapper, so `course-service.ts` needs no change.
   */
  runInTransaction?: <R>(fn: () => Promise<R>) => Promise<R>;
};

/** The operations every resource service exposes, restore aside. */
type ServiceBase<T> = {
  list: (input?: { where?: unknown; scope?: ResourceScope }) => Promise<T[]>;
  get: (id: string) => Promise<T | null>;
  create: (data: Record<string, unknown>) => Promise<T>;
  update: (id: string, data: Record<string, unknown>, reason?: string) => Promise<T>;
  archive: (id: string, reason: string) => Promise<T>;
};

/** Adds `restore` — only present when the config supplies `restoreData`. */
type ServiceWithRestore<T> = ServiceBase<T> & {
  restore: (id: string, reason: string) => Promise<T>;
};

/**
 * `restore` is present on the returned object's *type* only when the config
 * passed in actually supplies `restoreData` — a conditional return type
 * keyed off `C["restoreData"]`, chosen over two exported factory entry
 * points so every caller still imports one `createResourceService`. Calling
 * `.restore` on a service built without `restoreData` is therefore a
 * compile-time type error, and at runtime the property is `undefined`
 * (never a silently-present no-op).
 */
export function createResourceService<
  T extends { id: string },
  C extends ResourceServiceConfig<T> = ResourceServiceConfig<T>,
>(
  config: C,
): C["restoreData"] extends (id: string) => unknown
  ? ServiceWithRestore<T>
  : ServiceBase<T> {
  const { name, delegate, permissions, toScope, withPermission, audit } = config;
  const slug = name.toLowerCase();
  const runInTransaction =
    config.runInTransaction ?? (<R,>(fn: () => Promise<R>) => fn());

  const list = withPermission<{ where?: unknown; scope?: ResourceScope }>(
    permissions.view,
    (input) => input.scope ?? {},
  )(async (input) => delegate.findMany({ where: input.where }));

  const get = withPermission<string>(permissions.view, (id) => toScope(id))(
    async (id) => delegate.findUnique({ where: { id } }),
  );

  const create = withPermission<Record<string, unknown>>(
    permissions.create,
    () => ({}),
  )(async (data, ctx) => {
    const created = await delegate.create({ data });
    await audit({
      action: `${slug}.created`,
      targetType: name,
      targetId: created.id,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: null,
      after: created,
    });
    return created;
  });

  const update = withPermission<{
    id: string;
    data: Record<string, unknown>;
    reason?: string;
  }>(permissions.edit, (input) => toScope(input.id))(async (input, ctx) => {
    // Read before writing so the audit row carries both states (RBAC-08).
    const before = await delegate.findUnique({ where: { id: input.id } });
    const after = await delegate.update({ where: { id: input.id }, data: input.data });

    await audit({
      action: `${slug}.updated`,
      targetType: name,
      targetId: input.id,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: input.reason ?? null,
      before,
      after,
    });
    return after;
  });

  /**
   * Runs `attempt` once, and if it fails with a unique-constraint collision
   * on the position index, once more against freshly read data. A second
   * consecutive collision means someone else is winning this race too
   * consistently to be a fluke, so it surfaces as a typed error the caller
   * can turn into a sensible message rather than a raw Prisma failure.
   */
  async function withPositionRetry<R>(attempt: () => Promise<R>): Promise<R> {
    try {
      return await runInTransaction(attempt);
    } catch (err) {
      if (!isUniqueConstraintViolation(err)) throw err;
      try {
        return await runInTransaction(attempt);
      } catch (retryErr) {
        if (isUniqueConstraintViolation(retryErr)) {
          throw new PositionContentionError();
        }
        throw retryErr;
      }
    }
  }

  const archive = withPermission<{ id: string; reason: string }>(
    permissions.edit,
    (input) => toScope(input.id),
  )(async (input, ctx) => {
    const { before, after } = await withPositionRetry(async () => {
      const beforeRow = await delegate.findUnique({ where: { id: input.id } });
      const data = (await config.archiveData?.(input.id)) ?? { status: "ARCHIVED" };
      const afterRow = await delegate.update({ where: { id: input.id }, data });
      return { before: beforeRow, after: afterRow };
    });

    await audit({
      action: `${slug}.archived`,
      targetType: name,
      targetId: input.id,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: input.reason,
      before,
      after,
    });
    return after;
  });

  // Only built — and only exposed below — when the caller supplied
  // restoreData. A service with no withdrawn band (Course) gets no restore.
  const restore = config.restoreData
    ? withPermission<{ id: string; reason: string }>(
        permissions.edit,
        (input) => toScope(input.id),
      )(async (input, ctx) => {
        const restoreData = config.restoreData!;
        const { before, after } = await withPositionRetry(async () => {
          const beforeRow = await delegate.findUnique({ where: { id: input.id } });
          const data = await restoreData(input.id);
          const afterRow = await delegate.update({ where: { id: input.id }, data });
          return { before: beforeRow, after: afterRow };
        });

        await audit({
          action: `${slug}.restored`,
          targetType: name,
          targetId: input.id,
          actorId: ctx.actor.userId,
          outcome: "SUCCESS",
          reason: input.reason,
          before,
          after,
        });
        return after;
      })
    : undefined;

  const service: ServiceBase<T> & { restore?: (id: string, reason: string) => Promise<T> } = {
    list: (input: { where?: unknown; scope?: ResourceScope } = {}) => list(input),
    get: (id: string) => get(id),
    create: (data: Record<string, unknown>) => create(data),
    update: (id: string, data: Record<string, unknown>, reason?: string) =>
      update({ id, data, reason }),
    archive: (id: string, reason: string) => archive({ id, reason }),
  };
  if (restore) {
    service.restore = (id: string, reason: string) => restore({ id, reason });
  }

  return service as C["restoreData"] extends (id: string) => unknown
    ? ServiceWithRestore<T>
    : ServiceBase<T>;
}
