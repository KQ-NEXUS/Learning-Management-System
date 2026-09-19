---
phase: 11-certificates-completion-lifecycle
plan: 21
subsystem: certificates-ui
tags: [certificates, template-editor, public-verification, gap-closure, uat]
requires: ["11-16"]
provides:
  - "Drag-safe TemplateCanvas (non-draggable image preview, dragstart cancelled, select-none/touch-none boxes)"
  - "Public /verify-certificate reference-entry page reusing the guard-free /verify shell and VerifyReferenceForm"
  - "tests/verify-routes.test.ts route-table guard"
affects: [template-editor, public-verification]
tech-stack:
  added: []
  patterns:
    - "layout re-export (export { default } from ../verify/layout) so one implementation of the guard-free shell"
    - "route-table test with fs.existsSync to protect a path collision"
key-files:
  created:
    - src/app/verify-certificate/layout.tsx
    - src/app/verify-certificate/page.tsx
    - tests/components/verify-entry-page.test.tsx
    - tests/verify-routes.test.ts
  modified:
    - src/app/staff/certificates/templates/TemplateCanvas.tsx
    - tests/components/certificate-template-editor.test.tsx
    - tests/certificate-phase-invariants.test.ts
key-decisions:
  - "UAT test 13 delivered at /verify-certificate, not the literal bare /verify, because (auth)/verify/page.tsx owns /verify for IAM-02 email verification (links already emailed) and Next refuses two pages on one path"
  - "Page is statically prerendered (no lookup, no search params); the single lookup path stays /verify/[verificationRef]"
requirements-completed: [CRD-03, CRD-04]
duration: ~25 min
completed: 2026-09-19
---

# Phase 11 Plan 21: Canvas drag safety and public verification entry Summary

The uploaded logo can no longer trigger the browser's native image drag on the template canvas (UAT test 4), and employers can type a reference at the new public `/verify-certificate` page (UAT test 13) without touching the IAM-02 `/verify` flow.

## Tasks

| Task | Commit | Result |
|------|--------|--------|
| 1. Drag-safe canvas image and element boxes | 4d27f12 | 21/21 editor tests |
| 2. Public /verify-certificate entry page | 3342e59 | route-table, page and invariant tests green |

## RED verification

- Task 1: the 5 new tests were written first. 3 failed against the old markup (draggable attribute / pointer-events-none, dragstart not cancelled, no select-none/touch-none) and 2 passed: the readOnly guard and the pointer-drag test. The pointer-drag test (+100px moves x by exactly 100) is labelled in a comment as a regression GUARD only, since jsdom has no native image drag; it does not reproduce the browser bug. The DOM-contract assertions are the ones that fail pre-fix.
- Task 2: route-table test failed on the missing page (other 3 route assertions passed as pure guards), page test failed to resolve its import. Both green after the route was added.

## What was built

- `TemplateCanvas.tsx`: preview `<img>` gets `draggable={false}`, `onDragStart` preventDefault and `pointer-events-none select-none`; `interactiveProps` gains `onDragStart` preventDefault; non-readOnly border, image and text boxes get `select-none touch-none` (readOnly canvas markup unchanged). Pointer maths, clamp, keyboard and announcements untouched; no drag library.
- `/verify-certificate`: layout re-exports `../verify/layout`; page is a plain Server Component with the same heading/copy as the result page plus `VerifyReferenceForm`. No lookup, no search params, no caching exports. Invariant 4's `CACHE_ROUTE_DIRS` now includes `src/app/verify-certificate`.

## Verification

- `npx next build` clean; route list shows `ƒ /verify`, `○ /verify-certificate`, `ƒ /verify/[verificationRef]` (no duplicate-route error).
- `npx tsc --noEmit` and eslint on touched files clean.
- `git diff -- "src/app/(auth)" package.json package-lock.json` empty; no raw hex in `src/app/verify-certificate`.
- Targeted vitest: `certificate-template-editor`, `verify-entry-page`, `verify-routes`, `certificate-phase-invariants`, `certificate-verification`, `boundary` all pass. (`certificate-phase-invariants` invariant 1 timed out once at 5s when run in parallel with four other files; it passes alone 7/7. That test walks all of src/ and is load-sensitive.)

## Note on UAT test 13 wording

The literal expectation ("the plain /verify path shows a form where a reference can be typed") cannot be satisfied without breaking IAM-02 email-verification links already sent. The equivalent outcome is delivered at `/verify-certificate`; the UAT expectation should be re-worded to that path. `/verify` itself was not changed.

## Deviations from Plan

- Test typing fix (Rule 3): the new canvas test harness needed an explicit `readOnly={false}` prop because `TemplateCanvasProps.readOnly` is required. No production impact.

## Threat model

T-11-86, T-11-87, T-11-90 mitigated as planned (no lookup/no search params, route-table guard, clamp untouched). T-11-SC: no installs, package.json unchanged.

## Known Stubs

None.

## Self-Check: PASSED
- src/app/verify-certificate/page.tsx, layout.tsx, tests/verify-routes.test.ts, tests/components/verify-entry-page.test.tsx exist; commits 4d27f12 and 3342e59 exist.
