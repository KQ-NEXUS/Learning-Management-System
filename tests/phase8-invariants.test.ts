import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const source = (file: string) => readFileSync(path.join(root, file), "utf8");
const phaseClientFiles = [
  "src/app/staff/reconciliation/ReconciliationWorkspace.tsx",
  "src/app/staff/reports/ExportDialog.tsx",
  "src/app/staff/reports/exports/ExportHistory.tsx",
  "src/app/staff/audit/AuditTable.tsx",
].filter((file) => {
  try { return source(file).startsWith('"use client"'); } catch { return false; }
});

function imports(file: string): string[] {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true);
  return ast.statements.filter(ts.isImportDeclaration).filter((statement) => !statement.importClause?.isTypeOnly).map((statement) => (statement.moduleSpecifier as ts.StringLiteral).text);
}

describe("Phase 8 architectural and trust boundaries", () => {
  it("keeps Reconciliation and Reports reachable through the actual staff layout navigation", () => {
    const layout = source("src/app/staff/layout.tsx");
    expect(layout).toContain('href: "/staff/reconciliation"');
    expect(layout).toContain('href: "/staff/reports"');
    expect(source("src/app/staff/StaffShell.tsx")).toContain("pathname.startsWith(`${href}/`)");
  });
  it("keeps client UI away from Prisma, private storage, workers and request-scoped services", () => {
    expect(phaseClientFiles.length).toBeGreaterThanOrEqual(3);
    for (const file of phaseClientFiles) {
      for (const specifier of imports(file)) {
        expect(specifier, file).not.toMatch(/@prisma\/client|@\/server\/(db|auth|permissions|scheduled)\b/);
        if (specifier.startsWith("@/server/services/")) expect(specifier, file).toBe("@/server/services/report-registry");
      }
    }
  });
  it("keeps storage keys and presigned capabilities out of client projections", () => {
    for (const file of phaseClientFiles) expect(source(file), file).not.toMatch(/storageKey|signedUrl|presignExportObjectUrl/);
    expect(source("src/server/services/export-read-service.ts")).not.toMatch(/return\s+\{[^}]*storageKey/);
  });
  it("requires current authorization and a private no-store route before download", () => {
    const route = source("src/app/api/staff/reports/exports/[jobId]/download/route.ts");
    const access = source("src/server/services/export-download-service.ts");
    expect(route).toContain("await context.params");
    expect(route).toContain('"Cache-Control": "private, no-store"');
    expect(access).toContain("canAccessExportJob");
    expect(access.indexOf("await deps.audit")).toBeLessThan(access.indexOf("return deps.presign"));
  });
  it("keeps background HTTP input from selecting queue jobs or limits", () => {
    const handler = source("netlify/functions/process-export-jobs-background.ts");
    expect(handler).toContain("runProcessExportJobsTask");
    expect(handler).toContain("await run()");
    expect(handler).not.toMatch(/request\.json\(|jobId|dataset|storageKey|batchLimit/);
    const worker = source("src/server/services/export-worker-service.ts");
    expect(worker).toContain("FOR UPDATE SKIP LOCKED");
  });
  it("preserves currency separation and individual exception resolution", () => {
    expect(source("src/server/services/report-query-service.ts")).not.toMatch(/exchangeRate|convertCurrency|fxRate/);
    expect(source("src/server/services/reconciliation-case-service.ts")).not.toMatch(/resolveCases\(|resolveAll\(/);
  });
  it("does not introduce chart, shadcn or raw hex styles in Phase 8 UI", () => {
    const packageJson = source("package.json");
    expect(packageJson).not.toMatch(/@radix-ui\/react-chart|recharts|chart\.js|shadcn/);
    for (const file of phaseClientFiles) expect(source(file), file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
