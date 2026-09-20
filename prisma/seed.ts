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
import { buildCourseObligationTree, buildProgrammeObligationTree } from "../src/server/services/publication";
import {
  DEFAULT_CERTIFICATE_TEMPLATE_NAME,
  defaultCertificateTemplateLayout,
} from "../src/server/services/certificate-default-template-layout";

const prisma = new PrismaClient();

const DEV_PASSWORD = "Passw0rd!dev";

// PRD §7.1 — seeded for a workable launch. Administrators may edit these
// permission sets and deactivate the roles, but never delete them.
const DEFAULT_ROLES = [
  {
    name: "Administrator",
    description:
      "Administer identities, permissions, roles, catalogue, operations, and audit evidence.",
    // certificates.manage (D-09/CRD-03 template authoring) is granted here
    // via the full PERMISSIONS spread below — Administrator is the only
    // default role that already holds certificates.issue, so it is the only
    // one that should receive certificates.manage too (11-DECISIONS.md).
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

  // --- Certificate templates -------------------------------------------
  // D-10 — a fresh deployment must have exactly one default, renderable
  // template, or the first automatic issuance has nothing to render.
  // Upsert-safe on the template name (CertificateTemplate has no unique
  // constraint to key a real Prisma `upsert` on) so re-running the seed
  // neither duplicates the row nor produces a second `isDefault: true` row.
  const existingDefaultTemplate = await prisma.certificateTemplate.findFirst({
    where: { name: DEFAULT_CERTIFICATE_TEMPLATE_NAME },
  });
  if (existingDefaultTemplate) {
    await prisma.certificateTemplate.update({
      where: { id: existingDefaultTemplate.id },
      data: {
        layout: defaultCertificateTemplateLayout as unknown as Prisma.InputJsonValue,
        layoutSchemaVersion: defaultCertificateTemplateLayout.schema,
        isDefault: true,
        archivedAt: null,
      },
    });
  } else {
    await prisma.certificateTemplate.create({
      data: {
        name: DEFAULT_CERTIFICATE_TEMPLATE_NAME,
        layout: defaultCertificateTemplateLayout as unknown as Prisma.InputJsonValue,
        layoutSchemaVersion: defaultCertificateTemplateLayout.schema,
        isDefault: true,
      },
    });
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
        completionRule: { version: 1, requireAllRequiredLessons: true } as Prisma.InputJsonValue,
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
      completionRule: { version: 1, requireAllRequiredLessons: true } as Prisma.InputJsonValue,
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
    //
    // D-25 (plan 07-02) — this is the worked-acceptance-example Cohort:
    // priceNgnMinor 45_000_000 (NGN 450,000) is the exact base price D-25's
    // Paystack fee calculation walks through. Reasserted on update, same
    // rationale as holdMinutes.
    update: { holdMinutes: 30, priceNgnMinor: 45_000_000 },
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
      priceNgnMinor: 45_000_000, // D-25 worked-example base price
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
        instructions: "Answer both questions correctly to pass.",
        status: "PUBLISHED",
        passMark: 2,
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
        allowedFileTypes: [".pdf"],
        maxFileSizeBytes: 10 * 1024 * 1024,
        allowResubmission: true,
        totalMarks: 100,
      },
    });
  }

  // --- Gateway fee schedules (Phase 7, plan 07-02, D-11) --------------------
  // Seed examples of each rail's published fee schedule -- configurable
  // commercial configuration, not hard-coded permanent truth. Keyed by the
  // provider+currency+version unique constraint, so re-seeding twice
  // upserts the same two rows rather than creating four.
  const FEE_SCHEDULE_EFFECTIVE_FROM = new Date("2026-01-01T00:00:00.000Z");

  await prisma.gatewayFeeSchedule.upsert({
    where: {
      provider_currency_version: { provider: "PAYSTACK", currency: "NGN", version: 1 },
    },
    update: {},
    create: {
      provider: "PAYSTACK",
      currency: "NGN",
      version: 1,
      // Paystack's published Nigeria local-card schedule: 1.5% + NGN 100,
      // capped at NGN 2,000 -- the exact schedule D-25's worked example
      // walks through against programmeCohort's NGN 450,000 base price.
      percentageBps: 150,
      fixedMinor: 10_000, // NGN 100.00 in kobo
      waiverThresholdMinor: 250_000, // Paystack waives the flat fee under NGN 2,500
      capMinor: 200_000, // NGN 2,000.00 cap
      taxBps: 0,
      roundingRule: "CEIL",
      effectiveFrom: FEE_SCHEDULE_EFFECTIVE_FROM,
      active: true,
    },
  });

  await prisma.gatewayFeeSchedule.upsert({
    where: {
      provider_currency_version: { provider: "STRIPE", currency: "USD", version: 1 },
    },
    update: {},
    create: {
      provider: "STRIPE",
      currency: "USD",
      version: 1,
      // Stripe's published US card schedule: 2.9% + $0.30, no waiver or cap.
      percentageBps: 290,
      fixedMinor: 30, // $0.30 in cents
      waiverThresholdMinor: null,
      capMinor: null,
      taxBps: 0,
      roundingRule: "CEIL",
      effectiveFrom: FEE_SCHEDULE_EFFECTIVE_FROM,
      active: true,
    },
  });

  // --- Learner journey (pinned course content, progress, results) -----------
  // Cohorts are published above without a course publication, so a learner would see
  // "content not available". This block publishes each course/programme, pins the cohorts to
  // those publications the way the real publish flow does, and adds enough learner activity
  // (progress, a passed quiz, a submission waiting for grading, orders, a flagged certificate,
  // near-term sessions) that every learner and staff screen has something real to show.
  {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@kqnexus.test" } });

    // Quiz and assignment lessons in the safety course, so the course has assessed steps.
    const safetyModule2 = await prisma.module.findFirstOrThrow({
      where: { courseId: safetyCourseId, position: 2 },
    });
    const quizA = await prisma.assessment.findFirstOrThrow({ where: { courseId: safetyCourseId, type: "QUIZ" } });
    const asgA = await prisma.assessment.findFirstOrThrow({ where: { courseId: safetyCourseId, type: "ASSIGNMENT" } });
    for (const [position, title, type, assessmentId] of [
      [3, "Hazard identification check", "QUIZ", quizA.id],
      [4, "Site hazard report", "ASSIGNMENT", asgA.id],
    ] as const) {
      const exists = await prisma.lesson.findFirst({ where: { moduleId: safetyModule2.id, position } });
      if (!exists) {
        await prisma.lesson.create({
          data: { moduleId: safetyModule2.id, title, position, type, assessmentId, required: true, allowManualComplete: false },
        });
      }
    }

    // A database seeded by an older version of this file can hold a legacy completion-rule shape
    // (e.g. { allCourses: true }) that the current parser rejects, and the upserts above never
    // rewrite existing rows. Put the seed-owned courses and programme on the current v1 rule so
    // the snapshots below are valid.
    const canonicalRule = { version: 1, requireAllRequiredLessons: true } as Prisma.InputJsonValue;
    await prisma.course.updateMany({ where: { id: { in: [...courses.values()] } }, data: { completionRule: canonicalRule } });
    await prisma.programme.update({ where: { id: programme.id }, data: { completionRule: canonicalRule } });

    // Publish every course and pin the cohorts / cohort-courses that use it.
    for (const courseId of courses.values()) {
      const course = await prisma.course.findUniqueOrThrow({
        where: { id: courseId },
        include: { modules: { include: { lessons: true } } },
      });
      const payload = buildCourseObligationTree(course);
      const publication = await prisma.coursePublication.upsert({
        where: { courseId_version: { courseId, version: 1 } },
        update: { payload: payload as unknown as Prisma.InputJsonValue },
        create: { courseId, version: 1, payload: payload as unknown as Prisma.InputJsonValue, publishedById: admin.id },
      });
      await prisma.cohortCourse.updateMany({
        where: { courseId, coursePublicationId: null },
        data: { coursePublicationId: publication.id },
      });
      await prisma.cohort.updateMany({
        where: { courseId, coursePublicationId: null },
        data: { coursePublicationId: publication.id },
      });
    }
    const programmeRow = await prisma.programme.findUniqueOrThrow({ where: { id: programme.id } });
    const programmeMembers = await prisma.programmeCourse.findMany({ where: { programmeId: programme.id } });
    const programmePayload = buildProgrammeObligationTree({
      status: programmeRow.status,
      sequential: programmeRow.sequential,
      completionRule: programmeRow.completionRule,
      completionRuleVersion: programmeRow.completionRuleVersion,
      courses: programmeMembers.map((m) => ({ courseId: m.courseId, position: m.position })),
    }) as unknown as Prisma.InputJsonValue;
    const programmePublication = await prisma.programmePublication.upsert({
      where: { programmeId_version: { programmeId: programme.id, version: 1 } },
      update: { payload: programmePayload },
      create: {
        programmeId: programme.id,
        version: 1,
        payload: programmePayload,
        publishedById: admin.id,
      },
    });
    await prisma.cohort.updateMany({
      where: { programmeId: programme.id, programmePublicationId: null },
      data: { programmePublicationId: programmePublication.id },
    });

    // Publicly list the demo catalogue so /courses and /programmes have something to show. The rows
    // are PUBLISHED (and published above) but `publiclyListed` defaults to false, which would leave both pages empty.
    const listedAt = new Date();
    await prisma.course.updateMany({
      where: { id: { in: [...courses.values()] }, publiclyListed: false },
      data: { publiclyListed: true, publiclyListedAt: listedAt },
    });
    await prisma.programme.updateMany({
      where: { id: programme.id, publiclyListed: false },
      data: { publiclyListed: true, publiclyListedAt: listedAt },
    });

    // The first programme cohort is mid-delivery, so the overview has learners in delivery.
    await prisma.cohort.update({ where: { id: programmeCohort.id }, data: { status: "IN_PROGRESS" } });

    // Learner 4 (Bisi) is part-way through: first four reading/video lessons done, quiz passed on attempt 2.
    const safetyLessons = await prisma.lesson.findMany({
      where: { module: { courseId: safetyCourseId } },
      orderBy: [{ module: { position: "asc" } }, { position: "asc" }],
    });
    for (const lesson of safetyLessons.filter((l) => l.type !== "QUIZ" && l.type !== "ASSIGNMENT").slice(0, 4)) {
      await prisma.lessonProgress.upsert({
        where: { enrolmentId_lessonId: { enrolmentId: activeLearner4.id, lessonId: lesson.id } },
        update: {},
        create: { enrolmentId: activeLearner4.id, lessonId: lesson.id, source: "MANUAL" },
      });
    }
    // Attempts carry the frozen question snapshot + responses, exactly as startAttempt/submitAttempt write them.
    const quizQuestions = await prisma.quizQuestion.findMany({
      where: { assessmentId: quizA.id },
      orderBy: { position: "asc" },
      include: { options: { orderBy: { position: "asc" } } },
    });
    const snapshot = quizQuestions.map((q) => ({
      id: q.id,
      position: q.position,
      prompt: q.prompt,
      type: q.type,
      marks: q.marks,
      explanation: q.explanation,
      options: q.options.map((o) => ({ id: o.id, position: o.position, label: o.label, isCorrect: o.isCorrect })),
    }));
    const correctIds = (q: (typeof quizQuestions)[number]) => q.options.filter((o) => o.isCorrect).map((o) => o.id);
    const wrongIds = (q: (typeof quizQuestions)[number]) => q.options.filter((o) => !o.isCorrect).slice(0, 1).map((o) => o.id);
    const answersFor = (attemptNumber: number) => ({
      questionSnapshot: snapshot,
      responses: quizQuestions.map((q, i) => ({
        questionId: q.id,
        selectedOptionIds: attemptNumber === 2 || i === 0 ? correctIds(q) : wrongIds(q),
      })),
      passMark: quizA.passMark,
      totalMarks: quizA.totalMarks,
    });
    for (const [attemptNumber, score, passed] of [[1, 1, false], [2, 2, true]] as const) {
      await prisma.attempt.upsert({
        where: { assessmentId_enrolmentId_attemptNumber: { assessmentId: quizA.id, enrolmentId: activeLearner4.id, attemptNumber } },
        update: { answers: answersFor(attemptNumber) as unknown as Prisma.InputJsonValue },
        create: {
          assessmentId: quizA.id,
          enrolmentId: activeLearner4.id,
          attemptNumber,
          versionUsed: 1,
          status: "SUBMITTED",
          submittedAt: daysFromNow(-4 + attemptNumber),
          answers: answersFor(attemptNumber) as unknown as Prisma.InputJsonValue,
          score,
          maxScore: 2,
          passed,
        },
      });
    }
    const finalAttempt = await prisma.attempt.findFirstOrThrow({
      where: { assessmentId: quizA.id, enrolmentId: activeLearner4.id, attemptNumber: 2 },
    });
    if (!(await prisma.grade.findFirst({ where: { attemptId: finalAttempt.id } }))) {
      await prisma.grade.create({
        data: {
          assessmentId: quizA.id,
          enrolmentId: activeLearner4.id,
          attemptId: finalAttempt.id,
          score: 2,
          maxScore: 2,
          passed: true,
          status: "RELEASED",
          gradedById: admin.id,
          releasedById: admin.id,
          releasedAt: new Date(),
        },
      });
    }

    // A submission from another learner that has been waiting four days for a grade.
    const otherActive = await prisma.enrolment.findFirst({
      where: { cohortId: programmeCohort.id, status: "ACTIVE", userId: { not: activeLearner4.userId } },
    });
    if (otherActive && !(await prisma.submission.findFirst({ where: { assessmentId: asgA.id, enrolmentId: otherActive.id } }))) {
      await prisma.submission.create({
        data: {
          assessmentId: asgA.id,
          enrolmentId: otherActive.id,
          attemptNumber: 1,
          versionUsed: 1,
          submittedAt: daysFromNow(-4),
          isLate: false,
          storageKey: `seed/site-hazard-report-${otherActive.id}.pdf`,
          filename: "site-hazard-report.pdf",
          mimeType: "application/pdf",
          sizeBytes: 182_000,
          uploadStatus: "READY",
        },
      });
    }

    // Payments: one paid this month and one needing review.
    for (const [reference, userEmail, status, key] of [
      ["ORD-SEED-0001", "learner4@kqnexus.test", "PAID", "seed-order-1"],
      ["ORD-SEED-0002", "learner6@kqnexus.test", "EXCEPTION", "seed-order-2"],
    ] as const) {
      if (await prisma.order.findFirst({ where: { reference } })) continue;
      await prisma.order.create({
        data: {
          reference,
          userId: learnerByEmail.get(userEmail)!,
          cohortId: programmeCohort.id,
          amountMinor: 18_500_000,
          currency: "NGN",
          status,
          selectedProvider: "PAYSTACK",
          baseAmountMinor: 18_500_000,
          platformFeeMinor: 277_500,
          gatewayFeeEstimateMinor: 291_700,
          idempotencyKey: key,
          paidAt: status === "PAID" ? new Date() : null,
        },
      });
    }

    // An issued certificate flagged for review, so the issued list and the overview queue show one.
    if (!(await prisma.certificate.findFirst({ where: { verificationRef: "CERT-SEED-0001" } }))) {
      await prisma.certificate.create({
        data: {
          verificationRef: "CERT-SEED-0001",
          enrolmentId: activeLearner4.id,
          userId: activeLearner4.userId,
          scope: "COURSE",
          courseId: safetyCourseId,
          awardTitle: "Workplace Safety Essentials",
          learnerName: "Bisi Adewale",
          status: "ACTIVE",
          reviewFlaggedAt: daysFromNow(-3),
        },
      });
    }

    // Sessions close to today: one coming up this week, one recent and never marked.
    for (const [title, startOffsetDays, startHour] of [
      ["Site walk-through", 2, 9],
      ["Toolbox briefing", -3, 9],
    ] as const) {
      if (await prisma.scheduledSession.findFirst({ where: { cohortId: programmeCohort.id, title } })) continue;
      const startsAt = new Date(daysFromNow(startOffsetDays));
      startsAt.setUTCHours(startHour - 1, 0, 0, 0); // Lagos is UTC+1
      await prisma.scheduledSession.create({
        data: {
          cohortId: programmeCohort.id,
          title,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3 * 3_600_000),
          location: "Ikeja",
          attendanceExpected: true,
        },
      });
    }
  }

  // --- Role showcase (admin, instructor, learner review data) --------------
  // Fills the remaining gaps so every role has something real on every page: a payment with a
  // provider transaction and a partial refund, an active and a revoked certificate, a graded
  // assignment for the main demo learner, a second certificate template, and recent audit events.
  // Every write is guarded so re-running the seed never duplicates rows.
  {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@kqnexus.test" } });
    const finance = await prisma.user.findUniqueOrThrow({ where: { email: "finance@kqnexus.test" } });
    const instructorUser = await prisma.user.findUniqueOrThrow({ where: { email: "instructor@kqnexus.test" } });
    const asg = await prisma.assessment.findFirstOrThrow({ where: { courseId: safetyCourseId, type: "ASSIGNMENT" } });

    // 1. Provider transaction for the paid order, plus a second, partly refunded order.
    const paidOrder = await prisma.order.findFirstOrThrow({ where: { reference: "ORD-SEED-0001" } });
    async function attemptFor(orderId: string, ref: string, key: string) {
      return (
        (await prisma.paymentAttempt.findFirst({ where: { orderId } })) ??
        (await prisma.paymentAttempt.create({
          data: {
            orderId,
            provider: "PAYSTACK",
            providerRef: ref,
            providerIntentId: ref,
            amountMinor: 18_500_000,
            currency: "NGN",
            status: "SUCCEEDED",
            idempotencyKey: key,
            confirmedAt: new Date(),
            gatewayFeeActualMinor: 291_700,
            schoolSettlementActualMinor: 18_500_000,
            platformGrossActualMinor: 277_500,
            platformNetActualMinor: 0,
            reconciledAt: new Date(),
          },
        }))
      );
    }
    await attemptFor(paidOrder.id, "PSK-SEED-0001", "seed-attempt-1");

    if (!(await prisma.order.findFirst({ where: { reference: "ORD-SEED-0003" } }))) {
      const refundedOrder = await prisma.order.create({
        data: {
          reference: "ORD-SEED-0003",
          userId: learnerByEmail.get("learner1@kqnexus.test")!,
          cohortId: programmeCohort.id,
          amountMinor: 18_500_000,
          currency: "NGN",
          status: "PARTIALLY_REFUNDED",
          selectedProvider: "PAYSTACK",
          baseAmountMinor: 18_500_000,
          platformFeeMinor: 277_500,
          gatewayFeeEstimateMinor: 291_700,
          idempotencyKey: "seed-order-3",
          paidAt: daysFromNow(-6),
        },
      });
      const attempt = await attemptFor(refundedOrder.id, "PSK-SEED-0003", "seed-attempt-3");
      await prisma.refund.create({
        data: {
          orderId: refundedOrder.id,
          paymentAttemptId: attempt.id,
          amountMinor: 5_000_000,
          currency: "NGN",
          provider: "PAYSTACK",
          providerRef: "PSK-RF-SEED-0003",
          reason: "Partial refund - learner missed the first fortnight",
          accessDecision: "RETAINED",
          status: "COMPLETED",
          actorId: finance.id,
          completedAt: daysFromNow(-2),
          baseComponentMinor: 5_000_000,
          platformComponentMinor: 0,
          gatewayComponentMinor: 0,
        },
      });
    }

    // 2. Certificates: one active, one revoked (the flagged one is added above).
    const enrolmentOf = async (email: string) =>
      prisma.enrolment.findFirst({ where: { userId: learnerByEmail.get(email)! } });
    for (const [ref, email, title, name, status] of [
      ["CERT-SEED-0002", "learner1@kqnexus.test", "Workplace Safety Essentials", "Chidi Okafor", "ACTIVE"],
      ["CERT-SEED-0003", "learner2@kqnexus.test", "Incident Investigation", "Amara Nwosu", "REVOKED"],
    ] as const) {
      if (await prisma.certificate.findFirst({ where: { verificationRef: ref } })) continue;
      const enrolment = await enrolmentOf(email);
      if (!enrolment) continue;
      await prisma.certificate.create({
        data: {
          verificationRef: ref,
          enrolmentId: enrolment.id,
          userId: enrolment.userId,
          scope: "COURSE",
          courseId: title === "Workplace Safety Essentials" ? safetyCourseId : courses.get("incident-investigation") ?? safetyCourseId,
          awardTitle: title,
          learnerName: name,
          issuedAt: daysFromNow(-10),
          status,
          ...(status === "REVOKED"
            ? {
                revokedAt: daysFromNow(-1),
                revokedById: admin.id,
                revocationReason: "Attendance record corrected below the required threshold",
              }
            : {}),
        },
      });
    }

    // 3. A graded, released assignment for the main demo learner.
    if (!(await prisma.submission.findFirst({ where: { assessmentId: asg.id, enrolmentId: activeLearner4.id } }))) {
      const submission = await prisma.submission.create({
        data: {
          assessmentId: asg.id,
          enrolmentId: activeLearner4.id,
          attemptNumber: 1,
          versionUsed: 1,
          submittedAt: daysFromNow(-6),
          isLate: false,
          storageKey: `seed/site-hazard-report-${activeLearner4.id}.pdf`,
          filename: "hazard-report-bisi.pdf",
          mimeType: "application/pdf",
          sizeBytes: 241_000,
          uploadStatus: "READY",
        },
      });
      await prisma.grade.create({
        data: {
          assessmentId: asg.id,
          enrolmentId: activeLearner4.id,
          submissionId: submission.id,
          score: 78,
          maxScore: 100,
          passed: true,
          feedback: "Clear hazard register and sensible controls. Tighten the escalation steps for the loading bay.",
          status: "RELEASED",
          gradedById: instructorUser.id,
          releasedById: instructorUser.id,
          releasedAt: daysFromNow(-4),
        },
      });
    }

    // 4. A second certificate template (not default) so the templates list has more than one row.
    if (!(await prisma.certificateTemplate.findFirst({ where: { name: "Programme completion" } }))) {
      await prisma.certificateTemplate.create({
        data: {
          name: "Programme completion",
          layout: defaultCertificateTemplateLayout as unknown as Prisma.InputJsonValue,
          layoutSchemaVersion: defaultCertificateTemplateLayout.schema,
          isDefault: false,
        },
      });
    }

    // 5. Recent audit history so the audit log reads like real use.
    if (!(await prisma.auditEvent.findFirst({ where: { correlationId: "seed-showcase" } }))) {
      const events = [
        { actorId: admin.id, action: "cohort.published", targetType: "Cohort", targetId: programmeCohort.id, daysAgo: 12 },
        { actorId: admin.id, action: "cohort.instructor_assigned", targetType: "Cohort", targetId: programmeCohort.id, daysAgo: 11 },
        { actorId: finance.id, action: "payment.manual_confirmed", targetType: "Order", targetId: paidOrder.id, daysAgo: 7, reason: "Bank transfer confirmed" },
        { actorId: instructorUser.id, action: "grade.released", targetType: "Assessment", targetId: asg.id, daysAgo: 4 },
        { actorId: finance.id, action: "refund.recorded", targetType: "Order", targetId: paidOrder.id, daysAgo: 2, reason: "Partial refund - learner missed the first fortnight" },
        { actorId: admin.id, action: "certificate.revoked", targetType: "Certificate", targetId: null, daysAgo: 1, reason: "Attendance record corrected below the required threshold" },
      ];
      for (const e of events) {
        await prisma.auditEvent.create({
          data: {
            actorId: e.actorId,
            action: e.action,
            targetType: e.targetType,
            targetId: e.targetId,
            reason: e.reason ?? null,
            outcome: "SUCCESS",
            correlationId: "seed-showcase",
            createdAt: daysFromNow(-e.daysAgo),
          },
        });
      }
    }
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
    gatewayFeeSchedules: await prisma.gatewayFeeSchedule.count(),
    certificateTemplates: await prisma.certificateTemplate.count(),
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
