/**
 * Turns a Playwright JSON report of the full journey into the evidence files of
 * plan 15-17 (D-08, D-14).
 *
 *   npx tsx e2e/support/reliability-report.ts --in report.json --out evidence.json [--integrity checks.json]
 *   npx tsx e2e/support/reliability-report.ts --mode browsers --in report.json --out evidence.json
 *
 * Reliability mode (default) writes
 *   { project, runs, passed, failed, passRate, failures: [{ attempt, step, error }], ranAt, integrity? }
 * where `attempt` counts repeats from 1, `step` is the first journey step that
 * failed, and `error` is the first line of its message (no stack, no URL
 * query, nothing that could carry a session value). `--integrity` merges the
 * `checks` array that scripts/ops/integrity-checks.ts printed into `integrity`.
 * `--prior report.json` (repeatable) adds the same summary of an earlier,
 * superseded 20-run batch under `priorBatches`, so a failed batch is never
 * hidden by a later clean one.
 *
 * Browsers mode writes one entry per project:
 *   [{ project, browserVersion, passed, ranAt }]
 * with the version taken from the `browser-version` annotation the spec adds
 * from `browser.version()`.
 *
 * The parsing functions are exported so a unit test can feed them a small
 * synthetic report.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type JsonStep = { title: string; error?: { message?: string }; steps?: JsonStep[] };
type JsonResult = { status: string; error?: { message?: string }; steps?: JsonStep[] };
type JsonTest = {
  projectName: string;
  status: string;
  results: JsonResult[];
  annotations?: { type: string; description?: string }[];
};
type JsonSpec = { title: string; tests: JsonTest[] };
type JsonSuite = { specs?: JsonSpec[]; suites?: JsonSuite[] };
export type JsonReport = { suites?: JsonSuite[] };

export type JourneyRun = {
  project: string;
  passed: boolean;
  step: string | null;
  error: string | null;
  browserVersion: string | null;
};

const ANSI = /\u001b\[[0-9;]*m/g;

function firstLine(message: string | undefined): string {
  const clean = (message ?? "").replace(ANSI, "");
  const line = clean.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "failed";
  // Drop query strings so no token or session value can ride along in an error line.
  return line.replace(/\?[^\s)]*/g, "").slice(0, 300);
}

function failingStep(steps: JsonStep[] | undefined): string | null {
  for (const step of steps ?? []) {
    if (step.error) return failingStep(step.steps) ?? step.title;
  }
  return null;
}

/** Every run of the spec titled `title`, in the order the report lists them. */
export function collectRuns(report: JsonReport, title: string): JourneyRun[] {
  const runs: JourneyRun[] = [];
  const walk = (suite: JsonSuite) => {
    for (const spec of suite.specs ?? []) {
      if (spec.title !== title) continue;
      for (const test of spec.tests) {
        const last = test.results[test.results.length - 1];
        const passed = test.status === "expected";
        runs.push({
          project: test.projectName,
          passed,
          step: passed ? null : failingStep(last?.steps) ?? "setup",
          error: passed ? null : firstLine(last?.error?.message),
          browserVersion: test.annotations?.find((a) => a.type === "browser-version")?.description ?? null,
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  return runs;
}

export function reliabilityEvidence(runs: JourneyRun[], ranAt: string) {
  const passed = runs.filter((run) => run.passed).length;
  return {
    project: runs[0]?.project ?? null,
    runs: runs.length,
    passed,
    failed: runs.length - passed,
    passRate: runs.length === 0 ? 0 : Number((passed / runs.length).toFixed(4)),
    failures: runs
      .map((run, index) => ({ run, attempt: index + 1 }))
      .filter(({ run }) => !run.passed)
      .map(({ run, attempt }) => ({ attempt, step: run.step, error: run.error })),
    ranAt,
  };
}

export function browsersEvidence(runs: JourneyRun[], ranAt: string) {
  return runs.map((run) => ({
    project: run.project,
    browserVersion: run.browserVersion,
    passed: run.passed,
    ranAt,
    ...(run.project === "webkit"
      ? {
          note:
            "Playwright WebKit does not send the Secure session cookie to http://localhost, so the harness re-adds the same value without the Secure flag (e2e/support/session.ts). WebKit is not Safari: the manual Safari and iPhone pass stays.",
        }
      : {}),
  }));
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main(): void {
  const input = arg("--in");
  const out = arg("--out");
  const mode = arg("--mode") ?? "reliability";
  if (!input || !out || (mode !== "reliability" && mode !== "browsers")) {
    console.error("Usage: reliability-report.ts --in report.json --out evidence.json [--mode reliability|browsers] [--integrity checks.json]");
    process.exit(2);
  }

  const report = JSON.parse(readFileSync(path.resolve(input), "utf8")) as JsonReport;
  const runs = collectRuns(report, "full journey");
  if (runs.length === 0) {
    console.error("The report has no run of the test titled 'full journey'.");
    process.exit(1);
  }
  const ranAt = new Date().toISOString();

  let evidence: unknown;
  if (mode === "browsers") {
    evidence = browsersEvidence(runs, ranAt);
  } else {
    const base = reliabilityEvidence(runs, ranAt);
    const priorFiles = process.argv.flatMap((value, index) => (value === "--prior" ? [process.argv[index + 1]] : []));
    const priorBatches = priorFiles.map((file) => {
      const prior = JSON.parse(readFileSync(path.resolve(file), "utf8")) as JsonReport;
      const summary = reliabilityEvidence(collectRuns(prior, "full journey"), "earlier batch");
      const { ranAt: _ranAt, ...rest } = summary;
      void _ranAt;
      return rest;
    });
    const integrityFile = arg("--integrity");
    const integrity = integrityFile
      ? ((JSON.parse(readFileSync(path.resolve(integrityFile), "utf8")) as { checks?: unknown }).checks ?? [])
      : undefined;
    evidence = {
      ...base,
      ...(priorBatches.length > 0 ? { priorBatches } : {}),
      ...(integrity !== undefined ? { integrity } : {}),
    };
  }

  const target = path.resolve(out);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`Wrote ${path.relative(process.cwd(), target)} (${runs.length} run${runs.length === 1 ? "" : "s"}).`);
}

if (process.argv[1] && /reliability-report\.(ts|js|cjs|mjs)$/.test(process.argv[1].replace(/\\/g, "/"))) {
  main();
}
