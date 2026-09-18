---
phase: 11-certificates-completion-lifecycle
plan: 12
subsystem: ui
tags: [react, certificate-templates, canvas, drag-and-drop-free, pointer-events, keyboard-accessibility, object-storage-upload]

# Dependency graph
requires:
  - phase: 11-certificates-completion-lifecycle
    provides: "Plan 11-09's TemplateEditorShell frame (name/pageSize/orientation/elements/selectedIndex/dirty state, click-to-add palette, one-write save round trip) and plan 11-03's staged-upload storage primitives"
provides:
  - "TemplateCanvas — a controlled, drag-library-free certificate-page canvas with pointer drag and full keyboard nudge/delete parity"
  - "ElementInspector — per-kind property editing bound two-way to the canvas through one shared elements array"
  - "template-asset-actions.ts — verified staged upload for a template image element's assetKey"
  - "A component test suite proving the keyboard path as seriously as the pointer path"
affects: [11-certificates-completion-lifecycle later plans touching the template editor, any future canvas-style authoring surface]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Controlled canvas positioning via CSS percentage (page-unit -> % of the page rectangle's own box) instead of a JS-computed scale factor for layout, reserving scale math only for pointer-drag pixel-to-point conversion"
    - "role=\"group\" (not role=\"button\") for a selectable box that contains a real nested <button> (delete control), avoiding an interactive-in-interactive ARIA violation while staying queryable by role+name"
    - "Whole-element replacement (not partial-patch merge) for inspector writes, so a key can be genuinely deleted (switching a text element's field off `literal`) without the parser-visible `\"literal\" in record` false-positive a spread-merged `undefined` would cause"

key-files:
  created:
    - src/app/staff/certificates/templates/TemplateCanvas.tsx
    - src/app/staff/certificates/templates/ElementInspector.tsx
    - src/app/staff/certificates/templates/template-asset-actions.ts
    - tests/components/certificate-template-editor.test.tsx
  modified:
    - src/app/staff/certificates/templates/TemplateEditorShell.tsx

key-decisions:
  - "Page-dimension constants and the issued-date formatter are duplicated (not imported) from certificate-pdf-renderer.ts into TemplateCanvas.tsx, matching 11-09's own precedent — that module pulls in pdf-lib, which has no place in a client bundle"
  - "Canvas element boxes use role=\"group\", not role=\"button\" — the selected box nests a real <button> delete control, and button-in-button is an invalid/confusing interactive-nesting pattern"
  - "ElementInspector's onChange contract takes a whole replacement element, not a partial patch, specifically so switching a text element off `literal` can delete that key rather than set it to `undefined` (which parseCertificateTemplateLayout's `\"literal\" in record` check would still reject)"
  - "template-asset-actions.ts calls withPermission directly rather than through a service-layer function — there is no TemplateAsset Prisma model to gate through (assetKey lives only inside the template's JSON layout), matching the same direct-withPermission shape api/lesson-resources/upload-intent/route.ts already uses for the identical reason"
  - "An unsaved new template (no id yet) uses \"draft\" as its upload path's templateId — safe, since that string only organises storage keys and is never trusted as an authorization scope"
  - "A just-uploaded image's canvas preview is a transient, client-only URL.createObjectURL blob keyed by assetKey in shell state — never part of the persisted layout, since there is no template-asset download endpoint to resolve a bare storage key back into a displayable URL"

requirements-completed: [CRD-03]

# Metrics
duration: ~2h
completed: 2026-09-18
---

# Phase 11 Plan 12: Certificate template canvas — pointer drag, keyboard nudge, property inspector, image upload Summary

**A drag-library-free certificate-page canvas (plain pointer events + full keyboard nudge/delete parity) with a two-way-bound property inspector and a verified staged-upload flow for image elements.**

## Performance

- **Duration:** ~2h
- **Tasks:** 3 completed
- **Files modified:** 5 (3 created, 1 created test file, 1 modified)

## Accomplishments

- `TemplateCanvas.tsx`: a controlled certificate-page preview where staff place, move, and delete elements by pointer (plain `onPointerDown`/`onPointerMove`/`onPointerUp` with `setPointerCapture`, no drag library) and by keyboard alone (arrow = 1pt nudge, Shift+arrow = 10pt, Delete/Backspace removes with no `ConfirmModal`). Dynamic-field text elements render realistic sample values ("Jordan Example", "Sample Award Title", today's date via the renderer's own formatter, a sample verification reference) and never the raw field token. Positions/sizes always emit in page units, never scaled screen pixels; a drag is clamped so an element can never be dragged fully off the page.
- `ElementInspector.tsx`: every element property (X/Y/Width/Height for text/image; field type, literal text, font size, color, alignment for text; style, color, width for border) is editable and bound two-way to the canvas through the shell's one shared `elements` array — a position edit from either surface writes through the identical path and can never diverge. Numeric inputs clamp at the input boundary before ever reaching `onChange`.
- `template-asset-actions.ts`: a presign action and a confirm/promote action for a template image element's asset, reusing the existing three-step staged-upload flow (presign a staged key → browser PUT → server-side inspect of the real content-type/byte length → promote) — the client's declared MIME type is never trusted as the verification.
- `TemplateEditorShell.tsx` now mounts the real canvas and inspector in place of plan 11-09's static frame, and blocks Save with an inline message when an image element still carries the pending-upload placeholder, rather than letting the save action fail opaquely against `parseCertificateTemplateLayout`.
- `tests/components/certificate-template-editor.test.tsx`: 16 tests covering the keyboard-only interaction path as seriously as the pointer path, dynamic-field sample rendering, accessible names, `readOnly`'s no-handles/no-delete guarantee, pointer-drag clamping, keyboard nudge's scale-independence (proven by varying the container's rendered width), two-way inspector/canvas binding, the `literal`-clearing invariant proven against the real `parseCertificateTemplateLayout`, exact UI-SPEC copy, the negative-Width input clamp, and the upload flow's Save-blocking guard plus danger/retry state.

## Task Commits

Each task was committed atomically, in dependency order (actions layer, standalone canvas, then the integration point that wires everything together and makes it buildable/functional):

1. **Task 3 (actions layer only): `template-asset-actions.ts`** — `25d9bac` (feat)
2. **Task 1: `TemplateCanvas.tsx`** — `bceeb79` (feat)
3. **Tasks 1/2/3 integration: `ElementInspector.tsx`, `TemplateEditorShell.tsx` wiring, and the full test suite** — `678f7a1` (feat)

## Files Created/Modified

- `src/app/staff/certificates/templates/TemplateCanvas.tsx` — the certificate-page canvas (Task 1)
- `src/app/staff/certificates/templates/ElementInspector.tsx` — the property inspector (Task 2) plus the image-upload control (Task 3)
- `src/app/staff/certificates/templates/template-asset-actions.ts` — presign/confirm server actions for a template image asset (Task 3)
- `src/app/staff/certificates/templates/TemplateEditorShell.tsx` — mounts the canvas and inspector, owns the shared `elements`/`selectedIndex`/`assetPreviewUrls` state, blocks Save on an unattached image element
- `tests/components/certificate-template-editor.test.tsx` — the 16-test suite for all three tasks

## Decisions Made

See `key-decisions` in frontmatter. In addition:

- `renderHandlesAndDelete`'s four corner squares are visual affordances only, not a second drag-resize implementation — the property inspector's Width/Height numeric inputs are the actual resize mechanism, writing through the same `onChange` path.
- `event.currentTarget.setPointerCapture?.(event.pointerId)` is feature-detected, not assumed — jsdom (this plan's own component tests) implements no Pointer Events capture at all, and a real browser without it should degrade gracefully rather than throw.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `role="button"` on a canvas element box would nest a real `<button>` inside another button-role element**
- **Found during:** Task 1, while implementing the delete control inside the selected element's box
- **Issue:** The plan's read_first/action text describes each element box as focusable with an accessible name (naturally suggesting `role="button"`), but the same box also renders a real `<button>` delete control when selected — a `<button>` nested inside a `role="button"` ancestor is an invalid/confusing interactive-in-interactive ARIA pattern for assistive technology.
- **Fix:** Used `role="group"` for the element box instead (still focusable via `tabIndex`, still keydown/pointer-capable, still queryable by role+accessible name — the plan's actual acceptance criterion), and dropped the now-inapplicable `aria-pressed` (not a valid attribute for `role="group"`).
- **Files modified:** `src/app/staff/certificates/templates/TemplateCanvas.tsx`
- **Committed in:** `bceeb79` (Task 1 commit)

**2. [Rule 3 - Blocking] jsdom has no `Element.prototype.setPointerCapture`**
- **Found during:** Task 1, writing the pointer-drag clamp test
- **Issue:** Calling `event.currentTarget.setPointerCapture(event.pointerId)` unconditionally would throw `TypeError: ... is not a function` in the jsdom component-test environment (and potentially in any real environment lacking full Pointer Events capture support), blocking the pointer-drag path entirely.
- **Fix:** Feature-detected the call (`setPointerCapture?.(...)`) rather than assuming it exists.
- **Files modified:** `src/app/staff/certificates/templates/TemplateCanvas.tsx`
- **Committed in:** `bceeb79` (Task 1 commit)

**3. [Rule 1 - Bug] TypeScript narrowing of a captured `element` parameter does not propagate into nested function declarations**
- **Found during:** Task 2, writing `ElementInspector.tsx`'s per-kind field renderers
- **Issue:** The initial implementation checked `if (!element) return ...` once at the top of the component, then relied on that narrowing inside nested `function textFields() { if (element.kind !== "text") return null; ... }`-style helpers — TypeScript does not retain narrowing of a captured outer-scope parameter across a nested function boundary, producing ~30 compile errors.
- **Fix:** Restructured each per-kind renderer to accept the already-narrowed, correctly-typed element as an explicit parameter (`textFields(textElement: TextElement)`, `imageUploadControl(imageElement: ImageElement)`, `borderFields(borderElement: BorderElement)`), called from the single `element.kind === "..." && fn(element)` dispatch at the bottom.
- **Files modified:** `src/app/staff/certificates/templates/ElementInspector.tsx`
- **Verification:** `npx tsc --noEmit` exits 0
- **Committed in:** `678f7a1` (Task 2/3 integration commit)

---

**Total deviations:** 3 auto-fixed (1 accessibility/bug fix, 1 blocking test-environment fix, 1 blocking type-correctness fix)
**Impact on plan:** All three are correctness fixes with no scope creep — the plan's own acceptance criteria (accessible name query by role, keyboard-only test coverage, `npx tsc --noEmit` exits 0) are what caught each one.

## Issues Encountered

- Two component-test authoring pitfalls, both fixed before the first commit (not deviations from the plan's shipped code, just test-writing corrections): (1) `TemplateEditorShell`'s Elements/Properties panels render twice (a mobile `<details>` plus an `lg+` `<aside>`, matching `certificate-templates.test.tsx`'s own documented precedent) — every inspector-facing query in the new test file was switched to `getAllBy*(...)[0]`/`.length` assertions rather than a single `getBy*`. (2) `import.meta.url`-based file reads failed under Vitest's module URL scheme for a static "no drag library imported" grep-style test — switched to `path.resolve(process.cwd(), ...)`.
- Full `npx vitest run` (whole repo, 2825 tests) was run as a broader sanity check beyond the plan's own `<verification>` block. 3 pre-existing failures, none related to this plan: two Testcontainers-backed integration tests failing on "Could not find a working container runtime strategy" (Docker unavailable in this sandbox, a long-standing gap documented elsewhere in STATE.md) and one pre-existing timeout each in `rich-text-editor.test.tsx` and `docker-email-config.test.ts`. 2614 tests passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 11-12 completes CRD-03's "genuinely novel" canvas surface `11-PATTERNS.md`/`11-RESEARCH.md` flagged as LOW confidence / "no analog found" — staff can now design a certificate template end to end (place, style, and delete elements by pointer or by keyboard alone, attach a verified image asset, save a layout the renderer accepts) using only the primitives this plan and 11-09 built.
- No blockers for subsequent 11-* plans. The image-upload flow's client-only preview (`assetPreviewUrls`) is a deliberate, documented simplification — a future plan adding a template-asset download/preview endpoint could replace it, but nothing in this plan depends on that happening.

---
*Phase: 11-certificates-completion-lifecycle*
*Completed: 2026-09-18*
