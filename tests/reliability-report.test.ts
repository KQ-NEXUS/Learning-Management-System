import { describe, expect, it } from "vitest";
import {
  browsersEvidence,
  collectRuns,
  reliabilityEvidence,
  type JsonReport,
} from "../e2e/support/reliability-report";

function test(projectName: string, status: string, extra: object = {}) {
  return { projectName, status, results: [{ status }], ...extra };
}

const report: JsonReport = {
  suites: [
    {
      suites: [
        {
          specs: [
            { title: "leg 1: discover, register, verify, sign in", tests: [test("chromium", "expected")] },
            {
              title: "full journey",
              tests: [
                test("chromium", "expected", { annotations: [{ type: "browser-version", description: "147.0.1" }] }),
                {
                  projectName: "chromium",
                  status: "unexpected",
                  results: [
                    {
                      status: "failed",
                      error: { message: "\u001b[31mError: boom at http://localhost:3010/x?token=secret\u001b[39m\n  stack" },
                      steps: [
                        { title: "enrol", steps: [] },
                        { title: "pay", error: { message: "x" }, steps: [{ title: "inner step", error: { message: "y" } }] },
                      ],
                    },
                  ],
                },
                test("chromium", "expected"),
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("reliability report", () => {
  it("counts only the full journey, pass rate included", () => {
    const runs = collectRuns(report, "full journey");
    expect(runs).toHaveLength(3);
    const evidence = reliabilityEvidence(runs, "2026-10-09T00:00:00.000Z");
    expect(evidence).toMatchObject({ project: "chromium", runs: 3, passed: 2, failed: 1, passRate: 0.6667 });
  });

  it("records the failing step and a first line with no token or colour codes", () => {
    const evidence = reliabilityEvidence(collectRuns(report, "full journey"), "t");
    expect(evidence.failures).toEqual([{ attempt: 2, step: "inner step", error: "Error: boom at http://localhost:3010/x" }]);
  });

  it("reports the browser version per project", () => {
    const evidence = browsersEvidence(collectRuns(report, "full journey").slice(0, 1), "t");
    expect(evidence).toEqual([{ project: "chromium", browserVersion: "147.0.1", passed: true, ranAt: "t" }]);
  });

  it("treats a missing spec as zero runs", () => {
    expect(reliabilityEvidence(collectRuns(report, "nope"), "t")).toMatchObject({ runs: 0, passRate: 0 });
  });
});
