/**
 * Guarded scheduled-task runner (plan 15-15). Pure name resolution and the
 * refusal paths: an unknown name lists the valid ones, and a database URL the
 * guard rejects stops the run before any task module is loaded.
 */

import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TASK_LOADERS, TASK_NAMES, parseArgs, runTaskCli } from "../scripts/ops/run-task";

const LOCAL_URL = "postgresql://postgres:pw@localhost:5434/lms";
const NEON_URL = "postgresql://owner:s3cretPassw0rd@ep-quiet-bird-a1b2c3.eu-central-1.aws.neon.tech/neondb";

describe("task names", () => {
  it("are the Netlify function names minus the background function, plus process-export-jobs", () => {
    const functions = readdirSync(path.resolve(__dirname, "../netlify/functions"))
      .filter((file) => file.endsWith(".ts"))
      .map((file) => file.replace(/\.ts$/, ""))
      .filter((name) => name !== "process-export-jobs-background");
    expect([...TASK_NAMES].sort()).toEqual([...functions, "process-export-jobs"].sort());
  });
});

describe("parseArgs", () => {
  it("accepts a known name and defaults the target to local", () => {
    expect(parseArgs(["drain-domain-events"])).toEqual({ name: "drain-domain-events", target: "local" });
  });

  it("accepts an explicit staging target", () => {
    expect(parseArgs(["reconcile-payments", "--target", "staging"])).toEqual({
      name: "reconcile-payments",
      target: "staging",
    });
  });

  it("rejects an unknown name and lists the valid names", () => {
    expect(() => parseArgs(["not-a-task"])).toThrow(/Unknown task "not-a-task"/);
    expect(() => parseArgs(["not-a-task"])).toThrow(/drain-domain-events/);
    expect(() => parseArgs(["not-a-task"])).toThrow(/process-export-jobs/);
  });

  it("rejects the background function name, a missing name, a bad target and extra arguments", () => {
    expect(() => parseArgs(["process-export-jobs-background"])).toThrow(/Unknown task/);
    expect(() => parseArgs([])).toThrow(/No task name given/);
    expect(() => parseArgs(["drain-domain-events", "--target", "prod"])).toThrow(/--target/);
    expect(() => parseArgs(["drain-domain-events", "extra"])).toThrow(/exactly one/);
  });

  it("does not treat inherited object keys as task names", () => {
    expect(() => parseArgs(["constructor"])).toThrow(/Unknown task/);
  });
});

describe("runTaskCli", () => {
  it("refuses a shared database URL before loading any task module", async () => {
    const run = vi.fn(async () => undefined);
    const loader = vi.fn(async () => run);
    await expect(
      runTaskCli(["drain-domain-events"], {
        env: { DATABASE_URL: NEON_URL },
        loaders: { ...TASK_LOADERS, "drain-domain-events": loader },
      }),
    ).rejects.toThrow(/ep-quiet-bird/);
    expect(loader).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("never prints the password when it refuses", async () => {
    const error = await runTaskCli(["drain-domain-events"], { env: { DATABASE_URL: NEON_URL } }).catch((e: Error) => e);
    expect((error as Error).message).not.toContain("s3cretPassw0rd");
  });

  it("refuses a missing database URL", async () => {
    const loader = vi.fn();
    await expect(
      runTaskCli(["drain-domain-events"], { env: {}, loaders: { "drain-domain-events": loader } }),
    ).rejects.toThrow();
    expect(loader).not.toHaveBeenCalled();
  });

  it("refuses staging without the explicit opt-in", async () => {
    const loader = vi.fn();
    await expect(
      runTaskCli(["drain-domain-events", "--target", "staging"], {
        env: { DATABASE_URL: NEON_URL },
        loaders: { "drain-domain-events": loader },
      }),
    ).rejects.toThrow();
    expect(loader).not.toHaveBeenCalled();
  });

  it("loads and runs the named task once for a local database", async () => {
    const run = vi.fn(async () => undefined);
    const loader = vi.fn(async () => run);
    await runTaskCli(["drain-domain-events"], {
      env: { DATABASE_URL: LOCAL_URL },
      loaders: { "drain-domain-events": loader },
    });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
