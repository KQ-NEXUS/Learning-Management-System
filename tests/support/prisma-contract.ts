import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Schema-derived findUnique-selector contract for test fakes (G-03-6a).
 *
 * A hand-written fake store in tests/profile-service.test.ts answered a
 * `findUnique({ where: { pendingEmail } })` query that the real Prisma
 * client rejects at run time — `User.pendingEmail` carries no `@unique` in
 * prisma/schema.prisma. The suite believed the fake over the database, and
 * the confirmation flow shipped 100% broken behind 303 passing tests.
 *
 * The legal single-field unique selectors for a model are therefore parsed
 * out of `prisma/schema.prisma` itself at run time, exactly once, so they
 * cannot drift from the schema the way a hand-maintained list can. A test
 * fake wraps its `findUnique` with `guardFindUnique` and can then never
 * answer a query the database would refuse.
 */

const schema = readFileSync(path.resolve(process.cwd(), "prisma/schema.prisma"), "utf8");

export type ModelFields = {
  /** Every field this model declares, scalar or relation. */
  allFields: Set<string>;
  /** Fields legal as a single-field findUnique selector: field-level @id or @unique. */
  uniqueFields: Set<string>;
};

const modelFieldsCache = new Map<string, ModelFields>();

function getModelBody(modelName: string): string {
  const marker = `model ${modelName} {`;
  const start = schema.indexOf(marker);
  if (start === -1) {
    throw new Error(
      `prisma-contract: model "${modelName}" was not found in prisma/schema.prisma. ` +
        `A model that cannot be located cannot be given legal selectors — this throws ` +
        `rather than returning an empty set, which would be vacuously permissive.`,
    );
  }
  const end = schema.indexOf("}", start);
  return schema.slice(start, end);
}

/**
 * Parses a model body one line at a time. Block-level attribute lines (the
 * ones beginning with a doubled at-sign, e.g. `@@unique([a, b])`) are
 * excluded from field parsing — a field named in a compound unique is NOT a
 * legal single-field selector, only a field carrying its own field-level
 * `@id` or `@unique` attribute is.
 */
export function getModelFields(modelName: string): ModelFields {
  const cached = modelFieldsCache.get(modelName);
  if (cached) return cached;

  const body = getModelBody(modelName);
  const allFields = new Set<string>();
  const uniqueFields = new Set<string>();

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith("@@") || line.startsWith("model ")) {
      continue;
    }

    const tokens = line.split(/\s+/);
    const fieldName = tokens[0];
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(fieldName)) continue;

    allFields.add(fieldName);

    const isUnique = tokens.some(
      (t) => t === "@id" || t.startsWith("@id(") || t === "@unique" || t.startsWith("@unique("),
    );
    if (isUnique) uniqueFields.add(fieldName);
  }

  const result: ModelFields = { allFields, uniqueFields };
  modelFieldsCache.set(modelName, result);
  return result;
}

/**
 * Throws unless at least one key of `where` is a legal single-field unique
 * selector for `modelName`. Also throws if any key of `where` names a field
 * the model does not declare at all. The message names the model, the
 * offending keys, and the legal selectors, so a failure reads as a contract
 * violation rather than a mystery.
 */
export function assertLegalFindUniqueSelector(modelName: string, where: Record<string, unknown>): void {
  const { allFields, uniqueFields } = getModelFields(modelName);
  const keys = Object.keys(where);

  const undeclared = keys.filter((k) => !allFields.has(k));
  if (undeclared.length > 0) {
    throw new Error(
      `prisma-contract: findUnique on "${modelName}" referenced undeclared field(s) ` +
        `[${undeclared.join(", ")}]. Declared fields: [${[...allFields].sort().join(", ")}].`,
    );
  }

  const hasLegalSelector = keys.some((k) => uniqueFields.has(k));
  if (!hasLegalSelector) {
    throw new Error(
      `prisma-contract: findUnique on "${modelName}" used key(s) [${keys.join(", ")}], ` +
        `none of which is a legal unique selector. Legal single-field selectors for ` +
        `"${modelName}": [${[...uniqueFields].sort().join(", ")}].`,
    );
  }
}

/**
 * Wraps a fake's own async findUnique implementation. Runs the assertion
 * first and only then delegates — a fake can never be more permissive than
 * the schema it stands in for. This is the single line each test fake adds.
 */
export function guardFindUnique<Args extends { where: Record<string, unknown> }, Row>(
  modelName: string,
  impl: (args: Args) => Promise<Row>,
): (args: Args) => Promise<Row> {
  return async (args: Args) => {
    assertLegalFindUniqueSelector(modelName, args.where);
    return impl(args);
  };
}
