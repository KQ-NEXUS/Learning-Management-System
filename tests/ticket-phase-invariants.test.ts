/**
 * Static cross-surface invariants for Phase 12 (plan 12-09): privacy,
 * immutability, event payload hygiene and route/nav wiring (D-05, D-14, D-19, D-20).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPORT_DATASET_REGISTRY, REPORT_REGISTRY } from "@/server/services/report-registry";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
  });
}
const srcFiles = walk("src").filter((f) => /\.(ts|tsx)$/.test(f));

describe("ticket message immutability", () => {
  it("no source file updates, upserts or deletes TicketMessage rows", () => {
    const offenders = srcFiles.filter((f) =>
      /ticketMessage\s*\.\s*(update|updateMany|upsert|delete|deleteMany)\b/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it("the repository exposes no message update/delete method", () => {
    const svc = read("src/server/services/ticket-service.ts");
    const repoType = svc.slice(svc.indexOf("export type TicketRepository"), svc.indexOf("export type TicketServiceDeps"));
    expect(repoType).not.toMatch(/(update|delete|edit|remove)Message/i);
  });
});

describe("learner/staff projection boundary", () => {
  it("learner UI never imports staff modules or staff-only DTOs", () => {
    const learnerFiles = srcFiles.filter(
      (f) => f.startsWith("src/app/(learner)/support") || /components\/support\/(TicketTimeline|GetSupportLink)\./.test(f),
    );
    expect(learnerFiles.length).toBeGreaterThan(3);
    for (const f of learnerFiles) {
      const text = read(f);
      expect(text, f).not.toMatch(/from\s+["'][^"']*(staff\/support|StaffTicketTimeline|ticket-staff-queue-service)/);
      expect(text, f).not.toMatch(/getStaffTicketByReference|listStaffTickets|INTERNAL_NOTE|addInternalTicketNote/);
    }
  });

  it("the learner detail DTO never selects staff-only fields", () => {
    const svc = read("src/server/services/ticket-service.ts");
    const start = svc.indexOf("function learnerDetailDto");
    expect(start).toBeGreaterThan(-1);
    const body = svc.slice(start, start + 2500);
    expect(body).not.toMatch(/assigneeId|internal|INTERNAL/);
  });
});

describe("report and export privacy", () => {
  const FORBIDDEN = /(body|note|message|attachment|filename|storageKey|subject|reason)/i;

  it("support report columns and export definitions carry no private content fields", () => {
    const support = REPORT_REGISTRY.find((d) => d.id === "support");
    expect(support).toBeDefined();
    for (const c of support!.safeColumns) expect(c.key, c.key).not.toMatch(FORBIDDEN);
    const exp = EXPORT_DATASET_REGISTRY.find((d) => d.id === "support");
    expect(exp).toBeDefined();
    for (const c of [...exp!.safeColumns, ...exp!.sensitiveColumns]) expect(c.key, c.key).not.toMatch(FORBIDDEN);
  });

  it("the report query service never reads message or attachment delegates", () => {
    const text = read("src/server/services/report-query-service.ts");
    expect(text).not.toMatch(/ticketMessage|ticketAttachment/);
  });
});

describe("DomainEvent payload hygiene", () => {
  it("ticket domain events carry only ids/reference/queue/status keys", () => {
    const svc = read("src/server/services/ticket-service.ts");
    const auto = read("src/server/services/ticket-auto-close-system-service.ts");
    const blocks = [...(svc + auto).matchAll(/type:\s*"ticket\.[a-z_]+"\s*,\s*payload:\s*(\{[^}]*\})/g)].map((m) => m[1]);
    expect(blocks.length).toBeGreaterThanOrEqual(6);
    for (const block of blocks) {
      expect(block).not.toMatch(/\b(body|reason|filename|storageKey|note|subject|message)\b/i);
    }
  });
});

describe("route and navigation wiring", () => {
  it("expected pages, routes, function and nav entries exist", () => {
    for (const p of [
      "src/app/(learner)/support/page.tsx",
      "src/app/(learner)/support/new/page.tsx",
      "src/app/(learner)/support/[reference]/page.tsx",
      "src/app/staff/support/page.tsx",
      "src/app/staff/support/[reference]/page.tsx",
      "src/app/api/ticket-attachments/upload-intent/route.ts",
      "src/app/api/ticket-attachments/complete/route.ts",
      "src/app/api/ticket-attachments/[attachmentId]/download/route.ts",
      "netlify/functions/close-resolved-tickets.ts",
    ]) {
      expect(existsSync(join(ROOT, p)), p).toBe(true);
    }
    expect(read("src/app/(learner)/layout.tsx")).toContain('href: "/support"');
    const staff = read("src/app/staff/layout.tsx");
    expect(staff).toContain('href: "/staff/support"');
    expect(staff).toContain('"/staff/support": "tickets.view"');
    expect(read("netlify/functions/close-resolved-tickets.ts")).toMatch(/schedule:\s*"/);
  });

  it("the download route is private, no-store and attachment-disposition", () => {
    const text = read("src/app/api/ticket-attachments/[attachmentId]/download/route.ts");
    expect(text).toMatch(/no-store/);
    expect(text.toLowerCase()).toMatch(/attachment/);
  });
});
