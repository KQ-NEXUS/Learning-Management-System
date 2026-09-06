import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Mechanical WCAG 2.2 AA contrast gate for NFR-09.
 *
 * This test does NOT hard-code any hex value. It reads `src/app/globals.css` at test time,
 * parses the `--primitive-*` and `--pill-*` declarations into a name -> hex map, and drives
 * every assertion from that map — so a token edit in globals.css fails this test rather than
 * drifting silently out of sync with the design contract in
 * `.planning/phases/04.1-design-system-rollout-modern-ui-across-every-existing-surfac/04.1-UI-SPEC.md`
 * section 5.4.
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

/** Parses every `--primitive-*` / `--pill-*` hex declaration out of globals.css's `:root` block. */
function parseTokens(css: string): Map<string, string> {
  const map = new Map<string, string>();
  const pattern = /--((?:primitive|pill)-[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g;
  for (const match of css.matchAll(pattern)) {
    map.set(match[1], match[2]);
  }
  return map;
}

const css = readFileSync(GLOBALS_CSS_PATH, "utf-8");
const tokens = parseTokens(css);

/** Test 4: the parser must find every primitive/pill token it needs — a missing or renamed
 * declaration fails loudly here rather than silently skipping the pair that depends on it. */
const REQUIRED_TOKENS = [
  "primitive-white",
  "primitive-ink",
  "primitive-muted",
  "primitive-line",
  "primitive-paper",
  "primitive-brand",
  "primitive-teal-700",
  "primitive-teal-500",
  "primitive-amber-700",
  "primitive-amber-500",
  "primitive-red-700",
  "primitive-red-50",
  "primitive-green-700",
  "pill-green-bg",
  "pill-green-ink",
  "pill-blue-bg",
  "pill-blue-ink",
  "pill-amber-bg",
  "pill-amber-ink",
  "pill-grey-bg",
  "pill-grey-ink",
  "pill-red-bg",
  "pill-red-ink",
] as const;

describe("contrast token parser", () => {
  it.each(REQUIRED_TOKENS)("finds --%s in globals.css", (name) => {
    expect(tokens.get(name), `Missing or renamed token --${name} in globals.css`).toBeDefined();
  });
});

/** Small typed helper so a missing token throws immediately, naming the token, instead of
 * silently comparing against `undefined`. */
function hex(name: (typeof REQUIRED_TOKENS)[number]): string {
  const value = tokens.get(name);
  if (!value) {
    throw new Error(`Token --${name} not found in globals.css — cannot run contrast assertion`);
  }
  return value;
}

describe("body text contrast — UI-SPEC 5.4 PASS rows, >= 4.5:1", () => {
  const white = () => hex("primitive-white");
  const paper = () => hex("primitive-paper");

  const textPairs: [string, () => string, () => string][] = [
    ["ink on white", () => hex("primitive-ink"), white],
    ["ink on paper", () => hex("primitive-ink"), paper],
    ["muted-foreground on white", () => hex("primitive-muted"), white],
    ["muted-foreground on paper", () => hex("primitive-muted"), paper],
    ["accent (brand) on white", () => hex("primitive-brand"), white],
    ["accent-contrast (white) on accent", white, () => hex("primitive-brand")],
    ["teal-text on white", () => hex("primitive-teal-700"), white],
    ["warning (text-safe amber) on white", () => hex("primitive-amber-700"), white],
    ["success (green) on white", () => hex("primitive-green-700"), white],
    ["danger on white", () => hex("primitive-red-700"), white],
    ["danger on danger-surface", () => hex("primitive-red-700"), () => hex("primitive-red-50")],
  ];

  it.each(textPairs)("%s meets 4.5:1", (_label, fg, bg) => {
    const ratio = contrastRatio(fg(), bg());
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

describe("UI edge contrast — input-border (muted), >= 3:1 against white and parsed paper", () => {
  const uiEdgePairs: [string, () => string, () => string][] = [
    ["input-border (muted) on white", () => hex("primitive-muted"), () => hex("primitive-white")],
    ["input-border (muted) on paper", () => hex("primitive-muted"), () => hex("primitive-paper")],
  ];

  it.each(uiEdgePairs)("%s meets 3:1", (_label, fg, bg) => {
    const ratio = contrastRatio(fg(), bg());
    expect(ratio).toBeGreaterThanOrEqual(3);
  });
});

describe("StatusPill tone ink-on-tint — UI-SPEC 5.6, >= 4.5:1", () => {
  const pillPairs: [string, () => string, () => string][] = [
    ["green tone", () => hex("pill-green-ink"), () => hex("pill-green-bg")],
    ["blue tone", () => hex("pill-blue-ink"), () => hex("pill-blue-bg")],
    ["amber tone", () => hex("pill-amber-ink"), () => hex("pill-amber-bg")],
    ["grey tone", () => hex("pill-grey-ink"), () => hex("pill-grey-bg")],
    ["red tone", () => hex("pill-red-ink"), () => hex("pill-red-bg")],
  ];

  it.each(pillPairs)("%s ink-on-tint meets 4.5:1", (_label, fg, bg) => {
    const ratio = contrastRatio(fg(), bg());
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

describe("deliberately sub-threshold values — pinned by exact hex, not asserted as passing", () => {
  // WCAG 1.4.11 (D-15): --primitive-line is a decorative/structural border, exempt because
  // these elements are identified by content/layout, not solely their edge.
  it("--primitive-line stays #dfe5ee", () => {
    expect(hex("primitive-line")).toBe("#dfe5ee");
  });

  // WCAG 1.4.11 (D-12/D-15 mitigation, UI-SPEC 5.5): --primitive-amber-500 is the fill token,
  // never used as freestanding text or an unlabelled swatch — its standalone sub-3:1 ratio is
  // an accepted, documented exemption, not a bug to "fix" by picking a darker amber.
  it("--primitive-amber-500 stays #f79009", () => {
    expect(hex("primitive-amber-500")).toBe("#f79009");
  });
});
