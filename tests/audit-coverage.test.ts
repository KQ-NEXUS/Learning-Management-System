/**
 * NFR-07 — audit coverage guard.
 *
 * Security and sensitive-business events must stay auditable. This static
 * scan reads every `.ts` file under `src/server` once, collects the action
 * strings written into audit events, and fails if any REQUIRED action has
 * lost its last write site, naming the missing string.
 *
 * A write site is the value of an `action:` property: a string literal
 * (`action: "refund.recorded"`), a conditional over literals
 * (`action: isSystem ? "certificate.issued_auto" : "certificate.issued"`,
 * including multi-line ternaries), or a named constant declared in
 * `src/server` (`action: RATE_LIMIT_BLOCKED_ACTION`). Query filters such as
 * `action: { in: [...] }` and comment lines are not write sites.
 *
 * Plans 15-16 and 15-21 add the privacy actions to REQUIRED_AUDIT_ACTIONS
 * when they introduce them.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SERVER_ROOT = path.resolve(import.meta.dirname, "..", "src", "server");

/** Grouped so a reviewer can see why each one is required. */
export const REQUIRED_AUDIT_ACTIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  identity: [
    "auth.sign_in.succeeded",
    "auth.sign_in.failed",
    "auth.sign_in.throttled",
    "auth.sign_out",
    "rate_limit.blocked",
    "user.verified",
    "user.password_reset",
    "user.email_changed",
  ],
  authorization: ["authorization.denied"],
  roles: ["role.created", "role.updated", "assignment.created", "assignment.revoked"],
  users: ["user.created", "user.deactivated", "user.reactivated"],
  money: [
    "order.paid",
    "payment.manual_confirmed",
    "payment.reconciled",
    "refund.recorded",
    "reconciliation.case_resolved",
  ],
  grades: ["grade.released", "grade.released_batch", "grade.overridden"],
  credentials: ["certificate.issued", "certificate.issued_auto", "certificate.revoked", "certificate.reissued"],
  exports: ["export.requested", "export.download_authorized"],
  licence: ["licence.activated", "licence.activation_rejected", "licence.state_changed", "licence.restriction_enforced"],
  failures: ["domain_event.poisoned", "refund.access_revoke_failed"],
  // Plans 15-16 and 15-21 (D-12, NFR-11): anonymise and the learner data export.
  privacy: ["privacy.learner_anonymised", "privacy.learner_export_requested"],
});

const ACTION_STRING = /"([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)"/g;
const CONSTANT_DECLARATION = /\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*"([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)"/g;
const PROPERTY_LINE = /^\s*(?:[A-Za-z_$][\w$]*|"[^"]+")\??\s*:(?!:)/;

function serverSources(dir: string = SERVER_ROOT): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...serverSources(full));
    else if (entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

/** Drops whole-line comments so prose that mentions an action is not counted. */
function codeLines(source: string): string[] {
  let inBlock = false;
  const lines: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (inBlock) {
      if (trimmed.includes("*/")) inBlock = false;
      continue;
    }
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inBlock = true;
      continue;
    }
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    lines.push(line);
  }
  return lines;
}

/** The property value only: stops at the first comma or closing bracket outside any nesting. */
function untilTopLevelComma(value: string): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return value.slice(0, i);
      depth--;
    } else if (ch === "," && depth === 0) return value.slice(0, i);
  }
  return value;
}

/** The action strings written by `action:` properties across the given sources. */
export function extractAuditActions(sources: readonly string[]): Set<string> {
  const constants = new Map<string, string>();
  for (const source of sources) {
    for (const match of source.matchAll(CONSTANT_DECLARATION)) constants.set(match[1], match[2]);
  }

  const actions = new Set<string>();
  for (const source of sources) {
    const lines = codeLines(source);
    for (let i = 0; i < lines.length; i++) {
      const at = lines[i].search(/\baction\s*:/);
      if (at === -1) continue;
      // The value runs to the next property line (covers multi-line ternaries).
      let value = lines[i].slice(at).replace(/^action\s*:/, "");
      for (let j = i + 1; j < lines.length && !PROPERTY_LINE.test(lines[j]) && !/^\s*[})\]]/.test(lines[j]); j++) {
        value += "\n" + lines[j];
      }
      const trimmed = untilTopLevelComma(value).trim();
      // Query filters and selects (`action: { in: [...] }`, `action: true`) are reads.
      if (trimmed.startsWith("{") || trimmed.startsWith("true")) continue;
      for (const match of trimmed.matchAll(ACTION_STRING)) actions.add(match[1]);
      for (const identifier of trimmed.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? []) {
        const resolved = constants.get(identifier);
        if (resolved) actions.add(resolved);
      }
    }
  }
  return actions;
}

/** The required actions with no write site in `written`. */
export function missingAuditActions(written: ReadonlySet<string>, required: readonly string[]): string[] {
  return required.filter((action) => !written.has(action));
}

const ALL_REQUIRED = Object.values(REQUIRED_AUDIT_ACTIONS).flat();

describe("NFR-07 audit coverage", () => {
  const sources = serverSources().map((file) => readFileSync(file, "utf8"));
  const written = extractAuditActions(sources);

  it("scans a non-trivial set of server files and action strings", () => {
    expect(sources.length).toBeGreaterThan(50);
    expect(written.size).toBeGreaterThan(40);
  });

  it("the required list has no duplicates", () => {
    expect(new Set(ALL_REQUIRED).size).toBe(ALL_REQUIRED.length);
  });

  for (const [group, actions] of Object.entries(REQUIRED_AUDIT_ACTIONS)) {
    it(`every required ${group} action still has a write site under src/server`, () => {
      const missing = missingAuditActions(written, actions);
      for (const action of missing) console.error(`Missing audit action write site: ${action}`);
      expect(missing, `Missing audit action write site(s): ${missing.join(", ")}`).toEqual([]);
    });
  }

  it("self-check: removing one required string from the extracted set is reported by name", () => {
    const copy = new Set(written);
    copy.delete("auth.sign_in.failed");
    expect(missingAuditActions(copy, ALL_REQUIRED)).toEqual(["auth.sign_in.failed"]);
  });

  it("self-check: literal, conditional, multi-line and constant write sites are found; filters and comments are not", () => {
    const sample = [
      'const BLOCKED = "sample.blocked";',
      "await audit({",
      '  action: "sample.literal",',
      '  targetType: "User",',
      "});",
      'await audit({ action: isSystem ? "sample.auto" : "sample.manual", outcome: "SUCCESS" });',
      'await audit({ action: "sample.same_line", targetId: "not.an_action" });',
      "await audit({",
      "  action:",
      "    ok",
      '      ? "sample.multi_a"',
      '      : "sample.multi_b",',
      '  targetType: "Order",',
      "});",
      "await audit({ action: BLOCKED, outcome: \"DENIED\" });",
      'const rows = await db.auditEvent.findMany({ where: { action: { in: ["sample.filtered"] } } });',
      '// action: "sample.commented"',
      "/**",
      ' * action: "sample.block_commented"',
      " */",
    ].join("\n");
    const found = extractAuditActions([sample]);
    expect([...found].sort()).toEqual(
      [
        "sample.auto",
        "sample.blocked",
        "sample.literal",
        "sample.manual",
        "sample.multi_a",
        "sample.multi_b",
        "sample.same_line",
      ].sort(),
    );
  });
});
