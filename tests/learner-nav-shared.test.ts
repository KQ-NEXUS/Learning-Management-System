import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEARNER_NAV } from "@/components/shell/learner-nav";

const LAYOUTS = [
  "src/app/(learner)/layout.tsx",
  "src/app/account/layout.tsx",
  "src/app/(checkout)/layout.tsx",
];

describe("learner header navigation", () => {
  it("lists the same five links everywhere", () => {
    expect(LEARNER_NAV.map((item) => item.label)).toEqual([
      "Dashboard",
      "My learning",
      "Support",
      "Catalogue",
      "Account",
    ]);
  });

  it.each(LAYOUTS)("%s uses the shared list and defines none of its own", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("nav={LEARNER_NAV}");
    expect(source).not.toMatch(/const NAV\b/);
  });
});
