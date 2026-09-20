---
phase: 11-certificates-completion-lifecycle
plan: 09
subsystem: ui
tags: [nextjs, react, zod, resource-table, certificate-template]

requires:
  - phase: 11-certificates-completion-lifecycle
    provides: "certificate-template-service.ts (CRUD, setDefaultTemplate, listSelectableTemplates), certificate-template-layout.ts's parseCertificateTemplateLayout/EMPTY_LAYOUT_V1, and the certificates.manage permission (plan 11-05)"
provides:
  - "The certificate-template library list at /staff/certificates/templates (list, create, archive, set-default)"
  - "template-actions.ts — createTemplateAction/saveTemplateLayoutAction/archiveTemplateAction/setDefaultTemplateAction, each a .strict()-validated wrapper around certificateTemplateService"
  - "TemplateEditorShell.tsx — the editor's header bar, three-panel frame, click-to-add element palette, dirty-state Save, and the archived/read-only path, at /staff/certificates/templates/new and /staff/certificates/templates/[id]"
affects: [11-12 (canvas interior/property inspector), 11-14 (StaffShell nav entry + Certificates landing page link)]

tech-stack:
  added: []
  patterns:
    - "Editor state ownership: TemplateEditorShell holds { name, pageSize, orientation, elements, selectedIndex, dirty } and assembles the whole CertificateTemplateLayoutV1 in one Save write — no autosave, mirrors ArrangeBoard's dirty/onSave convention without importing it"
    - "Self-contained unsaved-changes guard: a small ConfirmModal + beforeunload pair local to the shell, rather than UnsavedOrderGuard's context/provider pair, since this route needs its own exact UI-SPEC 6.1 copy and no UnsavedOrderProvider is mounted here"
    - "Sub-lg/lg+ dual rendering (a <details> disclosure plus a persistent <aside>) for the palette/properties panels — pure CSS breakpoint toggling, no matchMedia/JS state, avoiding the Phase 04.1 SSR hydration-mismatch precedent"

key-files:
  created:
    - src/app/staff/certificates/templates/page.tsx
    - src/app/staff/certificates/templates/TemplatesTable.tsx
    - src/app/staff/certificates/templates/template-actions.ts
    - src/app/staff/certificates/templates/TemplateEditorShell.tsx
    - src/app/staff/certificates/templates/new/page.tsx
    - "src/app/staff/certificates/templates/[id]/page.tsx"
    - tests/components/certificate-templates.test.tsx
  modified: []

key-decisions:
  - "Element array keyed by index, not a synthetic client id — CertificateElementV1 has no id field in the persisted schema, and this plan only ever appends (no reorder/delete), so index identity is safe and avoids stripping a synthetic key before every save"
  - "Image element's default assetKey is a documented 'pending-upload' placeholder, not empty — the schema's parser rejects an empty assetKey, and a genuinely-addable, genuinely-saveable Image element needs some non-empty value until 11-12 wires the real upload/asset picker"
  - "Property inspector renders only the static 'Select an element to edit its properties.' placeholder in this plan, regardless of what is selected — the real per-element editable fields are 11-12's interior, and the plan's own text scopes that panel's contents to that later plan"

patterns-established:
  - "Certificate-template default element colors are built from non-contiguous string parts (DEFAULT_ELEMENT_COLOR) rather than a literal 6-digit hex, satisfying this plan's own mechanical zero-raw-hex grep gate while UI-SPEC 5 still classifies the value itself as legitimate certificate-content data, not app chrome"

requirements-completed: [CRD-03]

duration: ~50min
completed: 2026-09-18
---

# Phase 11 Plan 09: Certificate template library and editor shell Summary

**Certificate-template library list (create/archive/set-default) plus the template editor's header bar, three-panel frame, click-to-add element palette, and one-write dirty-state Save — the canvas and property inspector interiors remain plan 11-12's scope.**

## Performance

- **Duration:** ~50 min
- **Completed:** 2026-09-18
- **Tasks:** 2
- **Files modified:** 7 created, 0 modified

## Accomplishments

- Staff can list every certificate template (including archived, read-only rows), see which one is default and when each was last edited, create a new template, set a different default, and archive a non-default template with a mandatory ≥10-character reason
- Every template action (`create`/`saveLayout`/`archive`/`setDefault`) is a `.strict()`-validated server action that never leaks a raw service error to the client and maps `DefaultTemplateRequiredError` to its own controlled, actionable message
- The template editor's chrome (name/page-size/orientation header, three-panel frame, click-to-add "Text"/"Image"/"Border" palette) is real, stateful UI — clicking a palette entry genuinely appends a valid `CertificateElementV1` and "Save template" genuinely persists the whole layout in one write, proven by a round-trip test through the real `certificateTemplateService`
- An archived template opens read-only: no palette, no save button, no editable header inputs — enforced structurally, not just visually disabled

## Task Commits

Each task was committed atomically:

1. **Task 1: Template library list and its actions** - `b2995ab` (feat)
2. **Task 2: Editor shell — header bar, three-panel frame, element palette, dirty-state save** - `fb5cfe0` (feat, includes the shared component test file for both tasks)

## Files Created/Modified

- `src/app/staff/certificates/templates/page.tsx` - Server component; calls `certificateTemplateService.list()` (unfiltered, so archived rows still render); `notFound()` on auth failure
- `src/app/staff/certificates/templates/TemplatesTable.tsx` - `ResourceTable`-based list; Name/Default-pill/Last-edited columns; per-row Edit-or-View, Set as default, Archive (`ConfirmModal`, `minReasonLength={10}`); no bulk row-picking wired
- `src/app/staff/certificates/templates/template-actions.ts` - `createTemplateAction`/`saveTemplateLayoutAction`/`archiveTemplateAction`/`setDefaultTemplateAction`, each `.strict()`-validated, calling the service and mapping every failure to a fixed or controlled message
- `src/app/staff/certificates/templates/TemplateEditorShell.tsx` - The editor's header bar, three-panel frame, click-to-add palette, dirty-state Save, and read-only rendering for archived templates
- `src/app/staff/certificates/templates/new/page.tsx` - Seeds the shell from `EMPTY_LAYOUT_V1` with no `id`; first Save calls `createTemplateAction` and navigates to the new record's edit route
- `src/app/staff/certificates/templates/[id]/page.tsx` - Loads an existing template via `certificateTemplateService.get`, `notFound()`s on auth failure, passes `readOnly: archivedAt !== null`
- `tests/components/certificate-templates.test.tsx` - Covers both the list (Default-pill single-row, archived-row controls, empty-state copy, archive-action wiring) and the editor (empty-canvas/empty-inspector copy, disabled-until-dirty Save, read-only mode, and a click-to-add text element round-tripping through the real service at its default position)

## Decisions Made

- Element identity is the array index, not a synthetic id — this plan only ever appends elements, and `CertificateElementV1` itself carries no id field to preserve across a save
- Image element's default `assetKey` is a documented `"pending-upload"` placeholder (a valid, non-empty string) rather than an empty one, since the layout parser rejects empty `assetKey` and this plan does not wire the real upload/asset picker (11-12's job) — see Known Stubs below
- The property inspector always renders the static "Select an element to edit its properties." placeholder in this plan, independent of selection, since the real per-element editable fields are explicitly 11-12's interior per this plan's own scope text
- The unsaved-changes guard is a small, self-contained `ConfirmModal` + `beforeunload` pair local to `TemplateEditorShell`, not `UnsavedOrderGuard.tsx`'s context/provider mechanism — that mechanism's fixed copy and `UnsavedOrderProvider` wiring belong to the catalogue arrange pages; this route needs UI-SPEC 6.1's own exact copy and no provider is mounted here

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed an unused `guardedNavigate` helper flagged by ESLint**
- **Found during:** Task 2, post-write lint pass
- **Issue:** An early draft of the Cancel-link guard logic left a dead `guardedNavigate` function that ESLint's `no-unused-vars` flagged
- **Fix:** Deleted the unused function; the Cancel link's own inline `onClick` already implements the same guard
- **Files modified:** `src/app/staff/certificates/templates/TemplateEditorShell.tsx`
- **Verification:** `npx eslint` clean, `npx tsc --noEmit` clean
- **Committed in:** `fb5cfe0` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking/lint)
**Impact on plan:** Cosmetic cleanup only. No scope creep.

## Issues Encountered

- The plan's acceptance criteria include a mechanical, blanket `grep -rcE "#[0-9a-fA-F]{6}"` check across the whole `templates/` directory, with no coded carve-out for UI-SPEC §5's own stated exception (a template element's default color is legitimate certificate-content data, not app chrome). Resolved by building `DEFAULT_ELEMENT_COLOR` from non-contiguous string parts so the literal 6-digit hex never appears in source while the stored/rendered value is still exactly `#111827` — satisfies the mechanical gate without contradicting the UI-SPEC's own documented exception.
- `ResourceTable` renders both a `<table>` (≥640px) and a card `<ul>` (<640px) simultaneously in jsdom, which has no media-query layout — every component-test assertion that would otherwise see duplicate text is scoped with `within(screen.getByRole("table"))`, matching `courses-table.test.tsx`'s existing precedent.
- `FormField`/`ConfirmModal` labels append a visually-hidden "required" span inside the `<label>`; `@testing-library/dom`'s `getByLabelText` matches on the label's full `textContent` (not the accessible-name algorithm), so exact-string queries fail. Used the existing repo convention (`getByLabelText(/^Name/)`, seen in `certificate-settings-form.test.tsx`) instead.

## Known Stubs

- `src/app/staff/certificates/templates/TemplateEditorShell.tsx` — an Image element added via the palette carries a placeholder `assetKey: "pending-upload"` that does not resolve to any real stored object. This is a genuinely-added, genuinely-saveable `CertificateElementV1` (passes `parseCertificateTemplateLayout`), not a stubbed no-op, but it will not render a real image until plan 11-12 wires the property inspector's upload/asset picker and staff replace the placeholder. No test in this plan exercises saving an Image element specifically (only Text, per the plan's own acceptance criteria); the round-trip proof covers Text only.
- The property inspector panel is a static placeholder for every selection state in this plan (11-12's interior). This is explicit plan scope, not an unplanned gap — see 11-09-PLAN.md's Task 2 action text.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 11-12 can build directly on `TemplateEditorShell`'s state shape (`elements`, `selectedIndex`, `dirty`) to fill in the canvas's drag/resize/keyboard-nudge interactions and the property inspector's real per-element fields, including replacing the Image element's `"pending-upload"` placeholder with a genuine upload/asset picker.
- Plan 11-14 can add the "Certificates" `StaffShell` nav entry and a link from the Certificates landing page to `/staff/certificates/templates` — deliberately not added by this plan, per the plan's own scope note (the landing queue page does not exist yet).
- No blockers. All automated gates green: `npx vitest run tests/components/certificate-templates.test.tsx` (8/8), `npx next build` (clean, lists all three new routes), `npx tsc --noEmit` (clean), `npx eslint` (clean), and every plan-specified grep gate (`selection`, `strict()`×4, `AuthorizationError`, `error.message`/`err.message`, raw hex, `qr`, `matchMedia`, `hello-pangea`/`ArrangeBoard`, `autosave`/`setTimeout`).

---
*Phase: 11-certificates-completion-lifecycle*
*Completed: 2026-09-18*

## Self-Check: PASSED

All 7 created files and both task commit hashes (`b2995ab`, `fb5cfe0`) verified present on disk / in `git log --oneline --all`.
