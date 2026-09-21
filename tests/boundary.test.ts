import { beforeAll, describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { readdirSync } from "node:fs";
import path from "node:path";
// The traversal itself lives in `./import-graph` (09-14) — a plain module,
// not a `*.test.ts` spec — so `tests/learning-phase-invariants.test.ts` can
// import the exact same implementation without also importing (and thereby
// re-executing) this file's own `describe`/`it` registrations. See that
// module's header for the full reasoning.
import { runtimeImports, runtimeClosureFrom } from "./import-graph";

const PRISMA_IMPORT = `import { PrismaClient } from "@prisma/client";\nexport const x = PrismaClient;\n`;

// One instance for the whole file. Constructing ESLint per call reloads the
// Next.js config and the TypeScript parser each time, which costs seconds.
const eslint = new ESLint();

async function lintAs(filePath: string) {
  const [result] = await eslint.lintText(PRISMA_IMPORT, {
    filePath,
    warnIgnored: false,
  });
  return result.messages.filter((m) => m.ruleId === "no-restricted-imports");
}

function workerRuntimeClosure(): string[] {
  // The Netlify Scheduled Functions are the only always-off-request runtime
  // now — the pg-boss worker is gone. Their transitive import closure must
  // stay clear of request-only APIs for the same reason the worker's did.
  const functionsRoot = path.resolve(process.cwd(), "netlify/functions");
  const entrypoints = readdirSync(functionsRoot)
    .filter((name) => name.endsWith(".ts") || name.endsWith(".mts"))
    .map((name) => path.join(functionsRoot, name));
  return runtimeClosureFrom(entrypoints);
}

/**
 * The Stripe webhook route's own runtime import closure — the second
 * instance of this walk, proving the same "no request-only API" guarantee
 * `workerRuntimeClosure()` already proves for the hold-release worker
 * (T-06-33). Its one entrypoint is the route file itself; from there the
 * walk follows `checkout-webhook-system-service.ts` and everything it
 * imports transitively.
 */
function webhookRuntimeClosure(): string[] {
  const entrypoints = [
    path.resolve(process.cwd(), "src", "app", "api", "webhooks", "stripe", "route.ts"),
  ];
  return runtimeClosureFrom(entrypoints);
}

/**
 * The Paystack webhook route's own runtime import closure (07-04) — the
 * third instance of this walk, proving the same "no request-only API"
 * guarantee for a second, unauthenticated, actorless settlement path. Its
 * one entrypoint is the route file itself; from there the walk follows
 * `checkout-webhook-system-service.ts`, `providers/paystack/*`, and
 * everything they import transitively.
 */
function paystackWebhookRuntimeClosure(): string[] {
  const entrypoints = [
    path.resolve(process.cwd(), "src", "app", "api", "webhooks", "paystack", "route.ts"),
  ];
  return runtimeClosureFrom(entrypoints);
}

/**
 * The specifier set both closure assertions flag — a request-only API that
 * must never reach an actorless worker/webhook module. Shared so the two
 * assertions can never flag a different set by accident.
 */
function findRequestOnlyOffenders(closure: string[]): Array<{ file: string; specifier: string }> {
  return closure.flatMap((filePath) =>
    runtimeImports(filePath)
      .filter(
        ({ specifier, importsCurrentActor }) =>
          specifier === "next/headers" ||
          specifier === "@/server/permissions" ||
          specifier.startsWith("@/server/permissions/") ||
          importsCurrentActor,
      )
      .map(({ specifier }) => ({
        file: path.relative(process.cwd(), filePath),
        specifier,
      })),
  );
}

/**
 * Plan 11-10 Task 3 — the wiring plan's own closure guards. Task 1 makes
 * `lesson-progress-service.ts` and `attendance-service.ts` import
 * `certificate-issuance-service.ts`, which transitively reaches
 * `certificate-pdf-renderer.ts` and `storage-service.ts`. None of that
 * should ever land on `checkout-webhook-system-service.ts`'s own runtime
 * import closure — Phase 6's T-06-33 is the exact precedent for this class
 * of accidental closure growth caught by a test, not a review note.
 */
function checkoutWebhookSystemServiceClosure(): string[] {
  const entrypoints = [
    path.resolve(process.cwd(), "src", "server", "services", "checkout-webhook-system-service.ts"),
  ];
  return runtimeClosureFrom(entrypoints);
}

/** `enrolment-transitions.ts`'s own runtime import closure — its header states it MUST NOT import `next/*` or the permission choke point (plan 11-01 preserved this; plan 11-07 calls `assertTransition` from a module that DOES import both). */
function enrolmentTransitionsClosure(): string[] {
  const entrypoints = [
    path.resolve(process.cwd(), "src", "server", "services", "enrolment-transitions.ts"),
  ];
  return runtimeClosureFrom(entrypoints);
}

/** The set of specifiers `enrolment-transitions.ts`'s isolation rule forbids — `next/*` and the permission choke point, checked independently of `findRequestOnlyOffenders` (that helper only flags `next/headers`, not every `next/*` specifier). */
function findIsolationOffenders(closure: string[]): Array<{ file: string; specifier: string }> {
  return closure.flatMap((filePath) =>
    runtimeImports(filePath)
      .filter(
        ({ specifier }) =>
          specifier === "next" ||
          specifier.startsWith("next/") ||
          specifier === "@/server/permissions" ||
          specifier.startsWith("@/server/permissions/"),
      )
      .map(({ specifier }) => ({
        file: path.relative(process.cwd(), filePath),
        specifier,
      })),
  );
}

/**
 * Every project-local (`src/`) file whose runtime import closure (not
 * type-only) names a given bare specifier — used below to prove the PDF
 * library has exactly one importer (11-04's grep-based criterion, promoted
 * to a permanent gate).
 */
function projectSourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) return projectSourceFiles(full);
    return [".ts", ".tsx"].includes(path.extname(full)) ? [full] : [];
  });
}

function importersOf(specifier: string, root: string): string[] {
  return projectSourceFiles(root)
    .filter((filePath) => runtimeImports(filePath).some((imp) => imp.specifier === specifier))
    .map((filePath) => path.relative(process.cwd(), filePath).replace(/\\/g, "/"));
}

// The first lint pays for loading eslint-config-next, its plugins, and the
// TypeScript parser. Paying it here keeps that cost out of the assertions.
beforeAll(async () => {
  await lintAs("src/server/db.ts");
}, 300_000);

describe("service-layer boundary", () => {
  it("rejects a Prisma import from a route", async () => {
    expect(await lintAs("src/app/page.tsx")).toHaveLength(1);
  });

  it("rejects a Prisma import from a component", async () => {
    expect(await lintAs("src/components/primitives/ResourceTable.tsx")).toHaveLength(1);
  });

  it("rejects a Prisma import from a non-service server module", async () => {
    expect(await lintAs("src/server/audit/writer.ts")).toHaveLength(1);
  });

  it("rejects a Prisma import from the permissions module", async () => {
    expect(await lintAs("src/server/permissions/scope.ts")).toHaveLength(1);
  });

  it("allows a Prisma import from a service", async () => {
    expect(await lintAs("src/server/services/course-service.ts")).toHaveLength(0);
  });

  it("allows a Prisma import from the db client module", async () => {
    expect(await lintAs("src/server/db.ts")).toHaveLength(0);
  });

  it("rejects a Prisma import from a Netlify scheduled function", async () => {
    expect(await lintAs("netlify/functions/release-expired-holds.ts")).toHaveLength(1);
  });

  it("rejects a Prisma import from the reconcile-payments Netlify scheduled function (07-07)", async () => {
    expect(await lintAs("netlify/functions/reconcile-payments.ts")).toHaveLength(1);
  });

  it("keeps the scheduled-function runtime import closure away from request-only APIs", () => {
    expect(findRequestOnlyOffenders(workerRuntimeClosure())).toEqual([]);
  });

  it("the scheduled-function closure actually reaches the reconciliation service (07-07 — the assertion above is not vacuous)", () => {
    const closure = workerRuntimeClosure();
    const touchesReconciliationService = closure.some((filePath) =>
      filePath.replace(/\\/g, "/").endsWith("src/server/services/payment-reconciliation-service.ts"),
    );
    expect(touchesReconciliationService).toBe(true);
  });

  it("keeps the Stripe webhook route's runtime import closure away from request-only APIs", () => {
    expect(findRequestOnlyOffenders(webhookRuntimeClosure())).toEqual([]);
  });

  it("the webhook closure actually reaches the settlement service (the assertion above is not vacuous)", () => {
    const closure = webhookRuntimeClosure();
    const touchesSettlementService = closure.some((filePath) =>
      filePath.replace(/\\/g, "/").endsWith("src/server/services/checkout-webhook-system-service.ts"),
    );
    expect(touchesSettlementService).toBe(true);
  });

  it("keeps the Paystack webhook route's runtime import closure away from request-only APIs (07-04)", () => {
    expect(findRequestOnlyOffenders(paystackWebhookRuntimeClosure())).toEqual([]);
  });

  it("the Paystack webhook closure actually reaches the settlement service (the assertion above is not vacuous)", () => {
    const closure = paystackWebhookRuntimeClosure();
    const touchesSettlementService = closure.some((filePath) =>
      filePath.replace(/\\/g, "/").endsWith("src/server/services/checkout-webhook-system-service.ts"),
    );
    expect(touchesSettlementService).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Plan 11-10 Task 3 — closure guards for the completion/attendance/grade
  // wiring into certificate issuance.
  // -------------------------------------------------------------------------

  it("keeps checkout-webhook-system-service.ts's closure free of the permission choke point and the PDF/certificate stack (11-10)", () => {
    const closure = checkoutWebhookSystemServiceClosure();

    expect(findRequestOnlyOffenders(closure)).toEqual([]);

    const certificateOrPdfFiles = closure.filter((filePath) => {
      const rel = filePath.replace(/\\/g, "/");
      return (
        rel.endsWith("certificate-pdf-renderer.ts") ||
        rel.endsWith("certificate-issuance-service.ts")
      );
    });
    expect(certificateOrPdfFiles).toEqual([]);

    const importsPdfLib = closure.some((filePath) =>
      runtimeImports(filePath).some((imp) => imp.specifier === "pdf-lib"),
    );
    expect(importsPdfLib).toBe(false);
  });

  it("the PDF library (pdf-lib) has exactly one importer under src/ (11-04's criterion, promoted to a permanent gate)", () => {
    const importers = importersOf("pdf-lib", path.resolve(process.cwd(), "src"));
    expect(new Set(importers)).toEqual(
      new Set(["src/server/services/certificate-pdf-renderer.ts"]),
    );
  });

  it("keeps enrolment-transitions.ts's own closure free of next/* and the permission choke point (11-10)", () => {
    const closure = enrolmentTransitionsClosure();
    expect(findIsolationOffenders(closure)).toEqual([]);
  });
});
