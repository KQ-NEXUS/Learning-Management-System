/**
 * Wording-consistency check for the post-grace licence state (plan 14-20, D-08a).
 *
 * Phase 14 decided that after the grace period the deployment runs in
 * "restricted continuity mode" (D-06), not the retired wording: grading,
 * certificates, refunds, webhooks and exports continue. The product documents,
 * UI copy, tests and runbooks must all say the same thing (RESEARCH Pitfall
 * 12). This file is the automated guard for that.
 *
 * Groups (each title starts with its prefix so a task can run its own group):
 *   licence-owned:    licence-owned source, test, runbook and deployment-doc
 *                     lines never use the banned wording
 *   tracked-docs:     tracked planning documents never use it on licence lines
 *   prd-18:, prd-19:  the amended PRD sections (local-only file, see below)
 *   pxr:              the amended PXR sections (local-only file, see below)
 *   phrase-owner:     the phrase is a string literal only in policy.ts
 *   amendment-record: the tracked record of every PRD and PXR edit
 *
 * The PRD and PXR live under docs/reference, which `.gitignore` excludes. In a
 * checkout without them (CI) their groups are skipped with a visible title
 * suffix; the tracked planning documents are always checked.
 *
 * The banned pattern is built at run time from fragments so this file itself
 * never contains the wording (a self-test asserts that).
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const rel = (...parts: string[]) => path.join(ROOT, ...parts);

/** The banned wording: the old name of the post-grace state, built from fragments. */
const BANNED = new RegExp(`\\b${["read", "[- ]", "only"].join("")}\\b`, "i");

const PRD_PATH = rel(
  "docs",
  "reference",
  "Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md",
);
const PXR_PATH = rel(
  "docs",
  "reference",
  "Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md",
);
const PRD_EXISTS = existsSync(PRD_PATH);
const PXR_EXISTS = existsSync(PXR_PATH);
const ABSENT_SUFFIX = " (docs/reference is gitignored and absent in this checkout)";
const PRD_SUFFIX = PRD_EXISTS ? "" : ABSENT_SUFFIX;
const PXR_SUFFIX = PXR_EXISTS ? "" : ABSENT_SUFFIX;

const SELF = rel("tests", "licence-wording.test.ts");
const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json", ".md", ".txt", ".sql", ".yml", ".yaml", ".toml",
]);
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".next", ".git"]);

function walk(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (SKIPPED_DIRECTORIES.has(entry)) continue;
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (TEXT_EXTENSIONS.has(path.extname(full))) found.push(full);
  }
  return found;
}

function filesIn(directory: string, pattern: RegExp): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => pattern.test(name))
    .map((name) => path.join(directory, name))
    .filter((full) => statSync(full).isFile());
}

/** Every licence-owned file that exists (the context list of plan 14-20). */
function licenceOwnedFiles(): string[] {
  const files = new Set<string>();
  const add = (list: string[]) => list.forEach((file) => files.add(path.resolve(file)));

  add(walk(rel("src", "server", "licence")));
  add(filesIn(rel("src", "server", "services"), /^licence-.*\.ts$/));
  add([rel("src", "server", "services", "event-mappers", "licence.ts")].filter(existsSync));
  add([rel("src", "server", "scheduled", "check-licence-task.ts")].filter(existsSync));
  add([rel("netlify", "functions", "check-licence.ts")].filter(existsSync));
  add(walk(rel("src", "app", "staff", "licence")));
  add(walk(rel("src", "app", "api", "staff", "licence")));
  add(walk(rel("src", "components", "licence")));
  add([rel("src", "instrumentation.ts")].filter(existsSync));
  add(walk(rel("provider-tools")));
  add(filesIn(rel("tests"), /^licence-/));
  add(filesIn(rel("tests", "components"), /^licence-/));
  add(filesIn(rel("tests", "support"), /^licence-/));
  add(
    [
      rel("tests", "check-licence-task.test.ts"),
      rel("tests", "netlify-check-licence.test.ts"),
      rel("tests", "event-mappers-licence.test.ts"),
    ].filter(existsSync),
  );
  files.delete(SELF);
  return [...files].sort();
}

const display = (file: string) => path.relative(ROOT, file).replaceAll("\\", "/");
const linesOf = (file: string) => readFileSync(file, "utf8").split(/\r?\n/);

/** The lines of a markdown file from the heading matching `start` to the next heading matching `end` (exclusive). */
function slice(lines: string[], start: RegExp, end: RegExp | null): string[] {
  const from = lines.findIndex((line) => start.test(line));
  if (from < 0) return [];
  let to = lines.length;
  if (end) {
    for (let index = from + 1; index < lines.length; index += 1) {
      if (end.test(lines[index])) {
        to = index;
        break;
      }
    }
  }
  return lines.slice(from, to);
}

const firstCell = (line: string) => (line.split("|")[1] ?? "").replaceAll("*", "").trim();
const rowStartingWith = (lines: string[], cell: RegExp) =>
  lines.find((line) => line.trimStart().startsWith("|") && cell.test(firstCell(line)));

function bannedLines(lines: string[]): string[] {
  return lines.filter((line) => BANNED.test(line));
}

const PRD_SECTION_18 = /^# \*\*18\./;
const PRD_ANY_TOP = /^# \*\*\d+\./;
const PRD_18_2 = /^## \*\*18\.2 /;
const PRD_18_3 = /^## \*\*18\.3 /;

// ---------------------------------------------------------------------------

describe("licence-owned: no banned wording in licence-owned files", () => {
  const files = licenceOwnedFiles();

  it("scans a non-trivial set of licence-owned files", () => {
    // Guard against a vacuous pass: the sources, tests and runbook all exist.
    expect(files.length).toBeGreaterThan(40);
    const shown = files.map(display);
    expect(shown).toContain("src/server/licence/policy.ts");
    expect(shown).toContain("provider-tools/licence-issuer/RUNBOOK.md");
    expect(shown).toContain("tests/licence-policy.test.ts");
  });

  it("no licence-owned file line uses the banned wording", () => {
    const offenders: string[] = [];
    for (const file of files) {
      linesOf(file).forEach((line, index) => {
        if (BANNED.test(line)) offenders.push(`${display(file)}:${index + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the Licence check section of the deployment doc uses no banned wording", () => {
    const doc = rel("docs", "deployment", "netlify-scheduled-functions.md");
    const section = slice(linesOf(doc), /^## Licence check/, /^## /);
    expect(section.length).toBeGreaterThan(3);
    expect(bannedLines(section)).toEqual([]);
  });

  it("this file never contains the banned wording (self-test)", () => {
    const own = readFileSync(SELF, "utf8");
    expect(BANNED.test(own)).toBe(false);
  });

  it("the banned pattern recognises the wording it is meant to catch", () => {
    const hyphen = ["read", "-", "only"].join("");
    const spaced = ["read", " ", "only"].join("");
    expect(BANNED.test(`state is ${hyphen} now`)).toBe(true);
    expect(BANNED.test(`${spaced.toUpperCase()} mode`)).toBe(true);
    // A TypeScript modifier or a word that merely ends in "read" is not the banned wording.
    expect(BANNED.test(["readonly", " string[]"].join(""))).toBe(false);
    expect(BANNED.test(["thre", "ad only"].join(""))).toBe(false);
  });
});

describe(`prd-18: PRD section 18 uses restricted continuity mode${PRD_SUFFIX}`, () => {
  const lines = PRD_EXISTS ? linesOf(PRD_PATH) : [];
  const section18 = slice(lines, PRD_SECTION_18, PRD_ANY_TOP);
  const states = slice(lines, PRD_18_2, PRD_18_3);

  it.skipIf(!PRD_EXISTS)("no line in section 18 uses the banned wording", () => {
    expect(section18.length).toBeGreaterThan(30);
    expect(bannedLines(section18)).toEqual([]);
  });

  it.skipIf(!PRD_EXISTS)("the section 18.2 states table has the restricted continuity mode row only", () => {
    expect(states.length).toBeGreaterThan(5);
    expect(rowStartingWith(states, /^Restricted continuity mode/)).toBeDefined();
    expect(rowStartingWith(states, /Expired \/ /)).toBeUndefined();
    const row = rowStartingWith(states, /^Restricted continuity mode/) ?? "";
    expect(firstCell(row)).toBe("Restricted continuity mode (after the grace period)");
  });

  it.skipIf(!PRD_EXISTS)("the section 18.2 row states what continues and what is blocked", () => {
    const row = rowStartingWith(states, /^Restricted continuity mode/) ?? "";
    for (const phrase of [
      "application-level",
      "never a database-wide switch",
      "new enrolments",
      "new checkout sessions",
      "publishing",
      "staff and permission changes",
      "settings changes",
      "coursework",
      "progress recording",
      "submissions",
      "assessment",
      "grading",
      "certificate issuance",
      "sign-in",
      "security administration",
      "payment webhooks",
      "refunds and reversals",
      "data export",
      "licence activation",
      "transactional email",
      "in-product notifications",
      "nothing is deleted",
    ]) {
      expect(row.toLowerCase(), phrase).toContain(phrase);
    }
    expect(row).toContain(
      "Administrator sees renewal instructions, licence details, the licence activation route and the data export route.",
    );
  });

  it.skipIf(!PRD_EXISTS)("LIC-05 and LIC-08 say restricted continuity mode", () => {
    const lic05 = lines.find((line) => line.startsWith("| LIC-05 |")) ?? "";
    const lic08 = lines.find((line) => line.startsWith("| LIC-08 |")) ?? "";
    expect(lic05.toLowerCase()).toContain("restricted continuity mode");
    expect(lic08.toLowerCase()).toContain("restricted continuity mode");
  });

  it.skipIf(!PRD_EXISTS)("the section 18.6 post-expiry row says restricted continuity mode", () => {
    const row = lines.find((line) => line.startsWith("| Post-expiry learner access")) ?? "";
    expect(row.toLowerCase()).toContain("use restricted continuity mode and no deletion");
  });

  it.skipIf(!PRD_EXISTS)("revision history row 5 records the user-directed amendment", () => {
    const history = slice(lines, /^## 1\.2 Revision history/, /^## /);
    const rows = history.filter((line) => /^\|\s*\*{0,2}\d+\*{0,2}\s*\|/.test(line));
    expect(rows).toHaveLength(5);
    const five = rows[4];
    expect(five).toContain("1 Oct 2026");
    expect(five).toContain("Amendment (user-directed, Phase 14)");
    expect(five.toLowerCase()).toContain("restricted continuity mode");
    expect(five.toLowerCase()).toContain("commercial contract controls any remaining discrepancy");
  });
});

describe("phrase-owner: the phrase is a string literal only in policy.ts", { timeout: 60_000 }, () => {
  const PHRASE = /restricted continuity mode/i;
  const OWNER = "src/server/licence/policy.ts";

  function literalHits(file: string, source: string): string[] {
    const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
    const hits: string[] = [];
    const visit = (node: ts.Node) => {
      // Comments are not nodes, so only literal and template text is inspected.
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        if (PHRASE.test(node.text)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          hits.push(`${file}:${line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return hits;
  }

  it("the scanner finds a literal, a template and ignores a comment (fixtures)", () => {
    const phrase = "restricted continuity" + " mode";
    expect(literalHits("a.ts", `const a = "x ${phrase} y";`)).toHaveLength(1);
    expect(literalHits("a.ts", "const a = `x " + phrase.toUpperCase() + " ${1} y`;")).toHaveLength(1);
    expect(literalHits("a.ts", "const a = `x ${1} " + phrase + "`;")).toHaveLength(1);
    expect(literalHits("a.tsx", `const a = <p title="${phrase}">hi</p>;`)).toHaveLength(1);
    expect(literalHits("a.ts", `// ${phrase}\n/* ${phrase} */\nconst a = 1;`)).toHaveLength(0);
  });

  it("no source file under src defines the phrase as a literal except policy.ts", () => {
    const files = walk(rel("src")).filter((file) => /\.tsx?$/.test(file));
    expect(files.length).toBeGreaterThan(200);
    const offenders: string[] = [];
    for (const file of files) {
      const name = display(file);
      if (name === OWNER) continue;
      const source = readFileSync(file, "utf8");
      // Cheap pre-filter: a literal containing the phrase also contains it as raw text,
      // so only those files need the full syntax-tree walk.
      if (PHRASE.test(source)) offenders.push(...literalHits(name, source));
    }
    expect(offenders).toEqual([]);
  });

  it("policy.ts owns the phrase through RESTRICTED_CONTINUITY_LABEL", () => {
    const source = readFileSync(rel(...OWNER.split("/")), "utf8");
    expect(literalHits(OWNER, source)).toHaveLength(1);
    expect(source).toContain('export const RESTRICTED_CONTINUITY_LABEL = "Restricted continuity mode";');
  });
});

describe(`prd-19: PRD section 19 describes payments in restricted continuity mode${PRD_SUFFIX}`, () => {
  const lines = PRD_EXISTS ? linesOf(PRD_PATH) : [];
  const section19 = slice(lines, /^# \*\*19\./, PRD_ANY_TOP);
  const interaction = rowStartingWith(section19, /^Software licence interaction$/) ?? "";
  const matrix = rowStartingWith(section19, /^End-to-end test matrix$/) ?? "";

  it.skipIf(!PRD_EXISTS)("the Software licence interaction row follows D-08", () => {
    expect(interaction).not.toBe("");
    const lower = interaction.toLowerCase();
    for (const phrase of [
      "restricted continuity mode",
      "webhooks",
      "reconciliation",
      "refunds",
      "reversals",
      "disputes",
      "initiated before the restriction",
      "new checkout sessions is blocked",
      "created before the restriction",
      "never deleted",
    ]) {
      expect(lower, phrase).toContain(phrase);
    }
    expect(lower).not.toContain("blocks payment confirmation");
  });

  it.skipIf(!PRD_EXISTS)("the end-to-end test matrix row names the new scenarios", () => {
    expect(matrix).not.toBe("");
    expect(matrix).toContain("restricted-continuity-mode behaviour");
    expect(matrix).toContain("in-flight payment");
    expect(matrix).toContain("expiry during an in-flight payment");
    expect(matrix).not.toContain("expired-licence restriction");
  });

  it.skipIf(!PRD_EXISTS)("no line in section 19 uses the banned wording", () => {
    expect(section19.length).toBeGreaterThan(50);
    expect(bannedLines(section19)).toEqual([]);
  });
});

describe(`pxr: PXR section 11 and 12.4 describe restricted continuity mode${PXR_SUFFIX}`, () => {
  const lines = PXR_EXISTS ? linesOf(PXR_PATH) : [];
  const licenceLines = lines.filter((line) => /licen[cs]e|expir|grace|restrict/i.test(line));
  const matrix = slice(lines, /^## \*\*11\.3 /, /^## \*\*11\.4 /);
  const cells = (line: string) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.replaceAll("*", "").trim());

  it.skipIf(!PXR_EXISTS)("no licence, expiry, grace or restriction line uses the banned wording", () => {
    expect(licenceLines.length).toBeGreaterThan(20);
    expect(bannedLines(licenceLines)).toEqual([]);
  });

  it.skipIf(!PXR_EXISTS)("the section 11.1 row is Restricted continuity mode", () => {
    const states = slice(lines, /^## \*\*11\.1 /, /^## \*\*11\.2 /);
    expect(rowStartingWith(states, /^Restricted continuity mode$/)).toBeDefined();
    expect(rowStartingWith(states, /Expired \/ /)).toBeUndefined();
    const row = rowStartingWith(states, /^Restricted continuity mode$/) ?? "";
    for (const phrase of ["refused server-side and in the UI", "grading", "certificates", "refunds", "webhooks", "exports", "licence activation", "existing enrolments continue learning"]) {
      expect(row, phrase).toContain(phrase);
    }
  });

  it.skipIf(!PXR_EXISTS)("the section 11.3 matrix header's fourth column is Restricted continuity mode", () => {
    const header = matrix.find((line) => line.includes("Active / expiring soon")) ?? "";
    expect(cells(header)[3]).toBe("Restricted continuity mode");
  });

  it.skipIf(!PXR_EXISTS)("the section 11.3 attendance, grading and certificate row is not blocked", () => {
    const row = matrix.find((line) => firstCell(line).startsWith("Record/correct attendance")) ?? "";
    expect(row).not.toBe("");
    const restricted = cells(row)[3];
    expect(restricted).not.toMatch(/blocked/i);
    expect(restricted.toLowerCase()).toContain("existing enrolments continue");
  });

  it.skipIf(!PXR_EXISTS)("the section 11.3 payment row allows refunds and webhooks but blocks new checkout", () => {
    const row = matrix.find((line) => firstCell(line).startsWith("Confirm payment")) ?? "";
    const restricted = cells(row)[3].toLowerCase();
    expect(restricted).toContain("refunds, reversals and webhooks allowed");
    expect(restricted).toContain("created before the restriction");
    expect(restricted).toContain("new checkout blocked");
  });

  it.skipIf(!PXR_EXISTS)("the section 11.3 publish, settings and staff rows stay blocked with licence.activate as recovery", () => {
    const publish = matrix.find((line) => firstCell(line).startsWith("Publish Course")) ?? "";
    expect(cells(publish)[3]).toMatch(/blocked/i);
    const staff = matrix.find((line) => firstCell(line).startsWith("Create staff")) ?? "";
    expect(cells(staff)[3]).toMatch(/blocked/i);
    expect(cells(staff)[3]).toContain("licence.activate");
  });

  it.skipIf(!PXR_EXISTS)("the section 11.4 restrict step reaches the restricted continuity mode threshold", () => {
    const flow = slice(lines, /^## \*\*11\.4 /, /^## \*\*11\.5 /);
    const step = flow.find((line) => firstCell(line).startsWith("5. Restrict")) ?? "";
    expect(step.toLowerCase()).toContain("restricted continuity mode threshold");
  });

  it.skipIf(!PXR_EXISTS)("the section 12.4 licence row and the implementation handoff follow D-08", () => {
    const integrity = slice(lines, /^## \*\*12\.4 /, /^## \*\*12\.5 /);
    const row = rowStartingWith(integrity, /^LMS licence/) ?? "";
    expect(row).not.toBe("");
    expect(firstCell(row)).toBe("LMS licence in restricted continuity mode");
    for (const phrase of ["new checkout sessions are blocked for every method", "initiated before the restriction", "webhooks", "reconciliation", "refunds", "reversals"]) {
      expect(row, phrase).toContain(phrase);
    }
    const handoff = lines.filter((line) => line.includes("Update the payment acceptance traceability")).join("\n");
    expect(handoff).toContain("restricted-continuity-mode behaviour");
    expect(handoff).not.toContain("expired-licence restriction");
  });
});

describe("tracked-docs: tracked planning documents use restricted continuity mode", () => {
  const TRACKED = [
    [".planning", "REQUIREMENTS.md"],
    [".planning", "ROADMAP.md"],
    [".planning", "intel", "requirements.md"],
  ];
  const LICENCE_CONTEXT = /licen[cs]e|expir|grace|LIC-|restrict/i;

  it.each(TRACKED.map((parts) => [parts.join("/"), parts] as const))(
    "%s: no licence, expiry, grace or restriction line uses the banned wording",
    (_name, parts) => {
      const file = rel(...parts);
      expect(existsSync(file), `${_name} is tracked and must exist`).toBe(true);
      const contextLines = linesOf(file).filter((line) => LICENCE_CONTEXT.test(line));
      expect(contextLines.length).toBeGreaterThan(5);
      expect(bannedLines(contextLines)).toEqual([]);
    },
  );

  it("REQUIREMENTS.md LIC-05 and LIC-08 say restricted continuity mode", () => {
    const lines = linesOf(rel(".planning", "REQUIREMENTS.md"));
    const lic05 = lines.find((line) => line.includes("**LIC-05**")) ?? "";
    const lic08 = lines.find((line) => line.includes("**LIC-08**")) ?? "";
    expect(lic05.toLowerCase()).toContain("restricted continuity mode");
    expect(lic08).toContain("**LIC-08**: Restricted continuity mode preserves");
  });

  it("ROADMAP.md Phase 14 entry and criterion 3 say restricted continuity mode", () => {
    const lines = linesOf(rel(".planning", "ROADMAP.md"));
    const entry = lines.find((line) => line.includes("**Phase 14: Software Licence & Deployment Control**")) ?? "";
    expect(entry).toContain("expiry-driven restricted continuity mode enforcement");
    const criterion = lines.find((line) => line.includes("(LIC-05, LIC-08)") && line.includes("expiry/grace threshold")) ?? "";
    expect(criterion).toContain("enforces restricted continuity mode server-side and in the UI");
  });

  it("intel/requirements.md mirrors LIC-05 and LIC-08 with the new wording", () => {
    const text = readFileSync(rel(".planning", "intel", "requirements.md"), "utf8");
    expect(text).toContain("the LMS MUST enforce the configured restricted continuity mode server-side and in the UI.");
    expect(text).toContain("- description: Restricted continuity mode MUST preserve the records");
  });

  it("the permission catalogue comment no longer says the licence module is deferred", () => {
    const source = readFileSync(rel("src", "server", "permissions", "catalogue.ts"), "utf8");
    expect(source).not.toContain("The licence module is deferred");
    expect(source).toContain("Licence (Phase 14)");
  });
});

describe("amendment-record: 14-PRD-AMENDMENT.md lists every PRD and PXR edit", () => {
  const RECORD = rel(".planning", "phases", "14-software-licence-deployment-control", "14-PRD-AMENDMENT.md");

  it("exists and its table has at least 10 data rows", () => {
    expect(existsSync(RECORD)).toBe(true);
    const pipeLines = linesOf(RECORD).filter((line) => line.startsWith("|"));
    expect(pipeLines[0]).toBe("| Document | Section | Old text (abridged to one line) | New text (abridged to one line) |");
    expect(pipeLines[1]).toMatch(/^\| ?-+/);
    const dataRows = pipeLines.slice(2);
    expect(dataRows.length).toBeGreaterThanOrEqual(10);
    for (const row of dataRows) expect(row.split("|").length, row).toBe(6);
  });

  it("covers the PRD sections and the PXR sections amended by the plan", () => {
    const text = readFileSync(RECORD, "utf8");
    for (const needle of [
      "| PRD | 1.2 Revision history",
      "| PRD | 18.2 ",
      "| PRD | 18.3 LIC-05",
      "| PRD | 18.3 LIC-08",
      "| PRD | 18.6 ",
      "| PRD | 19.4 ",
      "| PRD | 19.5 ",
      "| PXR | 11.1 ",
      "| PXR | 11.3 ",
      "| PXR | 11.4 ",
      "| PXR | 12.4 ",
      "| PXR | Implementation handoff",
    ]) {
      expect(text, needle).toContain(needle);
    }
  });

  it("records the gitignore finding, the contract and the owner follow-ups", () => {
    const text = readFileSync(RECORD, "utf8");
    expect(text).toContain("gitignored");
    expect(text).toContain("commercial contract");
    expect(text).toContain("`.docx` twins");
  });
});
