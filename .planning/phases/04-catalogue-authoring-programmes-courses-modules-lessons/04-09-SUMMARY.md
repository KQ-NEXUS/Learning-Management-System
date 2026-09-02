---
phase: 04-catalogue-authoring-programmes-courses-modules-lessons
plan: 09
subsystem: ui
tags: [react, next-app-router, hello-pangea-dnd, server-actions, zod, wcag, accessibility]

status: checkpoint-pending

requires:
  - phase: 04-01
    provides: components Vitest project (jsdom), primitives (FormField/TextInput/ConfirmModal)
  - phase: 04-04
    provides: moduleService/createModule, lessonService, loadCourseTree, listWithdrawn* 
  - phase: 04-05
    provides: reorder-service (commitModuleOrder/commitLessonOrder, order token, StaleOrderError)
provides:
  - Reusable ArrangeBoard client component (pointer drag + first-class keyboard path + Withdrawn/Restore)
  - UnsavedOrderGuard (context + GuardedLink + beforeunload) for D-22
  - The phase's only Module creation surface (ModuleComposer + createModuleAction)
  - Staff route /staff/courses/[id]/arrange with whole-arrangement saves and D-23 stale refusal
  - Component test proving keyboard/drag arrangement parity
affects: [04-11 lesson-create form, 04-14 checkpoint, publish flow]

tech-stack:
  added: []
  patterns:
    - "Two entry points (pointer drag + keyboard buttons) route through one pure reducer and one Save commit"
    - "Server Actions validate with zod .strict() then delegate to service layer; no @prisma/client under app/"
    - "Order token round-tripped: action returns a fresh serialiseOrderToken after each save"
    - "Client island remounted via a structure-derived key after router.refresh()"

key-files:
  created:
    - src/components/catalogue/ArrangeBoard.tsx
    - src/components/catalogue/UnsavedOrderGuard.tsx
    - src/components/catalogue/index.ts
    - src/app/staff/courses/[id]/arrange/page.tsx
    - src/app/staff/courses/[id]/arrange/ArrangeClient.tsx
    - src/app/staff/courses/[id]/arrange/ModuleComposer.tsx
    - src/app/staff/courses/[id]/arrange/actions.ts
    - tests/components/arrange-board.test.tsx
  modified: []

key-decisions:
  - "ArrangeBoard is a controlled component; the parent owns arrangement + dirty state, boards report dirty per key into the guard context"
  - "GuardedLink drops external onNavigate support (the onNavigate event has no defaultPrevented); it always intercepts while dirty and defers to ConfirmModal"
  - "restoreItemAction casts moduleService/lessonService to a Restorable shape — the established codebase idiom (inferred service type omits the conditional .restore)"

patterns-established:
  - "moveItemInContainers / arrangementFromDragResult: pure, exported, shared by drag and keyboard"
  - "UnsavedOrderProvider tracks a Set of dirty keys so multiple boards on one screen do not clobber each other"

requirements-completed: []  # CAT-02, CAT-03 pending human checkpoint (Task 3)

duration: ~75min
completed: 2026-09-03
---

# Phase 4 Plan 9: Course structure screen (arrange) Summary

**ArrangeBoard with pointer drag and a first-class keyboard reorder path, an explicit Save order commit backed by the transactional reorder service with D-23 stale refusal, Module creation (the phase's only such surface), and a collapsed Withdrawn/Restore section — implementation complete, blocked on the accessibility human checkpoint.**

## Status: CHECKPOINT-PENDING

Tasks 1 and 2 are complete and committed. Task 3 is a `checkpoint:human-verify`
(`gate="blocking"`) that requires a human to exercise the accessible arrange
path (including a screen reader) against a running dev server. No code remains
for this plan after approval — a failing step is fixed back in Task 1 or 2.

## Performance

- **Tasks:** 2 of 3 complete (Task 3 is a human checkpoint)
- **Files created:** 8
- **Automated verification:** `npx tsc --noEmit` clean, `npx eslint .` clean,
  `npx vitest run` green (281 tests, 21 files, incl. `tests/boundary.test.ts`),
  `tests/components/arrange-board.test.tsx` 10/10.

## Accomplishments

- **ArrangeBoard** (`"use client"`): pointer/touch drag via `@hello-pangea/dnd`
  `DragDropContext` / `Droppable` / `Draggable`; a keyboard path that does NOT
  depend on the library's own keyboard sensor — every row carries "Move up" /
  "Move down" buttons (and, with `allowCrossContainer`, "Move to previous /
  next module") whose accessible names include the item label. Both paths
  mutate the same proposed arrangement through one pure reducer
  (`moveItemInContainers`) and commit through the same `onSave`. An
  `aria-live="polite"` region announces each move. A single "Save order"
  button, disabled until the arrangement changes (D-20). Read-only
  Required/Optional badge (D-24, no input). Collapsed "Withdrawn (n)"
  `<details>` with per-row Restore that appends to the end (D-34).
- **UnsavedOrderGuard**: `UnsavedOrderProvider` / `useUnsavedOrder()` /
  `GuardedLink`. `GuardedLink` intercepts `onNavigate` while dirty and calls
  `event.preventDefault()`, confirming through the accessible `ConfirmModal`
  primitive (not the blocking browser prompt). A `beforeunload` listener is
  registered while dirty because `onNavigate` does not cover reloads or the
  back button. A comment states plainly that this is courtesy — the real
  guarantee is the server-side `StaleOrderError` refusal.
- **ModuleComposer** (`"use client"`): the phase's only Module creation
  surface. Inline "Add module" form (required title, trimmed on submit),
  per-module inline rename, and an empty-state prompt ("a module has to exist
  before a lesson can") with the field focused when the Course has zero
  Modules.
- **actions.ts** (`"use server"`, single directive): `createModuleAction`
  (zod `.strict()`, no `position` field ever — `createModule` assigns it),
  `renameModuleAction`, `saveModuleOrderAction`, `saveLessonArrangementAction`
  (both parse the order token, delegate to `reorder-service`, and return a
  freshly serialised token on success), `withdrawItemAction`,
  `restoreItemAction`. `StaleOrderError` → `reason: "STALE"` with a reload
  message (D-23); `ArrangementMismatchError` → `"MISMATCH"`;
  `AuthorizationError`/`AuthenticationError` → `"DENIED"`. No `@prisma/client`
  import anywhere under the folder.
- **page.tsx**: Server Component — `await params`, `loadCourseTree(id)` plus
  the withdrawn lists, `AuthorizationError → notFound()` exactly as the course
  detail page, renders `ArrangeClient` inside `UnsavedOrderProvider` with
  `serialiseOrderToken(course.updatedAt)`.
- **ArrangeClient**: holds the proposed arrangement for two boards — Modules
  (`allowCrossContainer={false}`) and Lessons grouped by Module
  (`allowCrossContainer`, D-21) — wires the composer and both boards to the
  actions, shows failure messages inline, and offers a Reload button on
  `reason: "STALE"`. Each Module heading carries an "Add lesson"
  `GuardedLink` to `/staff/courses/<id>/lessons/new?moduleId=<moduleId>`
  (plan 04-11's route — the contract between the two plans).
- **tests/components/arrange-board.test.tsx**: 10 `it` blocks. Proves the
  keyboard-produced arrangement array deep-equals the drag-produced one,
  first/last no-op moves, the `aria-live` text change, Save-order
  enable/disable, the Withdrawn section, and the ModuleComposer add-form +
  zero-modules empty state.

## Task Commits

1. **Task 1: ArrangeBoard and the unsaved-order guard** — `851e06a` (feat)
2. **Task 2 (RED): failing keyboard-parity test** — `4696157` (test)
3. **Task 2 (GREEN): Module creation, the arrange route, and its server actions** — `9af1c8f` (feat)

Task 3 (checkpoint) and the plan-metadata commit are pending.

## Human Checkpoint — Task 3 (blocking)

**What was built:** drag-and-drop reordering of Modules and Lessons, a
keyboard-only path (Move up / Move down / Move to next module), an aria-live
announcement per move, an explicit Save order commit, an unsaved-changes guard
on navigation and reload, and a collapsed Withdrawn section with Restore.

**Verification steps the human must perform** (`npm run dev`, sign in as a user
holding `courses.edit`):

1. Open `/staff/courses/<a course id WITH NO MODULES>/arrange`. Confirm the
   empty state explains a Module must exist first; create two Modules through
   the inline form. Confirm each appears immediately and that neither creation
   asked for a position.
1b. Use the per-module "Add lesson" link to create at least two Lessons in the
   first Module and one in the second. (The lesson form is plan 04-11; if it is
   not yet built, seed the lessons directly and note it — but step 1's "Add
   module" flow must be exercised through the UI.)
2. With a mouse, drag a Lesson to a new position within its Module. Confirm it
   moves and that "Save order" becomes enabled.
3. Drag a Lesson into a DIFFERENT Module. Confirm it re-parents visually.
4. Press Save order. Reload the page. Confirm the new order persisted exactly.
5. Keyboard only: Tab to a Lesson row's "Move up" button and press Enter/Space
   several times. Confirm the item moves one position per press and stops at
   the top without error.
6. Turn on a screen reader (Narrator / VoiceOver). Repeat step 5 and confirm
   each move is announced with the lesson name and its new position.
7. Make a change and DO NOT save. Click a link out of the page. Confirm a modal
   (not a browser dialog) asks before leaving. Cancel, then press browser
   Reload and confirm the browser's own warning appears.
8. Open the same course's arrange page in a second tab. Save an order in tab A,
   then save a different order in tab B. Confirm tab B is refused with a
   message saying someone else reordered it and offering a reload — and that
   tab A's order survived.
9. Expand "Withdrawn (n)" and press Restore on an item. Confirm it reappears at
   the END of its list.

**Resume signal:** "approved", or a description of the step that failed.

## Files Created/Modified

- `src/components/catalogue/ArrangeBoard.tsx` — reusable arrange board
- `src/components/catalogue/UnsavedOrderGuard.tsx` — D-22 guard (context, GuardedLink, beforeunload)
- `src/components/catalogue/index.ts` — barrel
- `src/app/staff/courses/[id]/arrange/page.tsx` — Server Component route
- `src/app/staff/courses/[id]/arrange/ArrangeClient.tsx` — client island wiring composer + two boards
- `src/app/staff/courses/[id]/arrange/ModuleComposer.tsx` — Module create + rename + empty state
- `src/app/staff/courses/[id]/arrange/actions.ts` — six Server Actions
- `tests/components/arrange-board.test.tsx` — keyboard/drag parity + surface tests

## Decisions Made

- **ArrangeBoard is controlled.** The parent (`ArrangeClient`, or a test
  harness) owns the arrangement and the `dirty` flag; each board reports its
  own dirty state into the guard context under a `useId()` key, so the Modules
  board and the Lessons board on one screen do not clobber each other.
- **`GuardedLink` does not forward an external `onNavigate`.** The `onNavigate`
  event object is `{ preventDefault: () => void }` with no `defaultPrevented`,
  so there is no reliable way to compose a caller's handler. `GuardedLink`
  owns the interception entirely.
- **`restoreItemAction` casts the services to a `Restorable` shape.** The
  inferred exported type of `moduleService` / `lessonService` omits the
  conditional `.restore` even though it exists at runtime; casting at the call
  site is the established idiom (`tests/module-lesson-service.test.ts`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Generated Next.js route types**
- **Found during:** Task 1 verification (`npx tsc --noEmit`)
- **Issue:** `src/app/layout.tsx` referenced the generated global `LayoutProps<"/">`,
  which does not exist until Next.js writes `.next/types`. The worktree had no
  `.next/` directory, so `tsc` failed on pre-existing committed code.
- **Fix:** Ran `npx next typegen` to generate the route types (`.next/types`,
  git-ignored). No source change.
- **Verification:** `npx tsc --noEmit` clean.
- **Committed in:** n/a (generated, git-ignored artifact)

**2. [Rule 3 - Blocking] `page.tsx` needs the Course title/slug for the header**
- **Found during:** Task 2
- **Issue:** `loadCourseTree` selects `id`, `updatedAt`, and modules only — no
  title/slug for the page header and breadcrumb.
- **Fix:** Added a `courseService.get(id)` call (already `courses.view`-gated,
  same as `loadCourseTree`) and cast its result for `title`/`slug`.
- **Files modified:** src/app/staff/courses/[id]/arrange/page.tsx
- **Verification:** tsc + eslint clean; route renders.
- **Committed in:** `9af1c8f`

---

**Total deviations:** 2 auto-fixed (both Rule 3 blocking).
**Impact on plan:** No scope creep. Deviation 1 is an environment/setup fix;
deviation 2 is a one-line read needed to render the screen the plan specifies.

## Issues Encountered

- The controlled-component design meant the "Move up on the first item is a
  no-op" behavior is enforced by disabling the button at index 0 rather than
  by the reducer returning the same reference. The test was adjusted to assert
  the disabled button and a same-slot reducer no-op rather than reference
  equality.

## Known Stubs

- The "Add lesson" link targets `/staff/courses/<id>/lessons/new?moduleId=<id>`,
  a route **plan 04-11 builds**. Rendering it before that route exists is the
  deliberate contract between the two plans (plan 04-09 `<action>` for Task 2).
  Not a stub in this plan's own surface.

## Next Phase Readiness

- Blocked on the Task 3 human checkpoint (accessibility + concurrency + guard).
- After approval: mark CAT-02 and CAT-03 complete; the plan-metadata commit
  (`docs(04-09): ...`) is still to be made by the orchestrator flow.
- Plan 04-11 can now hand a `moduleId` from the arrange screen to its
  lesson-create form.

---
*Phase: 04-catalogue-authoring-programmes-courses-modules-lessons*
*Status: checkpoint-pending — 2026-09-03*
