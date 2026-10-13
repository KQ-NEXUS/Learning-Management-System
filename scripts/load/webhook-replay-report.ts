/**
 * `npx tsx scripts/load/webhook-replay-report.ts --k6 <summary.json> [--pending file] [--out evidence.json]`
 *
 * After perf/webhook-replay.js has posted one signed charge.success event 10
 * times at once, this reads the (local) database and writes the evidence:
 *
 *   succeededAttempts  SUCCEEDED payment attempts for the order      (expect 1)
 *   processedEvents   PROCESSED WebhookEvent rows for the event id   (expect 1)
 *   duplicateEvents   acknowledged posts that produced no new effect (expect 9)
 *
 * The database-target guard runs before Prisma is imported (P1). Exit 0 when
 * the counts are exactly 1, 1 and the order is PAID; exit 1 otherwise.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertSafeDatabaseUrl } from "../ops/db-target-guard";

type Args = { k6: string; pending: string; out: string };

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    k6: "",
    pending: path.join("perf", "results", "pending-order.json"),
    out: path.join("perf", "results", "k6-webhook-replay-local.json"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if ((flag === "--k6" || flag === "--pending" || flag === "--out") && next && !next.startsWith("--")) {
      args[flag.slice(2) as keyof Args] = next;
      i += 1;
    } else {
      throw new Error(`Unknown or incomplete argument ${JSON.stringify(flag)}.`);
    }
  }
  if (!args.k6) throw new Error("--k6 <summary.json> is required.");
  return args;
}

async function main(): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Bad arguments.");
    process.exit(2);
  }

  try {
    assertSafeDatabaseUrl(process.env.DATABASE_URL);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Refusing to run: the database target check failed.");
    process.exit(1);
  }

  const pending = JSON.parse(readFileSync(args.pending, "utf8")) as {
    orderId: string;
    reference: string;
    eventId: number;
    amountMinor: number;
    currency: string;
  };
  const summary = JSON.parse(readFileSync(args.k6, "utf8")) as {
    metrics?: Record<string, { count?: number; values?: { count?: number } }>;
  };
  const metricCount = (name: string): number => {
    const metric = summary.metrics?.[name];
    return Number(metric?.count ?? metric?.values?.count ?? 0);
  };

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    const [succeededAttempts, processedEvents, totalEvents, order] = await Promise.all([
      db.paymentAttempt.count({ where: { orderId: pending.orderId, status: "SUCCEEDED" } }),
      db.webhookEvent.count({
        where: { provider: "PAYSTACK", providerEventId: String(pending.eventId), status: "PROCESSED" },
      }),
      db.webhookEvent.count({ where: { provider: "PAYSTACK", providerEventId: String(pending.eventId) } }),
      db.order.findUnique({ where: { id: pending.orderId }, select: { status: true } }),
    ]);
    const enrolments = await db.enrolment.findMany({
      where: { orderId: pending.orderId },
      select: { status: true },
    });

    const acknowledged = metricCount("webhook_ok");
    const evidence = {
      generatedAt: new Date().toISOString(),
      target: "local production build with the Verify Transaction stub (no live provider)",
      reference: pending.reference,
      eventId: pending.eventId,
      postsSent: metricCount("http_reqs"),
      postsAcknowledged: acknowledged,
      succeededAttempts,
      processedEvents,
      webhookEventRows: totalEvents,
      duplicateEvents: Math.max(0, acknowledged - succeededAttempts),
      orderStatus: order?.status ?? null,
      enrolmentStatuses: enrolments.map((row) => row.status),
      k6: summary,
    };
    mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    writeFileSync(args.out, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

    console.log(
      `replay: ${acknowledged} posts acknowledged, ${succeededAttempts} SUCCEEDED attempt, ${processedEvents} PROCESSED event, ${evidence.duplicateEvents} duplicates absorbed, order ${evidence.orderStatus}.`,
    );
    const clean =
      succeededAttempts === 1 &&
      processedEvents === 1 &&
      totalEvents === 1 &&
      order?.status === "PAID" &&
      enrolments.length === 1 &&
      enrolments[0].status === "ACTIVE";
    process.exit(clean ? 0 : 1);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message.split("\n")[0] : "webhook-replay-report failed.");
  process.exit(1);
});
