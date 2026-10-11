/**
 * Staging probes, pure parts (plan 15-30; ledger A15, P-10). No test here
 * reaches a database: the token count and the connection sample are injected.
 *
 * Pinned: argument parsing, the refusal without `--target staging`, the
 * database guard running before any probe, the sampling schedule and peak, and
 * that the address given to `tokens` is never printed.
 */

import { describe, expect, it } from "vitest";
import {
  parseArgs,
  runStagingChecks,
  summariseConnections,
  type ConnectionSample,
} from "../scripts/ops/staging-checks";

const STAGING_HOST = "ep-staging-test.example.test";
const STAGING_ENV = {
  DATABASE_URL: `postgresql://user:secret-value@${STAGING_HOST}/db`,
  STAGING_DATABASE_HOSTS: STAGING_HOST,
  ALLOW_STAGING_DATABASE: "1",
};

describe("parseArgs", () => {
  it("parses tokens and normalises the address", () => {
    expect(parseArgs(["tokens", "--email", " New.Person@Example.test ", "--target", "staging"])).toEqual({
      command: "tokens",
      email: "new.person@example.test",
      target: "staging",
    });
  });

  it("parses connections, with 15 seconds as the default interval", () => {
    expect(parseArgs(["connections", "--for", "240", "--out", "x.json", "--target", "staging"])).toEqual({
      command: "connections",
      everySeconds: 15,
      forSeconds: 240,
      out: "x.json",
      target: "staging",
    });
    expect(
      parseArgs(["connections", "--every", "5", "--for", "60", "--out", "x.json", "--target", "staging"]),
    ).toMatchObject({ everySeconds: 5, forSeconds: 60 });
  });

  it("refuses to run without --target staging", () => {
    expect(() => parseArgs(["tokens", "--email", "a@b.test"])).toThrow(/needs --target staging/);
    expect(() => parseArgs(["tokens", "--email", "a@b.test", "--target", "local"])).toThrow(/needs --target staging/);
    expect(() => parseArgs(["connections", "--for", "60", "--out", "x.json"])).toThrow(/needs --target staging/);
  });

  it("rejects a missing or unknown command", () => {
    expect(() => parseArgs([])).toThrow(/Give a command/);
    expect(() => parseArgs(["drop", "--target", "staging"])).toThrow(/Give a command/);
  });

  it("rejects unknown flags, missing values and repeats", () => {
    expect(() => parseArgs(["tokens", "--every", "5", "--target", "staging"])).toThrow(/Unknown argument --every/);
    expect(() => parseArgs(["tokens", "--email", "--target", "staging"])).toThrow(/--email needs a value/);
    expect(() =>
      parseArgs(["tokens", "--email", "a@b.test", "--email", "c@d.test", "--target", "staging"]),
    ).toThrow(/given twice/);
  });

  it("never echoes a stray value", () => {
    expect(() => parseArgs(["tokens", "someone@private.test", "--target", "staging"])).toThrow(
      /Unknown argument \(value not shown\)/,
    );
  });

  it("validates the address and the numbers", () => {
    expect(() => parseArgs(["tokens", "--email", "not-an-address", "--target", "staging"])).toThrow(/email address/);
    expect(() => parseArgs(["tokens", "--target", "staging"])).toThrow(/email address/);
    expect(() => parseArgs(["connections", "--for", "0", "--out", "x.json", "--target", "staging"])).toThrow(/--for/);
    expect(() => parseArgs(["connections", "--for", "1e3", "--out", "x.json", "--target", "staging"])).toThrow(/--for/);
    expect(() => parseArgs(["connections", "--out", "x.json", "--target", "staging"])).toThrow(/--for/);
    expect(() =>
      parseArgs(["connections", "--every", "0", "--for", "60", "--out", "x.json", "--target", "staging"]),
    ).toThrow(/--every/);
    expect(() => parseArgs(["connections", "--for", "60", "--target", "staging"])).toThrow(/--out/);
  });
});

describe("summariseConnections", () => {
  it("reports the peak of each count", () => {
    const samples: ConnectionSample[] = [
      { at: "a", total: 9, client: 3, active: 1 },
      { at: "b", total: 14, client: 8, active: 2 },
      { at: "c", total: 11, client: 9, active: 5 },
    ];
    expect(summariseConnections(samples)).toEqual({ samples: 3, peakTotal: 14, peakClient: 9, peakActive: 5 });
    expect(summariseConnections([])).toEqual({ samples: 0, peakTotal: 0, peakClient: 0, peakActive: 0 });
  });
});

describe("runStagingChecks", () => {
  it("refuses without --target staging before any probe runs", async () => {
    let probed = false;
    await expect(
      runStagingChecks(["tokens", "--email", "a@b.test"], {
        env: STAGING_ENV,
        countTokens: async () => {
          probed = true;
          return 0;
        },
      }),
    ).rejects.toThrow(/needs --target staging/);
    expect(probed).toBe(false);
  });

  it("applies the database guard before any probe runs", async () => {
    let probed = false;
    const countTokens = async () => {
      probed = true;
      return 0;
    };
    const argv = ["tokens", "--email", "a@b.test", "--target", "staging"];

    // A host that is not on the allow-list.
    await expect(
      runStagingChecks(argv, { env: { ...STAGING_ENV, STAGING_DATABASE_HOSTS: "other.example.test" }, countTokens }),
    ).rejects.toThrow(/not listed in STAGING_DATABASE_HOSTS/);
    // The confirmation switch is missing.
    await expect(
      runStagingChecks(argv, { env: { ...STAGING_ENV, ALLOW_STAGING_DATABASE: undefined }, countTokens }),
    ).rejects.toThrow(/ALLOW_STAGING_DATABASE=1/);
    // No database URL at all.
    await expect(runStagingChecks(argv, { env: {}, countTokens })).rejects.toThrow(/DATABASE_URL is unset/);
    expect(probed).toBe(false);
  });

  it("prints the token count and not the address", async () => {
    const lines: string[] = [];
    const asked: string[] = [];
    const result = await runStagingChecks(["tokens", "--email", "Fresh@Example.test", "--target", "staging"], {
      env: STAGING_ENV,
      countTokens: async (email) => {
        asked.push(email);
        return 2;
      },
      log: (line) => lines.push(line),
    });
    expect(result).toEqual({ count: 2 });
    expect(asked).toEqual(["fresh@example.test"]);
    expect(lines).toEqual(["staging-checks tokens: 2"]);
    expect(lines.join("\n")).not.toMatch(/example\.test|secret-value/i);
  });

  it("samples on the interval for the whole span and writes the peak", async () => {
    let clock = 1_000_000;
    const sleeps: number[] = [];
    const writes: { file: string; content: string }[] = [];
    const lines: string[] = [];
    const counts = [5, 12, 7, 9, 6];
    let taken = 0;

    const result = await runStagingChecks(
      ["connections", "--every", "15", "--for", "60", "--out", "out/conn.json", "--target", "staging"],
      {
        env: STAGING_ENV,
        now: () => clock,
        sleep: async (ms) => {
          sleeps.push(ms);
          clock += ms;
        },
        sampleConnections: async () => {
          const total = counts[taken];
          taken += 1;
          clock += 200; // each sample takes a moment; the schedule must not drift because of it
          return { at: new Date(clock).toISOString(), total, client: total - 3, active: 1 };
        },
        write: (file, content) => writes.push({ file, content }),
        log: (line) => lines.push(line),
      },
    );

    // 60 seconds at 15-second spacing: samples at 0, 15, 30, 45 and 60 seconds.
    expect(taken).toBe(5);
    expect(sleeps).toEqual([14_800, 14_800, 14_800, 14_800]);
    expect(result).toEqual({ samples: 5, peakTotal: 12, peakClient: 9, peakActive: 1, out: "out/conn.json" });

    // Written after every sample; the last write holds everything.
    expect(writes).toHaveLength(5);
    const last = JSON.parse(writes[4].content);
    expect(writes[4].file).toBe("out/conn.json");
    expect(last).toMatchObject({ everySeconds: 15, forSeconds: 60, samples: 5, peakTotal: 12, peakClient: 9 });
    expect(last.list).toHaveLength(5);
    expect(writes[4].content).not.toMatch(/example\.test|secret-value|postgres/i);
    expect(lines).toEqual(["staging-checks connections: 5 samples, peak total 12, peak client 9, peak active 1"]);
  });

  it("closes what it opened even when a probe fails", async () => {
    let closed = 0;
    await expect(
      runStagingChecks(["tokens", "--email", "a@b.test", "--target", "staging"], {
        env: STAGING_ENV,
        countTokens: async () => {
          throw new Error("probe failed");
        },
        close: async () => {
          closed += 1;
        },
      }),
    ).rejects.toThrow("probe failed");
    expect(closed).toBe(1);
  });
});
