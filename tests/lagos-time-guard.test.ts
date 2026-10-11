import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Whole-tree guard for D-17 (UI-SPEC S6): rendered dates and times go through
 * src/lib/format-timestamp.ts or <LagosTime />, never through a UTC Intl call
 * or the runtime-locale `toLocaleDateString` / `toLocaleTimeString`.
 *
 * Rejected on any non-comment line of any .ts or .tsx file under src/app and
 * src/components:
 * - a `timeZone` option with a literal UTC value
 * - `toLocaleDateString(`
 * - `toLocaleTimeString(`
 *
 * A `timeZone` taken from a variable (session schedules and calendars keep the
 * cohort's own zone, ledger OQ4) is not a literal UTC value and is not flagged.
 *
 * No file edited by plans 15-10, 15-32 or 15-33 may be added to ALLOW_LIST.
 */
const ROOTS = ["src/app", "src/components"];

const PATTERNS: Array<{ name: string; test: RegExp }> = [
  { name: "timeZone with a literal UTC value", test: /timeZone\s*:\s*["'`]UTC["'`]/i },
  { name: "toLocaleDateString(", test: /toLocaleDateString\(/ },
  { name: "toLocaleTimeString(", test: /toLocaleTimeString\(/ },
];

/** Files that really contain a rejected call but are outside the Lagos-time sweep. Every entry needs a reason. */
const ALLOW_LIST: Record<string, string> = {
  "src/app/staff/reports/[dataset]/ReportDashboard.tsx":
    "report filter date (filterDate) is already pinned to locale en-NG and zone Africa/Lagos, so it is deterministic; the reports dashboard is not part of the 15-10/15-32/15-33 sweep",
};

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
}

function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*");
}

function scan(): { offenders: string[]; seenAllowListed: Set<string> } {
  const root = process.cwd();
  const files: string[] = [];
  for (const r of ROOTS) walk(path.join(root, r), files);
  const offenders: string[] = [];
  const seenAllowListed = new Set<string>();
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (isCommentLine(line)) return;
      for (const p of PATTERNS) {
        if (!p.test.test(line)) continue;
        if (rel in ALLOW_LIST) {
          seenAllowListed.add(rel);
          continue;
        }
        offenders.push(`${rel}:${i + 1} (${p.name})`);
      }
    });
  }
  return { offenders, seenAllowListed };
}

// The walk reads the whole tree synchronously; give it room when the machine is busy.
const SCAN_TIMEOUT_MS = 60_000;

describe("Lagos-time guard (D-17, whole tree)", () => {
  it("finds no UTC or locale-dependent date rendering under src/app and src/components", () => {
    const { offenders } = scan();
    expect(offenders, `Lagos-time guard offenders:\n${offenders.join("\n")}`).toEqual([]);
  }, SCAN_TIMEOUT_MS);

  it("keeps the allow-list honest: every entry has a reason and still contains a rejected call", () => {
    const { seenAllowListed } = scan();
    for (const [file, reason] of Object.entries(ALLOW_LIST)) {
      expect(reason.trim().length, `${file} needs a reason`).toBeGreaterThan(10);
      expect(seenAllowListed.has(file), `${file} no longer contains a rejected call; remove it from the allow-list`).toBe(true);
    }
  }, SCAN_TIMEOUT_MS);

  it("never allow-lists a file edited by plans 15-10, 15-32 or 15-33", () => {
    const swept = [
      "src/app/(public)/CohortCards.tsx",
      "src/app/(public)/courses/page.tsx",
      "src/app/(public)/programmes/page.tsx",
      "src/app/(learner)/dashboard/page.tsx",
      "src/app/(checkout)/checkout/[orderId]/page.tsx",
      "src/components/learner/AssignmentSubmissionPanel.tsx",
      "src/components/learner/NextUpCard.tsx",
      "src/components/learner/QuizAttemptPanel.tsx",
      "src/components/learner/ResultsList.tsx",
      "src/components/notifications/NotificationItem.tsx",
      "src/app/verify/[verificationRef]/page.tsx",
      "src/components/catalogue/PublishDialog.tsx",
    ];
    for (const f of swept) expect(f in ALLOW_LIST, `${f} must not be allow-listed`).toBe(false);
    for (const f of Object.keys(ALLOW_LIST)) {
      expect(f.startsWith("src/app/staff/certificates/"), `${f} (15-32 slice) must not be allow-listed`).toBe(false);
    }
  });
});
