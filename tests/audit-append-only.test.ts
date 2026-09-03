import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (/\.(ts|tsx)$/.test(entry.name)) return [full];
    return [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const SRC_ROOT = path.resolve(process.cwd(), "src");
const FILES = walk(SRC_ROOT);

// Built from parts at runtime rather than written verbatim, so this test
// file's own source cannot accidentally match its own forbidden-call scan
// (it is under tests/, outside the src/ walk, but this keeps the intent
// explicit rather than relying on that scope boundary alone).
const AUDIT_MODEL = ["audit", "Event"].join("");
const MUTATING_METHODS = ["update", "updateMany", "delete", "deleteMany", "upsert"];
const CREATE_METHOD = ["cre", "ate"].join("");

describe("audit trail append-only invariant", () => {
  it("contains no mutating or removing call against the audit model anywhere in src", () => {
    const offenders: string[] = [];

    for (const file of FILES) {
      const lines = stripComments(readFileSync(file, "utf8")).split("\n");
      for (const method of MUTATING_METHODS) {
        const pattern = new RegExp(`\\b${AUDIT_MODEL}\\.${method}\\b`);
        lines.forEach((line, index) => {
          if (pattern.test(line)) {
            offenders.push(
              `${path.relative(process.cwd(), file)}:${index + 1} — ${AUDIT_MODEL}.${method}(...)`,
            );
          }
        });
      }
    }

    expect(offenders, `Mutating call(s) against the audit model:\n${offenders.join("\n")}`).toEqual(
      [],
    );
  });

  it("has exactly one file in src that creates audit rows", () => {
    const creators: string[] = [];
    const pattern = new RegExp(`\\b${AUDIT_MODEL}\\.${CREATE_METHOD}\\b`);

    for (const file of FILES) {
      const stripped = stripComments(readFileSync(file, "utf8"));
      if (pattern.test(stripped)) {
        creators.push(path.relative(process.cwd(), file).split(path.sep).join("/"));
      }
    }

    expect(creators, `Audit-creating files: ${creators.join(", ")}`).toEqual([
      "src/server/services/audit-service.ts",
    ]);
  });
});
