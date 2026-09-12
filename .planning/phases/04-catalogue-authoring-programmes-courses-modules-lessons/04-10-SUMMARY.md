---
phase: 04-catalogue-authoring-programmes-courses-modules-lessons
plan: 10
subsystem: infrastructure
tags: [docker, clamav, pg-boss, minio, malware-scanning]

requires:
  - phase: 04-07
    provides: lesson-resource upload/download routes, queue names, and audited scan-system operations
provides:
  - Shared Docker image and Compose app/worker entrypoints
  - ClamAV service with persisted signatures, health gating, and bounded memory
  - pg-boss scan consumer and five-minute lost-job reconciliation
  - Transitive worker boundary enforcement against request-only authorization APIs
affects: [04-11, 04-14, learner-file-delivery, submissions, support-attachments]

tech-stack:
  added: [multi-stage Docker image, ClamAV daemon service, pg-boss worker runtime]
  patterns: [one image with two entrypoints, narrow AsSystem worker surface, scheduled lost-job reconciliation]

key-files:
  created:
    - Dockerfile
    - .dockerignore
    - worker/index.ts
    - worker/tsconfig.json
    - worker/handlers/scan-lesson-resource.ts
    - worker/handlers/reconcile-lesson-resources.ts
    - tests/worker-handlers.test.ts
  modified:
    - docker-compose.yml
    - .env.example
    - package.json
    - package-lock.json
    - eslint.config.mjs
    - src/server/services/storage-service.ts
    - src/server/services/scan-system-service.ts
    - tests/boundary.test.ts
    - tests/lesson-resource-service.test.ts

key-decisions:
  - "Preserve the existing information-concealment contract: INFECTED and ERROR resources return an empty 404 rather than revealing their existence with 403."
  - "Verify reconciliation with an aged PENDING row that has no pg-boss job; stopping the worker before a normal upload would leave a valid queued job and would not prove lost-job recovery."
  - "Resolve scan targets through a third narrowly scoped AsSystem operation that returns only the storage key required by the worker."

patterns-established:
  - "Scanner boundary: worker code reaches persistence and object storage only through narrowly scoped server services."
  - "Failure recovery: every five minutes, the worker re-enqueues PENDING resources older than ten minutes."
  - "Container parity: app and worker use the same Dockerfile and dependency graph, with only the entry command differing."

requirements-completed: [CAT-04]

duration: 7h 8m
completed: 2026-09-03
---

# Phase 04 Plan 10: Malware Scan Runtime Summary

**A shared app/worker container stack now scans lesson resources through ClamAV, records secure verdicts, and automatically recovers lost scan jobs.**

## Performance

- **Duration:** 7h 8m elapsed, including the human approval checkpoint
- **Started:** 2026-09-03T02:34:55+01:00
- **Completed:** 2026-09-03T09:42:26+01:00
- **Tasks:** 3
- **Files modified:** 16

## Accomplishments

- Added a repeatable non-root Docker image shared by the Next.js app and the TypeScript worker, plus a complete PostgreSQL, MinIO, ClamAV, app, and worker Compose stack.
- Implemented pg-boss v12 scan and reconciliation consumers with named imports, queue creation, array job callbacks, graceful shutdown, a 120-second scan timeout, and SYSTEM audit attribution.
- Enforced the worker boundary transitively and verified clean, infected, and genuinely lost-enqueue paths against the live container stack.

## Task Commits

Each implementation task was committed atomically:

1. **Task 1: Dockerfile, ClamAV, and app/worker Compose services** - `c5ff0ee`
2. **Task 2 RED: Worker runtime contracts and handler tests** - `d63d8d0`
3. **Task 2 GREEN: pg-boss worker, scan handler, and reconciliation** - `e91b5d6`
4. **Task 3: End-to-end human verification** - approved by the developer; no production-code commit required

## Files Created/Modified

- `Dockerfile` - Multi-stage Node 22 image with a non-root runtime.
- `docker-compose.yml` - Adds the app, worker, and healthy ClamAV services and persists signatures.
- `worker/index.ts` - Starts pg-boss queues, consumers, schedule, and graceful signal handling.
- `worker/handlers/scan-lesson-resource.ts` - Streams stored objects to remote clamd and records CLEAN, INFECTED, or ERROR.
- `worker/handlers/reconcile-lesson-resources.ts` - Re-enqueues stuck PENDING resources through the shared queue service.
- `src/server/services/storage-service.ts` - Exposes a streaming object read for the worker.
- `src/server/services/scan-system-service.ts` - Adds a one-resource storage-key lookup to the audited worker-only surface.
- `tests/boundary.test.ts` - Proves the worker cannot directly or transitively reach Prisma or request-only authorization APIs.
- `tests/worker-handlers.test.ts` - Covers clean, infected, error, timeout, and reconciliation behavior.

## Decisions Made

- Kept MinIO and Cloudflare R2 selection entirely environment-driven; no storage credential is baked into the image.
- Kept infected resource rows for staff visibility while refusing their download through the existing empty-404 security contract.
- Tested the recovery mechanism with a missing job rather than merely a stopped consumer, which distinguishes reconciliation from ordinary queued-job delivery.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added the missing scan-target read surface**

- **Found during:** Task 2
- **Issue:** The planned handler had no service-layer operation that could resolve a resource ID to its object-storage key without importing Prisma directly.
- **Fix:** Added `findScanTargetAsSystem`, returning only `{ storageKey }`, plus focused service tests.
- **Files modified:** `src/server/services/scan-system-service.ts`, `tests/lesson-resource-service.test.ts`
- **Verification:** Service tests and the full 385-test suite pass; the transitive boundary test remains clean.
- **Committed in:** `e91b5d6`

**2. [Rule 3 - Blocking] Added the missing streaming object read helper**

- **Found during:** Task 2
- **Issue:** The storage service could upload and presign objects but could not stream one into clamd.
- **Fix:** Added `getLessonObject`, which returns a Node `Readable` and never deletes infected data.
- **Files modified:** `src/server/services/storage-service.ts`
- **Verification:** Worker handler tests cover scan input and verdict recording; Docker end-to-end scans passed.
- **Committed in:** `e91b5d6`

**3. [Rule 2 - Missing Critical] Added direct worker-handler tests**

- **Found during:** Task 2
- **Issue:** The plan required boundary tests but did not list behavioral unit tests for CLEAN, INFECTED, ERROR, timeout, and reconciliation outcomes.
- **Fix:** Added `tests/worker-handlers.test.ts` alongside the required boundary coverage.
- **Files modified:** `tests/worker-handlers.test.ts`
- **Verification:** All handler scenarios pass as part of the full suite.
- **Committed in:** `d63d8d0`

**4. [Rule 1 - Bug] Corrected two checkpoint expectations during verification**

- **Found during:** Task 3
- **Issue:** The checkpoint expected INFECTED downloads to return 403, contradicting the earlier information-concealment contract, and its normal-upload/worker-stop procedure did not prove reconciliation because pg-boss retains the queued job.
- **Fix:** Preserved the secure empty 404 and exercised a genuinely lost enqueue using an aged PENDING row with no queue job.
- **Files modified:** None
- **Verification:** The infected row remained present with `Eicar-Test-Signature` and was not downloadable; the abandoned row was re-enqueued by the scheduled reconciler and reached CLEAN.

---

**Total deviations:** 4 auto-resolved (3 implementation completeness/security controls, 1 verification correction).
**Impact on plan:** The changes close missing runtime interfaces and make the security and reconciliation evidence stronger without expanding the product scope.

## Issues Encountered

- Windows Defender immediately removed a host EICAR fixture, so the harmless signature was constructed and tested inside the isolated Linux stack without weakening host antivirus protection.
- The Windows Prisma schema engine produced blank local migration output; the same migrations were applied through the cached Linux application environment and completed successfully.
- Port 3000 was already occupied, so the isolated app was exposed on port 3001 without terminating the existing process.
- A raw `tsc --noEmit` initially lacked Next.js-generated `LayoutProps`. The installed Next 16 documentation specifies `next typegen && tsc --noEmit`; that sequence passed without a source change.

## User Setup Required

Production host capacity and ClamAV environment notes are recorded in [04-USER-SETUP.md](./04-USER-SETUP.md). Local Compose setup is already configured and verified.

## Verification Results

- `npm test`: 28 files, 385 tests passed.
- `npm run lint`: passed with zero errors.
- `npx next typegen` followed by `npx tsc --noEmit`: passed.
- `npx tsc --noEmit -p worker/tsconfig.json`: passed.
- `docker compose config --quiet`: passed.
- `docker build -t lms-phase4-check .`: passed.
- All 28 static Plan 04-10 acceptance assertions passed.
- Live Compose evidence: app and worker running; PostgreSQL, MinIO, and ClamAV healthy; both queues ready.
- Persisted scan rows: ordinary PDF CLEAN, EICAR INFECTED with signature detail, lost-enqueue resource recovered to CLEAN.
- Human checkpoint: approved by the developer on 2026-09-03.

## Next Phase Readiness

- Plan 04-11 can now attach its upload panel to a running scan pipeline and render the PENDING, CLEAN, INFECTED, and ERROR states.
- Plan 04-14 can rely on the download route exposing only CLEAN lesson resources.
- Production deployment must confirm the host-memory and persisted-volume items in `04-USER-SETUP.md`.

## Self-Check: PASSED

- Required Docker, worker, handler, and test files exist.
- All Task 1 and Task 2 production commits are present on the isolated branch.
- Every task acceptance criterion and plan-level verification command passed.
- The developer approved the end-to-end checkpoint.

---
*Phase: 04-catalogue-authoring-programmes-courses-modules-lessons*
*Completed: 2026-09-03*
