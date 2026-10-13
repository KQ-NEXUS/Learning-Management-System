// Local rehearsal only: stands in for Paystack's Verify Transaction endpoint.
//
// The webhook route (src/app/api/webhooks/paystack/route.ts) re-verifies every
// charge.success event against https://api.paystack.co before it settles an
// order. The load rehearsal must never call a live payment provider, so this
// file is preloaded into the LOCAL production server with
//
//   NODE_OPTIONS="--require ./perf/stubs/paystack-verify-stub.cjs"
//   PAYSTACK_VERIFY_STUB_FILE=perf/results/pending-order.json
//
// and answers the verify call for the one pending order that seed-load
// --pending-order wrote to that file. Any other api.paystack.co call gets a 501.
// It refuses to install without PAYSTACK_VERIFY_STUB_FILE, so it can never be
// active in a deployed environment by accident. No application code changes.

const fs = require("node:fs");

const stubFile = process.env.PAYSTACK_VERIFY_STUB_FILE;
if (stubFile) {
  const realFetch = globalThis.fetch;
  const VERIFY_PREFIX = "https://api.paystack.co/transaction/verify/";

  const json = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  globalThis.fetch = function stubbedFetch(input, init) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (typeof url === "string" && url.startsWith("https://api.paystack.co")) {
      if (!url.startsWith(VERIFY_PREFIX)) {
        return Promise.resolve(json(501, { status: false, message: "perf stub: endpoint not stubbed" }));
      }
      const reference = decodeURIComponent(url.slice(VERIFY_PREFIX.length).split("?")[0]);
      let pending;
      try {
        pending = JSON.parse(fs.readFileSync(stubFile, "utf8"));
      } catch {
        return Promise.resolve(json(500, { status: false, message: "perf stub: pending order file unreadable" }));
      }
      if (pending.reference !== reference) {
        return Promise.resolve(json(404, { status: false, message: "perf stub: unknown reference" }));
      }
      return Promise.resolve(
        json(200, {
          status: true,
          message: "Verification successful",
          data: {
            id: pending.eventId,
            reference,
            status: "success",
            amount: pending.amountMinor,
            currency: pending.currency,
            channel: "card",
            paid_at: new Date().toISOString(),
            fees: 0,
            fees_split: null,
          },
        }),
      );
    }
    return realFetch.apply(this, arguments);
  };
}
