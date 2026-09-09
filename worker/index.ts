import { PgBoss } from "pg-boss";
import { HOLD_SWEEP_QUEUE, RECONCILE_QUEUE, SCAN_QUEUE } from "@/server/jobs/queue";
import { reconcileLessonResources } from "./handlers/reconcile-lesson-resources";
import { releaseExpiredHolds } from "./handlers/release-expired-holds";
import { scanLessonResource } from "./handlers/scan-lesson-resource";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to start the worker.");
}

const boss = new PgBoss(connectionString);
let stopping = false;

boss.on("error", (error) => {
  console.error("[worker] pg-boss error", error);
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.info(`[worker] ${signal} received; waiting for in-flight jobs`);
  try {
    await boss.stop({ graceful: true, timeout: 120_000 });
    process.exitCode = 0;
  } catch (error) {
    console.error("[worker] failed to stop cleanly", error);
    process.exitCode = 1;
  }
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

async function main(): Promise<void> {
  await boss.start();
  await boss.createQueue(SCAN_QUEUE);
  await boss.createQueue(RECONCILE_QUEUE);
  // Bounded retry (T-05-59): a poison row must not hammer the database
  // indefinitely. retryBackoff spaces out the (at most 3) retries instead of
  // hammering on a fixed cadence.
  await boss.createQueue(HOLD_SWEEP_QUEUE, {
    retryLimit: 3,
    retryBackoff: true,
  });

  await boss.work<{ lessonResourceId: string }>(SCAN_QUEUE, async ([job]) => {
    if (!job?.data.lessonResourceId) {
      throw new Error("Scan job is missing lessonResourceId.");
    }
    await scanLessonResource(job.data.lessonResourceId);
  });
  await boss.work(RECONCILE_QUEUE, async ([job]) => {
    if (!job) throw new Error("Reconciliation handler received no job.");
    await reconcileLessonResources();
  });
  await boss.work(HOLD_SWEEP_QUEUE, async ([job]) => {
    if (!job) throw new Error("Hold-sweep handler received no job.");
    await releaseExpiredHolds();
  });
  await boss.schedule(RECONCILE_QUEUE, "*/5 * * * *");
  await boss.schedule(HOLD_SWEEP_QUEUE, "*/5 * * * *");

  console.info(
    `[worker] queues ready: ${SCAN_QUEUE}, ${RECONCILE_QUEUE}, ${HOLD_SWEEP_QUEUE}`,
  );
}

main().catch((error: unknown) => {
  console.error("[worker] failed to start", error);
  process.exitCode = 1;
});
