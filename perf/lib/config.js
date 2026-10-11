// Shared k6 configuration (Phase 15, plan 15-14; D-03, NFR-02).
//
// k6 runs from the pinned grafana/k6 Docker image, never from npm (the npm
// "k6" package is a 2017 placeholder). This file is imported by the k6 scripts
// only; k6 has its own JavaScript runtime, so it is not part of the Next build.
//
// BASE_URL has NO default (T-15-14-05): a load run must name its target, and
// the README requires the deploy preview URL, never the production site.

import { check } from "k6";
import http from "k6/http";

export const SESSION_COOKIE = "lms.session";

/** Pinned image: confirm the tag exists with `docker pull grafana/k6:2.3.0`. */
export const K6_IMAGE = "grafana/k6:2.3.0";

export function baseUrl() {
  const value = __ENV.BASE_URL;
  if (!value) {
    throw new Error(
      "BASE_URL is required (for example http://host.docker.internal:3010). It has no default so a run can never hit the production site by accident.",
    );
  }
  return value.replace(/\/+$/, "");
}

/** SMOKE=1 runs 5 learner and 1 staff virtual users for one minute with short think time. */
export const SMOKE = __ENV.SMOKE === "1";

export const TOKENS_PATH = __ENV.TOKENS || "/perf/results/tokens.json";

/** Reads the tokens file seed-load wrote. Call it in the init context (open() is init-only). */
export function loadTokens() {
  const parsed = JSON.parse(open(TOKENS_PATH));
  if (!parsed.learners || !parsed.staff) {
    throw new Error("The tokens file has no learners or staff. Run scripts/load/seed-load.ts first.");
  }
  return parsed;
}

// The page tag of every core view the pilot load requests. A tag is the unit a
// p75 threshold applies to (http_req_duration{page:<name>}).
export const LEARNER_PAGE_TAGS = [
  "dashboard",
  "learn",
  "course-home",
  "lesson",
  "results",
  "sessions",
  "support",
];

export const STAFF_PAGE_TAGS = [
  "staff-overview",
  "staff-cohorts",
  "staff-cohort",
  "staff-grading",
  "staff-support",
  "staff-payments",
];

export const ALL_PAGE_TAGS = LEARNER_PAGE_TAGS.concat(STAFF_PAGE_TAGS);

/** NFR-02: p75 of every core view under 2.5 s; fewer than 1 percent failed requests. */
export const P75_BUDGET_MS = 2500;

export function buildThresholds(pageTags) {
  const thresholds = {
    http_req_failed: ["rate<0.01"],
    // A page that silently redirected to /signin still returns 200, so the
    // "signed in" check is a threshold too.
    checks: ["rate>0.999"],
  };
  for (const tag of pageTags) {
    thresholds[`http_req_duration{page:${tag}}`] = [`p(75)<${P75_BUDGET_MS}`];
  }
  return thresholds;
}

/** The learner journey: dashboard, learn, course home, two lessons, results, sessions, support. */
export function learnerJourney(context) {
  const eid = context.enrolmentId;
  const steps = [
    ["dashboard", "/dashboard"],
    ["learn", "/learn"],
    ["course-home", `/learn/${eid}`],
  ];
  for (const lessonId of context.lessonIds) {
    steps.push(["lesson", `/learn/${eid}/lessons/${lessonId}`]);
  }
  steps.push(["results", `/learn/${eid}/results`]);
  steps.push(["sessions", `/learn/${eid}/sessions`]);
  steps.push(["support", "/support"]);
  return steps;
}

/** The staff journey: overview, cohorts, one cohort, grading queue, support queue, payments. */
export function staffJourney(ids) {
  const steps = [
    ["staff-overview", "/staff"],
    ["staff-cohorts", "/staff/cohorts"],
  ];
  if (ids.cohortId) {
    steps.push(["staff-cohort", `/staff/cohorts/${ids.cohortId}`]);
    if (ids.assessmentId) {
      steps.push(["staff-grading", `/staff/cohorts/${ids.cohortId}/grading/${ids.assessmentId}`]);
    }
  }
  steps.push(["staff-support", "/staff/support"]);
  steps.push(["staff-payments", "/staff/payments"]);
  return steps;
}

/**
 * Requests one document with the session cookie and records the two checks.
 * Documents only: no static assets, so the load stays on the application and
 * the Netlify bill (see perf/README.md).
 */
export function visit(base, path, page, token) {
  const res = http.get(`${base}${path}`, {
    headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    tags: { page },
  });
  check(
    res,
    {
      "status is 200": (r) => r.status === 200,
      "stayed signed in": (r) => r.url.indexOf("/signin") === -1,
      // A server render error after streaming has started still answers 200;
      // Next marks the failed boundary with a data-dgst (digest) attribute.
      "rendered without an error": (r) => typeof r.body !== "string" || r.body.indexOf("data-dgst=") === -1,
    },
    { page },
  );
  return res;
}
