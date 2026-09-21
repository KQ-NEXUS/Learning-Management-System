import { describe, expect, it } from "vitest";
import {
  generateTicketReference,
  isTicketReference,
} from "@/server/services/ticket-reference";

describe("ticket references", () => {
  it("generates 100 unique, date-stamped references from injected UUIDs", () => {
    const now = () => new Date("2026-09-21T23:59:59.000Z");
    const references = new Set<string>();

    for (let index = 0; index < 100; index += 1) {
      const suffix = index.toString(16).padStart(8, "0");
      references.add(
        generateTicketReference({
          now,
          randomUUID: () => `${suffix}-0000-4000-8000-000000000000`,
        }),
      );
    }

    expect(references).toHaveLength(100);
    for (const reference of references) {
      expect(reference).toMatch(/^KQT-20260921-[0-9A-F]{8}$/);
      expect(isTicketReference(reference)).toBe(true);
    }
  });

  it.each([
    "KQT-20260921-ABCDEF0",
    "KQT-20260921-abcdef01",
    "KQT-2026-09-21-ABCDEF01",
    "ORD-20260921-ABCDEF01",
    "KQT-20261340-ABCDEF01",
  ])("rejects malformed references: %s", (reference) => {
    expect(isTicketReference(reference)).toBe(false);
  });
});
