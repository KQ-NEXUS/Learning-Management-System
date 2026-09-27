---
phase: 12-support-tickets
plan: 03
subsystem: support
tags: [tickets, attachments, uploads, r2, privacy, cleanup]
requires:
  - phase: 12-support-tickets
    plan: 01
    provides: TicketAttachment schema, ticket upload limits (validateTicketUpload)
  - phase: 12-support-tickets
    plan: 02
    provides: ticket/message model and tickets.view/manage permissions
provides:
  - Private direct-upload lifecycle for ticket files (intent, completion, download authorization)
  - Three route handlers under /api/ticket-attachments
  - Ticket staging/final key builders in storage-service
  - Stale UPLOADING ticket attachment sweep in the existing hourly cleanup
affects: [12-04, 12-05, 12-06, 12-07, 12-08, 12-09]
tech-stack:
  added: []
  patterns:
    - "Single NotFound error type for every attachment authorization/existence/visibility/status failure"
    - "Visibility derived from the parent TicketMessage, never from caller input"
key-files:
  created:
    - src/server/services/ticket-attachment-service.ts
    - src/app/api/ticket-attachments/upload-intent/route.ts
    - src/app/api/ticket-attachments/complete/route.ts
    - src/app/api/ticket-attachments/[attachmentId]/download/route.ts
    - tests/ticket-attachment-service.test.ts
    - tests/ticket-attachment-download-route.test.ts
  modified:
    - src/server/services/storage-service.ts
    - src/server/services/upload-cleanup-system-service.ts
    - tests/upload-cleanup-system-service.test.ts
key-decisions:
  - "Cap of 3 files per message counts READY+UPLOADING rows and is enforced in a Serializable transaction."
  - "Learner upload/download requires ticket ownership plus PUBLIC message; staff upload requires tickets.manage, staff download tickets.view or tickets.manage."
  - "Cleanup keeps one worker; each kind (lesson, ticket) is bounded by the batch limit, so at most 2x batch rows per run. Ticket delegate is optional so existing callers are unchanged."
  - "Downloads redirect (302) to a 60s presigned URL with attachment disposition and sanitized filename, reusing presignLessonObjectUrl with lessonType FILE."
patterns-established: []
requirements-completed: [SUP-01, SUP-02]
duration: ~25 min
completed: 2026-09-25
---

# Phase 12 Plan 03: Ticket Attachments Summary

Private ticket file uploads (PNG/JPEG/WebP/PDF, max 3 per message, max 10 MiB) using random staged keys, presigned PUT, HEAD metadata equality before READY, denial-parity downloads, and hourly abandoned-upload cleanup.

## Tasks

| Task | Commit | Notes |
|------|--------|-------|
| 1 Intent/completion service | 636ebc0, 542621c | service, storage key helpers, 20 unit tests |
| 2 Route handlers | 489a190 | intent, complete, download; 3 route tests |
| 3 Cleanup extension | 25e1b8a | ticket sweep, 2 new tests |

## Verification

Executed and passing:
- `npx vitest run tests/ticket-attachment-service.test.ts` (20 tests)
- `tests/ticket-attachment-download-route.test.ts`, `tests/lesson-resource-routes.test.ts`, `tests/learner-submission-route.test.ts` (all pass)
- `tests/upload-cleanup-system-service.test.ts`, `tests/boundary.test.ts`, `tests/netlify-cleanup-stale-uploads.test.ts` (pass)
- `npx tsc --noEmit` clean; eslint clean on changed files

Not executed: no DB-integration tests were added or run (Docker/testcontainers unavailable). The Prisma repository in `ticket-attachment-service.ts` (Serializable cap transaction, conditional `updateMany` READY promotion, message-visibility join) is therefore only verified by type-checking, not against a real database. Service logic was tested with in-memory fakes. Real storage (R2/MinIO) presign/HEAD/copy paths were likewise not exercised.

## Deviations from Plan

- [Rule 1 - Bug] Test BigInt literals failed tsc (target < ES2020); replaced with `BigInt(...)` (542621c).
- Ticket route handlers rely on the service for authorization (via injected `getActor`/`can`), not `withPermission`, because learner ownership is not a grant. Denials return an empty no-store 404.
- Malformed body returns 400 and file-rule failures 422 before/after authorization respectively; validation runs only after authorization so internal-message existence is not revealed.
- `plan` listed no test for the fourth-file cap against a real DB; covered with fake repository only.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model. Note: `ticket-service.ts` declares `UploadStatusValue` with QUARANTINED/REJECTED while the Prisma enum is UPLOADING/READY/ERROR; pre-existing mismatch, out of scope, worth fixing before the UI consumes attachment status.

## Self-Check: PASSED

Files and commits (636ebc0, 489a190, 542621c, 25e1b8a) verified present.
