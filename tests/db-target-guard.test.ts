/**
 * Database-target guard (plan 15-07, P1 / D-01, NFR-08).
 *
 * Every Phase 15 script that reads or writes a database calls
 * `assertSafeDatabaseUrl` before it opens a connection. The `.env` file points
 * at the shared Neon database, so the guard is the only thing standing between
 * a local seed, load or restore script and real learner data. These tests pin
 * the allow-list, the staging opt-in and the rule that an error message names
 * the host only, never the user, password or full connection string.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertSafeDatabaseUrl, isLocalHost } from "../scripts/ops/db-target-guard";

const PASSWORD = "s3cretPassw0rd";
const NEON_URL = `postgresql://neondb_owner:${PASSWORD}@ep-quiet-bird-a1b2c3.eu-central-1.aws.neon.tech/neondb?sslmode=require`;
const STAGING_HOST = "ep-staging-branch.eu-central-1.aws.neon.tech";
const STAGING_URL = `postgresql://app:${PASSWORD}@${STAGING_HOST}/lms?sslmode=require`;

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected the guard to throw");
}

describe("isLocalHost", () => {
  it.each(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal", "LOCALHOST"])(
    "treats %s as local",
    (host) => {
      expect(isLocalHost(host)).toBe(true);
    },
  );

  it.each([
    "ep-quiet-bird-a1b2c3.eu-central-1.aws.neon.tech",
    "db.example.com",
    "10.0.0.5",
    "127.0.0.2",
    "localhost.evil.example",
    "",
  ])("treats %s as remote", (host) => {
    expect(isLocalHost(host)).toBe(false);
  });
});

describe("assertSafeDatabaseUrl: local target", () => {
  it.each([
    ["postgresql://u:p@localhost:5434/licence_test", "localhost"],
    ["postgres://u:p@127.0.0.1:5432/lms", "127.0.0.1"],
    ["postgresql://u:p@[::1]:5432/lms", "::1"],
    ["postgresql://u:p@host.docker.internal:5434/lms", "host.docker.internal"],
  ])("accepts %s", (url, host) => {
    expect(assertSafeDatabaseUrl(url, { env: {} })).toEqual({ host, target: "local" });
  });

  it("rejects a neon.tech host, naming the host and never the password", () => {
    const message = messageOf(() => assertSafeDatabaseUrl(NEON_URL, { env: {} }));
    expect(message).toContain("ep-quiet-bird-a1b2c3.eu-central-1.aws.neon.tech");
    expect(message).not.toContain(PASSWORD);
    expect(message).not.toContain("neondb_owner");
    expect(message).not.toContain("postgresql://");
  });

  it("rejects any other remote host", () => {
    const message = messageOf(() =>
      assertSafeDatabaseUrl(`postgresql://admin:${PASSWORD}@db.example.com:5432/lms`, { env: {} }),
    );
    expect(message).toContain("db.example.com");
    expect(message).not.toContain(PASSWORD);
  });

  it.each([undefined, null, "", "   "])("rejects an unset value (%s)", (url) => {
    expect(messageOf(() => assertSafeDatabaseUrl(url, { env: {} }))).toContain("unset");
  });

  it("rejects a malformed URL without echoing it", () => {
    const malformed = `not a url ${PASSWORD}`;
    const message = messageOf(() => assertSafeDatabaseUrl(malformed, { env: {} }));
    expect(message).toMatch(/could not be parsed/);
    expect(message).not.toContain(PASSWORD);
  });

  it("rejects a non-Postgres scheme", () => {
    const message = messageOf(() => assertSafeDatabaseUrl(`mysql://u:${PASSWORD}@localhost/db`, { env: {} }));
    expect(message).not.toContain(PASSWORD);
    expect(message).toMatch(/postgres/i);
  });

  it("rejects a URL whose host query parameter could redirect the connection", () => {
    const message = messageOf(() =>
      assertSafeDatabaseUrl(
        `postgresql://u:${PASSWORD}@localhost:5432/db?host=ep-quiet-bird.neon.tech`,
        { env: {} },
      ),
    );
    expect(message).toContain("host");
    expect(message).not.toContain(PASSWORD);
  });

  it("rejects a URL with no host (socket-style)", () => {
    expect(() => assertSafeDatabaseUrl("postgresql:///lms", { env: {} })).toThrow();
  });

  it("rejects an allow-listed staging host when the caller asked for the local target", () => {
    const env = { STAGING_DATABASE_HOSTS: STAGING_HOST, ALLOW_STAGING_DATABASE: "1" };
    const message = messageOf(() => assertSafeDatabaseUrl(STAGING_URL, { env }));
    expect(message).toContain(STAGING_HOST);
    expect(message).not.toContain(PASSWORD);
  });
});

describe("assertSafeDatabaseUrl: staging target", () => {
  it("accepts a host listed in STAGING_DATABASE_HOSTS when ALLOW_STAGING_DATABASE is 1", () => {
    const env = {
      STAGING_DATABASE_HOSTS: ` other.example.com , ${STAGING_HOST.toUpperCase()} `,
      ALLOW_STAGING_DATABASE: "1",
    };
    expect(assertSafeDatabaseUrl(STAGING_URL, { target: "staging", env })).toEqual({
      host: STAGING_HOST,
      target: "staging",
    });
  });

  it.each([undefined, "0", "true", "yes", ""])(
    "rejects the same host when ALLOW_STAGING_DATABASE is %s",
    (flag) => {
      const env: Record<string, string | undefined> = { STAGING_DATABASE_HOSTS: STAGING_HOST };
      if (flag !== undefined) env.ALLOW_STAGING_DATABASE = flag;
      const message = messageOf(() => assertSafeDatabaseUrl(STAGING_URL, { target: "staging", env }));
      expect(message).toContain(STAGING_HOST);
      expect(message).toContain("ALLOW_STAGING_DATABASE");
      expect(message).not.toContain(PASSWORD);
    },
  );

  it("rejects a host that is not on the staging list even with the flag", () => {
    const env = { STAGING_DATABASE_HOSTS: STAGING_HOST, ALLOW_STAGING_DATABASE: "1" };
    const message = messageOf(() => assertSafeDatabaseUrl(NEON_URL, { target: "staging", env }));
    expect(message).toContain("ep-quiet-bird-a1b2c3.eu-central-1.aws.neon.tech");
    expect(message).not.toContain(PASSWORD);
  });

  it("rejects everything remote when STAGING_DATABASE_HOSTS is empty", () => {
    const env = { ALLOW_STAGING_DATABASE: "1" };
    expect(() => assertSafeDatabaseUrl(STAGING_URL, { target: "staging", env })).toThrow();
  });

  it("still accepts a local host for the staging target", () => {
    expect(
      assertSafeDatabaseUrl("postgresql://u:p@localhost:5434/lms", { target: "staging", env: {} }),
    ).toEqual({ host: "localhost", target: "staging" });
  });
});

describe("assert-local-db CLI", () => {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const script = path.join("scripts", "ops", "assert-local-db.ts");

  function run(databaseUrl: string | undefined) {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.DATABASE_URL;
    if (databaseUrl !== undefined) env.DATABASE_URL = databaseUrl;
    return spawnSync("npx", ["tsx", script], { cwd: repoRoot, env, encoding: "utf8", shell: true });
  }

  it("exits 1 for a neon.tech URL and never prints the password", () => {
    const result = run(NEON_URL);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(PASSWORD);
    expect(result.stderr).toContain("neon.tech");
  }, 60_000);

  it("exits 1 when DATABASE_URL is unset (it does not fall back to .env)", () => {
    const result = run(undefined);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unset");
  }, 60_000);

  it("exits 0 for a local URL and names only the host", () => {
    const result = run(`postgresql://u:${PASSWORD}@localhost:5434/licence_test`);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("database target is local (localhost)");
    expect(result.stdout + result.stderr).not.toContain(PASSWORD);
  }, 60_000);
});
