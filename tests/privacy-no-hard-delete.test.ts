/**
 * D-12 / NFR-11 / P3 — the privacy tool never hard-deletes a person or a
 * retained record.
 *
 * Hard deletion stays blocked until the owner approves a retention schedule and
 * a legal-hold process (15-DECISIONS.md). This static scan reads every
 * `src/server/services/privacy-*.ts` file (the anonymise service now, the export
 * and read services later) and fails if one of them:
 *
 * - deletes a `User` row (delete, deleteMany, or raw SQL),
 * - deletes from a retained financial, enrolment, grade, completion, credential,
 *   ticket, submission or consent model,
 * - updates or deletes an `AuditEvent` row (the audit log is append-only), or
 * - truncates or drops a table.
 *
 * The deletions the anonymise policy does allow (accounts, email preferences,
 * notifications, verification tokens, sign-in throttle rows) are not on the
 * forbidden list. The scanner has self-checks so it cannot pass by matching
 * nothing.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SERVICES_DIR = path.resolve(import.meta.dirname, "..", "src", "server", "services");

/** Prisma delegates for models the privacy tool must never delete from. */
const RETAINED_DELEGATES = [
  "user",
  "order",
  "paymentAttempt",
  "refund",
  "webhookEvent",
  "enrolment",
  "attendanceRecord",
  "grade",
  "gradeOverride",
  "completionRecord",
  "certificate",
  "ticket",
  "ticketMessage",
  "ticketAttachment",
  "submission",
  "policyAcceptance",
  "auditEvent",
];

/** Retained tables a raw statement must not delete from or update (audit log). */
const RETAINED_TABLES = ["User", "Order", "PaymentAttempt", "Refund", "WebhookEvent", "Enrolment", "Grade", "Certificate", "AuditEvent"];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Every forbidden call in one source text, as `line: snippet`. */
export function findForbiddenPrivacyCalls(source: string): string[] {
  const offenders: string[] = [];
  const lines = stripComments(source).split("\n");
  const delegates = RETAINED_DELEGATES.join("|");
  const tables = RETAINED_TABLES.join("|");
  const rules: Array<[string, RegExp]> = [
    ["delete on a retained model", new RegExp(`\\b(?:${delegates})\\.(?:delete|deleteMany)\\b`)],
    ["write to the append-only audit log", /\bauditEvent\.(?:update|updateMany|upsert)\b/],
    ["raw delete from a retained table", new RegExp(`DELETE\\s+FROM\\s+"?(?:${tables})"?`, "i")],
    ["raw update of the audit log", /UPDATE\s+"?AuditEvent"?/i],
    ["truncate or drop", /\b(?:TRUNCATE|DROP\s+TABLE)\b/i],
  ];
  lines.forEach((line, index) => {
    for (const [label, pattern] of rules) {
      if (pattern.test(line)) offenders.push(`${index + 1}: ${label}: ${line.trim()}`);
    }
  });
  return offenders;
}

function privacyServiceFiles(): string[] {
  return readdirSync(SERVICES_DIR)
    .filter((name) => /^privacy-.+\.ts$/.test(name))
    .map((name) => path.join(SERVICES_DIR, name));
}

describe("privacy services never hard-delete people or retained records (D-12, P3)", () => {
  it("finds the privacy services to scan, including the anonymise service", () => {
    const names = privacyServiceFiles().map((file) => path.basename(file));
    expect(names).toContain("privacy-anonymise-service.ts");
  });

  it("no privacy-*.ts service deletes a User row or a retained record, or touches the audit log", () => {
    const failures: string[] = [];
    for (const file of privacyServiceFiles()) {
      for (const offender of findForbiddenPrivacyCalls(readFileSync(file, "utf8"))) {
        failures.push(`${path.relative(process.cwd(), file)}:${offender}`);
      }
    }
    expect(failures, `Forbidden calls:\n${failures.join("\n")}`).toEqual([]);
  });

  it("the anonymise service still removes the ancillary rows its policy lists (the scan is not vacuous)", () => {
    const source = stripComments(readFileSync(path.join(SERVICES_DIR, "privacy-anonymise-service.ts"), "utf8"));
    for (const delegate of ["account", "emailPreference", "notification", "verificationToken", "loginThrottle"]) {
      expect(source, delegate).toMatch(new RegExp(`\\b${delegate}\\.deleteMany\\b`));
    }
    expect(source).toMatch(/\buser\.updateMany\b/);
  });

  describe("scanner self-checks", () => {
    it("flags user.delete and user.deleteMany, through a transaction client too", () => {
      expect(findForbiddenPrivacyCalls("await tx.user.delete({ where: { id } });")).toHaveLength(1);
      expect(findForbiddenPrivacyCalls("await prisma.user.deleteMany({});")).toHaveLength(1);
    });

    it("flags deletes of retained records and any change to an audit row", () => {
      expect(findForbiddenPrivacyCalls("await tx.order.deleteMany({});")).toHaveLength(1);
      expect(findForbiddenPrivacyCalls("await tx.certificate.delete({ where: { id } });")).toHaveLength(1);
      expect(findForbiddenPrivacyCalls("await tx.auditEvent.update({ where: { id }, data: {} });")).toHaveLength(1);
      expect(findForbiddenPrivacyCalls("await tx.auditEvent.deleteMany({});")).toHaveLength(1);
    });

    it("flags raw SQL deletes, audit updates, truncates and drops", () => {
      expect(findForbiddenPrivacyCalls('await tx.$executeRaw`DELETE FROM "User" WHERE id = ${id}`;')).toHaveLength(1);
      expect(findForbiddenPrivacyCalls('await tx.$executeRaw`UPDATE "AuditEvent" SET reason = null`;')).toHaveLength(1);
      expect(findForbiddenPrivacyCalls('await tx.$executeRawUnsafe("TRUNCATE TABLE x")')).toHaveLength(1);
      expect(findForbiddenPrivacyCalls('await tx.$executeRawUnsafe("DROP TABLE x")')).toHaveLength(1);
    });

    it("allows the ancillary deletions the policy lists, the audit create and commented prose", () => {
      const allowed = [
        "await tx.account.deleteMany({ where: { userId } });",
        "await tx.emailPreference.deleteMany({ where: { userId } });",
        "await tx.notification.deleteMany({ where: { recipientId: userId } });",
        "await tx.verificationToken.deleteMany({ where: {} });",
        "await tx.loginThrottle.deleteMany({ where: {} });",
        "await tx.user.updateMany({ where: { id }, data: {} });",
        "await tx.auditEvent.create({ data: {} });",
        "// the old code called user.delete(...) here",
        "/* tx.user.deleteMany() is forbidden */",
      ].join("\n");
      expect(findForbiddenPrivacyCalls(allowed)).toEqual([]);
    });
  });
});
