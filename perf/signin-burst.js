// Sign-in burst (Phase 15, plan 15-14; ledger A12 - a flagged assumption).
//
// Replays the NO-JAVASCRIPT sign-in form: GET /signin, copy the hidden server
// action inputs ($ACTION_REF_*, $ACTION_KEY ...), POST them with the load
// account's email and password. 150 attempts over 60 seconds by default, which
// is the scrypt burst a morning start of a cohort would cause.
//
// A12 says k6 can do this. If it cannot authenticate (no session cookie comes
// back), the burst is recorded as UNMEASURED with an owner in the report - it is
// never silently dropped. The signin_ok counter and its threshold make that
// visible: a replay that cannot authenticate exits non-zero.
//
// Knobs (all __ENV): ATTEMPTS (default 150), WINDOW_SECONDS (default 60),
// TOKENS (default /perf/results/tokens.json). The password is the random one
// seed-load generated and wrote to the ignored tokens file.
//
// Note: the sign-in is rate limited per address and per device (plan 15-02).
// All k6 traffic shares one IP, so a throttled result is reported separately
// (signin_throttled) from a failed replay (signin_failed).

import exec from "k6/execution";
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";
import { SESSION_COOKIE, baseUrl, loadTokens } from "./lib/config.js";

const BASE = baseUrl();
const tokens = loadTokens();
const ATTEMPTS = Number(__ENV.ATTEMPTS || 150);
const WINDOW_SECONDS = Number(__ENV.WINDOW_SECONDS || 60);

const ok = new Counter("signin_ok");
const throttled = new Counter("signin_throttled");
const failed = new Counter("signin_failed");

export const options = {
  scenarios: {
    burst: {
      executor: "constant-arrival-rate",
      rate: ATTEMPTS,
      timeUnit: `${WINDOW_SECONDS}s`,
      duration: `${WINDOW_SECONDS}s`,
      preAllocatedVUs: Math.min(60, Math.max(5, Math.ceil(ATTEMPTS / 4))),
      maxVUs: 150,
    },
  },
  thresholds: {
    // A12: the replay must authenticate. Zero successes means "unmeasured".
    signin_ok: [`count>=${Math.max(1, Math.floor(ATTEMPTS * 0.99))}`],
    "http_req_duration{page:signin-post}": ["p(75)<2500"],
  },
};

export default function () {
  const n = exec.scenario.iterationInTest;
  const email = tokens.learnerEmails[n % tokens.learnerEmails.length];

  const form = http.get(`${BASE}/signin`, { tags: { page: "signin-form" } });
  const fields = { email, password: tokens.password };
  const hidden = form.html().find('input[type="hidden"]').toArray();
  for (const input of hidden) {
    const name = input.attr("name");
    if (name) fields[name] = input.attr("value") || "";
  }

  // The no-JavaScript action post must be multipart/form-data: Next.js does not
  // find the server action in a url-encoded body (checked against 16.3.8).
  const boundary = `----k6burst${exec.vu.idInTest}x${n}`;
  const CRLF = "\r\n";
  let body = "";
  for (const name of Object.keys(fields)) {
    body += "--" + boundary + CRLF;
    body += 'Content-Disposition: form-data; name="' + name + '"' + CRLF + CRLF;
    body += fields[name] + CRLF;
  }
  body += "--" + boundary + "--" + CRLF;

  const res = http.post(`${BASE}/signin`, body, {
    // A server action answers with a redirect and a Set-Cookie; do not follow it.
    redirects: 0,
    headers: { Origin: BASE, "Content-Type": `multipart/form-data; boundary=${boundary}` },
    tags: { page: "signin-post" },
  });

  const cookie = res.cookies[SESSION_COOKIE];
  const authenticated = !!cookie && cookie.length > 0 && res.status >= 300 && res.status < 400;
  check(res, { "sign-in replay authenticated": () => authenticated });
  if (authenticated) {
    ok.add(1);
  } else if (res.status === 429 || (res.body && String(res.body).indexOf("Too many sign-in attempts") !== -1)) {
    throttled.add(1);
  } else {
    failed.add(1);
  }
}
