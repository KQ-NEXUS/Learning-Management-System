/**
 * Phase 13 close-out — cross-cutting invariants (13-13, D-06, D-09, D-14,
 * D-15, D-17, D-23).
 *
 * Mirrors `tests/learning-phase-invariants.test.ts` and
 * `tests/audit-append-only.test.ts`'s own style: TypeScript-compiler-API
 * source scans (never a raw text/regex match on identifiers that could
 * false-positive on a comment or a doc string, or silently pass because a
 * quoted literal in a comment happened to match) with comment content
 * stripped before any plain-text pattern match. `tests/boundary.test.ts`
 * carries this file's lint-boundary and worker-closure assertions (Prisma
 * import rejection, request-API-free closures) — a lint result and an ESLint
 * instance belong with that file's existing machinery, not duplicated here.
 *
 * Deviation from the plan's literal wording: the plan states the permission
 * catalogue "is still 36 identifiers". The catalogue is actually 37 — Phase
 * 11 added `certificates.manage` (11-05-SUMMARY.md) after the 36-count
 * language was written into `13-CONTEXT.md`/`13-13-PLAN.md`, and
 * `tests/permissions.test.ts` already pins 37 as the live count. This file
 * asserts 37 (Rule 1 — a stale plan literal is a bug in the test, not a
 * license to write a test that fails against already-correct code) and its
 * real job — proving Phase 13 added no new permission identifier — holds
 * either way.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { PERMISSIONS } from "@/server/permissions/catalogue";

const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const SRC_ROOT = path.resolve(process.cwd(), "src");
const SERVICES_ROOT = path.join(SRC_ROOT, "server", "services");

function walkSourceFiles(root: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkSourceFiles(full));
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

function parse(filePath: string): ts.SourceFile {
  const source = readFileSync(filePath, "utf8");
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Every `Identifier` node anywhere in the tree whose text matches `name` — AST-based, so a mention inside a comment or string literal is invisible. */
function findIdentifiers(sourceFile: ts.SourceFile, name: string): ts.Identifier[] {
  const found: ts.Identifier[] = [];
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && node.text === name) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

/** Every object-literal property (`{ textContent: ... }` or `{ textContent }`) named `name`, anywhere in the tree. */
function findPropertyNamed(sourceFile: ts.SourceFile, name: string): ts.Node[] {
  const found: ts.Node[] = [];
  function visit(node: ts.Node): void {
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

// ---------------------------------------------------------------------------
// The permission catalogue stays closed (D-06 — "no new catalogue identifier").
// ---------------------------------------------------------------------------

describe("phase 13 invariant: the permission catalogue is unchanged (D-06)", () => {
  it("PERMISSIONS has exactly 37 entries and contains no notification/email identifier", () => {
    expect(PERMISSIONS.length).toBe(37);

    const forbidden = PERMISSIONS.filter(
      (permission) =>
        permission.startsWith("notification") || permission.startsWith("email") || permission.startsWith("notifications"),
    );
    expect(
      forbidden,
      `Phase 13 must add no new catalogue identifier (D-06) — access to the delivery log is gated on an ` +
        `EXISTING global admin permission, never a new one:\n${forbidden.join(", ")}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DomainEventType retains every prior member plus the two Phase 13 additions.
// ---------------------------------------------------------------------------

describe("phase 13 invariant: DomainEventType retains every prior member and gained payment.failed / payment.refunded (D-09)", () => {
  it("parses the union from source and finds every pre-Phase-13 member plus the two new ones", () => {
    const filePath = path.join(SERVICES_ROOT, "domain-event-service.ts");
    const sourceFile = parse(filePath);

    let unionMembers: string[] = [];
    function visit(node: ts.Node): void {
      if (
        ts.isTypeAliasDeclaration(node) &&
        node.name.text === "DomainEventType" &&
        ts.isUnionTypeNode(node.type)
      ) {
        unionMembers = node.type.types
          .filter((t): t is ts.LiteralTypeNode => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal))
          .map((t) => (t.literal as ts.StringLiteral).text);
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);

    // Every member Phases 5-12 rely on, pinned here so a future removal of
    // any of these is caught, not just an absence of the two new ones.
    const PRE_PHASE_13_MEMBERS = [
      "enrolment.created",
      "enrolment.approved",
      "enrolment.transferred",
      "enrolment.withdrawn",
      "enrolment.cancelled",
      "enrolment.hold_expired",
      "attendance.changed",
      "cohort.published",
      "cohort.cancelled",
      "session.created",
      "session.updated",
      "session.cancelled",
      "order.created",
      "order.paid",
      "order.exception",
      "enrolment.activated",
      "payment.reconciled",
      "payment.reconciliation_exception",
      "lesson.completed",
      "course.completed",
      "programme.completed",
      "attempt.submitted",
      "submission.created",
      "grade.released",
      "grade.overridden",
      "certificate.issued",
      "certificate.review_flagged",
      "certificate.revoked",
      "certificate.reissued",
      "ticket.created",
      "ticket.public_reply_added",
      "ticket.assigned",
      "ticket.escalated",
      "ticket.resolved",
      "ticket.reopened",
      "ticket.closed",
    ];
    const PHASE_13_NEW_MEMBERS = ["payment.failed", "payment.refunded"];

    const missingPrior = PRE_PHASE_13_MEMBERS.filter((m) => !unionMembers.includes(m));
    expect(
      missingPrior,
      `DomainEventType lost pre-existing member(s) Phases 5-12 rely on: ${missingPrior.join(", ")}.`,
    ).toEqual([]);

    const missingNew = PHASE_13_NEW_MEMBERS.filter((m) => !unionMembers.includes(m));
    expect(
      missingNew,
      `DomainEventType is missing Phase 13's new member(s): ${missingNew.join(", ")} (D-09).`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Notification / EmailPreference / EmailDispatch / DomainEvent are append-only.
// ---------------------------------------------------------------------------

describe("phase 13 invariant: Notification, EmailPreference, EmailDispatch and DomainEvent rows are never hard-deleted (D-02, D-05, D-17, D-23)", () => {
  it("no file under src calls .delete( or .deleteMany( on the notification, emailPreference, emailDispatch or domainEvent delegates", () => {
    const DELEGATES = ["notification", "emailPreference", "emailDispatch", "domainEvent"];
    const MUTATING_METHODS = ["delete", "deleteMany"];
    const files = walkSourceFiles(SRC_ROOT);
    const offenders: string[] = [];

    for (const file of files) {
      const lines = stripComments(readFileSync(file, "utf8")).split("\n");
      for (const delegate of DELEGATES) {
        for (const method of MUTATING_METHODS) {
          const pattern = new RegExp(`\\b${delegate}\\.${method}\\b`);
          lines.forEach((line, index) => {
            if (pattern.test(line)) {
              offenders.push(`${path.relative(process.cwd(), file)}:${index + 1} — ${delegate}.${method}(...)`);
            }
          });
        }
      }
    }

    expect(
      offenders,
      `Retention for these four stores is archive/status-only, never a hard delete:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// One sender identity — no hard-coded fallback, no Prisma import (COM-04, D-14).
// ---------------------------------------------------------------------------

describe("phase 13 invariant: src/server/email and src/server/communications never hard-code a sender/support address or import Prisma directly (COM-04, D-14)", () => {
  it("no file under either root imports @prisma/client or contains an email-address-shaped string literal", () => {
    const roots = [path.join(SRC_ROOT, "server", "email"), path.join(SRC_ROOT, "server", "communications")];
    // Deliberately conservative — anything shaped like `local@domain.tld` is
    // flagged; a real deployment value must come only from the environment
    // (D-14: "fail loudly ... never a made-up sender").
    const EMAIL_LITERAL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const offenders: string[] = [];

    for (const root of roots) {
      for (const file of walkSourceFiles(root)) {
        const sourceFile = parse(file);

        for (const statement of sourceFile.statements) {
          if (
            ts.isImportDeclaration(statement) &&
            ts.isStringLiteral(statement.moduleSpecifier) &&
            statement.moduleSpecifier.text === "@prisma/client"
          ) {
            offenders.push(`${path.relative(process.cwd(), file)} imports @prisma/client directly`);
          }
        }

        function visit(node: ts.Node): void {
          if (ts.isStringLiteral(node) && EMAIL_LITERAL.test(node.text)) {
            offenders.push(`${path.relative(process.cwd(), file)} contains an email-address literal: "${node.text}"`);
          }
          ts.forEachChild(node, visit);
        }
        visit(sourceFile);
      }
    }

    expect(
      offenders,
      `The email identity stays env-configured, single-place and Prisma-free (COM-04, D-14):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The four auth services never build their own base URL or a plain-text body.
// ---------------------------------------------------------------------------

describe("phase 13 invariant: the four auth services build no base URL themselves and hand-build no plain-text email body (D-15, D-10)", () => {
  it("registration-service.ts, verification-service.ts, password-reset-service.ts and profile-service.ts contain no APP_BASE_URL identifier and no textContent property", () => {
    const files = [
      "registration-service.ts",
      "verification-service.ts",
      "password-reset-service.ts",
      "profile-service.ts",
    ].map((name) => path.join(SERVICES_ROOT, name));
    const offenders: string[] = [];

    for (const file of files) {
      const sourceFile = parse(file);

      const envIdentifiers = findIdentifiers(sourceFile, "APP_BASE_URL");
      if (envIdentifiers.length > 0) {
        offenders.push(
          `${path.relative(process.cwd(), file)} references APP_BASE_URL directly — base-URL construction ` +
            `belongs to src/server/email/config.ts's buildAbsoluteUrl (D-15) alone`,
        );
      }

      const textContentProps = findPropertyNamed(sourceFile, "textContent");
      if (textContentProps.length > 0) {
        offenders.push(
          `${path.relative(process.cwd(), file)} builds a "textContent" property directly — every auth mail ` +
            `renders through the shared template registry (D-10), never a hand-built body here`,
        );
      }
    }

    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Notification components never use a raw hex colour or an HTML-injection sink.
// ---------------------------------------------------------------------------

describe("phase 13 invariant: notification components use no raw hex colour and no HTML-injection sink (D-17, D-18)", () => {
  it("no file under src/components/notifications contains a hex colour literal outside a comment, dangerouslySetInnerHTML, or a raw .innerHTML assignment", () => {
    const root = path.join(SRC_ROOT, "components", "notifications");
    const files = walkSourceFiles(root);
    expect(files.length).toBeGreaterThan(0);

    const HEX_PATTERN = /#[0-9a-fA-F]{3,8}\b/;
    const violations: string[] = [];

    for (const file of files) {
      const withoutComments = stripComments(readFileSync(file, "utf8"));
      if (HEX_PATTERN.test(withoutComments)) {
        violations.push(`${path.relative(process.cwd(), file)}: raw hex colour literal outside a comment`);
      }
      if (/dangerouslySetInnerHTML/.test(withoutComments)) {
        violations.push(`${path.relative(process.cwd(), file)}: dangerouslySetInnerHTML`);
      }
      if (/\.innerHTML\s*=/.test(withoutComments)) {
        violations.push(`${path.relative(process.cwd(), file)}: a raw .innerHTML assignment`);
      }
    }

    expect(
      violations,
      `Every colour on a notification surface must be a semantic token, and notification text is rendered ` +
        `as text nodes, never injected HTML:\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});
