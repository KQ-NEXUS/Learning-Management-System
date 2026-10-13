/**
 * Runbook coverage guard (plan 15-11; NFR-12, NFR-13).
 *
 * Every Netlify function must have written recovery steps. This test derives
 * the function names from the files in netlify/functions, so adding a new
 * function without documenting it in BOTH the job-recovery runbook and the
 * scheduled-functions document fails here. It also pins the four recovery
 * headings and the headings the other runbooks are referred to by.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const FUNCTIONS_DIR = path.join(ROOT, "netlify", "functions");
const JOB_RECOVERY = "docs/runbooks/job-recovery.md";
const SCHEDULED_FUNCTIONS = "docs/deployment/netlify-scheduled-functions.md";

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

function functionNames(): string[] {
  return readdirSync(FUNCTIONS_DIR)
    .filter((file) => /\.(ts|mts|js|mjs)$/.test(file) && !/\.test\./.test(file))
    .map((file) => file.replace(/\.(ts|mts|js|mjs)$/, ""))
    .sort();
}

function headings(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .filter((line) => /^#{1,6} /.test(line))
    .map((line) => line.replace(/^#{1,6} /, "").trim());
}

/** True when `name` appears as a whole function name (not a prefix of another). */
function mentions(markdown: string, name: string): boolean {
  return new RegExp(`(^|[^a-z0-9-])${name.replace(/[-]/g, "\\-")}([^a-z0-9-]|$)`, "m").test(markdown);
}

describe("netlify/functions inventory", () => {
  it("finds the ten functions (nine scheduled plus the background export processor)", () => {
    const names = functionNames();
    expect(names).toHaveLength(10);
    expect(names).toContain("process-export-jobs-background");
  });
});

describe.each([JOB_RECOVERY, SCHEDULED_FUNCTIONS])("%s", (doc) => {
  const text = read(doc);

  it.each(functionNames())("documents %s", (name) => {
    expect(mentions(text, name), `${name} is missing from ${doc}`).toBe(true);
  });
});

describe("job-recovery.md", () => {
  const text = read(JOB_RECOVERY);
  const titles = headings(text);

  it.each(["Poisoned events", "Failed exports", "Failed emails", "Stuck webhooks"])(
    "has the recovery heading %s",
    (heading) => {
      expect(titles, `missing heading "${heading}"`).toContain(heading);
    },
  );

  it("gives every function its own section heading", () => {
    for (const name of functionNames()) {
      expect(
        titles.some((title) => mentions(title, name)),
        `no section heading names ${name}`,
      ).toBe(true);
    }
  });

  it("states for every function whether a re-run is safe", () => {
    const sections = text.split(/\r?\n(?=#{2,3} )/);
    for (const name of functionNames()) {
      const section = sections.find((s) => mentions(s.split(/\r?\n/)[0], name));
      expect(section, `no section for ${name}`).toBeDefined();
      expect(section, `${name} section does not say whether a re-run is safe`).toMatch(/Safe to re-run:/);
      expect(section, `${name} section has no ops page signal`).toMatch(/Operations status signal:/);
    }
  });
});

describe("other runbooks keep their required headings", () => {
  const required: Record<string, string[]> = {
    "docs/runbooks/deployment.md": [
      "Before you deploy",
      "Environment variables by deploy context",
      "Run migrations first",
      "Deploy",
      "After deploy checks",
      "Self-hosted Docker note",
    ],
    "docs/runbooks/restore.md": [
      "Targets (RPO 24h, RTO 8h)",
      "Route A: Neon point-in-time branch",
      "Route B: dump restored into Docker",
      "Files in object storage",
      "Record the timings",
    ],
    "docs/runbooks/rollback.md": ["Roll back the code", "Migrations are forward-only", "When to restore instead"],
    "docs/runbooks/incident-and-secrets.md": [
      "Who to call",
      "Reading the Operations status page",
      "Reading the host logs",
      "Rotating secrets",
    ],
  };

  it.each(Object.entries(required))("%s", (doc, needed) => {
    const titles = headings(read(doc));
    for (const heading of needed) expect(titles, `${doc} is missing "${heading}"`).toContain(heading);
  });

  it("README links the runbooks and no longer points at Vercel", () => {
    const readme = read("README.md");
    expect(readme).toContain("docs/runbooks");
    expect(readme).not.toMatch(/Deploy on Vercel/);
  });
});
