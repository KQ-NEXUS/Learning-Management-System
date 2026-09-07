import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Design contract — mechanical source gate for the phase 04.1 role rules.
 *
 * Reads each owned source file with the installed TypeScript parser, extracts
 * the class strings that actually reach the DOM (JSX `className` literals plus
 * UPPER_CASE module-level class constants and the string branches of the
 * ternaries / template literals inside them), tokenises them, strips Tailwind
 * variant prefixes (`sm:`, `hover:`, `aria-[invalid=true]:`, …) and asserts
 * every *type* utility (font-size / font-weight) and every *spacing* utility
 * (margin / padding / gap / space) resolves to a role permitted by
 * `.planning/phases/04.1-design-system-rollout-modern-ui-across-every-existing-surfac/04.1-UI-SPEC.md`
 * §3.1 (spacing grid) and §4.3 (type scale).
 *
 * Out of scope on purpose — not graded by a fixed role scale:
 *   - colour / alignment text utilities (`text-foreground`, `text-left`)
 *   - sizing (`size-*`, `h-*`, `w-*`, `min-*`, `max-*`) — structural dimensions
 *     (38px controls, 228px sidebar, 34px tiles, fractional widths) are locked
 *     by the spec and are NOT spacing roles
 *   - positioning (`inset-*`, `left-*`, `top-*`) and negative nudges (`-mb-px`)
 *   - `sr-only` / accessibility clipping
 *   - radius / shadow / tracking / leading
 *   - authored lesson HTML and code comments
 *
 * Two locked exceptions from CONTEXT override the grid. They are allow-listed
 * by exact file + exact token only — never globally:
 *   D-21 — auth form-stack gap fixed at 20px            (`gap-5`)
 *   D-23 — learner shell header padding 14px / 28px     (`py-3.5` / `py-[14px]` / `px-7`)
 *
 * Incremental execution: each manifest group is its own `describe`, so a repair
 * task gates only its group with `-t <group>` until plan 29 runs the whole file.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

// ---------------------------------------------------------------------------
// Type scale — 04.1-UI-SPEC §4.3
// ---------------------------------------------------------------------------

/** Primitive / app-UI scale — exactly 4 sizes. */
const PRIMITIVE_FONT_PX = new Set([25, 16, 14, 11]);
/** Marketing / display scale — exactly 4 sizes, drawn once each on front-of-house screens. */
const DISPLAY_FONT_PX = new Set([42, 33, 28, 22]);

/** Named Tailwind font-size utilities -> px (default theme). */
const FONT_SIZE_KEYWORDS: Record<string, number> = {
  "text-xs": 12,
  "text-sm": 14,
  "text-base": 16,
  "text-lg": 18,
  "text-xl": 20,
  "text-2xl": 24,
  "text-3xl": 30,
  "text-4xl": 36,
  "text-5xl": 48,
  "text-6xl": 60,
  "text-7xl": 72,
};

/** Named Tailwind font-weight utilities -> numeric weight. `font-mono`/`font-sans` are faces, not weights. */
const FONT_WEIGHTS: Record<string, number> = {
  "font-thin": 100,
  "font-extralight": 200,
  "font-light": 300,
  "font-normal": 400,
  "font-medium": 500,
  "font-semibold": 600,
  "font-bold": 700,
  "font-extrabold": 800,
  "font-black": 900,
};

/** Exactly two weights are active this phase (UI-SPEC §4.3): 400 and 600. */
const ACTIVE_WEIGHTS = new Set([400, 600]);

// ---------------------------------------------------------------------------
// Spacing grid — 04.1-UI-SPEC §3.1: 4, 8, 16, 24, 32, 48, 64px (plus 0)
// ---------------------------------------------------------------------------

const ALLOWED_SPACING_PX = new Set([0, 4, 8, 16, 24, 32, 48, 64]);

const SPACING_PREFIXES = [
  "space-x",
  "space-y",
  "gap-x",
  "gap-y",
  "gap",
  "mx",
  "my",
  "mt",
  "mb",
  "ml",
  "mr",
  "ms",
  "me",
  "px",
  "py",
  "pt",
  "pb",
  "pl",
  "pr",
  "ps",
  "pe",
  "m",
  "p",
].sort((a, b) => b.length - a.length);

// ---------------------------------------------------------------------------
// Locked exceptions — exact file + exact token, never global
// ---------------------------------------------------------------------------

const LOCKED_EXCEPTIONS: { file: string; tokens: Set<string>; rationale: string }[] = [
  {
    file: "src/app/(auth)/layout.tsx",
    tokens: new Set(["gap-5"]),
    rationale: "D-21 — auth form-stack gap is fixed at 20px",
  },
  {
    file: "src/app/(auth)/AuthPanel.tsx",
    tokens: new Set(["gap-5"]),
    rationale: "D-21 — auth form-stack gap is fixed at 20px",
  },
  {
    file: "src/components/shell/LearnerShell.tsx",
    tokens: new Set(["px-7", "py-3.5", "py-[14px]", "px-[28px]"]),
    rationale: "D-23 — learner shell header padding is 14px vertical / 28px horizontal",
  },
];

function isLockedException(relPath: string, token: string): boolean {
  return LOCKED_EXCEPTIONS.some((e) => e.file === relPath && e.tokens.has(token));
}

// ---------------------------------------------------------------------------
// Manifest — phase visual source groups (this plan + plans 25–28, 30, 31 + shells)
// ---------------------------------------------------------------------------

const GROUPS: Record<string, string[]> = {
  "primitives-table": ["src/components/primitives/ResourceTable.tsx"],
  "primitives-forms": [
    "src/components/primitives/ResourceForm.tsx",
    "src/components/primitives/DetailLayout.tsx",
    "src/components/primitives/ConfirmModal.tsx",
  ],
  "catalogue-controls-entry": [
    "src/components/catalogue/LessonFormFields.tsx",
    "src/components/catalogue/PublishDialog.tsx",
    "src/components/catalogue/CourseDetailActions.tsx",
  ],
  "catalogue-controls-expansion": [
    "src/components/catalogue/RichTextEditor.tsx",
    "src/components/catalogue/UploadPanel.tsx",
  ],
  "catalogue-reading-entry": [
    "src/components/catalogue/ArrangeBoard.tsx",
    "src/components/catalogue/ReadinessPanel.tsx",
    "src/components/catalogue/UnsavedOrderGuard.tsx",
  ],
  "catalogue-reading-expansion": [
    "src/components/catalogue/LessonContent.tsx",
    "src/components/catalogue/LessonMediaPlayer.tsx",
  ],
  "auth-shell": [
    "src/app/(auth)/layout.tsx",
    "src/app/(auth)/AuthPanel.tsx",
    "src/app/(auth)/signin/page.tsx",
    "src/app/(auth)/signin/SignInForm.tsx",
    "src/app/(auth)/register/page.tsx",
    "src/app/(auth)/register/RegisterForm.tsx",
    "src/app/(auth)/forgot-password/page.tsx",
    "src/app/(auth)/forgot-password/ForgotPasswordForm.tsx",
    "src/app/(auth)/reset-password/page.tsx",
    "src/app/(auth)/reset-password/ResetPasswordForm.tsx",
    "src/app/(auth)/verify/page.tsx",
    "src/app/(auth)/verify/ResendVerificationForm.tsx",
    "src/app/(auth)/confirm-email-change/page.tsx",
  ],
  "public-account-shell": [
    "src/app/(public)/layout.tsx",
    "src/app/(public)/courses/page.tsx",
    "src/app/(public)/courses/[slug]/page.tsx",
    "src/app/(public)/programmes/page.tsx",
    "src/app/(public)/programmes/[slug]/page.tsx",
    "src/app/(public)/not-found.tsx",
    "src/app/not-found.tsx",
    "src/app/account/layout.tsx",
    "src/app/account/page.tsx",
    "src/app/account/ProfileForm.tsx",
    "src/components/shell/LearnerShell.tsx",
    "src/components/shell/BrandMark.tsx",
  ],
};

/** Every manifest group key — asserted deep-equal to `Object.keys(GROUPS)` by the
 * anti-vacuity fixtures so a renamed or dropped group fails loudly instead of
 * silently making a `-t <group>` run assert nothing (the G-RV-02 root cause).
 * `staff-shell-access` and `staff-courses-programmes` land with this plan's
 * Task 2 and are appended to both this literal and `GROUPS` there together. */
const EXPECTED_GROUPS = [
  "primitives-table",
  "primitives-forms",
  "catalogue-controls-entry",
  "catalogue-controls-expansion",
  "catalogue-reading-entry",
  "catalogue-reading-expansion",
  "auth-shell",
  "public-account-shell",
];

/** Primitives are strictly the 4-size app scale; catalogue/shell/marketing surfaces
 * may also draw the display scale (the two contexts never share a screen, UI-SPEC §4.3). */
function allowedFontPx(relPath: string): Set<number> {
  if (relPath.startsWith("src/components/primitives/")) return PRIMITIVE_FONT_PX;
  return new Set([...PRIMITIVE_FONT_PX, ...DISPLAY_FONT_PX]);
}

// ---------------------------------------------------------------------------
// Class-string extraction
// ---------------------------------------------------------------------------

/** Does this string look like authored HTML rather than a Tailwind class list? */
function looksLikeHtml(s: string): boolean {
  return /<\/?[a-z][a-z0-9]*[\s/>]/i.test(s);
}

function extractClassStrings(source: string, fileName: string): string[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  const out: string[] = [];

  const addFromExpression = (expr: ts.Node): void => {
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      out.push(expr.text);
    } else if (ts.isTemplateExpression(expr)) {
      out.push(expr.head.text);
      for (const span of expr.templateSpans) {
        addFromExpression(span.expression);
        out.push(span.literal.text);
      }
    } else if (ts.isConditionalExpression(expr)) {
      addFromExpression(expr.whenTrue);
      addFromExpression(expr.whenFalse);
    } else if (ts.isBinaryExpression(expr)) {
      addFromExpression(expr.left);
      addFromExpression(expr.right);
    } else if (ts.isParenthesizedExpression(expr)) {
      addFromExpression(expr.expression);
    } else if (ts.isCallExpression(expr)) {
      for (const arg of expr.arguments) addFromExpression(arg);
    } else if (ts.isObjectLiteralExpression(expr)) {
      for (const prop of expr.properties) {
        if (ts.isPropertyAssignment(prop)) addFromExpression(prop.initializer);
      }
    }
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(sf) === "className" &&
      node.initializer
    ) {
      if (ts.isStringLiteral(node.initializer)) {
        out.push(node.initializer.text);
      } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        addFromExpression(node.initializer.expression);
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /^[A-Z][A-Z0-9_]*$/.test(node.name.text) &&
      node.initializer
    ) {
      addFromExpression(node.initializer);
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  return out.filter((s) => s.trim() !== "" && !looksLikeHtml(s));
}

// ---------------------------------------------------------------------------
// Tokenising + grading
// ---------------------------------------------------------------------------

/** Strip Tailwind variant prefixes, respecting `[...]` arbitrary segments. */
function stripVariants(token: string): string {
  let depth = 0;
  let lastColon = -1;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === "[") depth++;
    else if (c === "]") depth--;
    else if (c === ":" && depth === 0) lastColon = i;
  }
  return lastColon >= 0 ? token.slice(lastColon + 1) : token;
}

function fontSizePx(base: string): number | null {
  if (base in FONT_SIZE_KEYWORDS) return FONT_SIZE_KEYWORDS[base];
  const m = base.match(/^text-\[(\d+(?:\.\d+)?)(px|rem)\]$/);
  if (m) return m[2] === "rem" ? parseFloat(m[1]) * 16 : parseFloat(m[1]);
  return null;
}

function fontWeight(base: string): number | null {
  return base in FONT_WEIGHTS ? FONT_WEIGHTS[base] : null;
}

function parseSpacing(
  base: string,
): { prefix: string; value: string; negative: boolean } | null {
  let t = base;
  let negative = false;
  if (t.startsWith("-")) {
    negative = true;
    t = t.slice(1);
  }
  for (const prefix of SPACING_PREFIXES) {
    if (t.startsWith(prefix + "-")) {
      return { prefix, value: t.slice(prefix.length + 1), negative };
    }
  }
  return null;
}

/** Resolve a spacing utility value to px, or null when it is not grid-graded
 * (`auto`, fractions, `full`, `reverse`, CSS vars, …). */
function spacingValuePx(value: string): number | null {
  const arb = value.match(/^\[(\d+(?:\.\d+)?)(px|rem)\]$/);
  if (arb) return arb[2] === "rem" ? parseFloat(arb[1]) * 16 : parseFloat(arb[1]);
  if (value === "px") return 1;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n * 4;
}

type Violation = {
  file: string;
  token: string;
  kind: "font-size" | "font-weight" | "spacing";
  detail: string;
};

function checkClassString(classStr: string, relPath: string, violations: Violation[]): void {
  for (const raw of classStr.split(/\s+/)) {
    if (!raw) continue;
    const base = stripVariants(raw);
    if (!base || base.startsWith("[")) continue;
    if (base === "sr-only" || base === "not-sr-only") continue;

    const sizePx = fontSizePx(base);
    if (sizePx !== null) {
      const allowed = allowedFontPx(relPath);
      if (!allowed.has(sizePx)) {
        violations.push({
          file: relPath,
          token: raw,
          kind: "font-size",
          detail: `${sizePx}px is not in the permitted scale {${[...allowed].sort((a, b) => a - b).join(", ")}}`,
        });
      }
      continue;
    }

    const weight = fontWeight(base);
    if (weight !== null) {
      if (!ACTIVE_WEIGHTS.has(weight)) {
        violations.push({
          file: relPath,
          token: raw,
          kind: "font-weight",
          detail: `weight ${weight} — only 400 / 600 are active this phase (UI-SPEC §4.3)`,
        });
      }
      continue;
    }

    const spacing = parseSpacing(base);
    if (spacing) {
      if (spacing.negative) continue; // alignment nudge — excluded by plan
      const px = spacingValuePx(spacing.value);
      if (px === null) continue; // auto / fraction / keyword — not grid-graded
      if (ALLOWED_SPACING_PX.has(px)) continue;
      if (isLockedException(relPath, raw)) continue;
      violations.push({
        file: relPath,
        token: raw,
        kind: "spacing",
        detail: `${px}px is off the 4 / 8 / 16 / 24 / 32 / 48 / 64 grid (UI-SPEC §3.1)`,
      });
    }
  }
}

function formatViolations(violations: Violation[]): string {
  if (violations.length === 0) return "no violations";
  return [
    `${violations.length} design-contract violation(s):`,
    ...violations.map((v) => `  [${v.kind}] ${v.file} :: "${v.token}" — ${v.detail}`),
  ].join("\n");
}

function gradeFile(relPath: string): Violation[] {
  const abs = path.join(REPO_ROOT, relPath);
  const violations: Violation[] = [];
  if (!existsSync(abs)) {
    violations.push({ file: relPath, token: "(file)", kind: "spacing", detail: "manifest file is missing" });
    return violations;
  }
  const src = readFileSync(abs, "utf-8");
  for (const s of extractClassStrings(src, abs)) checkClassString(s, relPath, violations);
  return violations;
}

// ---------------------------------------------------------------------------
// Manifest-group suites — gate one with `-t <group>` during incremental repair
// ---------------------------------------------------------------------------

for (const [group, files] of Object.entries(GROUPS)) {
  describe(group, () => {
    for (const relPath of files) {
      it(`${relPath} uses only permitted type and spacing roles`, () => {
        const violations = gradeFile(relPath);
        expect(formatViolations(violations)).toBe("no violations");
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Non-vacuous enforcement fixtures — always run (full suite / `-t fixtures`)
// ---------------------------------------------------------------------------

describe("contract checker fixtures — enforcement is non-vacuous", () => {
  const PRIMITIVE = "src/components/primitives/ResourceTable.tsx";

  it("flags a font-size outside the primitive scale", () => {
    const v: Violation[] = [];
    checkClassString("text-[13px]", PRIMITIVE, v);
    expect(v.map((x) => x.kind)).toEqual(["font-size"]);
  });

  it("flags text-xs (12px) in a primitive", () => {
    const v: Violation[] = [];
    checkClassString("text-xs", PRIMITIVE, v);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("font-size");
  });

  it("flags font-medium — weight 500 is retired this phase", () => {
    const v: Violation[] = [];
    checkClassString("font-medium", "src/components/primitives/ResourceForm.tsx", v);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("font-weight");
  });

  it("flags off-grid spacing utilities", () => {
    const v: Violation[] = [];
    checkClassString("px-2.5 gap-1.5 py-3 p-5 gap-0.5", "src/components/primitives/ConfirmModal.tsx", v);
    expect(v.filter((x) => x.kind === "spacing").map((x) => x.token).sort()).toEqual([
      "gap-0.5",
      "gap-1.5",
      "p-5",
      "px-2.5",
      "py-3",
    ]);
  });

  it("passes the D-21 locked exception at its exact file + token", () => {
    const v: Violation[] = [];
    checkClassString("gap-5", "src/app/(auth)/layout.tsx", v);
    expect(v).toEqual([]);
  });

  it("still flags gap-5 outside the locked file — the exception does not leak", () => {
    const v: Violation[] = [];
    checkClassString("gap-5", PRIMITIVE, v);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("spacing");
  });

  it("passes the D-23 learner-shell header padding exception", () => {
    const v: Violation[] = [];
    checkClassString("px-7 py-3.5", "src/components/shell/LearnerShell.tsx", v);
    expect(v).toEqual([]);
  });

  it("does not global-allow px-7 / py-3.5 elsewhere", () => {
    const v: Violation[] = [];
    checkClassString("px-7 py-3.5", PRIMITIVE, v);
    expect(v.map((x) => x.token).sort()).toEqual(["px-7", "py-3.5"]);
  });

  it("ignores negative nudges, auto, sizing, positioning and sr-only", () => {
    const v: Violation[] = [];
    checkClassString(
      "-mb-px ml-auto size-3.5 h-[38px] w-full min-w-[12rem] left-2 top-0 inset-0 sr-only",
      PRIMITIVE,
      v,
    );
    expect(v).toEqual([]);
  });

  it("does not treat colour / alignment text utilities as font-size", () => {
    const v: Violation[] = [];
    checkClassString("text-left text-right text-center text-muted-foreground text-danger text-accent", PRIMITIVE, v);
    expect(v).toEqual([]);
  });

  it("strips variant prefixes before grading", () => {
    const v: Violation[] = [];
    checkClassString("sm:px-4 hover:gap-2 aria-[invalid=true]:px-4 disabled:py-2 placeholder:text-sm", PRIMITIVE, v);
    expect(v).toEqual([]);
  });

  it("accepts the permitted primitive sizes, weights and grid steps", () => {
    const v: Violation[] = [];
    checkClassString(
      "text-[25px] text-base text-sm text-[11px] font-normal font-semibold gap-1 gap-2 gap-4 gap-6 p-8 p-12",
      PRIMITIVE,
      v,
    );
    expect(v).toEqual([]);
  });

  it("extracts className literals, ternaries, template spans and UPPER_CASE constants", () => {
    const sample = [
      'const CELL = "px-4 py-2";',
      "export function X({ mono }: { mono: boolean }) {",
      '  return <div className={`${CELL} ${mono ? "text-sm" : "text-[11px]"}`}><span className="gap-4" /></div>;',
      "}",
    ].join("\n");
    const strings = extractClassStrings(sample, "sample.tsx");
    expect(strings).toEqual(expect.arrayContaining(["px-4 py-2", "text-sm", "text-[11px]", "gap-4"]));
  });

  it("excludes authored HTML strings from grading", () => {
    const sample = [
      'const SAFE = "text-sm gap-4";',
      'const MARKUP = "<p class=\\"text-7xl\\">hi</p>";',
      "export const X = MARKUP;",
    ].join("\n");
    const strings = extractClassStrings(sample, "sample.tsx");
    expect(strings).toContain("text-sm gap-4");
    expect(strings.some((s) => s.includes("text-7xl"))).toBe(false);
    expect(strings.some((s) => looksLikeHtml(s))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Anti-vacuity / anti-stale guards — a dropped group or a dead path fails loud
  // -------------------------------------------------------------------------

  it("GROUPS keys deep-equal EXPECTED_GROUPS — a renamed or dropped group fails loudly", () => {
    expect([...Object.keys(GROUPS)].sort()).toEqual([...EXPECTED_GROUPS].sort());
  });

  it("every manifest group has at least one file", () => {
    for (const [group, files] of Object.entries(GROUPS)) {
      expect(files.length, `group "${group}" is empty`).toBeGreaterThan(0);
    }
  });

  it("every manifest file exists on disk", () => {
    const missing = Object.values(GROUPS)
      .flat()
      .filter((rel) => !existsSync(path.join(REPO_ROOT, rel)));
    expect(missing).toEqual([]);
  });

  it("no relative path appears in two manifest groups", () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const [group, files] of Object.entries(GROUPS)) {
      for (const rel of files) {
        const prior = seen.get(rel);
        if (prior) dupes.push(`${rel} (in "${prior}" and "${group}")`);
        else seen.set(rel, group);
      }
    }
    expect(dupes).toEqual([]);
  });

  it("every LOCKED_EXCEPTIONS file exists on disk — a dead exception path cannot be reintroduced", () => {
    const missing = LOCKED_EXCEPTIONS.map((e) => e.file).filter(
      (rel) => !existsSync(path.join(REPO_ROOT, rel)),
    );
    expect(missing).toEqual([]);
  });
});
