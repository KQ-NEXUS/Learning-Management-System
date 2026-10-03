/**
 * Licence enforcement boundary (Phase 14, plan 14-17; D-09).
 *
 * A static, registry-driven proof that no database write path in the service
 * layer is left unguarded. ESLint confines `@prisma/client` to
 * `src/server/services/**` and `src/server/db.ts`, so the service files are the
 * complete write surface. The AST scan in `./support/licence-write-scan.ts`
 * finds every service file that writes and every permission call site; this
 * file checks them against `LICENCE_SERVICE_REGISTRY`. Pure helper functions
 * (`findUnregisteredWriters` and friends) do the comparisons so the same logic
 * is exercised both against the real tree and, in the unit tests, against
 * deliberately broken inputs to prove each check can fail.
 */

import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPermission } from "@/server/permissions/catalogue";
import { effectForPermission, LICENCE_PERMISSION_EFFECT } from "@/server/licence/effects";
import {
  CONTINUITY_TAG_SNAPSHOT,
  DYNAMIC_PERMISSION_FILES,
  LICENCE_SERVICE_REGISTRY,
  type RegistryEntry,
} from "@/server/licence/registry";
import { resolveProjectImport, runtimeImports } from "./import-graph";
import { scanServiceFiles, scanSource, type ScannedServiceFile } from "./support/licence-write-scan";

const SERVICES = "src/server/services/";

function entryFor(file: string): RegistryEntry | undefined {
  return LICENCE_SERVICE_REGISTRY.find((entry) => entry.file === file);
}

// ---------------------------------------------------------------------------
// Pure checks. Each returns the offending items so the real-tree test can
// assert an empty list and a unit test can prove the check does fail.
// ---------------------------------------------------------------------------

/** Writing files with no registry entry (an unguarded, unclassified write path). */
function findUnregisteredWriters(
  scanned: readonly ScannedServiceFile[],
  registry: readonly RegistryEntry[],
): string[] {
  const registered = new Set(registry.map((entry) => entry.file));
  return scanned.filter((file) => file.writes && !registered.has(file.file)).map((file) => file.file);
}

/** Registry entries whose file is not part of the scanned set (stale after a rename or delete). */
function findStaleEntries(
  scanned: readonly ScannedServiceFile[],
  registry: readonly RegistryEntry[],
): string[] {
  const existing = new Set(scanned.map((file) => file.file));
  return registry.filter((entry) => !existing.has(entry.file)).map((entry) => entry.file);
}

/** A file registered more than once. */
function findDuplicateEntries(registry: readonly RegistryEntry[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const entry of registry) {
    if (seen.has(entry.file)) duplicates.add(entry.file);
    seen.add(entry.file);
  }
  return [...duplicates];
}

/** Non-literal permission call sites in a file that is not a reviewed dynamic file. */
function findUndeclaredDynamicPermissions(
  scanned: readonly ScannedServiceFile[],
  dynamicFiles: ReadonlyArray<{ file: string }>,
): string[] {
  const allowed = new Set(dynamicFiles.map((entry) => entry.file));
  return scanned.flatMap((file) =>
    allowed.has(file.file)
      ? []
      : file.permissionCalls
          .filter((call) => call.permission === null)
          .map((call) => `${file.file}:${call.line}`),
  );
}

type OverrideRow = { file: string; permission: string; reason: string | null };

/**
 * Call-site overrides that change the effect the permission would otherwise
 * have (a real exception, Pitfall 1), as rows. An override that merely restates
 * the permission's own default is a redundant restatement and is returned by
 * `restatedOverrides` instead.
 */
function overrideRows(scanned: readonly ScannedServiceFile[]): Array<OverrideRow & { restates: boolean }> {
  return scanned.flatMap((file) =>
    file.permissionCalls.flatMap((call) =>
      call.override !== null && call.permission !== null
        ? [
            {
              file: file.file,
              permission: call.permission,
              reason: call.reason,
              restates: call.override === effectForPermission(call.permission),
            },
          ]
        : [],
    ),
  );
}

function exceptionOverrides(scanned: readonly ScannedServiceFile[]): OverrideRow[] {
  return overrideRows(scanned)
    .filter((row) => !row.restates)
    .map(({ file, permission, reason }) => ({ file, permission, reason }));
}

function restatedOverrides(scanned: readonly ScannedServiceFile[]): string[] {
  return [
    ...new Set(
      overrideRows(scanned)
        .filter((row) => row.restates)
        .map((row) => `${row.file}|${row.permission}`),
    ),
  ].sort();
}

function pairKey(row: { file: string; permission: string }): string {
  return `${row.file}|${row.permission}`;
}

function projectSourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) return projectSourceFiles(full);
    return [".ts", ".tsx"].includes(path.extname(full)) ? [full] : [];
  });
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

describe("licence write scanner", () => {
  it("reports writes true for a Prisma write call and false for reads only", () => {
    const writer = scanSource(
      `${SERVICES}x-service.ts`,
      `export async function f(tx: any) { await tx.order.update({ where: { id: "1" }, data: {} }); }`,
    );
    const reader = scanSource(
      `${SERVICES}y-service.ts`,
      `export async function f(tx: any) { return tx.order.findMany({ where: {} }); }`,
    );
    expect(writer.writes).toBe(true);
    expect(reader.writes).toBe(false);
  });

  it("detects every write method name and raw SQL write statements", () => {
    for (const method of [
      "create",
      "createMany",
      "update",
      "updateMany",
      "delete",
      "deleteMany",
      "upsert",
      "$executeRaw",
      "$executeRawUnsafe",
    ]) {
      expect(
        scanSource(`${SERVICES}m.ts`, `export const f = (tx: any) => tx.thing.${method}({});`).writes,
        method,
      ).toBe(true);
    }
    expect(scanSource(`${SERVICES}s.ts`, "export const q = (tx: any) => tx.$queryRaw`INSERT INTO \"Thing\" (a) VALUES (1)`;").writes).toBe(true);
    expect(scanSource(`${SERVICES}s.ts`, "export const q = (tx: any) => tx.$queryRaw`UPDATE \"Thing\" SET a = 1`;").writes).toBe(true);
    expect(scanSource(`${SERVICES}s.ts`, "export const q = (tx: any) => tx.$queryRaw`DELETE FROM \"Thing\"`;").writes).toBe(true);
    expect(scanSource(`${SERVICES}s.ts`, "export const q = (tx: any) => tx.$queryRaw`SELECT 1 FROM \"Thing\" FOR UPDATE`;").writes).toBe(false);
  });

  it("reports a curried permission call with its literal permission and no override", () => {
    const scanned = scanSource(
      `${SERVICES}p.ts`,
      `const scope = {};
       export const run = authorize<string>("users.manage", () => scope)(async (input) => input);`,
    );
    expect(scanned.permissionCalls).toEqual([
      { permission: "users.manage", override: null, reason: null, unresolvedOptions: false, line: 2 },
    ]);
  });

  it("reads the licence override and reason from the third argument", () => {
    const scanned = scanSource(
      `${SERVICES}p.ts`,
      `export const run = authorize("users.manage", () => ({}), { licence: "continuity", reason: "x" })(async () => {});`,
    );
    expect(scanned.permissionCalls).toHaveLength(1);
    expect(scanned.permissionCalls[0]).toMatchObject({
      permission: "users.manage",
      override: "continuity",
      reason: "x",
    });
  });

  it("reports permission null when the first argument is not a string literal", () => {
    const scanned = scanSource(
      `${SERVICES}p.ts`,
      `export const run = authorize(perm, () => ({}))(async () => {});`,
    );
    expect(scanned.permissionCalls).toHaveLength(1);
    expect(scanned.permissionCalls[0]?.permission).toBeNull();
  });

  it("finds a permission call through a destructured, dep-property or identifier-resolver shape", () => {
    const scanned = scanSource(
      `${SERVICES}p.ts`,
      `export const a = deps.withPermission<string>("payments.view", findScope)(async (id, ctx) => ctx);
       export const b = withPermission("courses.edit", (i) => scope(i))(async () => {});`,
    );
    expect(scanned.permissionCalls.map((call) => call.permission)).toEqual([
      "payments.view",
      "courses.edit",
    ]);
  });

  it("does not report a non-curried call with a string first argument as a permission call", () => {
    const scanned = scanSource(
      `${SERVICES}p.ts`,
      `export const a = format("users.manage", () => 1);
       export const b = format("users.manage", () => 1, { licence: "continuity" });
       export const c = authorize("users.manage")(async () => {});`,
    );
    expect(scanned.permissionCalls).toEqual([]);
  });

  it("reads guard operations from assertWriteAllowed object literals", () => {
    const scanned = scanSource(
      `${SERVICES}g.ts`,
      `export async function f(deps: any, actor: any) {
         await deps.licence?.assertWriteAllowed({ operation: "checkout.start", actorId: actor.userId });
         await assertWriteAllowed({ operation: "registration", actorId: null });
         await deps.licence.assertWriteAllowed({ operation: dynamicOperation });
       }`,
    );
    expect(scanned.guardOperations).toEqual(["checkout.start", "registration"]);
  });

  it("reports runtime imports of the permission layer but not type-only ones", () => {
    const base = `${SERVICES}i.ts`;
    expect(scanSource(base, `import { withPermission } from "@/server/permissions";`).importsPermissionLayer).toBe(true);
    expect(scanSource(base, `import { x } from "@/server/permissions/scope";`).importsPermissionLayer).toBe(true);
    expect(scanSource(base, `export const f = async () => (await import("@/server/permissions")).can;`).importsPermissionLayer).toBe(true);
    expect(scanSource(base, `import type { Actor } from "@/server/permissions/with-permission";`).importsPermissionLayer).toBe(false);
    expect(scanSource(base, `import { type Actor } from "@/server/permissions/with-permission";`).importsPermissionLayer).toBe(false);
    expect(scanSource(base, `import { prisma } from "@/server/db";`).importsPermissionLayer).toBe(false);
  });
});

describe("licence guard files (tracer)", () => {
  const scanned = scanServiceFiles();
  const byFile = new Map(scanned.map((file) => [file.file, file]));

  it("scans checkout-service.ts and registration-service.ts with their guard operations", () => {
    expect(byFile.get(`${SERVICES}checkout-service.ts`)?.guardOperations).toEqual(
      expect.arrayContaining(["checkout.start", "checkout.initiate_stripe", "checkout.initiate_paystack"]),
    );
    expect(byFile.get(`${SERVICES}registration-service.ts`)?.guardOperations).toContain("registration");
  });

  it("registers both as guard files naming exactly the operations the files contain", () => {
    for (const file of [`${SERVICES}checkout-service.ts`, `${SERVICES}registration-service.ts`]) {
      const entry = entryFor(file);
      expect(entry?.kind, file).toBe("guard");
      expect(entry?.guardOperations?.length, file).toBeGreaterThan(0);
      const present = byFile.get(file)?.guardOperations ?? [];
      for (const operation of entry?.guardOperations ?? []) {
        expect(present, `${file} must contain a guard call for ${operation}`).toContain(operation);
      }
      expect([...present].sort(), file).toEqual([...(entry?.guardOperations ?? [])].sort());
    }
  });

});

describe("scanner resolves options passed by name", () => {
  it("reads licence and reason from a same-file const used as the third argument", () => {
    const scanned = scanSource(
      `${SERVICES}p.ts`,
      `const OPTIONS = { licence: "continuity", reason: "recovery" } as const;
       export const run = authorize("licence.activate", () => ({}), OPTIONS)(async () => {});`,
    );
    expect(scanned.permissionCalls[0]).toMatchObject({
      permission: "licence.activate",
      override: "continuity",
      reason: "recovery",
      unresolvedOptions: false,
    });
  });

  it("flags a third argument whose effect cannot be read statically", () => {
    const scanned = scanSource(
      `${SERVICES}p.ts`,
      `export const a = authorize("users.manage", () => ({}), imported)(async () => {});
       export const b = authorize("users.manage", () => ({}), { licence: effect })(async () => {});`,
    );
    expect(scanned.permissionCalls.map((call) => call.unresolvedOptions)).toEqual([true, true]);
    expect(scanned.permissionCalls.map((call) => call.override)).toEqual([null, null]);
  });
});

describe("D-09 completeness: every writing service file is classified", () => {
  const scanned = scanServiceFiles();

  it("scans a plausible number of service files and writers", () => {
    expect(scanned.length).toBeGreaterThan(80);
    expect(scanned.filter((file) => file.writes).length).toBeGreaterThan(40);
  });

  it("has a registry entry for every file that writes", () => {
    expect(findUnregisteredWriters(scanned, LICENCE_SERVICE_REGISTRY)).toEqual([]);
  });

  it("has no stale, duplicate or unreasoned registry entry", () => {
    expect(findStaleEntries(scanned, LICENCE_SERVICE_REGISTRY)).toEqual([]);
    expect(findDuplicateEntries(LICENCE_SERVICE_REGISTRY)).toEqual([]);
    for (const entry of LICENCE_SERVICE_REGISTRY) {
      expect(entry.file.startsWith(SERVICES), entry.file).toBe(true);
      expect(entry.file.includes("\\"), entry.file).toBe(false);
      expect(entry.reason.trim().length, `${entry.file} needs a reason`).toBeGreaterThan(20);
    }
  });

  it("fails for an extra writing file that is not registered (the check can fail)", () => {
    const extra = scanSource(
      `${SERVICES}zz-unclassified-service.ts`,
      `export async function f(tx: any) { await tx.thing.deleteMany({}); }`,
    );
    expect(findUnregisteredWriters([...scanned, extra], LICENCE_SERVICE_REGISTRY)).toEqual([
      `${SERVICES}zz-unclassified-service.ts`,
    ]);
  });

  it("fails for a stale entry and for a duplicate entry (the checks can fail)", () => {
    const stale: RegistryEntry = {
      file: `${SERVICES}deleted-service.ts`,
      kind: "continuity",
      reason: "A file that no longer exists in the scanned set.",
    };
    expect(findStaleEntries(scanned, [...LICENCE_SERVICE_REGISTRY, stale])).toEqual([stale.file]);
    const first = LICENCE_SERVICE_REGISTRY[0]!;
    expect(findDuplicateEntries([...LICENCE_SERVICE_REGISTRY, first])).toEqual([first.file]);
  });

  it("registers a not-a-db-write file only when it reaches no database module", () => {
    for (const entry of LICENCE_SERVICE_REGISTRY.filter((candidate) => candidate.kind === "not-a-db-write")) {
      const specifiers = runtimeImports(path.resolve(process.cwd(), entry.file)).map((item) => item.specifier);
      expect(specifiers.filter((specifier) => specifier === "@prisma/client" || specifier === "@/server/db"), entry.file).toEqual([]);
    }
  });

  it("holds because only the service layer reaches the database (the premise of a service-file registry)", () => {
    const offenders: string[] = [];
    const roots = ["src", "netlify/functions"].map((root) => path.resolve(process.cwd(), root));
    for (const file of roots.flatMap((root) => projectSourceFiles(root))) {
      const relative = toPosix(path.relative(process.cwd(), file));
      if (relative.startsWith(SERVICES) || relative === "src/server/db.ts") continue;
      for (const item of runtimeImports(file)) {
        if (item.specifier === "@prisma/client" || item.specifier === "@/server/db") {
          offenders.push(`${relative} imports ${item.specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("D-09 withPermission files: every permission call is classified", () => {
  const scanned = scanServiceFiles();
  const byFile = new Map(scanned.map((file) => [file.file, file]));
  const withPermissionEntries = LICENCE_SERVICE_REGISTRY.filter((entry) => entry.kind === "withPermission");

  it("resolves every literal permission to a catalogue permission and an effect", () => {
    for (const file of scanned) {
      for (const call of file.permissionCalls) {
        if (call.permission === null) continue;
        expect(isPermission(call.permission), `${file.file}:${call.line} ${call.permission}`).toBe(true);
        expect(
          Object.hasOwn(LICENCE_PERMISSION_EFFECT, call.permission),
          `${file.file}:${call.line} ${call.permission} has an effect`,
        ).toBe(true);
      }
    }
  });

  it("allows a non-literal permission only in a reviewed dynamic file, and every dynamic entry is live", () => {
    expect(findUndeclaredDynamicPermissions(scanned, DYNAMIC_PERMISSION_FILES)).toEqual([]);
    for (const dynamic of DYNAMIC_PERMISSION_FILES) {
      expect(dynamic.reason.trim().length, dynamic.file).toBeGreaterThan(20);
      const nulls = byFile.get(dynamic.file)?.permissionCalls.filter((call) => call.permission === null) ?? [];
      expect(nulls.length, `${dynamic.file} no longer forwards a dynamic permission`).toBeGreaterThan(0);
      expect(entryFor(dynamic.file)?.kind, dynamic.file).toBe("withPermission");
    }
  });

  it("fails for a non-literal permission in an unreviewed file (the check can fail)", () => {
    const extra = scanSource(
      `${SERVICES}zz-dynamic-service.ts`,
      `export const run = authorize(somePermission, () => ({}))(async () => {});`,
    );
    expect(findUndeclaredDynamicPermissions([...scanned, extra], DYNAMIC_PERMISSION_FILES)).toEqual([
      `${SERVICES}zz-dynamic-service.ts:1`,
    ]);
  });

  it("reads every options argument statically", () => {
    const unresolved = scanned.flatMap((file) =>
      file.permissionCalls.filter((call) => call.unresolvedOptions).map((call) => `${file.file}:${call.line}`),
    );
    expect(unresolved).toEqual([]);
  });

  it("registers every withPermission file with at least one permission call", () => {
    expect(withPermissionEntries.length).toBeGreaterThan(20);
    for (const entry of withPermissionEntries) {
      expect(byFile.get(entry.file)?.permissionCalls.length ?? 0, entry.file).toBeGreaterThan(0);
    }
  });

  it("resolves an unclassified permission string to write (default-block)", () => {
    expect(effectForPermission("widgets.manage")).toBe("write");
    expect(effectForPermission("")).toBe("write");
    expect(effectForPermission("toString")).toBe("write");
    expect(effectForPermission("users.manage")).toBe("write");
    expect(effectForPermission("users.view")).toBe("read");
    expect(effectForPermission("grades.manage")).toBe("continuity");
  });
});

describe("Pitfall 1: the call-site continuity overrides are an exact, reasoned snapshot", () => {
  const scanned = scanServiceFiles();

  // Hard-coded on purpose: changing this list is a reviewed decision, and the
  // registry copy and the source call sites must agree with it (D-09, T-14-17-02).
  const REVIEWED_OVERRIDES = [
    { file: `${SERVICES}lesson-progress-service.ts`, permission: "enrolments.manage" },
    { file: `${SERVICES}staff-account-service.ts`, permission: "users.manage" },
    { file: `${SERVICES}email-delivery-log-service.ts`, permission: "users.manage" },
  ];

  // Overrides that only restate a permission's own default effect are not
  // exceptions; this is the one reviewed restatement: licence activation is
  // continuity in the effect map and is also pinned at its call sites as
  // defence in depth (T-14-06-03).
  const REVIEWED_RESTATEMENTS = [`${SERVICES}licence-staff-service.ts|licence.activate`];

  it("has exactly the three reviewed exceptions in the source, each with a reason", () => {
    const found = exceptionOverrides(scanned);
    expect(found.map(pairKey).sort()).toEqual(REVIEWED_OVERRIDES.map(pairKey).sort());
    for (const row of found) {
      expect((row.reason ?? "").trim().length, `${row.file} override needs a reason`).toBeGreaterThan(10);
    }
  });

  it("matches the registry snapshot in file, permission and reason", () => {
    expect(CONTINUITY_TAG_SNAPSHOT.map(pairKey).sort()).toEqual(REVIEWED_OVERRIDES.map(pairKey).sort());
    const sourceRows = exceptionOverrides(scanned);
    for (const snapshot of CONTINUITY_TAG_SNAPSHOT) {
      expect(snapshot.reason.trim().length, snapshot.file).toBeGreaterThan(10);
      const source = sourceRows.find((row) => pairKey(row) === pairKey(snapshot));
      expect(source?.reason, `${snapshot.file} source reason`).toBe(snapshot.reason);
    }
  });

  it("only restates a default effect where it was reviewed", () => {
    expect(restatedOverrides(scanned)).toEqual(REVIEWED_RESTATEMENTS);
  });

  it("makes every exception a continuity override of a write-default permission", () => {
    const calls = scanned.flatMap((file) =>
      file.permissionCalls.map((call) => ({ ...call, file: file.file })),
    );
    for (const row of exceptionOverrides(scanned)) {
      const call = calls.find((candidate) => candidate.file === row.file && candidate.permission === row.permission && candidate.override !== null);
      expect(call?.override, row.file).toBe("continuity");
      expect(effectForPermission(row.permission), row.file).toBe("write");
    }
  });

  it("fails for an undeclared override in a new file (the check can fail)", () => {
    const extra = scanSource(
      `${SERVICES}zz-tagged-service.ts`,
      `export const run = authorize("users.manage", () => ({}), { licence: "continuity", reason: "A new unreviewed exception here" })(async () => {});`,
    );
    const rows = exceptionOverrides([...scanned, extra]).map(pairKey).sort();
    expect(rows).not.toEqual(REVIEWED_OVERRIDES.map(pairKey).sort());
    expect(rows).toContain(`${SERVICES}zz-tagged-service.ts|users.manage`);
  });

  it("shows the adopted ledger in the effective effects (A9, A10, A11)", () => {
    const effective = (file: string, permission: string): string[] =>
      (scanned.find((candidate) => candidate.file === `${SERVICES}${file}`)?.permissionCalls ?? [])
        .filter((call) => call.permission === permission)
        .map((call) => call.override ?? effectForPermission(permission));

    // A9: attendance recording and the staff progress override are continuity.
    expect(effective("attendance-service.ts", "attendance.manage")).toEqual(["continuity", "continuity"]);
    expect(effective("lesson-progress-service.ts", "enrolments.manage")).toEqual(["continuity"]);
    // A10: deactivation is continuity, creation and reactivation stay blocked.
    expect(effective("staff-account-service.ts", "users.manage").sort()).toEqual(["continuity", "write", "write"]);
    // A11: support tickets stay available.
    expect(effective("ticket-service.ts", "tickets.manage")).toEqual(["continuity"]);
    // D-07: the email-log resend stays available.
    expect(effective("email-delivery-log-service.ts", "users.manage")).toEqual(["continuity"]);
    // Enrolment writes stay blocked.
    expect(new Set(effective("enrolment-service.ts", "enrolments.manage"))).toEqual(new Set(["write"]));
  });
});

describe("D-09 read-fronted writes are documented", () => {
  const byFile = new Map(scanServiceFiles().map((file) => [file.file, file]));

  it("registers reconciliation-case-service with a readFrontedWrites reason and a payments.view wrapper", () => {
    const file = `${SERVICES}reconciliation-case-service.ts`;
    const entry = entryFor(file);
    expect(entry?.kind).toBe("withPermission");
    expect((entry?.readFrontedWrites ?? "").trim().length).toBeGreaterThan(20);
    expect(byFile.get(file)?.permissionCalls.map((call) => call.permission)).toContain("payments.view");
    expect(effectForPermission("payments.view")).toBe("read");
  });

  it("allows readFrontedWrites only on withPermission entries", () => {
    for (const entry of LICENCE_SERVICE_REGISTRY.filter((candidate) => candidate.readFrontedWrites !== undefined)) {
      expect(entry.kind, entry.file).toBe("withPermission");
    }
  });
});

describe("D-07, D-08 system, continuity and licence files", () => {
  const byFile = new Map(scanServiceFiles().map((file) => [file.file, file]));

  it("keeps system services free of the permission layer", () => {
    const systems = LICENCE_SERVICE_REGISTRY.filter((entry) => entry.kind === "system");
    expect(systems.length).toBeGreaterThan(5);
    for (const entry of systems) {
      expect(byFile.get(entry.file)?.importsPermissionLayer, entry.file).toBe(false);
    }
  });

  it("requires a continuity file that imports the permission layer to state the exemption", () => {
    for (const entry of LICENCE_SERVICE_REGISTRY.filter((candidate) => candidate.kind === "continuity")) {
      if (byFile.get(entry.file)?.importsPermissionLayer) {
        expect(entry.reason, `${entry.file} imports the permission layer`).toMatch(/permission layer/i);
      }
    }
  });

  it("flags an undocumented permission-layer import (the check can fail)", () => {
    const extra = scanSource(
      `${SERVICES}zz-continuity-service.ts`,
      `import { withPermission } from "@/server/permissions"; export const f = withPermission;`,
    );
    expect(extra.importsPermissionLayer).toBe(true);
    expect("Learner coursework that continues (D-06).").not.toMatch(/permission layer/i);
  });

  it("registers exactly the three licence services as kind licence", () => {
    expect(
      LICENCE_SERVICE_REGISTRY.filter((entry) => entry.kind === "licence")
        .map((entry) => entry.file)
        .sort(),
    ).toEqual([
      `${SERVICES}licence-activation-service.ts`,
      `${SERVICES}licence-notice-service.ts`,
      `${SERVICES}licence-service.ts`,
    ]);
  });

  it("registers the named system, guard and continuity services from the research inventory", () => {
    const expected: Record<string, string[]> = {
      system: [
        "checkout-webhook-system-service",
        "payment-reconciliation-service",
        "hold-release-system-service",
        "upload-cleanup-system-service",
        "ticket-auto-close-system-service",
        "seat-accounting",
        "email-dispatch-service",
        "email-failure-alert-service",
        "domain-event-drain-service",
        "domain-event-service",
        "export-worker-service",
      ],
      continuity: [
        "attempt-service",
        "submission-service",
        "completion-service",
        "certificate-issuance-service",
        "certificate-file-service",
        "auth-service",
        "session-service",
        "verification-service",
        "password-reset-service",
        "profile-service",
        "email-preference-service",
        "notification-service",
        "ticket-attachment-service",
        "ticket-context-service",
        "export-service",
        "export-download-service",
        "audit-service",
      ],
    };
    for (const [kind, names] of Object.entries(expected)) {
      for (const name of names) {
        expect(entryFor(`${SERVICES}${name}.ts`)?.kind, name).toBe(kind);
      }
    }
  });
});

describe("T-14-07-06 licence activation is reachable only through the licence.activate wrapper", () => {
  it("has licence-staff-service as the only runtime importer of licence-activation-service", () => {
    const target = path.resolve(process.cwd(), `${SERVICES}licence-activation-service.ts`);
    const importers: string[] = [];
    for (const file of projectSourceFiles(path.resolve(process.cwd(), "src"))) {
      const imports = runtimeImports(file).filter(
        (item) => resolveProjectImport(file, item.specifier) === target,
      );
      if (imports.length > 0) importers.push(toPosix(path.relative(process.cwd(), file)));
    }
    expect(importers).toEqual([`${SERVICES}licence-staff-service.ts`]);
  });

  it("wraps both entry points of that importer in a licence.activate permission call", () => {
    const staff = scanServiceFiles().find((file) => file.file === `${SERVICES}licence-staff-service.ts`);
    expect(staff?.permissionCalls.filter((call) => call.permission === "licence.activate")).toHaveLength(2);
  });
});
