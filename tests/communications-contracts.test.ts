import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DOMAIN_EVENT_TYPE_LIST,
  EMAIL_CATEGORY,
  EMAIL_STATUS,
  MAX_EVENT_ATTEMPTS,
  MAX_SEND_ATTEMPTS,
  MUTABLE_EMAIL_CATEGORIES,
  NOTIFICATION_TARGET_TYPES,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_TARGET,
  RETRY_BACKOFF_MS,
  SKIP_REASONS,
  STALE_SENDING_MS,
  TEMPLATE_CATEGORY,
  TEMPLATE_IDS,
  buildCorrelationId,
} from "@/server/communications/contracts";

const contractsPath = path.join(
  process.cwd(),
  "src/server/communications/contracts.ts",
);
const eventServicePath = path.join(
  process.cwd(),
  "src/server/services/domain-event-service.ts",
);

describe("EMAIL_STATUS", () => {
  it("lists exactly the five statuses the database CHECK constraint accepts", () => {
    expect(Object.values(EMAIL_STATUS).sort()).toEqual(
      ["FAILED", "QUEUED", "SENDING", "SENT", "SKIPPED"].sort(),
    );
  });
});

describe("email categories", () => {
  it("has exactly four mutable categories (D-16)", () => {
    expect([...MUTABLE_EMAIL_CATEGORIES].sort()).toEqual(
      [
        "ENROLMENT_STATUS",
        "RESULT_NOTICES",
        "SESSION_CHANGES",
        "TICKET_UPDATES",
      ].sort(),
    );
  });

  it("never treats AUTH, ALWAYS or STAFF as mutable", () => {
    for (const c of [EMAIL_CATEGORY.AUTH, EMAIL_CATEGORY.ALWAYS, EMAIL_CATEGORY.STAFF]) {
      expect((MUTABLE_EMAIL_CATEGORIES as readonly string[]).includes(c)).toBe(false);
    }
  });
});

describe("TEMPLATE_IDS", () => {
  it("lists exactly 27 unique ids", () => {
    expect(TEMPLATE_IDS).toHaveLength(27);
    expect(new Set(TEMPLATE_IDS).size).toBe(27);
  });

  it("gives every id a known category and excludes the legacy order-confirmation id", () => {
    const categories = new Set(Object.values(EMAIL_CATEGORY));
    for (const id of TEMPLATE_IDS) {
      expect(categories.has(TEMPLATE_CATEGORY[id])).toBe(true);
    }
    expect((TEMPLATE_IDS as readonly string[]).includes("order-confirmation")).toBe(false);
    expect(Object.keys(TEMPLATE_CATEGORY)).toHaveLength(27);
  });

  it("categorises auth mail as AUTH and the ticket-reply mail as TICKET_UPDATES", () => {
    expect(TEMPLATE_CATEGORY["password-reset"]).toBe("AUTH");
    expect(TEMPLATE_CATEGORY["ticket-reply"]).toBe("TICKET_UPDATES");
    expect(TEMPLATE_CATEGORY["staff-order-exception"]).toBe("STAFF");
    expect(TEMPLATE_CATEGORY["payment-failed"]).toBe("ALWAYS");
  });
});

describe("notification vocabulary", () => {
  it("lists exactly 27 unique types, each mapped to a known target type", () => {
    expect(NOTIFICATION_TYPES).toHaveLength(27);
    expect(new Set(NOTIFICATION_TYPES).size).toBe(27);
    const targets = new Set<string>(NOTIFICATION_TARGET_TYPES);
    for (const t of NOTIFICATION_TYPES) {
      expect(targets.has(NOTIFICATION_TYPE_TARGET[t])).toBe(true);
    }
    expect(Object.keys(NOTIFICATION_TYPE_TARGET)).toHaveLength(27);
  });

  it("lists the ten target types", () => {
    expect(NOTIFICATION_TARGET_TYPES).toHaveLength(10);
  });

  it("routes representative types to the documented targets", () => {
    expect(NOTIFICATION_TYPE_TARGET["payment.failed"]).toBe("LEARNER_ORDER");
    expect(NOTIFICATION_TYPE_TARGET["staff.email_failed"]).toBe("STAFF_EMAIL_LOG");
    expect(NOTIFICATION_TYPE_TARGET["ticket.reply"]).toBe("LEARNER_TICKET");
  });
});

describe("retry constants", () => {
  it("pins backoff and attempt limits (A-19)", () => {
    expect([...RETRY_BACKOFF_MS]).toEqual([60000, 300000, 1800000, 7200000]);
    expect(MAX_SEND_ATTEMPTS).toBe(5);
    expect(MAX_EVENT_ATTEMPTS).toBe(3);
    expect(STALE_SENDING_MS).toBe(10 * 60 * 1000);
  });

  it("has one backoff step between each pair of the five attempts", () => {
    expect(RETRY_BACKOFF_MS).toHaveLength(MAX_SEND_ATTEMPTS - 1);
  });

  it("lists the six skip reasons", () => {
    expect(SKIP_REASONS).toHaveLength(6);
  });
});

describe("DOMAIN_EVENT_TYPE_LIST", () => {
  it("matches the members of the DomainEventType union exactly and includes the payment outcomes", () => {
    const source = readFileSync(eventServicePath, "utf8");
    const start = source.indexOf("export type DomainEventType");
    // The alias ends at the first line-terminating semicolon (comments inside
    // the union may contain semicolons mid-line).
    const end = start + source.slice(start).search(/;[ \t]*\r?\n/);
    const block = source.slice(start, end);
    const members = [...block.matchAll(/^\s*\| "([a-z_.]+)"/gm)].map((m) => m[1]);
    expect(members.length).toBeGreaterThan(30);
    expect([...DOMAIN_EVENT_TYPE_LIST].sort()).toEqual([...members].sort());
    expect(new Set(DOMAIN_EVENT_TYPE_LIST).size).toBe(DOMAIN_EVENT_TYPE_LIST.length);
    expect(DOMAIN_EVENT_TYPE_LIST).toContain("payment.failed");
    expect(DOMAIN_EVENT_TYPE_LIST).toContain("payment.refunded");
  });
});

describe("buildCorrelationId (D-05)", () => {
  it("returns the event id alone for a single-recipient event", () => {
    expect(buildCorrelationId("ev1")).toBe("ev1");
  });

  it("appends the recipient for a fan-out event", () => {
    expect(buildCorrelationId("ev1", "u1")).toBe("ev1:u1");
  });
});

describe("module purity", () => {
  it("has no runtime import of @prisma/client and none of next/headers", () => {
    const source = readFileSync(contractsPath, "utf8");
    expect(source).not.toMatch(/from\s+["']@prisma\/client["']/);
    expect(source).not.toMatch(/next\/headers/);
    const imports = [...source.matchAll(/^import\s+(?!type\b)[^;]*from\s+["']([^"']+)["']/gm)];
    expect(imports.map((m) => m[1])).toEqual([]);
  });
});
