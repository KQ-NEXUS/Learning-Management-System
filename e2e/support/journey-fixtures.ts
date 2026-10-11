/**
 * Guarded fixture setup for the full browser journey (Phase 15, plan 15-17;
 * D-08), run once by Playwright as `globalSetup`.
 *
 * The seeded catalogue has no cohort that is open, priced for the Naira rail,
 * has a past session to mark, and carries a graded assignment, so this file
 * makes one dedicated "Journey Verification Course" with exactly those parts.
 * Everything is created through Prisma and only when missing (idempotent):
 * running it twice changes nothing but the dates, which are pushed forward so
 * the cohort stays open and the session stays inside its marking window.
 *
 * The database guard runs first, before any client is constructed, so a shell
 * that carries the shared database URL stops here with no write. The ids the
 * journey needs are written to `test-results/journey-fixtures.json` and can also
 * be read back with `loadJourneyIds()`.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { Prisma } from "@prisma/client";
import { assertSafeDatabaseUrl, type DatabaseTarget } from "../../scripts/ops/db-target-guard";
import { buildCourseObligationTree } from "../../src/server/services/publication";
import {
  DEFAULT_CERTIFICATE_TEMPLATE_NAME,
  defaultCertificateTemplateLayout,
} from "../../src/server/services/certificate-default-template-layout";
import { LOCAL_S3, applyTaskEnvToProcess } from "./server-env";

export const JOURNEY = {
  courseSlug: "journey-verification-course",
  courseTitle: "Journey Verification Course",
  cohortCode: "JOURNEY-VERIFY-2026",
  cohortTitle: "Journey Verification Cohort",
  sessionTitle: "Journey live session",
  assessmentTitle: "Journey assignment",
  textLessonOne: "Journey reading one",
  textLessonTwo: "Journey reading two",
  assignmentLesson: "Journey assignment lesson",
  /** Base price in kobo (NGN 10,000.00). The platform fee is added at checkout. */
  priceNgnMinor: 1_000_000,
  passMark: 50,
  maxScore: 100,
} as const;

export type JourneyIds = {
  courseId: string;
  cohortId: string;
  sessionId: string;
  assessmentId: string;
  lessonIds: string[];
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Staff accounts the seed creates (prisma/seed.ts); the password is the seed's development password. */
export const STAFF_LOGINS = {
  finance: { email: "finance@kqnexus.test", password: "Passw0rd!dev" },
  instructor: { email: "instructor@kqnexus.test", password: "Passw0rd!dev" },
} as const;

const FIXTURE_FILE = path.resolve(__dirname, "../../test-results/journey-fixtures.json");
/** The staging ids live in their own file, so a staging run never overwrites the local ids (plan 15-30). */
const STAGING_FIXTURE_FILE = path.resolve(__dirname, "../../test-results/journey-fixtures-staging.json");

function fixtureFile(target: DatabaseTarget): string {
  return target === "staging" ? STAGING_FIXTURE_FILE : FIXTURE_FILE;
}

export type JourneyFixtureOptions = {
  /**
   * "staging" makes the same course on the staging branch (plan 15-30). The guard
   * then needs the host in STAGING_DATABASE_HOSTS and ALLOW_STAGING_DATABASE=1.
   */
  target?: DatabaseTarget;
};

async function ensureBucket(): Promise<void> {
  const client = new S3Client({
    endpoint: LOCAL_S3.endpoint,
    region: "auto",
    forcePathStyle: true,
    credentials: { accessKeyId: LOCAL_S3.accessKeyId, secretAccessKey: LOCAL_S3.secretAccessKey },
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: LOCAL_S3.bucket }));
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    // A missing bucket is the first-run case; anything else (no server) is a setup problem.
    if (name !== "NotFound" && name !== "NoSuchBucket") {
      throw new Error(
        `Local object storage is not reachable at ${LOCAL_S3.endpoint} (${name || "unknown error"}). ` +
          "Start the throwaway MinIO container described in the plan 15-17 SUMMARY, then run again.",
      );
    }
    await client.send(new CreateBucketCommand({ Bucket: LOCAL_S3.bucket }));
  } finally {
    client.destroy();
  }
}

export async function ensureJourneyFixtures(options: JourneyFixtureOptions = {}): Promise<JourneyIds> {
  const target = options.target ?? "local";
  // Guard first. Throws (naming the host only) unless the shell URL is local, or allow-listed staging when asked for.
  assertSafeDatabaseUrl(process.env.DATABASE_URL, { target });

  // The local MinIO bucket belongs to the local server only: the deploy preview has its own storage.
  if (target === "local") await ensureBucket();

  // Construct the client only after the guard has passed.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ log: ["error"] });
  try {
    const now = Date.now();
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@kqnexus.test" } });
    const instructor = await prisma.user.findUniqueOrThrow({ where: { email: "instructor@kqnexus.test" } });

    // An active certificate template: the seed makes the default one, this only repairs a database without it.
    const template = await prisma.certificateTemplate.findFirst({
      where: { name: DEFAULT_CERTIFICATE_TEMPLATE_NAME, archivedAt: null },
    });
    if (!template) {
      await prisma.certificateTemplate.create({
        data: {
          name: DEFAULT_CERTIFICATE_TEMPLATE_NAME,
          layout: defaultCertificateTemplateLayout as unknown as Prisma.InputJsonValue,
          layoutSchemaVersion: defaultCertificateTemplateLayout.schema,
          isDefault: true,
        },
      });
    }

    // Course: automatic certificate, passing assessments required, no live edits after the pin below.
    const course = await prisma.course.upsert({
      where: { slug: JOURNEY.courseSlug },
      update: {},
      create: {
        slug: JOURNEY.courseSlug,
        title: JOURNEY.courseTitle,
        summary: "A short course used to prove the whole learner and staff journey works end to end.",
        durationHours: 2,
        status: "PUBLISHED",
        contentVersion: 1,
        publishedAt: new Date(),
        publiclyListed: true,
        publiclyListedAt: new Date(),
        certificateEnabled: true,
        certificateIssuanceMode: "AUTOMATIC",
        completionRuleVersion: 2,
        completionRule: {
          version: 2,
          requireAllRequiredLessons: true,
          requirePassingAssessments: true,
        } as Prisma.InputJsonValue,
      },
    });

    // One file-submission assignment, graded by staff.
    const assessment =
      (await prisma.assessment.findFirst({ where: { courseId: course.id, type: "ASSIGNMENT", title: JOURNEY.assessmentTitle } })) ??
      (await prisma.assessment.create({
        data: {
          courseId: course.id,
          type: "ASSIGNMENT",
          title: JOURNEY.assessmentTitle,
          instructions: "Upload a short text file describing what you learned.",
          status: "PUBLISHED",
          allowedFileTypes: [".txt"],
          maxFileSizeBytes: 1024 * 1024,
          allowResubmission: false,
          passMark: JOURNEY.passMark,
          totalMarks: JOURNEY.maxScore,
        },
      }));

    // Module 1: two reading lessons. Module 2: the assignment lesson.
    async function ensureModule(position: number, title: string) {
      return (
        (await prisma.module.findFirst({ where: { courseId: course.id, position } })) ??
        (await prisma.module.create({ data: { courseId: course.id, position, title, summary: `${title} of the journey course.` } }))
      );
    }
    const moduleOne = await ensureModule(1, "Journey module one");
    const moduleTwo = await ensureModule(2, "Journey module two");

    async function ensureLesson(moduleId: string, position: number, title: string, type: "TEXT" | "ASSIGNMENT", assessmentId: string | null) {
      return (
        (await prisma.lesson.findFirst({ where: { moduleId, position } })) ??
        (await prisma.lesson.create({
          data: {
            moduleId,
            position,
            title,
            type,
            body: type === "TEXT" ? `<p>${title}: a short reading for the journey test.</p>` : null,
            assessmentId,
            required: true,
            allowManualComplete: type === "TEXT",
          },
        }))
      );
    }
    const lessonOne = await ensureLesson(moduleOne.id, 1, JOURNEY.textLessonOne, "TEXT", null);
    const lessonTwo = await ensureLesson(moduleOne.id, 2, JOURNEY.textLessonTwo, "TEXT", null);
    const lessonThree = await ensureLesson(moduleTwo.id, 1, JOURNEY.assignmentLesson, "ASSIGNMENT", assessment.id);

    // Publish version 1: the frozen obligation tree that learners are bound to.
    const withTree = await prisma.course.findUniqueOrThrow({
      where: { id: course.id },
      include: { modules: { include: { lessons: true } } },
    });
    const payload = buildCourseObligationTree(withTree) as unknown as Prisma.InputJsonValue;
    const publication = await prisma.coursePublication.upsert({
      where: { courseId_version: { courseId: course.id, version: 1 } },
      update: { payload },
      create: { courseId: course.id, version: 1, payload, publishedById: admin.id },
    });

    // The cohort: open for a year, priced in Naira only, 50 percent attendance needed, and plenty of seats
    // because the journey adds a learner on every run. Dates move forward on every setup.
    const cohortDates = {
      startsAt: new Date(now - 7 * DAY),
      endsAt: new Date(now + 365 * DAY),
      enrolmentOpensAt: new Date(now - 30 * DAY),
      enrolmentClosesAt: new Date(now + 365 * DAY),
    };
    const cohort = await prisma.cohort.upsert({
      where: { code: JOURNEY.cohortCode },
      update: { ...cohortDates, status: "PUBLISHED", capacity: 100_000, priceNgnMinor: JOURNEY.priceNgnMinor },
      create: {
        code: JOURNEY.cohortCode,
        title: JOURNEY.cohortTitle,
        courseId: course.id,
        deliveryMode: "INSTRUCTOR_LED",
        timezone: "Africa/Lagos",
        ...cohortDates,
        capacity: 100_000,
        seatsTaken: 0,
        holdMinutes: 30,
        priceMinor: JOURNEY.priceNgnMinor,
        priceNgnMinor: JOURNEY.priceNgnMinor,
        currency: "NGN",
        status: "PUBLISHED",
        publishedAt: new Date(),
        attendanceThresholdPct: 50,
        coursePublicationId: publication.id,
      },
    });
    if (!cohort.coursePublicationId) {
      await prisma.cohort.update({ where: { id: cohort.id }, data: { coursePublicationId: publication.id } });
    }
    await prisma.cohortCourse.upsert({
      where: { cohortId_courseId: { cohortId: cohort.id, courseId: course.id } },
      update: {},
      create: { cohortId: cohort.id, courseId: course.id, position: 1, contentVersion: 1, coursePublicationId: publication.id },
    });
    await prisma.cohortInstructor.upsert({
      where: { cohortId_userId: { cohortId: cohort.id, userId: instructor.id } },
      update: {},
      create: { cohortId: cohort.id, userId: instructor.id },
    });

    // One session that started two hours ago and ended an hour ago: attendance can be marked now and the
    // 168-hour marking window is wide open.
    const sessionTimes = { startsAt: new Date(now - 2 * HOUR), endsAt: new Date(now - HOUR) };
    const existingSession = await prisma.scheduledSession.findFirst({
      where: { cohortId: cohort.id, title: JOURNEY.sessionTitle },
    });
    const session = existingSession
      ? await prisma.scheduledSession.update({ where: { id: existingSession.id }, data: sessionTimes })
      : await prisma.scheduledSession.create({
          data: {
            cohortId: cohort.id,
            title: JOURNEY.sessionTitle,
            ...sessionTimes,
            location: "Virtual",
            facilitatorId: instructor.id,
            attendanceExpected: true,
          },
        });

    const ids: JourneyIds = {
      courseId: course.id,
      cohortId: cohort.id,
      sessionId: session.id,
      assessmentId: assessment.id,
      lessonIds: [lessonOne.id, lessonTwo.id, lessonThree.id],
    };
    mkdirSync(path.dirname(fixtureFile(target)), { recursive: true });
    writeFileSync(fixtureFile(target),`${JSON.stringify(ids, null, 2)}\n`, "utf8");
    return ids;
  } finally {
    await prisma.$disconnect();
  }
}

/** Reads the ids written by the last setup. Throws if setup has not run. */
export function loadJourneyIds(target: DatabaseTarget = "local"): JourneyIds {
  return JSON.parse(readFileSync(fixtureFile(target), "utf8")) as JourneyIds;
}

/** Playwright `globalSetup` entry point. */
export default async function globalSetup(): Promise<void> {
  applyTaskEnvToProcess();
  await ensureJourneyFixtures();
}
