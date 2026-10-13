/**
 * `npx tsx scripts/ops/run-task.ts <task-name> [--target local|staging]`
 *
 * Runs one scheduled task from `src/server/scheduled` once, the same way its
 * Netlify function does (Phase 15, plan 15-15; RESEARCH Pitfall 9). Netlify
 * scheduled functions do not run on a local server or on a deploy preview, so
 * the browser journey and the staging run call this to drain email, dispatch
 * exports, reconcile payments and so on, on demand.
 *
 * The database guard runs FIRST, before any task module (and so before Prisma)
 * is imported: a shell carrying the shared database URL refuses to run. The
 * default target is `local`; `staging` additionally needs the host in
 * STAGING_DATABASE_HOSTS and ALLOW_STAGING_DATABASE=1 (see db-target-guard.ts).
 *
 * Valid names are the Netlify function names, plus `process-export-jobs`, which
 * is the in-process form of the `process-export-jobs-background` function (that
 * function is an HTTP-triggered background function, so it is not run by name).
 */

import { assertSafeDatabaseUrl, type DatabaseTarget } from "./db-target-guard";

type TaskLoader = () => Promise<() => Promise<void>>;

/** Task name to a lazy loader. Nothing here imports a task until it is chosen. */
export const TASK_LOADERS: Readonly<Record<string, TaskLoader>> = {
  "check-licence": async () => (await import("../../src/server/scheduled/check-licence-task")).runCheckLicenceTask,
  "cleanup-notifications": async () =>
    (await import("../../src/server/scheduled/cleanup-notifications-task")).runCleanupNotificationsTask,
  "cleanup-stale-uploads": async () =>
    (await import("../../src/server/scheduled/cleanup-stale-uploads-task")).runCleanupStaleUploadsTask,
  "close-resolved-tickets": async () =>
    (await import("../../src/server/scheduled/close-resolved-tickets-task")).runCloseResolvedTicketsTask,
  "dispatch-export-jobs": async () =>
    (await import("../../src/server/scheduled/dispatch-export-jobs-task")).runDispatchExportJobsTask,
  "drain-domain-events": async () =>
    (await import("../../src/server/scheduled/drain-domain-events-task")).runDrainDomainEventsTask,
  "expire-export-jobs": async () =>
    (await import("../../src/server/scheduled/expire-export-jobs-task")).runExpireExportJobsTask,
  "process-export-jobs": async () =>
    (await import("../../src/server/scheduled/process-export-jobs-task")).runProcessExportJobsTask,
  "reconcile-payments": async () =>
    (await import("../../src/server/scheduled/reconcile-payments-task")).runReconcilePaymentsTask,
  "release-expired-holds": async () =>
    (await import("../../src/server/scheduled/release-expired-holds-task")).runReleaseExpiredHoldsTask,
};

export const TASK_NAMES: readonly string[] = Object.keys(TASK_LOADERS);

export type ParsedArgs = { name: string; target: DatabaseTarget };

/** Parses `<name> [--target local|staging]`; throws a plain Error with the valid names on a bad name. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let name: string | undefined;
  let target: DatabaseTarget = "local";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") {
      const value = argv[i + 1];
      if (value !== "local" && value !== "staging") {
        throw new Error('--target must be "local" or "staging".');
      }
      target = value;
      i += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option ${arg}.`);
    } else if (name === undefined) {
      name = arg;
    } else {
      throw new Error("Give exactly one task name.");
    }
  }

  if (name === undefined || !Object.hasOwn(TASK_LOADERS, name)) {
    throw new Error(
      `${name === undefined ? "No task name given" : `Unknown task "${name}"`}. Valid tasks: ${TASK_NAMES.join(", ")}.`,
    );
  }
  return { name, target };
}

export type RunTaskDeps = {
  env?: Record<string, string | undefined>;
  loaders?: Readonly<Record<string, TaskLoader>>;
};

/**
 * Resolves the task, applies the database guard, and only then loads and runs
 * the task module. Throws on an unknown name or a refused database target.
 */
export async function runTaskCli(argv: readonly string[], deps: RunTaskDeps = {}): Promise<void> {
  const env = deps.env ?? process.env;
  const loaders = deps.loaders ?? TASK_LOADERS;
  const { name, target } = parseArgs(argv);

  assertSafeDatabaseUrl(env.DATABASE_URL, { target, env });

  const run = await loaders[name]();
  await run();
}

function isMain(): boolean {
  return Boolean(process.argv[1]) && /run-task\.(ts|js|cjs|mjs)$/.test(process.argv[1].replace(/\\/g, "/"));
}

/**
 * Leaves the process without tripping the Windows/libuv "handle is closing"
 * assertion (exit code 3221226505), which fires when `process.exit` runs while a
 * socket from the finished task is still being torn down. The task itself has
 * succeeded by then, but the browser journey reads the exit code, so a crash here
 * would fail a healthy run. Closing the database client first and exiting one
 * timer later lets those handles finish closing.
 */
function exitLater(code: number): void {
  setTimeout(() => process.exit(code), 150);
}

if (isMain()) {
  runTaskCli(process.argv.slice(2))
    .then(async () => {
      // The guard has passed and the task has run, so the client already exists: close it cleanly.
      try {
        const { prisma } = await import("../../src/server/db");
        await prisma.$disconnect();
      } catch {
        // Nothing useful to do: the task result is already decided.
      }
      exitLater(0);
    })
    .catch((error: unknown) => {
      // The message from the guard and the parser names hosts and tasks only.
      console.error(error instanceof Error ? error.message : "The task failed.");
      exitLater(1);
    });
}
