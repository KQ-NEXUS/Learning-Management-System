/**
 * Pure parts of the statement-count tool (plan 15-28): argument parsing, budget
 * comparison, query-text truncation and row summarising. The database and the
 * server are not needed; the guard-first order is checked on the source.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isTransactionControl,
  parseArgs,
  parseCheck,
  resolvePath,
  summariseRows,
  truncateQuery,
  withinBudget,
} from "../scripts/ops/statement-counts";

describe("parseCheck", () => {
  it("reads persona, path and budget", () => {
    expect(parseCheck("staff:/staff:25")).toEqual({ persona: "staff", path: "/staff", budget: 25 });
  });

  it("keeps placeholders in the path", () => {
    expect(parseCheck("learner:/learn/{enrolmentId}/lessons/{lessonId}:20")).toEqual({
      persona: "learner",
      path: "/learn/{enrolmentId}/lessons/{lessonId}",
      budget: 20,
    });
  });

  it.each(["staff", "staff:/staff", "admin:/staff:25", "staff:staff:25", "staff:/staff:0", "staff:/staff:x"])(
    "rejects %s",
    (value) => {
      expect(() => parseCheck(value)).toThrow();
    },
  );
});

describe("parseArgs", () => {
  it("collects checks, base and output", () => {
    const options = parseArgs(["--base", "http://localhost:3010/", "--check", "staff:/staff:25", "--out=out.json"]);
    expect(options.base).toBe("http://localhost:3010");
    expect(options.out).toBe("out.json");
    expect(options.checks).toHaveLength(1);
  });

  it("requires a base and at least one check", () => {
    expect(() => parseArgs(["--check", "staff:/staff:25"])).toThrow(/--base/);
    expect(() => parseArgs(["--base", "http://localhost:3010"])).toThrow(/--check/);
  });

  it("rejects an unknown flag and a flag with no value", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/Unknown argument/);
    expect(() => parseArgs(["--base"])).toThrow(/needs a value/);
  });
});

describe("withinBudget", () => {
  it("passes at the budget and fails one over", () => {
    expect(withinBudget(25, 25)).toBe(true);
    expect(withinBudget(26, 25)).toBe(false);
    expect(withinBudget(0, 25)).toBe(true);
  });
});

describe("truncateQuery", () => {
  it("collapses whitespace and cuts to 120 characters", () => {
    expect(truncateQuery("SELECT   1\n  FROM   t")).toBe("SELECT 1 FROM t");
    const long = `SELECT ${"a, ".repeat(100)}`;
    const cut = truncateQuery(long);
    expect(cut.length).toBe(120);
    expect(cut.endsWith("...")).toBe(true);
  });
});

describe("summariseRows", () => {
  it("sums calls, reports transaction control and orders the top queries", () => {
    const rows = [
      { calls: 1, query: "BEGIN" },
      { calls: 1, query: "COMMIT" },
      { calls: 5, query: 'SELECT "id" FROM "User" WHERE "id" = $1' },
      { calls: 2, query: 'SELECT "id" FROM "Cohort"' },
    ];
    const summary = summariseRows(rows);
    expect(summary.statements).toBe(9);
    expect(summary.transactionControl).toBe(2);
    expect(summary.topQueries[0]).toEqual({ calls: 5, query: 'SELECT "id" FROM "User" WHERE "id" = $1' });
  });

  it("keeps at most 10 top queries", () => {
    const rows = Array.from({ length: 15 }, (_, index) => ({ calls: index + 1, query: `SELECT ${index}` }));
    expect(summariseRows(rows).topQueries).toHaveLength(10);
  });

  it("recognises transaction control", () => {
    expect(isTransactionControl("BEGIN")).toBe(true);
    expect(isTransactionControl("  commit")).toBe(true);
    expect(isTransactionControl("SELECT 1")).toBe(false);
  });
});

describe("resolvePath", () => {
  const tokens = { learnerContext: [{ enrolmentId: "enr1", lessonIds: ["les1", "les2"] }] };

  it("fills the first learner context", () => {
    expect(resolvePath("/learn/{enrolmentId}/lessons/{lessonId}", tokens)).toBe("/learn/enr1/lessons/les1");
  });

  it("throws a plain message when the ids are missing", () => {
    expect(() => resolvePath("/learn/{enrolmentId}", {})).toThrow(/enrolmentId/);
  });
});

describe("guard first", () => {
  it("calls assertSafeDatabaseUrl before Prisma is imported", () => {
    const source = readFileSync(path.join(__dirname, "..", "scripts", "ops", "statement-counts.ts"), "utf8");
    const guardAt = source.indexOf("assertSafeDatabaseUrl(process.env.DATABASE_URL");
    const importAt = source.indexOf('await import("@prisma/client")');
    expect(guardAt).toBeGreaterThan(0);
    expect(importAt).toBeGreaterThan(guardAt);
  });
});
