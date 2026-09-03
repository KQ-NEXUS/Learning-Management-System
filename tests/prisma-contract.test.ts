import { describe, expect, it, vi } from "vitest";
import {
  assertLegalFindUniqueSelector,
  getModelFields,
  guardFindUnique,
} from "./support/prisma-contract";

describe("getModelFields — parsed from prisma/schema.prisma at run time", () => {
  it("reports the primary key and the unique email field of User as legal selectors", () => {
    const { uniqueFields } = getModelFields("User");
    expect(uniqueFields.has("id")).toBe(true);
    expect(uniqueFields.has("email")).toBe(true);
  });

  it("reports the pending-address field of User as NOT a legal unique selector", () => {
    const { allFields, uniqueFields } = getModelFields("User");
    expect(allFields.has("pendingEmail")).toBe(true);
    expect(uniqueFields.has("pendingEmail")).toBe(false);
  });

  it("throws for a model name absent from the schema", () => {
    expect(() => getModelFields("NotAModel")).toThrow(/not found/);
  });
});

describe("assertLegalFindUniqueSelector", () => {
  it("passes when the selector is the primary key", () => {
    expect(() => assertLegalFindUniqueSelector("User", { id: "u1" })).not.toThrow();
  });

  it("passes when the selector is the unique email field", () => {
    expect(() => assertLegalFindUniqueSelector("User", { email: "a@example.com" })).not.toThrow();
  });

  it("throws when the selector is the pending-address field, naming the model and the offending key", () => {
    expect(() =>
      assertLegalFindUniqueSelector("User", { pendingEmail: "a@example.com" }),
    ).toThrow(/User/);
    expect(() =>
      assertLegalFindUniqueSelector("User", { pendingEmail: "a@example.com" }),
    ).toThrow(/pendingEmail/);
  });

  it("throws when the selector names a field the model does not declare at all", () => {
    expect(() => assertLegalFindUniqueSelector("User", { notAField: "x" })).toThrow(/notAField/);
  });
});

describe("guardFindUnique", () => {
  it("passes a legal query straight through and returns the wrapped implementation's value unchanged", async () => {
    const impl = vi.fn(async (args: { where: { id: string } }) => ({ id: args.where.id }));
    const guarded = guardFindUnique("User", impl);

    const result = await guarded({ where: { id: "u1" } });

    expect(result).toEqual({ id: "u1" });
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it("throws before calling the wrapped implementation when the selector is illegal", async () => {
    const impl = vi.fn(async () => ({ id: "u1" }));
    const guarded = guardFindUnique("User", impl);

    await expect(guarded({ where: { pendingEmail: "x@example.com" } })).rejects.toThrow();
    expect(impl).not.toHaveBeenCalled();
  });
});
