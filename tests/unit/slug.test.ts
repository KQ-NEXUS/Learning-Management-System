import { describe, expect, it } from "vitest";
import { slugFromTitle } from "@/lib/slug";

describe("slugFromTitle", () => {
  it("lowercases and joins words with single hyphens", () => {
    expect(slugFromTitle("Workplace Safety: Level 1!")).toBe("workplace-safety-level-1");
    expect(slugFromTitle("  Fire   Marshal  ")).toBe("fire-marshal");
  });

  it("drops accents and symbols", () => {
    expect(slugFromTitle("Café & Crème – Hygiene")).toBe("cafe-creme-hygiene");
  });

  it("gives an empty slug when nothing usable is left", () => {
    expect(slugFromTitle("???")).toBe("");
    expect(slugFromTitle("")).toBe("");
  });

  it("stays within 120 characters and never ends on a hyphen", () => {
    const slug = slugFromTitle(`${"a".repeat(119)} b`);
    expect(slug.length).toBeLessThanOrEqual(120);
    expect(slug.endsWith("-")).toBe(false);
  });
});
