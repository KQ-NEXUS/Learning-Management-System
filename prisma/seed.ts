/**
 * Development seed.
 *
 * Creates the five default roles (PRD RBAC-01), staff and learner accounts,
 * a Programme of two Courses, a standalone Course, cohorts for both, lessons,
 * assessments, and scheduled sessions — enough to exercise every screen
 * without hand-entering data.
 *
 * Idempotent: every write is an upsert keyed on a stable natural key, so
 * running it twice changes nothing. Safe to re-run after a schema change.
 *
 *   npx prisma db seed
 */

import { PrismaClient, type Prisma } from "@prisma/client";
import { hashPassword } from "../src/server/auth/password";
import { PERMISSIONS } from "../src/server/permissions/catalogue";

const prisma = new PrismaClient();

const DEV_PASSWORD = "Passw0rd!dev";

// PRD §7.1 — seeded for a workable launch. Administrators may edit these
// permission sets and deactivate the roles, but never delete them.
const DEFAULT_ROLES = [
  {
    name: "Administrator",
    description:
      "Administer identities, permissions, roles, catalogue, operations, and audit evidence.",
    permissions: [...PERMISSIONS],
  },
  {
    name: "Programme Manager",
    description:
      "Coordinate programmes, courses, cohorts, enrolments, schedules, and delivery exceptions.",
    permissions: [
      "users.view",
      "programmes.view", "programmes.manage", "programmes.publish",
      "courses.view", "courses.create", "courses.edit",
      "cohorts.view", "cohorts.manage", "cohorts.publish",
      "enrolments.view", "enrolments.manage",
      "attendance.view", "attendance.manage",
      "submissions.view",
      "certificates.view",
      "reports.view",
    ],
  },
  {
    name: "Instructor",
    description: "Author and deliver assigned learning and assess learners.",
    permissions: [
      "courses.view", "courses.edit", "courses.publish",
      "cohorts.view",
      "enrolments.view",
      "attendance.view", "attendance.manage",
      "assessments.create", "assessments.edit",
      "submissions.view", "grades.manage",
      "reports.view",
    ],
  },
  {
    name: "Finance/Operations",
    description:
      "Operate payment, refund, reconciliation, and related enrolment processes.",
    permissions: [
      "users.view",
      "cohorts.view",
      "enrolments.view", "enrolments.manage",
      "payments.view", "payments.confirm", "refunds.manage",
      "reports.view", "reports.export",
    ],
  },
  {
    // Learner access flows from enrolment ownership, not from staff
    // permissions — hence an empty set rather than a set of "own record"
    // permissions that would be meaningless to scope.
    name: "Learner",
    description: "Access the learner journey and own records.",
    permissions: [] as string[],
  },
] as const;

const STAFF = [
  { email: "admin@kqnexus.test", name: "Ada Admin", role: "Administrator" },
  { email: "pm@kqnexus.test", name: "Pilar Manager", role: "Programme Manager" },
  { email: "instructor@kqnexus.test", name: "Ije Instructor", role: "Instructor" },
  { email: "finance@kqnexus.test", name: "Femi Finance", role: "Finance/Operations" },
];

const LEARNERS = [
  { email: "learner1@kqnexus.test", name: "Chidi Okafor" },
  { email: "learner2@kqnexus.test", name: "Amara Nwosu" },
  { email: "learner3@kqnexus.test", name: "Tunde Bello" },
  // Phase 5 (plan 05-11) — demo learners for the cohort/enrolment/attendance
  // screens. Clearly non-production (`@kqnexus.test`), same shape as above.
  { email: "learner4@kqnexus.test", name: "Bisi Adewale" },
  { email: "learner5@kqnexus.test", name: "Karim Yusuf" },
  { email: "learner6@kqnexus.test", name: "Ronke Bakare" },
  { email: "learner7@kqnexus.test", name: "Segun Alade" },
];

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(9, 0, 0, 0);
  return d;
}

async function main() {
  const passwordHash = await hashPassword(DEV_PASSWORD);

  // --- Roles ---------------------------------------------------------------
  const roles = new Map<string, string>();
  for (const role of DEFAULT_ROLES) {
    const saved = await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description, permissions: [...role.permissions] },
      create: {
        name: role.name,
        description: role.description,
        permissions: [...role.permissions],
        isDefault: true,
        active: true,
        version: 1,
      },
    });
    roles.set(role.name, saved.id);

    await prisma.roleVersion.upsert({
      where: { roleId_version: { roleId: saved.id, version: 1 } },
      update: {},
      create: {
        roleId: saved.id,
        version: 1,
        name: role.name,
        description: role.description,
        permissions: [...role.permissions],
        active: true,
        reason: "Seeded default role",
      },
    });
  }

  // --- People --------------------------------------------------------------
  for (const person of [...STAFF, ...LEARNERS]) {
    const isStaff = "role" in person;
    const user = await prisma.user.upsert({
      where: { email: person.email },
      update: { name: person.name },
      create: {
        email: person.email,
        name: person.name,
        passwordHash,
        emailVerified: new Date(),
        status: "ACTIVE",
        isStaff,
      },
    });

    const roleName = isStaff ? (person as { role: string }).role : "Learner";
    const roleId = roles.get(roleName)!;
    const existing = await prisma.assignment.findFirst({
      where: { userId: user.id, roleId, scopeType: "GLOBAL" },
    });
    if (!existing) {
      await prisma.assignment.create({
        data: {
          userId: user.id,
          roleId,
          scopeType: "GLOBAL",
          scopeId: null,
          active: true,
          reason: "Seeded",
        },
      });
    }
  }

  // --- Catalogue -----------------------------------------------------------
  const courseSeeds = [
    {
      slug: "workplace-safety-essentials",
      title: "Workplace Safety Essentials",
      summary: "Core hazard identification, reporting, and response for site teams.",
      durationHours: 12,
      certificateEnabled: true,
    },
    {
      slug: "incident-investigation",
      title: "Incident Investigation",
      summary: "Root-cause technique, evidence handling, and reporting standards.",
      durationHours: 16,
      certificateEnabled: false,
    },
    {
      slug: "financial-controls-masterclass",
      title: "Financial Controls Masterclass",
      summary: "A standalone one-day masterclass on operational financial controls.",
      durationHours: 8,
      certificateEnabled: true,
    },
  ];

  const courses = new Map<string, string>();
  for (const c of courseSeeds) {
    const saved = await prisma.course.upsert({
      where: { slug: c.slug },
      update: { title: c.title, summary: c.summary },
      create: {
        slug: c.slug,
        title: c.title,
        summary: c.summary,
        durationHours: c.durationHours,
        certificateEnabled: c.certificateEnabled,
        status: "PUBLISHED",
        contentVersion: 1,
        publishedAt: new Date(),
        completionRule: { requiredLessons: "all", passAssessments: true } as Prisma.InputJsonValue,
      },
    });
    courses.set(c.slug, saved.id);

    // Two modules, two lessons each.
    for (let m = 1; m <= 2; m++) {
      const existingModule = await prisma.module.findFirst({
        where: { courseId: saved.id, position: m },
      });
      const mod =
        existingModule ??
        (await prisma.module.create({
          data: {
            courseId: saved.id,
            title: `Module ${m}`,
            summary: `Part ${m} of ${c.title}.`,
            position: m,
          },
        }));

      for (let l = 1; l <= 2; l++) {
        const existingLesson = await prisma.lesson.findFirst({
          where: { moduleId: mod.id, position: l },
        });
        if (!existingLesson) {
          await prisma.lesson.create({
            data: {
              moduleId: mod.id,
              title: `Lesson ${m}.${l}`,
              position: l,
              type: l === 2 ? "VIDEO" : "TEXT",
              body:
                l === 2
                  ? null
                  : `Reading material for lesson ${m}.${l} of ${c.title}.`,
              embedUrl: l === 2 ? "https://example.com/video/placeholder" : null,
              required: true,
              allowManualComplete: true,
            },
          });
        }
      }
    }
  }

  // --- Programme -----------------------------------------------------------
  const programme = await prisma.programme.upsert({
    where: { slug: "safety-leadership-programme" },
    update: {},
    create: {
      slug: "safety-leadership-programme",
      title: "Safety Leadership Programme",
      summary: "A two-course programme for site supervisors and safety leads.",
      status: "PUBLISHED",
      sequential: true,
      certificateEnabled: true,
      publishedAt: new Date(),
      completionRule: { allCourses: true } as Prisma.InputJsonValue,
    },
  });

  const programmeCourseSlugs = ["workplace-safety-essentials", "incident-investigation"];
  for (const [i, slug] of programmeCourseSlugs.entries()) {
    await prisma.programmeCourse.upsert({
      where: {
        programmeId_courseId: {
          programmeId: programme.id,
          courseId: courses.get(slug)!,
        },
      },
      update: { position: i + 1 },
      create: {
        programmeId: programme.id,
        courseId: courses.get(slug)!,
        position: i + 1,
      },
    });
  }

  // --- Cohorts -------------------------------------------------------------
  // One programme cohort and one standalone-course cohort, which together
  // exercise the Course-XOR-Programme constraint from both sides.
  const programmeCohort = await prisma.cohort.upsert({
    where: { code: "SLP-2026-01" },
    // D-02 default — reasserted explicitly (plan 05-11) rather than left to
    // the schema `@default(30)` so a re-seed after any future default change
    // keeps this cohort on the documented value.
    update: { holdMinutes: 30 },
    create: {
      code: "SLP-2026-01",
      title: "Safety Leadership Programme — January 2026",
      programmeId: programme.id,
      deliveryMode: "BLENDED",
      timezone: "Africa/Lagos",
      startsAt: daysFromNow(14),
      endsAt: daysFromNow(70),
      enrolmentOpensAt: daysFromNow(-7),
      enrolmentClosesAt: daysFromNow(10),
      capacity: 25,
      seatsTaken: 0,
      priceMinor: 45000000, // NGN 450,000.00
      currency: "NGN",
      status: "PUBLISHED",
      attendanceThresholdPct: 75,
      publishedAt: new Date(),
    },
  });

  for (const [i, slug] of programmeCourseSlugs.entries()) {
    await prisma.cohortCourse.upsert({
      where: {
        cohortId_courseId: {
          cohortId: programmeCohort.id,
          courseId: courses.get(slug)!,
        },
      },
      update: {},
      create: {
        cohortId: programmeCohort.id,
        courseId: courses.get(slug)!,
        position: i + 1,
        contentVersion: 1,
      },
    });
  }

  const masterclassCohort = await prisma.cohort.upsert({
    where: { code: "FCM-2026-02" },
    update: { holdMinutes: 30 },
    create: {
      code: "FCM-2026-02",
      title: "Financial Controls Masterclass — February 2026",
      courseId: courses.get("financial-controls-masterclass")!,
      deliveryMode: "INSTRUCTOR_LED",
      timezone: "Africa/Lagos",
      startsAt: daysFromNow(30),
      endsAt: daysFromNow(30),
      enrolmentOpensAt: daysFromNow(-3),
      enrolmentClosesAt: daysFromNow(28),
      capacity: 40,
      seatsTaken: 0,
      priceMinor: 12500000, // NGN 125,000.00
      currency: "NGN",
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });

  await prisma.cohortCourse.upsert({
    where: {
      cohortId_courseId: {
        cohortId: masterclassCohort.id,
        courseId: courses.get("financial-controls-masterclass")!,
      },
    },
    update: {},
    create: {
      cohortId: masterclassCohort.id,
      courseId: courses.get("financial-controls-masterclass")!,
      position: 1,
      contentVersion: 1,
    },
  });

  // A third cohort of the SAME programme as `programmeCohort` (plan 05-11,
  // Task 3): `holdMinutes: 0` demonstrates the hold-less add/approve branch
  // (D-02 — a PENDING_PAYMENT enrolment here takes no seat), and sharing
  // `programmeId` with `programmeCohort` is what makes it a legal
  // `transferEnrolment` target (D-13 — same offer only). `FCM-2026-02` is
  // deliberately left with ZERO enrolments below, so it is the cohort that
  // demonstrates the roster's "No one is enrolled yet" empty state.
  const secondProgrammeCohort = await prisma.cohort.upsert({
    where: { code: "SLP-2026-03" },
    update: { holdMinutes: 0 },
    create: {
      code: "SLP-2026-03",
      title: "Safety Leadership Programme — March 2026",
      programmeId: programme.id,
      deliveryMode: "BLENDED",
      timezone: "Africa/Lagos",
      startsAt: daysFromNow(60),
      endsAt: daysFromNow(120),
      enrolmentOpensAt: daysFromNow(-2),
      enrolmentClosesAt: daysFromNow(55),
      capacity: 25,
      seatsTaken: 0,
      holdMinutes: 0,
      priceMinor: 45000000,
      currency: "NGN",
      status: "PUBLISHED",
      attendanceThresholdPct: 75,
      publishedAt: new Date(),
    },
  });

  for (const [i, slug] of programmeCourseSlugs.entries()) {
    await prisma.cohortCourse.upsert({
      where: {
        cohortId_courseId: {
          cohortId: secondProgrammeCohort.id,
          courseId: courses.get(slug)!,
        },
      },
      update: {},
      create: {
        cohortId: secondProgrammeCohort.id,
        courseId: courses.get(slug)!,
        position: i + 1,
        contentVersion: 1,
      },
    });
  }

  // --- Instructor assignment and sessions ---------------------------------
  const instructor = await prisma.user.findUniqueOrThrow({
    where: { email: "instructor@kqnexus.test" },
  });

  for (const cohort of [programmeCohort, masterclassCohort, secondProgrammeCohort]) {
    await prisma.cohortInstructor.upsert({
      where: { cohortId_userId: { cohortId: cohort.id, userId: instructor.id } },
      update: {},
      create: { cohortId: cohort.id, userId: instructor.id },
    });

    for (let s = 1; s <= 3; s++) {
      const startsAt = daysFromNow(14 + s * 7);
      const existing = await prisma.scheduledSession.findFirst({
        where: { cohortId: cohort.id, title: `Live session ${s}` },
      });
      if (!existing) {
        const endsAt = new Date(startsAt);
        endsAt.setUTCHours(endsAt.getUTCHours() + 2);
        await prisma.scheduledSession.create({
          data: {
            cohortId: cohort.id,
            title: `Live session ${s}`,
            startsAt,
            endsAt,
            location: "Virtual",
            meetingUrl: "https://meet.example.com/placeholder",
            facilitatorId: instructor.id,
            attendanceExpected: true,
          },
        });
      }
    }
  }

  // A PAST session on `programmeCohort` — the attendance-exceptions view
  // (D-19 / ATT-04) needs at least one session whose start has already
  // passed to demonstrate "missing register" (a NOT_RECORDED row) and
  // "at-risk" (below `attendanceThresholdPct` with a future session still
  // remaining). Every one of the three "Live session N" rows above is in the
  // future, so this is a genuinely new past data point, not a duplicate.
  const pastSessionStartsAt = daysFromNow(-3);
  const pastSession =
    (await prisma.scheduledSession.findFirst({
      where: { cohortId: programmeCohort.id, title: "Orientation session" },
    })) ??
    (await (async () => {
      const endsAt = new Date(pastSessionStartsAt);
      endsAt.setUTCHours(endsAt.getUTCHours() + 2);
      return prisma.scheduledSession.create({
        data: {
          cohortId: programmeCohort.id,
          title: "Orientation session",
          startsAt: pastSessionStartsAt,
          endsAt,
          location: "Virtual",
          meetingUrl: "https://meet.example.com/placeholder",
          facilitatorId: instructor.id,
          attendanceExpected: true,
        },
      });
    })());

  // --- Enrolments (COH-05) --------------------------------------------------
  // Phase 5 demo data (plan 05-11, Task 3): every Enrolment status, a live
  // and an expired seat hold, and a same-offer transfer — so the roster,
  // enrolment actions and attendance-exceptions screens all have real
  // populated and exception states to render (D-19).
  const learnerByEmail = new Map<string, string>();
  for (const email of [
    "learner1@kqnexus.test",
    "learner2@kqnexus.test",
    "learner3@kqnexus.test",
    "learner4@kqnexus.test",
    "learner5@kqnexus.test",
    "learner6@kqnexus.test",
    "learner7@kqnexus.test",
  ]) {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    learnerByEmail.set(email, user.id);
  }

  /** Creates the enrolment if none exists yet for (cohortId, userId) — the
   *  seed's idempotency guard for a model with no natural unique key beyond
   *  the partial "one ACTIVE per learner per cohort" index. */
  async function upsertDemoEnrolment(
    cohortId: string,
    userId: string,
    data: Omit<Prisma.EnrolmentUncheckedCreateInput, "cohortId" | "userId">,
  ) {
    const existing = await prisma.enrolment.findFirst({ where: { cohortId, userId } });
    if (existing) return existing;
    return prisma.enrolment.create({ data: { cohortId, userId, ...data } });
  }

  const holdFuture = new Date(Date.now() + 2 * 24 * 3_600_000);
  const holdPast = new Date(Date.now() - 1 * 24 * 3_600_000);

  const activeLearner4 = await upsertDemoEnrolment(
    programmeCohort.id,
    learnerByEmail.get("learner4@kqnexus.test")!,
    { status: "ACTIVE", activatedAt: new Date(), reason: "Corporate sponsorship" },
  );
  const atRiskLearner5 = await upsertDemoEnrolment(
    programmeCohort.id,
    learnerByEmail.get("learner5@kqnexus.test")!,
    { status: "ACTIVE", activatedAt: new Date(), reason: "Scholarship" },
  );
  const missingRegisterLearner3 = await upsertDemoEnrolment(
    programmeCohort.id,
    learnerByEmail.get("learner3@kqnexus.test")!,
    { status: "ACTIVE", activatedAt: new Date(), reason: "Self-funded" },
  );
  await upsertDemoEnrolment(
    programmeCohort.id,
    learnerByEmail.get("learner6@kqnexus.test")!,
    {
      status: "PENDING_PAYMENT",
      holdExpiresAt: holdFuture,
      reason: "Awaiting bank transfer confirmation",
    },
  );
  await upsertDemoEnrolment(
    programmeCohort.id,
    learnerByEmail.get("learner7@kqnexus.test")!,
    {
      status: "PENDING_PAYMENT",
      holdExpiresAt: holdPast,
      reason: "Awaiting bank transfer confirmation",
    },
  );
  await upsertDemoEnrolment(
    programmeCohort.id,
    learnerByEmail.get("learner1@kqnexus.test")!,
    {
      status: "WITHDRAWN",
      withdrawnAt: daysFromNow(-10),
      reason: "Relocated for work before the cohort started",
    },
  );

  // D-13: the source enrolment of a transfer is RETAINED as TRANSFERRED
  // (never deleted) — the seat it held has already been released.
  const transferSource = await upsertDemoEnrolment(
    programmeCohort.id,
    learnerByEmail.get("learner2@kqnexus.test")!,
    {
      status: "TRANSFERRED",
      reason: "Moved to the March cohort for a schedule conflict",
    },
  );
  await upsertDemoEnrolment(
    secondProgrammeCohort.id,
    learnerByEmail.get("learner2@kqnexus.test")!,
    {
      status: "ACTIVE",
      activatedAt: new Date(),
      reason: "Moved to the March cohort for a schedule conflict",
      transferredFromId: transferSource.id,
    },
  );
  // D-02: `secondProgrammeCohort.holdMinutes` is 0 — this PENDING_PAYMENT
  // enrolment takes NO seat (holdExpiresAt stays null), demonstrating the
  // hold-less add/approve branch in the UI.
  await upsertDemoEnrolment(
    secondProgrammeCohort.id,
    learnerByEmail.get("learner7@kqnexus.test")!,
    { status: "PENDING_PAYMENT", holdExpiresAt: null, reason: "Invoice raised, no hold" },
  );

  // D-02/D-04: recomputed from the actual rows on every run (never a
  // hand-maintained constant), so `seatsTaken` always equals the
  // seat-holding enrolment count — a seat is held by an ACTIVE row or a
  // PENDING_PAYMENT row whose `holdExpiresAt` is set (regardless of whether
  // that hold has since expired; the sweep worker is what clears it).
  for (const cohort of [programmeCohort, secondProgrammeCohort, masterclassCohort]) {
    const seatHolders = await prisma.enrolment.count({
      where: {
        cohortId: cohort.id,
        OR: [{ status: "ACTIVE" }, { status: "PENDING_PAYMENT", holdExpiresAt: { not: null } }],
      },
    });
    await prisma.cohort.update({
      where: { id: cohort.id },
      data: { seatsTaken: seatHolders },
    });
  }

  // --- Attendance (ATT-01..04) ----------------------------------------------
  // The three D-19 exception categories, each with at least one row, all
  // against the PAST "Orientation session" above.
  async function upsertAttendance(
    sessionId: string,
    enrolmentId: string,
    data: Omit<Prisma.AttendanceRecordUncheckedCreateInput, "sessionId" | "enrolmentId">,
  ) {
    await prisma.attendanceRecord.upsert({
      where: { sessionId_enrolmentId: { sessionId, enrolmentId } },
      update: data,
      create: { sessionId, enrolmentId, ...data },
    });
  }

  // Missing register — a PAST session left entirely NOT_RECORDED for an
  // active learner.
  await upsertAttendance(pastSession.id, missingRegisterLearner3.id, {
    state: "NOT_RECORDED",
  });

  // At-risk — below `attendanceThresholdPct: 75` with a future session
  // still remaining ("Live session 1/2/3" on programmeCohort are all ahead).
  await upsertAttendance(pastSession.id, atRiskLearner5.id, {
    state: "ABSENT",
    recordedById: instructor.id,
  });

  // Disputed/corrected — carries a non-empty correctionReason, satisfying
  // the `attendance_correction_has_reason` CHECK (plan 05-01).
  await upsertAttendance(pastSession.id, activeLearner4.id, {
    state: "ABSENT",
    recordedById: instructor.id,
    correctedById: instructor.id,
    correctedAt: new Date(),
    correctionReason: "Corrected after reviewing the sign-in sheet",
  });

  // --- Assessments ---------------------------------------------------------
  const safetyCourseId = courses.get("workplace-safety-essentials")!;

  const existingQuiz = await prisma.assessment.findFirst({
    where: { courseId: safetyCourseId, type: "QUIZ" },
  });
  if (!existingQuiz) {
    const quiz = await prisma.assessment.create({
      data: {
        courseId: safetyCourseId,
        type: "QUIZ",
        title: "Hazard identification check",
        instructions: "Answer all questions. 70% is required to pass.",
        status: "PUBLISHED",
        passMark: 70,
        totalMarks: 2,
        maxAttempts: 3,
        allowedFileTypes: [],
      },
    });
    await prisma.quizQuestion.create({
      data: {
        assessmentId: quiz.id,
        position: 1,
        prompt: "Which of these must be reported immediately?",
        type: "SINGLE_CHOICE",
        marks: 1,
        options: {
          create: [
            { position: 1, label: "A near miss with injury potential", isCorrect: true },
            { position: 2, label: "A completed toolbox talk", isCorrect: false },
            { position: 3, label: "A scheduled equipment service", isCorrect: false },
          ],
        },
      },
    });
    await prisma.quizQuestion.create({
      data: {
        assessmentId: quiz.id,
        position: 2,
        prompt: "Personal protective equipment is the first line of defence.",
        type: "TRUE_FALSE",
        marks: 1,
        options: {
          create: [
            { position: 1, label: "True", isCorrect: false },
            { position: 2, label: "False", isCorrect: true },
          ],
        },
      },
    });
  }

  const existingAssignment = await prisma.assessment.findFirst({
    where: { courseId: safetyCourseId, type: "ASSIGNMENT" },
  });
  if (!existingAssignment) {
    await prisma.assessment.create({
      data: {
        courseId: safetyCourseId,
        type: "ASSIGNMENT",
        title: "Site hazard report",
        instructions:
          "Submit a hazard report for your own site using the provided template. PDF only, 10MB maximum.",
        status: "PUBLISHED",
        dueAt: daysFromNow(45),
        allowedFileTypes: ["application/pdf"],
        maxFileSizeBytes: 10 * 1024 * 1024,
        allowResubmission: true,
        totalMarks: 100,
      },
    });
  }

  // --- Summary -------------------------------------------------------------
  const counts = {
    roles: await prisma.role.count(),
    users: await prisma.user.count(),
    assignments: await prisma.assignment.count(),
    programmes: await prisma.programme.count(),
    courses: await prisma.course.count(),
    modules: await prisma.module.count(),
    lessons: await prisma.lesson.count(),
    cohorts: await prisma.cohort.count(),
    sessions: await prisma.scheduledSession.count(),
    enrolments: await prisma.enrolment.count(),
    attendanceRecords: await prisma.attendanceRecord.count(),
    assessments: await prisma.assessment.count(),
  };

  console.log("Seed complete:");
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(14)} ${v}`);
  }
  console.log(`\n  Staff and learner password: ${DEV_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
