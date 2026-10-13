/**
 * AST scan of the service layer for the licence enforcement boundary test
 * (Phase 14, plan 14-17; D-09).
 *
 * ESLint confines `@prisma/client` to `src/server/services/**` and
 * `src/server/db.ts`, so the service files are the complete database write
 * surface and a per-file scan is the right unit. For each service file this
 * module reports:
 *
 * - `writes`: whether the file performs a database write. A call whose callee
 *   is a property access named create, createMany, update, updateMany, delete,
 *   deleteMany, upsert, $executeRaw or $executeRawUnsafe counts, as does a
 *   template literal (tagged or not) or a string passed to a `$`-prefixed raw
 *   client call that contains an INSERT INTO, UPDATE "table" or DELETE FROM
 *   statement. The scan deliberately over-reports (a Map.delete or a hash
 *   .update is a writer too): a false positive is classified once in the
 *   registry as `not-a-db-write`, a false negative would be an unguarded path.
 * - `permissionCalls`: every permission call site, detected STRUCTURALLY and not
 *   by identifier name. Services destructure the choke point
 *   (`const { withPermission } = deps`, `withPermission: authorize`) and call
 *   curried forms such as `authorize<T>("users.manage", () => scope)(handler)`,
 *   so a site is a CallExpression that is itself the callee of another call and
 *   whose own arguments are (permission, function-valued scope resolver,
 *   optional options object).
 * - `guardOperations`: the `operation` string literals of every call to a
 *   function or property named `assertWriteAllowed` (the explicit guard used by
 *   the learner entry points).
 * - `importsPermissionLayer`: a runtime (not type-only) static import, re-export
 *   or dynamic import of `@/server/permissions` or a path beneath it.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export type LicenceOverride = "read" | "write" | "continuity";

export interface PermissionCall {
  /** The first-argument string literal, or null when it is not a literal. */
  permission: string | null;
  /** The `licence` option of the third argument, when it is an object literal. */
  override: LicenceOverride | null;
  /** The `reason` option of the third argument, when it is a string literal. */
  reason: string | null;
  /**
   * True when a third argument exists but its `licence` effect could not be
   * read statically (not an object literal, not a same-file const holding one,
   * or a non-literal `licence` value). The boundary test requires false.
   */
  unresolvedOptions: boolean;
  line: number;
}

export interface ScannedServiceFile {
  /** Path relative to the repository root, forward slashes. */
  file: string;
  writes: boolean;
  permissionCalls: PermissionCall[];
  guardOperations: string[];
  importsPermissionLayer: boolean;
}

export const SERVICES_DIR = "src/server/services";

const WRITE_METHODS = new Set([
  "create",
  "createMany",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "upsert",
  "$executeRaw",
  "$executeRawUnsafe",
]);

const SQL_WRITE = /\bINSERT\s+INTO\b|\bDELETE\s+FROM\b|\bUPDATE\s+"/i;

const OVERRIDE_VALUES: ReadonlySet<string> = new Set(["read", "write", "continuity"]);

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function literalText(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function isFunctionValued(node: ts.Node): boolean {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isIdentifier(node) ||
    ts.isPropertyAccessExpression(node)
  );
}

function calleeName(expression: ts.LeftHandSideExpression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function templateText(node: ts.TemplateLiteral): string {
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ");
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current)
    ) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

/**
 * Reads `{ licence, reason }` from an options expression: an object literal, or an
 * identifier naming a same-file const whose initializer is an object literal (the
 * `ACTIVATION_OPTIONS` shape in licence-staff-service.ts). Anything else is reported
 * as unresolved rather than silently treated as "no override".
 */
function readOptions(
  node: ts.Expression | undefined,
  constants: ReadonlyMap<string, ts.Expression>,
): { override: LicenceOverride | null; reason: string | null; unresolved: boolean } {
  if (!node) return { override: null, reason: null, unresolved: false };
  let resolved = unwrap(node);
  if (ts.isIdentifier(resolved)) {
    const initializer = constants.get(resolved.text);
    if (!initializer) return { override: null, reason: null, unresolved: true };
    resolved = unwrap(initializer);
  }
  if (!ts.isObjectLiteralExpression(resolved)) {
    return { override: null, reason: null, unresolved: true };
  }
  let override: LicenceOverride | null = null;
  let reason: string | null = null;
  let unresolved = false;
  for (const property of resolved.properties) {
    if (!ts.isPropertyAssignment(property)) {
      unresolved = true;
      continue;
    }
    const name = ts.isIdentifier(property.name)
      ? property.name.text
      : ts.isStringLiteral(property.name)
        ? property.name.text
        : null;
    if (name === "licence") {
      const value = literalText(unwrap(property.initializer));
      if (value !== null && OVERRIDE_VALUES.has(value)) override = value as LicenceOverride;
      else unresolved = true;
    } else if (name === "reason") {
      reason = literalText(unwrap(property.initializer));
    }
  }
  return { override, reason, unresolved };
}

function isPermissionLayerSpecifier(fromFile: string, specifier: string): boolean {
  if (specifier === "@/server/permissions" || specifier.startsWith("@/server/permissions/")) {
    return true;
  }
  if (specifier.startsWith(".")) {
    const resolved = toPosix(path.resolve(path.dirname(path.resolve(process.cwd(), fromFile)), specifier));
    const permissionsRoot = toPosix(path.resolve(process.cwd(), "src/server/permissions"));
    return resolved === permissionsRoot || resolved.startsWith(`${permissionsRoot}/`);
  }
  return false;
}

/** Scans one source text; `filePath` is only used for the report and relative import resolution. */
export function scanSource(filePath: string, text: string): ScannedServiceFile {
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
  let writes = false;
  let importsPermissionLayer = false;
  const permissionCalls: PermissionCall[] = [];
  const guardOperations: string[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      const named = clause?.namedBindings;
      const onlyTypeSpecifiers =
        named &&
        ts.isNamedImports(named) &&
        !clause.name &&
        named.elements.length > 0 &&
        named.elements.every((element) => element.isTypeOnly);
      if (onlyTypeSpecifiers) continue;
      if (isPermissionLayerSpecifier(filePath, statement.moduleSpecifier.text)) {
        importsPermissionLayer = true;
      }
    } else if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      isPermissionLayerSpecifier(filePath, statement.moduleSpecifier.text)
    ) {
      importsPermissionLayer = true;
    }
  }

  // Same-file const initializers, so an options argument passed by name resolves.
  const constants = new Map<string, ts.Expression>();
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      constants.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;

      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = literalText(node.arguments[0]);
        if (specifier !== null && isPermissionLayerSpecifier(filePath, specifier)) {
          importsPermissionLayer = true;
        }
      }

      if (ts.isPropertyAccessExpression(callee)) {
        const name = callee.name.text;
        if (WRITE_METHODS.has(name)) writes = true;
        if (name.startsWith("$")) {
          for (const argument of node.arguments) {
            const value = literalText(argument);
            if (value !== null && SQL_WRITE.test(value)) writes = true;
          }
        }
      }

      if (calleeName(callee) === "assertWriteAllowed") {
        const argument = node.arguments[0];
        if (argument && ts.isObjectLiteralExpression(argument)) {
          for (const property of argument.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              ts.isIdentifier(property.name) &&
              property.name.text === "operation"
            ) {
              const operation = literalText(property.initializer);
              if (operation !== null) guardOperations.push(operation);
            }
          }
        }
      }

      // Structural permission call site: this call is itself the callee of
      // another call, takes (first, function-valued resolver, optional options
      // object) and is therefore the first half of `authorize(p, resolve)(handler)`.
      const parent = node.parent;
      if (
        parent &&
        ts.isCallExpression(parent) &&
        parent.expression === node &&
        node.arguments.length >= 2 &&
        node.arguments.length <= 3 &&
        isFunctionValued(node.arguments[1]!)
      ) {
        const { override, reason, unresolved } = readOptions(node.arguments[2], constants);
        permissionCalls.push({
          permission: literalText(node.arguments[0]),
          override,
          reason,
          unresolvedOptions: unresolved,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        });
      }
    }

    if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (SQL_WRITE.test(templateText(node))) writes = true;
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return {
    file: toPosix(filePath),
    writes,
    permissionCalls,
    guardOperations,
    importsPermissionLayer,
  };
}

function listTypeScriptFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      listTypeScriptFiles(full, found);
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      found.push(full);
    }
  }
  return found;
}

/** Every `.ts` file under `src/server/services` (including event-mappers), scanned. */
export function scanServiceFiles(): ScannedServiceFile[] {
  const root = path.resolve(process.cwd(), SERVICES_DIR);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Service directory not found: ${root}`);
  }
  return listTypeScriptFiles(root)
    .map((absolute) => {
      const relative = toPosix(path.relative(process.cwd(), absolute));
      return scanSource(relative, readFileSync(absolute, "utf8"));
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}
