"use client";

import Link from "next/link";
import { useEffect } from "react";

export type RouteErrorPanelProps = {
  error: Error & { digest?: string };
  /** The boundary's `retry()` — re-fetches and re-renders the failed segment. */
  retry: () => void;
  home: { href: string; label: string };
};

/**
 * Body of every route `error.tsx`. Never renders `error.message`: in production a
 * Server Component error arrives as a generic message anyway, and a Client
 * Component error can carry internals. The digest is shown instead so a person
 * can quote it to support and it can be matched to the server log.
 */
export function RouteErrorPanel({ error, retry, home }: RouteErrorPanelProps) {
  useEffect(() => {
    console.$containerEnv = docker inspect learning-management-system-postgres-1 --format '{{range .Config.Env}}{{println .}}{{end}}'

$pgUser = (($containerEnv | Where-Object { $_ -like 'POSTGRES_USER=*' } | Select-Object -First 1) -split '=', 2)[1]
$pgPassword = (($containerEnv | Where-Object { $_ -like 'POSTGRES_PASSWORD=*' } | Select-Object -First 1) -split '=', 2)[1]
$pgDatabase = (($containerEnv | Where-Object { $_ -like 'POSTGRES_DB=*' } | Select-Object -First 1) -split '=', 2)[1]

$encodedUser = [Uri]::EscapeDataString($pgUser)
$encodedPassword = [Uri]::EscapeDataString($pgPassword)
$encodedDatabase = [Uri]::EscapeDataString($pgDatabase)

$env:DATABASE_URL = "postgresql://${encodedUser}:${encodedPassword}@localhost:5434/${encodedDatabase}?schema=public"

npm.cmd run deverror(error);
  }, [error]);

  return (
    <div role="alert" className="flex flex-col items-start gap-4 pb-12">
      <p className="text-base font-semibold text-foreground">Something went wrong loading this page</p>
      <p className="max-w-prose text-sm text-muted-foreground">
        This is usually temporary. Try again, and if it keeps happening, contact support with the reference below.
      </p>
      {error.digest && (
        <p className="text-sm text-muted-foreground">
          Reference <span className="font-mono text-foreground">{error.digest}</span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => retry()}
          className="inline-flex min-h-11 items-center rounded-md bg-accent px-6 text-sm font-semibold text-accent-contrast hover:bg-accent-deep"
        >
          Try again
        </button>
        <Link href={home.href} className="text-sm font-semibold text-accent underline underline-offset-2">
          {home.label}
        </Link>
      </div>
    </div>
  );
}
