import { describe, expect, it } from "vitest";
import {
  buildAuditRow,
  redactForAudit,
  AUDIT_REDACTED_KEYS,
  type BusinessAuditEvent,
} from "@/server/services/audit-service";

const minimal: BusinessAuditEvent = {
  actorId: "user-1",
  action: "role.created",
  targetType: "Role",
  outcome: "SUCCESS",
};

describe("buildAuditRow", () => {
  it("defaults scopeType and scopeId to null when absent", () => {
    const row = buildAuditRow(minimal);
    expect(row.scopeType).toBeNull();
    expect(row.scopeId).toBeNull();
  });

  it("threads scopeType and scopeId onto the row unchanged", () => {
    const row = buildAuditRow({ ...minimal, scopeType: "COHORT", scopeId: "cohort-1" });
    expect(row.scopeType).toBe("COHORT");
    expect(row.scopeId).toBe("cohort-1");
  });

  it("defaults reason, correlationId, and ipAddress to null when absent", () => {
    const row = buildAuditRow(minimal);
    expect(row.reason).toBeNull();
    expect(row.correlationId).toBeNull();
    expect(row.ipAddress).toBeNull();
  });

  it("passes outcome, action, and targetType through verbatim", () => {
    const row = buildAuditRow(minimal);
    expect(row.outcome).toBe("SUCCESS");
    expect(row.action).toBe("role.created");
    expect(row.targetType).toBe("Role");
  });

  it("redacts a passwordHash key in before", () => {
    const row = buildAuditRow({
      ...minimal,
      before: { id: "u1", passwordHash: "super-secret-hash" },
    });
    const serialized = JSON.stringify(row.before);
    expect(serialized).not.toContain("super-secret-hash");
    expect((row.before as { passwordHash: string }).passwordHash).toBe("[redacted]");
  });
});

describe("redactForAudit", () => {
  it("redacts every key in AUDIT_REDACTED_KEYS", () => {
    for (const key of AUDIT_REDACTED_KEYS) {
      const result = redactForAudit({ [key]: "secret-value" }) as Record<string, unknown>;
      expect(result[key]).toBe("[redacted]");
    }
  });

  it("redacts a nested object one level deep", () => {
    const result = redactForAudit({
      user: { id: "u1", passwordHash: "hash" },
    }) as { user: { passwordHash: string } };
    expect(result.user.passwordHash).toBe("[redacted]");
  });

  it("redacts an object inside an array", () => {
    const result = redactForAudit([{ token: "abc" }]) as { token: string }[];
    expect(result[0].token).toBe("[redacted]");
  });

  it("leaves keys not in the redaction set untouched", () => {
    const result = redactForAudit({ name: "Ada Admin" }) as { name: string };
    expect(result.name).toBe("Ada Admin");
  });

  it("leaves a Date value untouched rather than walking into it", () => {
    const date = new Date("2026-09-02T00:00:00Z");
    const result = redactForAudit({ createdAt: date }) as { createdAt: Date };
    expect(result.createdAt).toBe(date);
  });

  it("does not infinitely recurse on a self-referential object", () => {
    const cyclic: Record<string, unknown> = { name: "cyclic" };
    cyclic.self = cyclic;
    expect(() => redactForAudit(cyclic)).not.toThrow();
  });

  it("passes null and primitives through unchanged", () => {
    expect(redactForAudit(null)).toBeNull();
    expect(redactForAudit("plain string")).toBe("plain string");
    expect(redactForAudit(42)).toBe(42);
  });
});
