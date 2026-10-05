/**
 * Exhaustive ConfirmModal classification gate for the licence UI mirror (Phase 14,
 * plan 14-19; D-06, D-07, D-09, T-14-19-02).
 *
 * `ConfirmModal` disables its confirm in restricted continuity mode unless the
 * consumer passes `licenceEffect="continuity"`. A modal whose action is continuity
 * or purely local (an unsaved-changes guard, the licence activation confirm) that
 * stays on the default would trap users in the restricted state; a write modal that
 * wrongly says "continuity" would stay enabled and mislead. So every staff and
 * catalogue file with a ConfirmModal JSX element must be classified here, and an
 * unclassified file fails with its path: a new modal can neither silently trap users
 * nor silently stay enabled.
 *
 * The UI is a courtesy mirror only (D-09); the server guard from plan 14-11 is the
 * control. This gate keeps the mirror honest, it does not enforce anything.
 *
 * The scan uses the TypeScript compiler API to find JSX elements and attributes (as
 * `tests/import-graph.ts` does for imports), so comments, strings and similarly named
 * identifiers cannot fool it.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCAN_ROOTS = ["src/app/staff", "src/components/catalogue"];

/**
 * Continuity or purely local actions: every ConfirmModal element in these files must
 * carry the literal `licenceEffect="continuity"`, so it is never disabled.
 */
export const CONTINUITY_MODAL_FILES: readonly string[] = [
  // Certificate issue, revoke and reissue (certificates.issue, certificates.revoke).
  "src/app/staff/certificates/CertificateQueueTable.tsx",
  "src/app/staff/certificates/issued/[id]/CertificateRecordActions.tsx",
  // Grading, attendance and progress override (grades.manage, attendance.manage, A9).
  "src/app/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/GradeEntryClient.tsx",
  "src/app/staff/cohorts/[id]/grading/[assessmentId]/GradingQueueTable.tsx",
  "src/app/staff/cohorts/[id]/learners/[enrolmentId]/ProgressOverridePanel.tsx",
  "src/app/staff/cohorts/[id]/sessions/[sessionId]/attendance/AttendanceMarkClient.tsx",
  // Email-log resend (call-site continuity override, plan 14-17).
  "src/app/staff/email-log/EmailLogTable.tsx",
  // Licence activation is the recovery route (licence.activate, T-14-06-03): never disabled.
  "src/app/staff/licence/ActivateLicenceForm.tsx",
  // Unsaved-changes guards only discard local edits: never disabled.
  "src/components/catalogue/UnsavedOrderGuard.tsx",
  "src/app/staff/certificates/templates/TemplateEditorShell.tsx",
];

/**
 * The single reviewed dynamic case: the account-status modal passes a conditional
 * `licenceEffect` (deactivate is continuity, A10; reactivate is write) and the
 * revoke-assignment modal has no attribute (write).
 */
export const DYNAMIC_MODAL_FILES: readonly string[] = ["src/app/staff/users/AssignmentsPanel.tsx"];

/** Write actions: every ConfirmModal element must have NO licenceEffect attribute (default write). */
export const WRITE_MODAL_FILES: readonly string[] = [
  "src/app/staff/certificates/templates/TemplatesTable.tsx",
  "src/app/staff/cohorts/[id]/EnrolmentActionModals.tsx",
  "src/app/staff/cohorts/[id]/SessionsTab.tsx",
  "src/app/staff/courses/[id]/lessons/[lessonId]/LessonEditorClient.tsx",
  "src/app/staff/learner-numbers/LearnerNumberForm.tsx",
  "src/app/staff/programmes/[id]/ProgrammeDetailClient.tsx",
  "src/app/staff/roles/RoleDetailPanels.tsx",
  "src/components/catalogue/AssessmentFormFields.tsx",
  "src/components/catalogue/CohortDetailActions.tsx",
  "src/components/catalogue/CourseDetailActions.tsx",
  "src/components/catalogue/UploadPanel.tsx",
];

/**
 * Continuity dialogs that are NOT built on ConfirmModal or ResourceForm (bespoke dialogs on the
 * PublishDialog precedent), so the mirror can never disable them. Their server actions are
 * continuity (payments.confirm, refunds.manage). Asserted below so a later move onto ConfirmModal
 * or ResourceForm forces a classification instead of silently entering the mirror.
 */
export const BESPOKE_CONTINUITY_DIALOG_FILES: readonly string[] = [
  "src/app/staff/payments/ManualPaymentDialog.tsx",
  "src/app/staff/payments/RefundDialog.tsx",
];

type EffectAttribute =
  | { kind: "absent" }
  | { kind: "literal"; value: string }
  | { kind: "expression"; text: string; conditional: boolean };

interface ElementScan {
  line: number;
  effect: EffectAttribute;
}

function tagName(node: ts.JsxOpeningLikeElement, sourceFile: ts.SourceFile): string {
  return node.tagName.getText(sourceFile);
}

function readEffect(node: ts.JsxOpeningLikeElement, sourceFile: ts.SourceFile): EffectAttribute {
  for (const attribute of node.attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || attribute.name.getText(sourceFile) !== "licenceEffect") continue;
    const initializer = attribute.initializer;
    if (initializer === undefined) return { kind: "expression", text: "true", conditional: false };
    if (ts.isStringLiteral(initializer)) return { kind: "literal", value: initializer.text };
    if (ts.isJsxExpression(initializer) && initializer.expression) {
      const expression = initializer.expression;
      if (ts.isStringLiteralLike(expression)) return { kind: "literal", value: expression.text };
      return {
        kind: "expression",
        text: expression.getText(sourceFile),
        conditional: ts.isConditionalExpression(expression),
      };
    }
    return { kind: "expression", text: initializer.getText(sourceFile), conditional: false };
  }
  return { kind: "absent" };
}

/** Every JSX element with the given tag name in a source text, with its licenceEffect attribute. */
export function scanJsxElements(source: string, tag: string, fileName = "fixture.tsx"): ElementScan[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: ElementScan[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && tagName(node, sourceFile) === tag) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      found.push({ line: line + 1, effect: readEffect(node, sourceFile) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * Classification check over `{ path: source }`. Returns one message per violation, so a
 * failing test names the offending file.
 */
export function checkModalClassification(sources: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  const continuity = new Set(CONTINUITY_MODAL_FILES);
  const dynamic = new Set(DYNAMIC_MODAL_FILES);
  const write = new Set(WRITE_MODAL_FILES);

  for (const [file, source] of Object.entries(sources)) {
    const modals = scanJsxElements(source, "ConfirmModal", file);
    if (modals.length === 0) continue;

    if (continuity.has(file)) {
      for (const modal of modals) {
        if (modal.effect.kind !== "literal" || modal.effect.value !== "continuity") {
          problems.push(`${file}:${modal.line} is a continuity modal file but lacks licenceEffect="continuity"`);
        }
      }
    } else if (dynamic.has(file)) {
      const conditional = modals.filter((m) => m.effect.kind === "expression" && m.effect.conditional);
      const bare = modals.filter((m) => m.effect.kind === "absent");
      if (conditional.length !== 1 || bare.length !== modals.length - 1) {
        problems.push(
          `${file} is the single reviewed dynamic case: expected exactly one conditional licenceEffect and the rest with none, found ${conditional.length} conditional of ${modals.length}`,
        );
      }
    } else if (write.has(file)) {
      for (const modal of modals) {
        if (modal.effect.kind !== "absent") {
          problems.push(`${file}:${modal.line} is a write modal file but passes licenceEffect`);
        }
      }
    } else {
      problems.push(
        `${file} contains a ConfirmModal element but is not classified: add it to CONTINUITY_MODAL_FILES or WRITE_MODAL_FILES in tests/licence-ui-mirror-gate.test.ts`,
      );
    }
  }
  return problems;
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return path.extname(full) === ".tsx" ? [full] : [];
  });
}

function repoPath(absolute: string): string {
  return path.relative(ROOT, absolute).replace(/\\/g, "/");
}

function loadScanSources(): Record<string, string> {
  const sources: Record<string, string> = {};
  for (const root of SCAN_ROOTS) {
    for (const file of tsxFiles(path.resolve(ROOT, root))) {
      sources[repoPath(file)] = readFileSync(file, "utf8");
    }
  }
  return sources;
}

// The whole-tree TypeScript parse is CPU heavy: under a loaded machine or a parallel run it can pass the
// default 5 s ceiling (observed once at 5.7 s), so the scanning tests get an explicit generous timeout.
describe("licence UI mirror: ConfirmModal classification gate (14-19, D-09, T-14-19-02)", { timeout: 60_000 }, () => {
  const sources = loadScanSources();

  it("classifies every staff and catalogue ConfirmModal element as write, continuity or the single reviewed dynamic case", () => {
    expect(checkModalClassification(sources)).toEqual([]);
  });

  it("keeps the lists honest: every listed file exists and still contains a ConfirmModal element", () => {
    const listed = [...CONTINUITY_MODAL_FILES, ...DYNAMIC_MODAL_FILES, ...WRITE_MODAL_FILES];
    expect(new Set(listed).size).toBe(listed.length);
    for (const file of listed) {
      expect(sources[file], `${file} is listed but was not found under the scan roots`).toBeDefined();
      expect(scanJsxElements(sources[file], "ConfirmModal", file).length, `${file} no longer has a ConfirmModal`).toBeGreaterThan(0);
    }
  });

  it("marks the continuity files from the plan, plus licence activation, and nothing else as continuity", () => {
    const continuityFound = Object.entries(sources)
      .filter(([file, source]) =>
        scanJsxElements(source, "ConfirmModal", file).some(
          (m) => m.effect.kind === "literal" && m.effect.value === "continuity",
        ),
      )
      .map(([file]) => file)
      .sort();
    // The AssignmentsPanel account modal is conditional, not a literal, so it is not in this set.
    expect(continuityFound).toEqual([...CONTINUITY_MODAL_FILES].sort());
  });

  it("treats AssignmentsPanel as the dynamic case: deactivate continuity, reactivate write, revoke default", () => {
    const [file] = DYNAMIC_MODAL_FILES;
    const modals = scanJsxElements(sources[file], "ConfirmModal", file);
    expect(modals).toHaveLength(2);
    const conditional = modals.find((m) => m.effect.kind === "expression" && m.effect.conditional);
    expect(conditional).toBeDefined();
    expect(conditional!.effect).toMatchObject({ text: expect.stringContaining('"continuity"') });
    expect((conditional!.effect as { text: string }).text).toContain('"write"');
    expect(modals.filter((m) => m.effect.kind === "absent")).toHaveLength(1);
  });

  it("no staff or catalogue ResourceForm element passes licenceEffect continuity", () => {
    const offenders: string[] = [];
    for (const [file, source] of Object.entries(sources)) {
      for (const form of scanJsxElements(source, "ResourceForm", file)) {
        if (form.effect.kind !== "absent") offenders.push(`${file}:${form.line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the bespoke continuity dialogs off ConfirmModal and ResourceForm, so the mirror cannot disable them", () => {
    for (const file of BESPOKE_CONTINUITY_DIALOG_FILES) {
      const source = sources[file];
      expect(source, `${file} not found under the scan roots`).toBeDefined();
      expect(scanJsxElements(source, "ConfirmModal", file), `${file} now uses ConfirmModal: classify it`).toEqual([]);
      expect(scanJsxElements(source, "ResourceForm", file), `${file} now uses ResourceForm: classify it`).toEqual([]);
    }
  });
});

describe("checkModalClassification (unit, in-memory sources)", () => {
  const MODAL = `export const X = () => <ConfirmModal open title="t" confirmLabel="c" onConfirm={() => {}} onCancel={() => {}} />;`;

  it("fails for an unclassified file containing a ConfirmModal, naming its path", () => {
    const problems = checkModalClassification({ "src/app/staff/brand-new/NewThing.tsx": MODAL });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("src/app/staff/brand-new/NewThing.tsx");
    expect(problems[0]).toContain("not classified");
  });

  it("ignores files with no ConfirmModal element, and mentions in comments or strings", () => {
    expect(
      checkModalClassification({
        "src/app/staff/brand-new/Other.tsx": `// <ConfirmModal open />\nexport const a = "<ConfirmModal />";\nexport const B = () => <div />;`,
      }),
    ).toEqual([]);
  });

  it("fails a continuity file whose modal lacks the continuity attribute", () => {
    const [file] = CONTINUITY_MODAL_FILES;
    const problems = checkModalClassification({ [file]: MODAL });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('lacks licenceEffect="continuity"');
  });

  it("passes a continuity file whose modal carries the literal continuity attribute", () => {
    const [file] = CONTINUITY_MODAL_FILES;
    const marked = MODAL.replace("<ConfirmModal open", '<ConfirmModal licenceEffect="continuity" open');
    expect(checkModalClassification({ [file]: marked })).toEqual([]);
    const braced = MODAL.replace("<ConfirmModal open", '<ConfirmModal licenceEffect={"continuity"} open');
    expect(checkModalClassification({ [file]: braced })).toEqual([]);
  });

  it("fails a write file whose modal passes any licenceEffect", () => {
    const [file] = WRITE_MODAL_FILES;
    const marked = MODAL.replace("<ConfirmModal open", '<ConfirmModal licenceEffect="continuity" open');
    const problems = checkModalClassification({ [file]: marked });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("write modal file but passes licenceEffect");
  });

  it("fails the dynamic file unless exactly one modal passes a conditional expression", () => {
    const [file] = DYNAMIC_MODAL_FILES;
    expect(checkModalClassification({ [file]: MODAL })).toHaveLength(1);
    const conditional = `${MODAL}\nexport const Y = () => <ConfirmModal licenceEffect={isActive ? "continuity" : "write"} open />;`;
    expect(checkModalClassification({ [file]: conditional })).toEqual([]);
    const twoConditional = `${conditional}\nexport const Z = () => <ConfirmModal licenceEffect={a ? "continuity" : "write"} open />;`;
    expect(checkModalClassification({ [file]: twoConditional })).toHaveLength(1);
  });
});
