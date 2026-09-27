---
phase: 12-support-tickets
plan: 05
subsystem: support
tags: [tickets, learner-ui, attachments, privacy, server-actions]
requires:
  - phase: 12-support-tickets
    plan: 02
    provides: ticket service, lifecycle helpers, learner DTO
  - phase: 12-support-tickets
    plan: 03
    provides: private attachment intent/complete/download routes
provides:
  - Support nav item and /support list, /support/new create, /support/[reference] detail routes
  - Ticket-first recoverable create + per-file direct-upload orchestration
  - Public-only learner detail with reply, close and seven-day reopen
  - addOwnReply service command and server-validated context hints
affects: [12-06, 12-09]
tech-stack:
  added: []
  patterns:
    - "Explicit field projection in the page before a client island: only learner-safe fields are representable"
    - "Server computes canReply/canClose/canReopen/autoCloseAt; client never derives grace"
key-files:
  created:
    - src/app/(learner)/support/page.tsx
    - src/app/(learner)/support/new/{page.tsx,actions.ts,NewTicketForm.tsx}
    - src/app/(learner)/support/[reference]/{page.tsx,actions.ts,LearnerTicketDetail.tsx}
    - src/components/support/{TicketAttachmentPicker,TicketContextCard,TicketTimeline}.tsx
    - src/components/support/{ticket-labels.tsx,upload-ticket-attachment.ts}
    - src/server/services/ticket-learner-context-service.ts
    - tests/components/learner-support.test.tsx
    - tests/ticket-learner-reply.integration.test.ts
  modified:
    - src/app/(learner)/layout.tsx
    - src/server/services/ticket-service.ts
    - tests/ticket-service.test.ts
key-decisions:
  - "Partial upload navigates to the created ticket with ?upload=partial&failed=N (no content in URL); the form stays locked after create so a retry can never create twice."
  - "Learner replies are a new service command (addOwnReply) - the existing addPublicReply is staff-only. Replies on RESOLVED/CLOSED tickets are refused; the learner must reopen first."
  - "Context hint (kind+id) is ownership-checked server side in a new ticket-learner-context-service; foreign/unknown hints are silently dropped."
patterns-established: []
requirements-completed: [SUP-01, SUP-02, SUP-05]
metrics:
  completed: 2026-09-25
---

# Phase 12 Plan 05: Learner support journey Summary

Learners get a Support destination with list, ticket-first creation with recoverable per-file uploads, and a public-only detail with reply, close and seven-day reopen driven by server-calculated lifecycle flags.

## Tasks

| Task | Commit | Notes |
|------|--------|-------|
| 1 list + create flow | eadf31e, 3acf402 (lock-state lint fix) | nav, routes, form, picker, context validation, UploadStatus fix |
| 2 detail, reply, lifecycle | 491e7de | page projection, actions, timeline, reopen dialog |
| Extra: real-DB proof | 037aadb | reply version guard, private-content exclusion, exact grace boundary |

## Verification (actual results)

- `npx vitest run tests/components/learner-support.test.tsx`: 24/24 passed.
- `tests/ticket-service.test.ts` plus all `tests/ticket-*.test.ts` and ticket integration files: 113/113 passed.
- `tests/ticket-learner-reply.integration.test.ts`: 3/3 passed on a testcontainers PostgreSQL (Docker available).
- `npx tsc --noEmit`: clean. `npx eslint` on all new/changed 12-05 files (excluding ticket-service.ts): clean.
- Not run: manual browser walkthrough, real R2/MinIO upload (upload helper is mocked in component tests), narrow-viewport visual check (only class-level wrap assertions).

## Deviations from Plan

**1. [Rule 1 - Bug] UploadStatusValue mismatch**
- `ticket-service.ts` declared UPLOADING/READY/QUARANTINED/REJECTED; Prisma enum is UPLOADING/READY/ERROR. Aligned to the Prisma enum as requested. Commit eadf31e.

**2. [Rule 2 - Missing critical functionality] Learner reply and detail flags did not exist**
- The service had only a staff `addPublicReply`, and the learner DTO had no author role or lifecycle flags. Added `addOwnReply`, `initialMessageId` on create, `authorRole`, `canReply/canClose/canReopen/autoCloseAt` (server-calculated). Commits eadf31e, 491e7de.

**3. [Rule 2] Server-side context ownership**
- Plan required the action to validate ownership; added `ticket-learner-context-service.ts` (course/cohort via enrolment, order/certificate by userId, submission via enrolment). Not covered by a real-DB test.

**4. Plan-vs-spec tension resolved**
- Plan says both "stay on form" and "route to detail" on partial failure; implemented: show the message, then route to the ticket. Failed files cannot be retried after navigation (File objects do not survive); the banner directs the learner to attach them in a reply, which is the "try again from the ticket" copy in UI-SPEC. Retry buttons work in the reply composer once the reply exists.

## Known Stubs

None. `GetSupportLink.tsx` and the dashboard slot listed in plan key_links belong to plan 12-06 and were not built here.

## Deferred Issues

- `ticket-service.ts` has 33 pre-existing `no-explicit-any` lint errors (Prisma repository typing from plan 12-02); untouched.
- The resolved-but-grace-expired state shows the closed copy; wording could be refined.
- Route-level `/support/[reference]` failure banners rely on query params; not tested in a browser.

## Threat Flags

None beyond the plan's threat model (T-12-01, T-12-06, T-12-08 mitigated: explicit projection with sentinel tests, local+server file caps and disabled double submit, versioned actions and server grace).
