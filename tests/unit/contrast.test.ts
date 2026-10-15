import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Mechanical WCAG 2.2 AA contrast gate for NFR-09, for the IETC tokens.
 *
 * No hex value is hard-coded here. The test reads `src/app/globals.css`, parses every custom
 * property in its `:root` block, resolves `var(--x)` chains down to a hex value, and drives
 * every assertion from that map — so a token edit that breaks a pair fails here instead of
 * drifting out of AA unnoticed.
 */

const GLOBALS_CSS_PATH = path.resolve(import.meta.dirname, "../../src/app/globals.css");

/** WCAG 2.x relative luminance + contrast ratio. */
function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [rl, gl, bl] = [r, g, b].map(linear);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contrastRatio(hexA: string, hexB: string): number {
  const [l1, l2] = [relativeLuminance(hexA), relativeLuminance(hexB)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Every `--name: value;` in the first `:root { … }` block. */
function parseRoot(css: string): Map<string, string> {
  const root = css.slice(css.indexOf(":root {"), css.indexOf("\n}\n", css.indexOf(":root {")));
  const map = new Map<string, string>();
  for (const match of root.matchAll(/--([\w-]+):\s*([^;]+);/g)) map.set(match[1], match[2].trim());
  return map;
}

const css = readFileSync(GLOBALS_CSS_PATH, "utf-8");
const tokens = parseRoot(css);

/** A token's hex value, following var() references; fails loudly when a token is missing. */
function hex(name: string, seen: string[] = []): string {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`--${name} is not declared in globals.css :root`);
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
  const ref = value.match(/^var\(--([\w-]+)\)$/);
  if (ref && !seen.includes(ref[1])) return hex(ref[1], [...seen, name]);
  throw new Error(`--${name} is not a plain hex or var() chain: ${value}`);
}

function expectRatio(fg: string, bg: string, min: number) {
  const ratio = contrastRatio(hex(fg), hex(bg));
  expect(ratio, `--${fg} on --${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`).toBeGreaterThanOrEqual(min);
}

describe("contrast token parser", () => {
  it.each(["ietc-ink", "ietc-paper", "ietc-ground", "ietc-orange", "ietc-orange-text", "pill-green-ink", "sidebar-fg", "danger"])(
    "resolves --%s to a hex value",
    (name) => {
      expect(hex(name)).toMatch(/^#[0-9a-f]{6}$/);
    },
  );
});

describe("body text, >= 4.5:1", () => {
  it.each([
    ["ietc-ink", "ietc-paper"],
    ["ietc-ink", "ietc-ground"],
    ["ietc-ink-soft", "ietc-paper"],
    ["ietc-ink-soft", "ietc-ground"],
    ["ietc-orange-text", "ietc-paper"],
    ["ietc-orange-text", "ietc-ground"],
    ["ietc-placeholder", "ietc-paper"],
    ["ietc-peach-text", "ietc-peach"],
    ["accent-contrast", "accent"],
    ["warning", "ietc-paper"],
    ["success", "ietc-paper"],
    ["danger", "ietc-paper"],
    ["danger", "danger-surface"],
    ["pill-amber-ink", "warning-surface"],
  ])("--%s on --%s", (fg, bg) => expectRatio(fg, bg, 4.5));
});

describe("text on the black frame, >= 4.5:1", () => {
  it.each(["ietc-paper", "sidebar-fg", "sidebar-muted", "sidebar-soft", "ietc-on-ink-soft", "ietc-orange", "on-navy-blue"])(
    "--%s on --ietc-ink",
    (fg) => expectRatio(fg, "ietc-ink", 4.5),
  );
});

describe("class tints carry dark text, >= 4.5:1", () => {
  const tints = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `ietc-tint-${n}`);
  it.each(tints)("--ietc-ink on --%s", (tint) => expectRatio("ietc-ink", tint, 4.5));
  it.each(tints)("--ietc-tint-text on --%s", (tint) => expectRatio("ietc-tint-text", tint, 4.5));
  it("ink on the solid orange of the current module", () => expectRatio("ietc-ink", "ietc-orange", 4.5));
});

describe("StatusPill tone ink-on-tint, >= 4.5:1", () => {
  it.each(["green", "blue", "amber", "grey", "red"])("%s tone", (tone) => expectRatio(`pill-${tone}-ink`, `pill-${tone}-bg`, 4.5));
});

describe("UI edges and the focus ring, >= 3:1 (WCAG 1.4.11)", () => {
  it.each(["ietc-paper", "ietc-ground"])("input-border (field) on --%s", (bg) => expectRatio("ietc-field", bg, 3));
  it.each(["ietc-paper", "ietc-ground", "ietc-peach", "ietc-ink"])("the orange-text focus ring on --%s", (bg) =>
    expectRatio("ietc-orange-text", bg, 3),
  );

  it("draws focus with the text-safe orange, not the bright one", () => {
    expect(css).toMatch(/:focus-visible\s*\{\s*outline:\s*3px solid var\(--ietc-orange-text\)/);
  });
});

describe("the bright orange stays off light backgrounds", () => {
  it("is below 3:1 on paper and ground, which is why text on them uses --ietc-orange-text", () => {
    expect(contrastRatio(hex("ietc-orange"), hex("ietc-paper"))).toBeLessThan(3);
    expect(contrastRatio(hex("ietc-orange"), hex("ietc-ground"))).toBeLessThan(3);
  });
});
