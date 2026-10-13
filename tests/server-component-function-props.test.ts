/**
 * Static guard for audit A-04.
 *
 * A Server Component cannot hand an inline function to a Client Component:
 * React refuses to serialise it and the whole route fails with "Event handlers
 * cannot be passed to Client Component props". TypeScript and `next build` both
 * accept the code, so the crash only shows when that branch renders, which for
 * A-04 was the permission-denied branch nobody opens as an Administrator.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
  });
}

const serverComponents = walk("src/app")
  .filter((f) => f.endsWith(".tsx"))
  .filter((f) => !/^\s*["']use client["']/.test(read(f)));

// `prop={() => ...}`, `prop={(x) => ...}`, `prop={x => ...}`, `prop={function ...}`.
// An inline server action (`action={async () => { "use server"; ... }}`) is the
// one function a Server Component may pass, so `async` forms are not matched.
const INLINE_FUNCTION_PROP = /\b[A-Za-z]+=\{\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|\b[A-Za-z]+=\{\s*function\b/;

describe("Server Components pass no inline functions as props", () => {
  it("finds the Server Components to check", () => {
    expect(serverComponents.length).toBeGreaterThan(50);
    expect(serverComponents).toContain("src/app/staff/users/new/page.tsx");
    expect(serverComponents).toContain("src/app/staff/roles/new/page.tsx");
  });

  it("no page, layout or server-rendered component under src/app has an inline function prop", () => {
    const offenders = serverComponents.flatMap((file) =>
      read(file)
        .split(/\r?\n/)
        .map((line, index) => ({ line, at: `${file}:${index + 1}` }))
        .filter(({ line }) => INLINE_FUNCTION_PROP.test(line))
        .map(({ at }) => at),
    );
    expect(offenders).toEqual([]);
  });
});
