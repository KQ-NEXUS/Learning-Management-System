/**
 * Shared Phase-5 test fixtures (plan 05-01, Task 3).
 *
 * Every DB-dependent Phase-5 plan — seat accounting, the hold sweep, the
 * enrolment state machine, attendance marking/correction — needs to seed a
 * cohort, a learner, a session, an enrolment and an attendance record against
 * a real Postgres (the `tests/support/pg.ts` Testcontainers harness). This
 * module is the single place that shape lives so those plans do not each
 * re-invent it and drift apart.
 *
 * Each helper:
 *   - takes a live `PrismaClient` (from `startTestDatabase()`),
 *   - creates any missing parent rows (owning User / Course) so a caller can
 *     seed a whole graph with one call,
 *   - suffixes every unique column (code / slug / email / title) with a
 *     process-wide counter so repeated calls inside one container never
 *     collide with a unique index,
 *   - returns the ids the next helper needs.
 *
 * ESLint boundary note: this file is under `tests/`, so the
 * `no-restricted-imports` rule that confines `@prisma/client` to
 * `src/server/**` does not match it — importing `PrismaClient` here is
 * intentional (same rationale as `tests/support/pg.ts`).
 */

import type { PrismaClient } from "@prisma/client";

type Overrides = Record<string, unknown>;

let counter = 0;
/** Process-wide unique suffix so repeated seeds don't hit a unique index. */
function uniq(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

const DAY_MS = 86_400_000;

export type CohortFixture = {
  cohortId: string;
  courseId: string;
};

/**
 * A coherent, publishable-shaped cohort pinned to a standalone Course.
 * Dates satisfy the pre-existing `cohort_dates_ordered` CHECK
 * (`startsAt <= endsAt`, `enrolmentOpensAt <= enrolmentClosesAt`) and the
 * XOR CHECK (`courseId` set, `programmeId` null).
 *
 * Pass `overrides` to change any `Cohort` column (e.g. `{ capacity: 2 }`,
 * `{ holdMinutes: null }`, `{ deliveryMode: "SELF_PACED" }`). Pass
 * `overrides.courseId` to pin to an existing Course instead of creating one.
 */
export async function seedCohortFixture(
  prisma: PrismaClient,
  overrides: Overrides = {},
): Promise<CohortFixture> {
  const { courseId: courseIdOverride, ...cohortOverrides } = overrides as {
    courseId?: string;
  } & Overrides;

  const courseId =
    courseIdOverride ??
    (
      await prisma.course.create({
        data: { slug: uniq("cohort-fixture-course"), title: "Cohort Fixture Course" },
        select: { id: true },
      })
    ).id;

  const now = Date.now();
  const cohort = await prisma.cohort.create({
    data: {
      code: uniq("COH"),
      title: "Cohort Fixture",
      courseId,
      deliveryMode: "INSTRUCTOR_LED",
      timezone: "Africa/Lagos",
      startsAt: new Date(now + 7 * DAY_MS),
      endsAt: new Date(now + 30 * DAY_MS),
      enrolmentOpensAt: new Date(now - 7 * DAY_MS),
      enrolmentClosesAt: new Date(now + 5 * DAY_MS),
      capacity: 1,
      seatsTaken: 0,
      priceMinor: 0,
      currency: "NGN",
      holdMinutes: 30,
      ...cohortOverrides,
    },
    select: { id: true },
  });

  return { cohortId: cohort.id, courseId };
}

export type LearnerFixture = { userId: string };

/** A learner User with a unique email. */
export async function seedLearnerFixture(
  prisma: PrismaClient,
  overrides: Overrides = {},
): Promise<LearnerFixture> {
  const user = await prisma.user.create({
    data: {
      email: `${uniq("learner")}@fixture.test`,
      name: "Fixture Learner",
      status: "ACTIVE",
      ...overrides,
    },
    select: { id: true },
  });
  return { userId: user.id };
}

export type SessionFixture = { sessionId: string };

/**
 * A scheduled session for `cohortId`. Defaults to a 2-hour slot starting one
 * day from now; override `startsAt` / `endsAt` for marking-window tests.
 */
export async function seedSessionFixture(
  prisma: PrismaClient,
  args: { cohortId: string } & Overrides,
): Promise<SessionFixture> {
  const { cohortId, ...overrides } = args;
  const now = Date.now();
  const session = await prisma.scheduledSession.create({
    data: {
      cohortId,
      title: uniq("Session"),
      startsAt: new Date(now + 1 * DAY_MS),
      endsAt: new Date(now + 1 * DAY_MS + 2 * 3_600_000),
      ...overrides,
    },
    select: { id: true },
  });
  return { sessionId: session.id };
}

export type EnrolmentFixture = { enrolmentId: string; userId: string };

/**
 * An enrolment in `cohortId`. Creates a learner when `userId` is absent.
 * `status` defaults to `ACTIVE`; pass `holdExpiresAt` (with
 * `status: "PENDING_PAYMENT"`) to model a live seat hold.
 */
export async function seedEnrolmentFixture(
  prisma: PrismaClient,
  args: {
    cohortId: string;
    userId?: string;
    status?: string;
    holdExpiresAt?: Date | null;
  } & Overrides,
): Promise<EnrolmentFixture> {
  const { cohortId, userId: userIdArg, status = "ACTIVE", holdExpiresAt, ...overrides } = args;
  const userId = userIdArg ?? (await seedLearnerFixture(prisma)).userId;

  const enrolment = await prisma.enrolment.create({
    data: {
      cohortId,
      userId,
      status: status as never,
      ...(holdExpiresAt !== undefined ? { holdExpiresAt } : {}),
      ...overrides,
    },
    select: { id: true },
  });
  return { enrolmentId: enrolment.id, userId };
}

export type AttendanceFixture = { attendanceId: string };

/**
 * An attendance record for (`sessionId`, `enrolmentId`). `state` defaults to
 * `NOT_RECORDED`.
 */
export async function seedAttendanceFixture(
  prisma: PrismaClient,
  args: {
    sessionId: string;
    enrolmentId: string;
    state?: string;
  } & Overrides,
): Promise<AttendanceFixture> {
  const { sessionId, enrolmentId, state = "NOT_RECORDED", ...overrides } = args;
  const record = await prisma.attendanceRecord.create({
    data: {
      sessionId,
      enrolmentId,
      state: state as never,
      ...overrides,
    },
    select: { id: true },
  });
  return { attendanceId: record.id };
}
