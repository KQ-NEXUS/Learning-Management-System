/**
 * Phase 15, plan 15-31 (D-05, D-06, D-07): guard over the launch checklist.
 *
 * The checklist is a document people sign, so nothing in it can be proven by
 * running product code. What CAN be proven is that the document keeps three
 * promises, and this file fails when one of them is broken:
 *
 *  1. The ordered "Neon go-live migrations (in order)" list holds every
 *     migration folder from FIRST_LISTED_MIGRATION onward, in folder order.
 *     A new folder under prisma/migrations that is not added to the list
 *     fails here and is named in the failure (threat T-15-31-03).
 *  2. Every accepted waiver names a person and an expiry date, and no waiver,
 *     accepted or only proposed, is in a category that D-07 says is never
 *     waived: security, payment, authorization, private-file (threats
 *     T-15-31-01 and T-15-31-02, prohibition P2).
 *  3. Every owner item has an owner. Until the owner has named people (plan
 *     15-31, Task 2) the placeholder "to be named" is accepted; Task 3 flips
 *     OWNERS_ASSIGNED to true and the placeholder then counts as empty.
 *
 * It also checks that the tracked document carries no connection string, host
 * name or key (threat T-15-31-04).
 *
 * The rules are plain functions over markdown text, and each one has control
 * cases on made-up text, so a rule that silently stopped matching anything
 * would fail its own control case.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "prisma", "migrations");
const CHECKLIST_PATH = path.join(
  REPO_ROOT,
  ".planning",
  "phases",
  "15-launch-readiness-nfr-verification-operational-cutover",
  "15-LAUNCH-CHECKLIST.md",
);

/**
 * Flipped to true in plan 15-31, Task 3, once the owner has given a name for
 * every row. While false, the placeholder below is accepted in an Owner cell.
 */
const OWNERS_ASSIGNED = false;
const OWNER_PLACEHOLDER = "to be named";

/**
 * The plan requires every folder AFTER this one.
 */
const PLAN_BASELINE_MIGRATION = "20260927150000_video_watch_pacing";

/**
 * The list starts earlier than the plan's baseline. Plan 15-29 found that the
 * staging schema, copied from the production branch, lacked the five
 * 20260927... migrations as well, so production is probably 12 migrations
 * behind and not 7. The list therefore starts at the first of those five and
 * must hold every folder from there to the newest one.
 */
const FIRST_LISTED_MIGRATION = "20260927015627_communications_notifications";

const MIGRATION_HEADING = "Neon go-live migrations (in order)";
const OWNER_HEADING = "Owner items";
const WAIVER_HEADING = "Waivers (D-07)";
const MANUAL_HEADING = "Manual checks";
const HOW_TO_HEADING = "How to use this checklist";

const MIGRATION_FOLDER = /^\d{14}_[a-z0-9_]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** D-07: a waiver whose category mentions one of these is refused. */
const NEVER_WAIVE_PATTERNS: readonly RegExp[] = [
  /security/i,
  /payment/i,
  /authori[sz]ation/i,
  /private[\s-]*file/i,
];

/** Shapes that must never appear in a tracked, public document. */
const SECRET_PATTERNS: Readonly<Record<string, RegExp>> = {
  "a database connection string": /postgres(?:ql)?:\/\//i,
  "a Neon host name": /neon\.tech/i,
  "a Netlify host name": /netlify\.app/i,
  "a storage host name": /r2\.cloudflarestorage\.com|r2\.dev\//i,
  "a payment secret key": /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]+/,
  "a webhook signing secret": /\bwhsec_[A-Za-z0-9]+/,
  "a Brevo key": /\bxkeysib-[A-Za-z0-9-]+/,
  "a Neon branch or endpoint id": /\b(?:br|ep)-[a-z]+-[a-z]+-[a-z0-9]{6,}\b/,
};

// ---------------------------------------------------------------------------
// Markdown helpers
// ---------------------------------------------------------------------------

/** Text of one "## heading" section, up to the next "## " heading. */
export function sectionOf(markdown: string, heading: string): string | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^## (?!#)/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

export interface MarkdownTable {
  headers: string[];
  rows: Array<Record<string, string>>;
}

/** Every pipe table in a block of markdown, keyed by lower-cased header. */
export function tablesIn(markdown: string): MarkdownTable[] {
  const lines = markdown.split(/\r?\n/);
  const tables: MarkdownTable[] = [];
  let i = 0;
  while (i < lines.length) {
    const isHeader =
      lines[i].trim().startsWith("|") &&
      i + 1 < lines.length &&
      /^\|\s*:?-{3,}/.test(lines[i + 1].trim());
    if (!isHeader) {
      i += 1;
      continue;
    }
    const headers = splitRow(lines[i]).map((header) => header.toLowerCase());
    const rows: Array<Record<string, string>> = [];
    i += 2;
    while (i < lines.length && lines[i].trim().startsWith("|")) {
      const cells = splitRow(lines[i]);
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = cells[index] ?? "";
      });
      rows.push(row);
      i += 1;
    }
    tables.push({ headers, rows });
  }
  return tables;
}

function stripTicks(cell: string): string {
  return cell.replace(/`/g, "").trim();
}

// ---------------------------------------------------------------------------
// Rule 1: the ordered migration list
// ---------------------------------------------------------------------------

/** Folder names in the order the checklist lists them (table rows only). */
export function listedMigrations(markdown: string): string[] {
  const section = sectionOf(markdown, MIGRATION_HEADING);
  if (section === null) return [];
  const listed: string[] = [];
  for (const table of tablesIn(section)) {
    if (!table.headers.includes("migration folder")) continue;
    for (const row of table.rows) {
      const folder = stripTicks(row["migration folder"]);
      if (MIGRATION_FOLDER.test(folder)) listed.push(folder);
    }
  }
  return listed;
}

/** Problems with a listed order, given the real folders in folder order. */
export function migrationProblems(
  listed: readonly string[],
  folders: readonly string[],
  firstRequired: string,
): string[] {
  const problems: string[] = [];
  const startIndex = folders.indexOf(firstRequired);
  if (startIndex === -1) {
    return [`the first required migration ${firstRequired} is not a folder in prisma/migrations`];
  }
  const required = folders.slice(startIndex);
  for (const folder of required) {
    if (!listed.includes(folder)) {
      problems.push(`missing migration: ${folder} is in prisma/migrations but not in the checklist`);
    }
  }
  for (const folder of listed) {
    if (!folders.includes(folder)) {
      problems.push(`unknown migration: ${folder} is in the checklist but not in prisma/migrations`);
    }
  }
  const seen = new Set<string>();
  for (const folder of listed) {
    if (seen.has(folder)) problems.push(`listed twice: ${folder}`);
    seen.add(folder);
  }
  for (let i = 1; i < listed.length; i += 1) {
    if (listed[i - 1] >= listed[i]) {
      problems.push(`out of folder order: ${listed[i]} is listed after ${listed[i - 1]}`);
    }
  }
  return problems;
}

function realMigrationFolders(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && MIGRATION_FOLDER.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

// ---------------------------------------------------------------------------
// Rule 2: waivers
// ---------------------------------------------------------------------------

function isBlank(cell: string | undefined, placeholderIsBlank: boolean): boolean {
  const value = (cell ?? "").trim();
  if (value === "" || value === "-") return true;
  return placeholderIsBlank && value.toLowerCase() === OWNER_PLACEHOLDER;
}

export function waiverProblems(markdown: string): string[] {
  const section = sectionOf(markdown, WAIVER_HEADING);
  if (section === null) return [`the "${WAIVER_HEADING}" section is missing`];
  const problems: string[] = [];
  const tables = tablesIn(section).filter((table) => table.headers.includes("category"));
  if (!tables.some((table) => table.headers.includes("accepted by"))) {
    problems.push('no waiver table with an "Accepted by" column');
  }
  for (const table of tables) {
    const accepted = table.headers.includes("accepted by");
    for (const row of table.rows) {
      const name = row["finding"] || row["id"] || "(unnamed row)";
      const category = row["category"] ?? "";
      if (category.trim() === "") {
        problems.push(`waiver row has no category: ${name}`);
      }
      if (NEVER_WAIVE_PATTERNS.some((pattern) => pattern.test(category))) {
        problems.push(`never-waive category "${category}" on waiver row: ${name}`);
      }
      if (!accepted) continue;
      // A person is always required on an accepted waiver; the placeholder is
      // never a person, whatever OWNERS_ASSIGNED says.
      if (isBlank(row["accepted by"], true)) {
        problems.push(`accepted waiver names no person: ${name}`);
      }
      if (!ISO_DATE.test((row["expires"] ?? "").trim())) {
        problems.push(`accepted waiver has no expiry date (YYYY-MM-DD): ${name}`);
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Rule 3: owner items
// ---------------------------------------------------------------------------

export interface OwnerItemReport {
  rows: number;
  problems: string[];
}

export function ownerItemReport(markdown: string, ownersAssigned: boolean): OwnerItemReport {
  const section = sectionOf(markdown, OWNER_HEADING);
  if (section === null) return { rows: 0, problems: [`the "${OWNER_HEADING}" section is missing`] };
  const problems: string[] = [];
  let rows = 0;
  for (const table of tablesIn(section)) {
    if (!table.headers.includes("owner")) {
      problems.push(`a table under "${OWNER_HEADING}" has no Owner column`);
      continue;
    }
    for (const row of table.rows) {
      rows += 1;
      const name = row["id"] || row["item"] || "(unnamed row)";
      if (isBlank(row["item"], false)) problems.push(`owner item has no Item text: ${name}`);
      if (isBlank(row["owner"], ownersAssigned)) {
        problems.push(`owner item has an empty Owner cell: ${name}`);
      }
    }
  }
  return { rows, problems };
}

export function secretProblems(markdown: string): string[] {
  return Object.entries(SECRET_PATTERNS)
    .filter(([, pattern]) => pattern.test(markdown))
    .map(([label]) => `the document contains ${label}`);
}

// ---------------------------------------------------------------------------
// The real checklist
// ---------------------------------------------------------------------------

function readChecklist(): string {
  return readFileSync(CHECKLIST_PATH, "utf8");
}

describe("launch checklist (15-LAUNCH-CHECKLIST.md)", () => {
  it("has the five sections the plan names", () => {
    const text = readChecklist();
    for (const heading of [HOW_TO_HEADING, OWNER_HEADING, MIGRATION_HEADING, WAIVER_HEADING, MANUAL_HEADING]) {
      expect(sectionOf(text, heading), `missing section: ## ${heading}`).not.toBeNull();
    }
  });

  it("says production stays closed until every row is signed (D-06)", () => {
    const howTo = sectionOf(readChecklist(), HOW_TO_HEADING) ?? "";
    expect(howTo).toMatch(/production stays closed/i);
    expect(howTo).toContain("D-06");
  });

  it("lists every migration folder from the first unapplied one onward, in folder order", () => {
    const folders = realMigrationFolders();
    const listed = listedMigrations(readChecklist());
    expect(migrationProblems(listed, folders, FIRST_LISTED_MIGRATION)).toEqual([]);
  });

  it("covers every folder after the plan's baseline migration", () => {
    const folders = realMigrationFolders();
    const baseline = folders.indexOf(PLAN_BASELINE_MIGRATION);
    expect(baseline, `${PLAN_BASELINE_MIGRATION} must exist`).toBeGreaterThan(-1);
    const afterBaseline = folders.slice(baseline + 1);
    expect(afterBaseline.length).toBeGreaterThan(0);
    const listed = listedMigrations(readChecklist());
    const missing = afterBaseline.filter((folder) => !listed.includes(folder));
    expect(missing, `missing migration(s): ${missing.join(", ")}`).toEqual([]);
  });

  it("tells the reader to apply each migration over the direct connection and to check production first", () => {
    const section = sectionOf(readChecklist(), MIGRATION_HEADING) ?? "";
    expect(section).toContain("prisma migrate deploy");
    expect(section).toMatch(/direct connection/i);
    expect(section).toContain("prisma migrate status");
  });

  // Checklist row B-06: the deployment runbook once named four waiting
  // migrations while this list held twelve. The two must agree, in order.
  it("is repeated, in the same order, by the first go-live step of the deployment runbook", () => {
    const runbook = readFileSync(path.join(REPO_ROOT, "docs", "runbooks", "deployment.md"), "utf8");
    const before = sectionOf(runbook, "Before you deploy") ?? "";
    const step = before.split(/\r?\n(?=\d+\. )/).find((item) => item.includes("first go-live")) ?? "";
    const inRunbook = [...step.matchAll(/^\s+\d+\. `(\d{14}_[a-z0-9_]+)`/gm)].map((match) => match[1]);
    expect(inRunbook).toEqual(listedMigrations(readChecklist()));
    expect(inRunbook.length).toBeGreaterThanOrEqual(12);
    // "status" must come before the list: check production first, then apply.
    expect(step.indexOf("prisma migrate status")).toBeGreaterThan(-1);
    expect(step.indexOf("prisma migrate status")).toBeLessThan(step.indexOf(inRunbook[0] ?? "missing"));
  });

  it("names a person and an expiry on every accepted waiver and offers no never-waive category", () => {
    expect(waiverProblems(readChecklist())).toEqual([]);
  });

  it("has an owner on every owner item", () => {
    const report = ownerItemReport(readChecklist(), OWNERS_ASSIGNED);
    expect(report.rows).toBeGreaterThan(0);
    expect(report.problems).toEqual([]);
  });

  it("points at the manual checks file", () => {
    const section = sectionOf(readChecklist(), MANUAL_HEADING) ?? "";
    expect(section).toContain("e2e/MANUAL-CHECKS.md");
  });

  it("holds no connection string, host name or key", () => {
    expect(secretProblems(readChecklist())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Control cases: each rule must fail on text that breaks it
// ---------------------------------------------------------------------------

const FOLDERS = [
  "20260101000000_first",
  "20260201000000_second",
  "20260301000000_third",
  "20260401000000_fourth",
];

function migrationDoc(folders: readonly string[]): string {
  return [
    `## ${MIGRATION_HEADING}`,
    "",
    "Prose that names `20260101000000_first` must not count as a row.",
    "",
    "| Order | Migration folder | Purpose |",
    "| --- | --- | --- |",
    ...folders.map((folder, index) => `| ${index + 1} | \`${folder}\` | something |`),
    "",
    "## Next section",
    "",
    "| Order | Migration folder | Purpose |",
    "| --- | --- | --- |",
    "| 9 | `20260401000000_fourth` | outside the section |",
  ].join("\n");
}

describe("launch checklist rules (control cases)", () => {
  it("reads migration rows from the section's table only", () => {
    const listed = listedMigrations(migrationDoc(["20260201000000_second", "20260301000000_third"]));
    expect(listed).toEqual(["20260201000000_second", "20260301000000_third"]);
  });

  it("accepts a complete list in folder order", () => {
    const listed = listedMigrations(migrationDoc(FOLDERS.slice(1)));
    expect(migrationProblems(listed, FOLDERS, "20260201000000_second")).toEqual([]);
  });

  it("names a migration folder that is missing from the list", () => {
    const listed = listedMigrations(migrationDoc(["20260201000000_second", "20260301000000_third"]));
    expect(migrationProblems(listed, FOLDERS, "20260201000000_second")).toEqual([
      "missing migration: 20260401000000_fourth is in prisma/migrations but not in the checklist",
    ]);
  });

  it("rejects a list that is out of folder order", () => {
    const listed = listedMigrations(
      migrationDoc(["20260301000000_third", "20260201000000_second", "20260401000000_fourth"]),
    );
    expect(migrationProblems(listed, FOLDERS, "20260201000000_second")).toEqual([
      "out of folder order: 20260201000000_second is listed after 20260301000000_third",
    ]);
  });

  it("rejects a folder that does not exist and a folder listed twice", () => {
    const problems = migrationProblems(
      ["20260201000000_second", "20260201000000_second", "20260301000000_third", "20260401000000_fourth", "20260501000000_ghost"],
      FOLDERS,
      "20260201000000_second",
    );
    expect(problems).toContain("unknown migration: 20260501000000_ghost is in the checklist but not in prisma/migrations");
    expect(problems).toContain("listed twice: 20260201000000_second");
  });

  function waiverDoc(acceptedRows: string[], candidateRows: string[] = []): string {
    return [
      `## ${WAIVER_HEADING}`,
      "",
      "### Accepted waivers",
      "",
      "| Id | Finding | Category | Accepted by | Expires | Mitigation until then |",
      "| --- | --- | --- | --- | --- | --- |",
      ...acceptedRows,
      "",
      "### Candidates",
      "",
      "| Id | Finding | Category | Recommendation |",
      "| --- | --- | --- | --- |",
      ...candidateRows,
    ].join("\n");
  }

  it("accepts an empty waiver table and a complete waiver", () => {
    expect(waiverProblems(waiverDoc([]))).toEqual([]);
    expect(
      waiverProblems(waiverDoc(["| W-1 | Small links | accessibility | A. Person | 2027-01-31 | Keyboard works |"])),
    ).toEqual([]);
  });

  it("rejects an accepted waiver with no person, with the placeholder, or with no expiry date", () => {
    expect(waiverProblems(waiverDoc(["| W-1 | Small links | accessibility | | 2027-01-31 | x |"]))).toEqual([
      "accepted waiver names no person: Small links",
    ]);
    expect(waiverProblems(waiverDoc(["| W-1 | Small links | accessibility | to be named | 2027-01-31 | x |"]))).toEqual([
      "accepted waiver names no person: Small links",
    ]);
    expect(waiverProblems(waiverDoc(["| W-1 | Small links | accessibility | A. Person | soon | x |"]))).toEqual([
      "accepted waiver has no expiry date (YYYY-MM-DD): Small links",
    ]);
  });

  it.each(["security", "Payment", "authorization", "authorisation", "private-file", "private file", "minor security"])(
    "rejects the never-waive category %s on an accepted waiver and on a candidate",
    (category) => {
      const accepted = waiverProblems(
        waiverDoc([`| W-1 | Something | ${category} | A. Person | 2027-01-31 | x |`]),
      );
      expect(accepted).toEqual([`never-waive category "${category}" on waiver row: Something`]);
      const candidate = waiverProblems(waiverDoc([], [`| C-1 | Something | ${category} | accept |`]));
      expect(candidate).toEqual([`never-waive category "${category}" on waiver row: Something`]);
    },
  );

  it("rejects a waiver section without an accepted-waivers table, and a missing section", () => {
    const noTable = `## ${WAIVER_HEADING}\n\n| Id | Finding | Category |\n| --- | --- | --- |\n| C-1 | x | performance |`;
    expect(waiverProblems(noTable)).toEqual(['no waiver table with an "Accepted by" column']);
    expect(waiverProblems("## Something else\n")).toEqual([`the "${WAIVER_HEADING}" section is missing`]);
  });

  function ownerDoc(ownerCell: string): string {
    return [
      `## ${OWNER_HEADING}`,
      "",
      "### Group",
      "",
      "| Id | Item | Why | Owner | Due | Signed (name and date) |",
      "| --- | --- | --- | --- | --- | --- |",
      `| O-1 | Do the thing | Because | ${ownerCell} | | |`,
    ].join("\n");
  }

  it("rejects an empty Owner cell whether or not owners are assigned", () => {
    for (const assigned of [false, true]) {
      expect(ownerItemReport(ownerDoc(""), assigned).problems).toEqual([
        "owner item has an empty Owner cell: O-1",
      ]);
    }
  });

  it("accepts the placeholder before owners are assigned and rejects it afterwards", () => {
    expect(ownerItemReport(ownerDoc(OWNER_PLACEHOLDER), false)).toEqual({ rows: 1, problems: [] });
    expect(ownerItemReport(ownerDoc(OWNER_PLACEHOLDER), true).problems).toEqual([
      "owner item has an empty Owner cell: O-1",
    ]);
    expect(ownerItemReport(ownerDoc("A. Person"), true)).toEqual({ rows: 1, problems: [] });
  });

  it("rejects an owner table without an Owner column", () => {
    const text = `## ${OWNER_HEADING}\n\n| Id | Item |\n| --- | --- |\n| O-1 | x |`;
    expect(ownerItemReport(text, false).problems).toEqual([`a table under "${OWNER_HEADING}" has no Owner column`]);
  });

  it("flags connection strings, host names and keys", () => {
    expect(secretProblems("see postgresql://user:pw@host/db")).toEqual(["the document contains a database connection string"]);
    expect(secretProblems("the preview at something.netlify.app")).toEqual(["the document contains a Netlify host name"]);
    expect(secretProblems("key sk_test_abc123")).toEqual(["the document contains a payment secret key"]);
    expect(secretProblems("Set S3_ACCESS_KEY_ID on Netlify and check the Neon plan.")).toEqual([]);
  });
});
