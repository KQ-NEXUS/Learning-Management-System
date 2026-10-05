/**
 * Audit A-12: the overview's "orders needing review" item used to open the
 * unfiltered payments list. It now links to `?status=EXCEPTION`, and the list
 * opens on the status tab named in that parameter.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/primitives", () => ({ ResourceTable: () => null, StatusPill: () => null }));

import { initialPaymentStatus } from "@/app/staff/payments/PaymentsTable";

describe("initialPaymentStatus", () => {
  it("accepts each status the list has a tab for", () => {
    for (const status of ["PENDING", "PAID", "PARTIALLY_REFUNDED", "REFUNDED", "EXCEPTION", "FAILED", "CANCELLED"]) {
      expect(initialPaymentStatus(status)).toBe(status);
    }
  });

  it("opens on All for a missing, unknown or prototype-named value", () => {
    for (const value of [undefined, "", "exception", "NOPE", "toString", "constructor"]) {
      expect(initialPaymentStatus(value)).toBe("");
    }
  });
});

describe("the overview's exception item", () => {
  const overview = readFileSync("src/server/services/staff-overview-service.ts", "utf8");
  const page = readFileSync("src/app/staff/payments/page.tsx", "utf8");

  it("links to the payments list filtered to exception orders and calls them orders, not payments", () => {
    expect(overview).toContain('href: "/staff/payments?status=EXCEPTION"');
    expect(overview).toContain('title: "Orders needing review"');
    expect(overview).not.toContain('title: "Payments needing review"');
  });

  it("the payments page passes the status parameter through to the table", () => {
    expect(page).toContain("initialStatus={initialPaymentStatus(status)}");
  });
});
