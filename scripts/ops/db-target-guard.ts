/**
 * Database-target guard (Phase 15, plan 15-07; P1 / D-01, NFR-08).
 *
 * The repository's `.env` points at the shared Neon database. Every Phase 15
 * script that reads or writes a database (seed-load, integrity checks, restore
 * rehearsal, schema pushes) calls `assertSafeDatabaseUrl` FIRST, before it
 * imports Prisma or opens a connection, so a script started from a shell that
 * happens to carry the shared URL refuses to run instead of touching real
 * learner data.
 *
 * Rules:
 *   - Local hosts are always allowed: localhost, 127.0.0.1, ::1 and
 *     host.docker.internal (a container reaching the developer's Postgres).
 *   - A remote host is allowed only when the caller explicitly asks for the
 *     `staging` target AND the host is listed in STAGING_DATABASE_HOSTS
 *     (comma-separated) AND ALLOW_STAGING_DATABASE is exactly "1".
 *   - Anything else throws: a remote host, an unset or blank value, an
 *     unparseable URL, a non-Postgres scheme, a URL with no host, and a URL
 *     whose `host`/`hostaddr` query parameter could redirect the connection.
 *
 * Messages name the host only. They never include the user, the password or
 * the connection string, because these messages land in terminal scrollback
 * and CI logs.
 *
 * This module has no imports on purpose: it must be loadable before anything
 * that reads `.env` or constructs a database client.
 */

export type DatabaseTarget = "local" | "staging";

export type AssertSafeDatabaseUrlOptions = {
  /** Defaults to "local". Only "staging" consults the staging allow-list. */
  target?: DatabaseTarget;
  /** Environment to read the staging allow-list from; defaults to process.env. */
  env?: Record<string, string | undefined>;
};

export type SafeDatabaseTarget = {
  /** The bare host name (IPv6 without brackets), safe to print. */
  host: string;
  target: DatabaseTarget;
};

const LOCAL_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "host.docker.internal",
]);

const POSTGRES_PROTOCOLS: ReadonlySet<string> = new Set(["postgresql:", "postgres:"]);

/** Query parameters libpq-style drivers honour as a connection host override. */
const HOST_OVERRIDE_PARAMS = ["host", "hostaddr"];

function normaliseHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
}

/** True for the four host names the guard treats as this machine. */
export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(normaliseHost(hostname));
}

function stagingHosts(env: Record<string, string | undefined>): Set<string> {
  return new Set(
    (env.STAGING_DATABASE_HOSTS ?? "")
      .split(",")
      .map(normaliseHost)
      .filter((host) => host.length > 0),
  );
}

/**
 * Throws a plain Error unless `url` names a database this script may touch.
 * Returns the bare host and the target on success.
 */
export function assertSafeDatabaseUrl(
  url: string | null | undefined,
  options: AssertSafeDatabaseUrlOptions = {},
): SafeDatabaseTarget {
  const target: DatabaseTarget = options.target ?? "local";
  const env = options.env ?? process.env;

  if (url === undefined || url === null || url.trim() === "") {
    throw new Error(
      "Refusing to run: DATABASE_URL is unset. Export a local DATABASE_URL in this shell first; scripts never fall back to .env.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error("Refusing to run: DATABASE_URL could not be parsed as a URL (value not shown).");
  }

  const host = normaliseHost(parsed.hostname);
  const shownHost = host === "" ? "(none)" : host;

  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(
      `Refusing to run against host "${shownHost}": DATABASE_URL must use the postgresql:// or postgres:// scheme.`,
    );
  }

  if (host === "") {
    throw new Error(
      'Refusing to run: DATABASE_URL has no host (socket-style URLs are not allowed). Use a postgresql://user@localhost:port/db URL.',
    );
  }

  for (const param of HOST_OVERRIDE_PARAMS) {
    if (parsed.searchParams.has(param)) {
      throw new Error(
        `Refusing to run against host "${shownHost}": DATABASE_URL carries a "${param}" query parameter, which could redirect the connection to another host.`,
      );
    }
  }

  if (isLocalHost(host)) {
    return { host, target };
  }

  if (target !== "staging") {
    throw new Error(
      `Refusing to run against database host "${shownHost}": only local hosts (localhost, 127.0.0.1, ::1, host.docker.internal) are allowed. Point DATABASE_URL at the local Docker Postgres.`,
    );
  }

  if (!stagingHosts(env).has(host)) {
    throw new Error(
      `Refusing to run against database host "${shownHost}": it is not listed in STAGING_DATABASE_HOSTS.`,
    );
  }

  if (env.ALLOW_STAGING_DATABASE !== "1") {
    throw new Error(
      `Refusing to run against staging database host "${shownHost}": set ALLOW_STAGING_DATABASE=1 to confirm this run targets staging.`,
    );
  }

  return { host, target };
}
