// Concurrent webhook replay (Phase 15, plan 15-14; NFR-03, ledger PAY idempotency).
//
// Posts ONE correctly signed Paystack charge.success event 10 times at the same
// moment (10 virtual users, one iteration each). Idempotency means the order is
// settled once: afterwards the database holds exactly one SUCCEEDED attempt and
// one PROCESSED WebhookEvent for it. scripts/load/webhook-replay-report.ts reads
// the database after the run and writes the evidence file.
//
// Setup, per perf/README.md:
//   1. npx tsx scripts/load/seed-load.ts --learners 0 --staff 0 --pending-order
//      (prints the reference and writes perf/results/pending-order.json)
//   2. start the production build with PAYSTACK_SECRET_KEY set to a local test
//      value and the Verify Transaction stub preloaded (perf/stubs/README in
//      perf/README.md) - no live provider is ever called
//   3. run k6 with PAYSTACK_SECRET set to the SAME local value.
//
// The signing secret is read from __ENV only; a literal key must never appear
// in this file (T-15-14-04).

import crypto from "k6/crypto";
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";
import { baseUrl } from "./lib/config.js";

const BASE = baseUrl();
const PENDING_PATH = __ENV.PENDING_ORDER || "/perf/results/pending-order.json";
const pending = JSON.parse(open(PENDING_PATH));

const accepted = new Counter("webhook_ok");
const rejected = new Counter("webhook_not_ok");

export const options = {
  scenarios: {
    replay: { executor: "shared-iterations", vus: 10, iterations: 10, maxDuration: "1m" },
  },
  thresholds: {
    // Every duplicate is acknowledged (200) so Paystack stops retrying.
    webhook_ok: ["count==10"],
    webhook_not_ok: ["count==0"],
  },
};

export function setup() {
  const secret = __ENV.PAYSTACK_SECRET;
  if (!secret) {
    throw new Error("PAYSTACK_SECRET is required: the local test value the app was started with.");
  }
  // The signature covers the exact bytes posted, so build the body once.
  const body = JSON.stringify({
    event: "charge.success",
    data: {
      id: pending.eventId,
      reference: pending.reference,
      status: "success",
      amount: pending.amountMinor,
      currency: pending.currency,
      metadata: { orderId: pending.orderId },
    },
  });
  return { body, signature: crypto.hmac("sha512", secret, body, "hex") };
}

export default function (data) {
  const res = http.post(`${BASE}/api/webhooks/paystack`, data.body, {
    headers: { "Content-Type": "application/json", "x-paystack-signature": data.signature },
    tags: { page: "paystack-webhook" },
  });
  const ok = check(res, { "webhook acknowledged with 200": (r) => r.status === 200 });
  if (ok) accepted.add(1);
  else rejected.add(1);
}
