/**
 * The pg-boss job queue — a lazily-initialised singleton.
 *
 * WORKER REACH (plan 04-10): the scan worker imports this module. It MUST NOT
 * import the request-scoped permission module (`src/server/permissions/*`) or
 * anything that reads the request session cookie — a worker process has no
 * request. There is no reason for this module to reach the permission layer;
 * keep it that way.
 *
 * NOT a transactional enqueue. pg-boss's `fromPrisma` adapter requires Prisma
 * v7+ with `@prisma/adapter-pg`, and this project pins 6.19.3. So the
 * `LessonResource` row commits FIRST and `enqueueScan` follows — a crash
 * between the two loses the job. That is exactly what
 * `findStuckPendingAsSystem` (scan-system-service.ts) plus plan 04-10's
 * reconciliation cron exist to recover. Do not "optimise away" the
 * reconciliation path believing this enqueue is atomic — it is not.
 *
 * pg-boss v12 notes (verified against the installed `dist/index.d.ts`):
 *   - ESM-only, named `PgBoss` export — NOT a default export.
 *   - `createQueue(name)` must be called before `send(name, ...)`.
 */

import { PgBoss } from "pg-boss";

/** The scan queue name — plan 04-10's worker imports this, so a typo here
 * cannot split the queue in two. */
export const SCAN_QUEUE = "lesson-resource.scan";

/** The reconciliation queue name — plan 04-10 schedules the cron that drains it. */
export const RECONCILE_QUEUE = "lesson-resource.reconcile";

/** The hold-sweep queue name (plan 05-09) — a typo here cannot split the
 * queue in two since every reader imports this constant. */
export const HOLD_SWEEP_QUEUE = "enrolment.hold-sweep";

let bossPromise: Promise<PgBoss> | null = null;

async function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    bossPromise = (async () => {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) {
        throw new Error("DATABASE_URL is required to start the job queue.");
      }
      const boss = new PgBoss(connectionString);
      // A pg-boss 'error' event with no listener is an unhandled exception that
      // crashes the process. Log and continue; the reconciliation cron is the
      // recovery path for anything a transient failure loses here.
      boss.on("error", (err) => {
        console.error("[pg-boss] error", err);
      });
      await boss.start();
      return boss;
    })();
  }
  return bossPromise;
}

/**
 * Enqueue a virus scan for a freshly-uploaded resource. Creates the queue
 * idempotently before sending, so a fresh database needs no migration step.
 */
export async function enqueueScan(lessonResourceId: string): Promise<void> {
  const boss = await getBoss();
  await boss.createQueue(SCAN_QUEUE);
  await boss.send(SCAN_QUEUE, { lessonResourceId });
}
