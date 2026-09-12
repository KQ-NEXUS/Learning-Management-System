---
status: issues
phase: "05"
phase_name: "Cohorts, Scheduling, Enrolment Operations & Attendance"
reviewed: 2026-09-08T00:00:00Z
depth: standard
files_reviewed: 141
findings:
  critical: 3
  warning: 0
  info: 0
  total: 3
---

# Phase 05: Code Review Report

**Reviewed:** 2026-09-08T00:00:00Z
**Depth:** standard
**Files Reviewed:** 141
**Status:** issues

## Summary

Reviewed the Phase 5 cohort, scheduling, enrolment, attendance, schema, worker, route/action, and test changes at standard depth. The implementation contains three blocking correctness/data-integrity issues in server-side mutation paths: attendance can be written for non-markable rows, cohort publish can use stale readiness evidence, and transfers can race against mutable target cohort offers.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Attendance mutations accept cancelled/transferred enrolments and cancelled sessions

**File:** `src/server/services/attendance-service.ts:432`

**Issue:** `markAttendance` validates only that the submitted enrolment belongs to the session's cohort (`enrolment.cohortId !== session.cohortId`) and never checks `enrolment.status` or `session.cancelledAt`. `saveSessionAttendance` has the same status gap: it builds `rosterIds` from every enrolment in the cohort with no `status` filter at lines 501-504. The read side explicitly excludes `TRANSFERRED` and `CANCELLED` rows via `OFF_ROSTER_STATUSES` at lines 604-609, but a direct Server Action POST can still submit those hidden enrolment ids and create/update `AttendanceRecord` rows for learners who are no longer on the roster. Because `SessionRow.cancelledAt` is loaded but never used in the mutation guards, attendance can also be marked for a cancelled session.

**Fix:**

```ts
const MARKABLE_STATUSES = ["PENDING_PAYMENT", "ACTIVE", "COMPLETED", "WITHDRAWN"] as const;

if (session.cancelledAt !== null) {
  throw new SessionNotFoundError(input.sessionId); // or a dedicated SessionCancelledError
}

if (
  !enrolment ||
  enrolment.cohortId !== session.cohortId ||
  OFF_ROSTER_STATUSES.includes(enrolment.status as (typeof OFF_ROSTER_STATUSES)[number])
) {
  throw new LearnerNotOnRosterError(input.sessionId, input.enrolmentId);
}

const roster = await deps.enrolment.findMany({
  where: {
    cohortId: session.cohortId,
    status: { notIn: OFF_ROSTER_STATUSES },
  },
});
```

Add service tests proving both single and bulk mutation paths reject `TRANSFERRED`/`CANCELLED` enrolments and cancelled sessions before any attendance row, event, or audit is written.

### CR-02: Cohort publish can pass on stale readiness after sessions or instructors change

**File:** `src/server/services/cohort-service.ts:673`

**Issue:** `publishCohort` loads the readiness aggregate and evaluates blocking failures before opening the transaction at lines 673-686. Inside the transaction it only checks `Cohort.updatedAt` and status at lines 692-705. Readiness-critical writes in this phase do not necessarily change `Cohort.updatedAt`: `assignCohortInstructor`/`removeCohortInstructor` mutate only `CohortInstructor` at lines 598-604 and 629-636, and session creation/cancellation in `scheduled-session-service.ts` mutates only `ScheduledSession` at lines 423-435 and 531-545. A cohort can therefore pass readiness with one instructor/session, then lose that instructor or have its only session cancelled before the transaction claims the cohort row; `updatedAt` remains unchanged, so publish succeeds and records a published cohort that fails the server-side readiness rules.

**Fix:**

```ts
await deps.db.$transaction(async (tx) => {
  const fresh = await loadAggregateRowForTx(tx, input.cohortId);
  if (!fresh) throw new CohortNotFoundError(input.cohortId);
  assertCohortOpen(input.cohortId, fresh.status);

  const freshAggregate = toReadinessInput(fresh);
  const failures = blockingFailures(evaluateCohortReadiness(freshAggregate));
  if (failures.length > 0) throw new CohortReadinessRefusedError(failures);

  const claimed = await tx.cohort.updateMany({
    where: { id: input.cohortId, updatedAt: input.expectedUpdatedAt, status: { in: ["DRAFT", "PUBLISHED", "IN_PROGRESS"] } },
    data: { status: PUBLISHED_STATUS, publishedAt, [pinColumn]: freshAggregate.pin!.publicationId },
  });
  if (claimed.count === 0) throw new StaleOrderError();
  await writeDomainEvent(tx, { type: "cohort.published", payload: { cohortId: input.cohortId, publicationId: freshAggregate.pin!.publicationId, actorId: ctx.actor.userId } });
});
```

Alternatively, every readiness-affecting write must also bump the parent cohort's `updatedAt`, but the publish path should still re-read the readiness aggregate in the same transaction that publishes.

### CR-03: Transfer same-offer validation races against target cohort offer changes

**File:** `src/server/services/enrolment-service.ts:565`

**Issue:** `transferEnrolment` checks source/target offer compatibility before the transaction at lines 565-583, then the transaction re-reads only the source enrolment at lines 585-591 and calls `takeSeat` on the target at lines 605-616. `takeSeat` locks the target cohort row for capacity/status but does not re-check `courseId`/`programmeId`. If the target cohort has no enrolments yet, its offer is still mutable; a concurrent cohort edit can change that target from the checked offer to a different course/programme between the pre-transaction compatibility check and the target row lock. The transfer then creates an ACTIVE enrolment in a cross-offer cohort, violating the stated D-13 same-offer invariant.

**Fix:**

```ts
const result = await db.$transaction(async (tx) => {
  const e = await tx.enrolment.findUnique({ where: { id: input.enrolmentId } });
  if (!e) throw new EnrolmentNotFoundError(input.enrolmentId);

  const sourceCohort = await lockCohortWithOffer(tx, e.cohortId);
  const targetCohort = await lockCohortWithOffer(tx, input.targetCohortId);
  assertSameOffer(sourceCohort, targetCohort, e.cohortId, input.targetCohortId);

  assertTransition(e.status as EnrolmentStatusValue, "TRANSFERRED", e.id);
  await releaseSeat(tx, { cohortId: e.cohortId, enrolmentId: e.id, toStatus: "TRANSFERRED", reason, heldSeat: holdsSeat(e), expected: { status: e.status, holdExpiresAt: e.holdExpiresAt } });
  const created = await takeSeat(tx, { cohortId: input.targetCohortId, enrolment: { userId: e.userId, cohortId: input.targetCohortId, status: "ACTIVE", activatedAt: now(), reason, transferredFromId: e.id, orderId: null } });
  return { sourceId: e.id, targetId: created.id, before: e.status };
});
```

The target offer must be locked and validated inside the same transaction that releases the source seat and creates the target enrolment.

---

_Reviewed: 2026-09-08T00:00:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
