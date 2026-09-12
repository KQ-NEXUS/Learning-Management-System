---
schema_version: 1
open_count: 12
waived_count: 0
fixed_count: 2
total_count: 14
last_updated: 2026-09-10T05:18:51.181Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 04.1 | unrun-verify | src/components/primitives/ResourceTable.tsx |  | Task 3's human-check (npm run dev, visually confirm segmented filter control, glyphs, keyboard focus ring, and narrow-viewport no-scrollbar card fallback on /staff/courses) was not run this session — deferred to phase D-26 manual walkthrough | open |  | 2026-09-05T11:32:25.977Z |  |
| 2 | 04.1 | deviation | src/app/(public)/courses/[slug]/page.tsx |  | Reworded privacy comments to satisfy the zero-Suspense verification gate without changing lookup behavior | fixed |  | 2026-09-05T16:08:35.375Z | 2026-09-05T16:09:18.561Z |
| 3 | 04.1 | deviation | src/app/(public)/not-found.tsx |  | Changed the public 404 local wrapper from main to section to avoid nesting LearnerShell's main landmark | fixed |  | 2026-09-05T16:08:38.158Z | 2026-09-05T16:09:20.928Z |
| 4 | 04.1 | stub | src/app/staff/courses/CoursesTable.tsx | 178 | Existing Publish and Archive bulk-action handlers remain empty by explicit Plan 10 instruction; implementation is deferred beyond the design-system restyle | open |  | 2026-09-05T17:07:14.890Z |  |
| 5 | 04.1 | unrun-verify | src/app/staff/courses/[id]/preview/page.tsx |  | Plan 10 human walkthrough of course list, detail, arrange, lesson editor, and both previews was deferred until Phase 04.1 completes per user direction | open |  | 2026-09-05T17:07:18.335Z |  |
| 6 | 04.1 | stub | src/components/catalogue/LessonFormFields.tsx | 175 | The disabled assessment picker remains an intentional Phase 10 placeholder because assessment authoring is outside the design-system rollout. | open |  | 2026-09-05T21:12:10.742Z |  |
| 7 | 04.1 | unrun-verify | src/components/catalogue/RichTextEditor.tsx |  | Plan 12 human walkthrough of the empty editor, mouse and keyboard reordering, screen-reader announcement, unsaved pill, and drag-over highlight is deferred until Phase 04.1 completes per user direction. | open |  | 2026-09-05T21:12:23.486Z |  |
| 8 | 04.1 | stub | src/components/catalogue/LessonMediaPlayer.tsx | 46 | The pre-existing captions track remains without an uploaded caption source because caption-upload capability is explicitly deferred to Phase 9 or 15; Plan 13 did not introduce or expand this stub. | open |  | 2026-09-05T21:37:06.594Z |  |
| 9 | 04.1 | unrun-verify | src/components/catalogue/LessonContent.tsx |  | Plan 13 human walkthrough of failed-media placeholders, publish-dialog scrolling/gating, six readiness headings and pending-to-clean upload behavior is deferred until Phase 04.1 completes per user direction. | open |  | 2026-09-05T21:38:38.242Z |  |
| 10 | 04.1 | unrun-verify | .planning/phases/04.1-design-system-rollout-modern-ui-across-every-existing-surfac/04.1-MOCKUP-SOURCE.html |  | Plan 14 phase-wide 28-screen/30-route walkthrough, denial-parity visual comparison, responsive no-horizontal-scroll sweep, and every UI-SPEC section 8 backstop remain unrun by explicit user request to finish implementation before testing. | open |  | 2026-09-06T01:10:11.359Z |  |
| 11 | 04.1 | stub | src/app/staff/courses/CoursesTable.tsx | 181 | Publish, Archive, Export CSV and New course remain intentionally unavailable with native disabled and visible explanations; new capability work is outside 04.1. | open |  | 2026-09-06T14:04:15.971Z |  |
| 12 | 06 | stub | src/server/services/checkout-service.ts |  | initiateStripePayment's successUrl points at /checkout/{orderId}/confirming, not built until plan 06-07 (D-05 interstitial) -- 404s momentarily after a real Stripe test payment until that plan ships | open |  | 2026-09-10T05:18:06.391Z |  |
| 13 | 06 | unrun-verify | tests/checkout-webhook.integration.test.ts |  | 6-case real-Postgres webhook settlement suite could not run in this execution sandbox -- Docker unavailable; needs a Docker-enabled environment before REG-03/REG-05/PAY-10's real-Postgres proof is complete | open |  | 2026-09-10T05:18:42.581Z |  |
| 14 | 06 | unrun-verify | 06-03-SUMMARY.md |  | Task 3's human-check browser walkthrough (enroll, pay with a real Stripe test card via stripe listen, confirm receipt page and cross-learner 404) not yet performed | open |  | 2026-09-10T05:18:51.181Z |  |

````json
[
  {
    "id": 1,
    "kind": "unrun-verify",
    "phase": "04.1",
    "file": "src/components/primitives/ResourceTable.tsx",
    "line": null,
    "description": "Task 3's human-check (npm run dev, visually confirm segmented filter control, glyphs, keyboard focus ring, and narrow-viewport no-scrollbar card fallback on /staff/courses) was not run this session — deferred to phase D-26 manual walkthrough",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-05T11:32:25.977Z",
    "resolved_at": null
  },
  {
    "id": 2,
    "kind": "deviation",
    "phase": "04.1",
    "file": "src/app/(public)/courses/[slug]/page.tsx",
    "line": null,
    "description": "Reworded privacy comments to satisfy the zero-Suspense verification gate without changing lookup behavior",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-05T16:08:35.375Z",
    "resolved_at": "2026-09-05T16:09:18.561Z"
  },
  {
    "id": 3,
    "kind": "deviation",
    "phase": "04.1",
    "file": "src/app/(public)/not-found.tsx",
    "line": null,
    "description": "Changed the public 404 local wrapper from main to section to avoid nesting LearnerShell's main landmark",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-05T16:08:38.158Z",
    "resolved_at": "2026-09-05T16:09:20.928Z"
  },
  {
    "id": 4,
    "kind": "stub",
    "phase": "04.1",
    "file": "src/app/staff/courses/CoursesTable.tsx",
    "line": 178,
    "description": "Existing Publish and Archive bulk-action handlers remain empty by explicit Plan 10 instruction; implementation is deferred beyond the design-system restyle",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-05T17:07:14.890Z",
    "resolved_at": null
  },
  {
    "id": 5,
    "kind": "unrun-verify",
    "phase": "04.1",
    "file": "src/app/staff/courses/[id]/preview/page.tsx",
    "line": null,
    "description": "Plan 10 human walkthrough of course list, detail, arrange, lesson editor, and both previews was deferred until Phase 04.1 completes per user direction",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-05T17:07:18.335Z",
    "resolved_at": null
  },
  {
    "id": 6,
    "kind": "stub",
    "phase": "04.1",
    "file": "src/components/catalogue/LessonFormFields.tsx",
    "line": 175,
    "description": "The disabled assessment picker remains an intentional Phase 10 placeholder because assessment authoring is outside the design-system rollout.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-05T21:12:10.742Z",
    "resolved_at": null
  },
  {
    "id": 7,
    "kind": "unrun-verify",
    "phase": "04.1",
    "file": "src/components/catalogue/RichTextEditor.tsx",
    "line": null,
    "description": "Plan 12 human walkthrough of the empty editor, mouse and keyboard reordering, screen-reader announcement, unsaved pill, and drag-over highlight is deferred until Phase 04.1 completes per user direction.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-05T21:12:23.486Z",
    "resolved_at": null
  },
  {
    "id": 8,
    "kind": "stub",
    "phase": "04.1",
    "file": "src/components/catalogue/LessonMediaPlayer.tsx",
    "line": 46,
    "description": "The pre-existing captions track remains without an uploaded caption source because caption-upload capability is explicitly deferred to Phase 9 or 15; Plan 13 did not introduce or expand this stub.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-05T21:37:06.594Z",
    "resolved_at": null
  },
  {
    "id": 9,
    "kind": "unrun-verify",
    "phase": "04.1",
    "file": "src/components/catalogue/LessonContent.tsx",
    "line": null,
    "description": "Plan 13 human walkthrough of failed-media placeholders, publish-dialog scrolling/gating, six readiness headings and pending-to-clean upload behavior is deferred until Phase 04.1 completes per user direction.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-05T21:38:38.242Z",
    "resolved_at": null
  },
  {
    "id": 10,
    "kind": "unrun-verify",
    "phase": "04.1",
    "file": ".planning/phases/04.1-design-system-rollout-modern-ui-across-every-existing-surfac/04.1-MOCKUP-SOURCE.html",
    "line": null,
    "description": "Plan 14 phase-wide 28-screen/30-route walkthrough, denial-parity visual comparison, responsive no-horizontal-scroll sweep, and every UI-SPEC section 8 backstop remain unrun by explicit user request to finish implementation before testing.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-06T01:10:11.359Z",
    "resolved_at": null
  },
  {
    "id": 11,
    "kind": "stub",
    "phase": "04.1",
    "file": "src/app/staff/courses/CoursesTable.tsx",
    "line": 181,
    "description": "Publish, Archive, Export CSV and New course remain intentionally unavailable with native disabled and visible explanations; new capability work is outside 04.1.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-06T14:04:15.971Z",
    "resolved_at": null
  },
  {
    "id": 12,
    "kind": "stub",
    "phase": "06",
    "file": "src/server/services/checkout-service.ts",
    "line": null,
    "description": "initiateStripePayment's successUrl points at /checkout/{orderId}/confirming, not built until plan 06-07 (D-05 interstitial) -- 404s momentarily after a real Stripe test payment until that plan ships",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-10T05:18:06.391Z",
    "resolved_at": null
  },
  {
    "id": 13,
    "kind": "unrun-verify",
    "phase": "06",
    "file": "tests/checkout-webhook.integration.test.ts",
    "line": null,
    "description": "6-case real-Postgres webhook settlement suite could not run in this execution sandbox -- Docker unavailable; needs a Docker-enabled environment before REG-03/REG-05/PAY-10's real-Postgres proof is complete",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-10T05:18:42.581Z",
    "resolved_at": null
  },
  {
    "id": 14,
    "kind": "unrun-verify",
    "phase": "06",
    "file": "06-03-SUMMARY.md",
    "line": null,
    "description": "Task 3's human-check browser walkthrough (enroll, pay with a real Stripe test card via stripe listen, confirm receipt page and cross-learner 404) not yet performed",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-10T05:18:51.181Z",
    "resolved_at": null
  }
]
````
