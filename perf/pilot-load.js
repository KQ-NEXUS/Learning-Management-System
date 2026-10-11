// Pilot load (Phase 15, plan 15-14; D-02, D-03, NFR-02).
//
// Two concurrent scenarios against the core views:
//   learners  ramp to 150 virtual users over 2 minutes, hold 10 minutes,
//             ramp down 30 seconds; 5 to 15 seconds of think time per page.
//   staff     10 virtual users for the same span.
// Every request carries tag page:<name>; each core view has its own threshold
//   http_req_duration{page:<name>}: p(75)<2500 (milliseconds)
// plus http_req_failed: rate<0.01. A breached threshold exits k6 non-zero.
//
// SMOKE=1 swaps in 5 learner and 1 staff virtual users for one minute with
// short think time, to prove the harness cheaply.
//
// k6 cannot easily call server actions, so this loads pages (documents only).
// Writes are exercised by the Playwright journey (plan 15-16 onward).
//
// Run (see perf/README.md):
//   docker run --rm -i -v "$PWD/perf:/perf" -e BASE_URL=http://host.docker.internal:3010 \
//     grafana/k6:2.3.0 run /perf/pilot-load.js

import { sleep } from "k6";
import {
  ALL_PAGE_TAGS,
  SMOKE,
  baseUrl,
  buildThresholds,
  learnerJourney,
  loadTokens,
  staffJourney,
  visit,
} from "./lib/config.js";

const BASE = baseUrl();
const tokens = loadTokens();

const FULL_SPAN = "12m30s"; // 2m ramp + 10m hold + 30s ramp down

export const options = {
  scenarios: SMOKE
    ? {
        learners: { executor: "constant-vus", exec: "learner", vus: 5, duration: "1m" },
        staff: { executor: "constant-vus", exec: "staff", vus: 1, duration: "1m" },
      }
    : {
        learners: {
          executor: "ramping-vus",
          exec: "learner",
          startVUs: 0,
          stages: [
            { duration: "2m", target: 150 },
            { duration: "10m", target: 150 },
            { duration: "30s", target: 0 },
          ],
          gracefulRampDown: "30s",
        },
        staff: { executor: "constant-vus", exec: "staff", vus: 10, duration: FULL_SPAN },
      },
  thresholds: buildThresholds(ALL_PAGE_TAGS),
};

function think() {
  if (SMOKE) sleep(0.5 + Math.random());
  else sleep(5 + Math.random() * 10);
}

export function learner() {
  const index = (__VU - 1) % tokens.learners.length;
  const token = tokens.learners[index];
  const context = tokens.learnerContext[index];
  for (const [page, path] of learnerJourney(context)) {
    visit(BASE, path, page, token);
    think();
  }
}

export function staff() {
  const token = tokens.staff[(__VU - 1) % tokens.staff.length];
  for (const [page, path] of staffJourney(tokens.ids)) {
    visit(BASE, path, page, token);
    think();
  }
}
