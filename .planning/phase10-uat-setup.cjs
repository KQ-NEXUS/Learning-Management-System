// Isolated local walkthrough fixture; credentials are read without logging them.
const { execFileSync } = require('node:child_process');
const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd());
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const environment = (name) => Object.fromEntries(
  JSON.parse(docker('inspect', name))[0].Config.Env.map(entry => {
    const split = entry.indexOf('='); return [entry.slice(0, split), entry.slice(split + 1)];
  }),
);
const pg = environment('learning-management-system-postgres-1');
const minio = environment('learning-management-system-minio-1');
const database = 'lms_phase10_uat';
const exists = docker('exec', 'learning-management-system-postgres-1', 'psql',
  '-U', pg.POSTGRES_USER, '-d', 'postgres', '-Atc',
  "SELECT 1 FROM pg_database WHERE datname = 'lms_phase10_uat'");
if (!exists) docker('exec', 'learning-management-system-postgres-1', 'createdb', '-U', pg.POSTGRES_USER, database);
const env = { ...process.env,
  DATABASE_URL: `postgresql://${encodeURIComponent(pg.POSTGRES_USER)}:${encodeURIComponent(pg.POSTGRES_PASSWORD)}@localhost:5433/${database}?schema=public`,
  S3_ENDPOINT: 'http://localhost:9002', S3_PUBLIC_ENDPOINT: 'http://localhost:9002',
  S3_ACCESS_KEY_ID: minio.MINIO_ROOT_USER, S3_SECRET_ACCESS_KEY: minio.MINIO_ROOT_PASSWORD,
  S3_FORCE_PATH_STYLE: 'true',
};
if (process.argv.includes('--activate-batch')) {
  Object.assign(process.env, env);
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  (async () => {
    const completionRule = { version: 1, requireAllRequiredLessons: true };
    const result = await db.user.updateMany({ where: { email: { startsWith: 'phase10-batch-', endsWith: '@kqnexus.test' } },
      data: { status: 'ACTIVE', emailVerified: new Date() } });
    await db.assessment.updateMany({ where: { type: 'ASSIGNMENT', title: 'Site hazard report' },
      data: { allowedFileTypes: ['.pdf'] } });
    await db.course.updateMany({ data: { completionRule } });
    await db.programme.updateMany({ data: { completionRule } });
    const repairPublications = async (model) => {
      let repaired = 0;
      for (const publication of await model.findMany({ select: { id: true, payload: true } })) {
        if (!publication.payload || typeof publication.payload !== 'object' || Array.isArray(publication.payload)) continue;
        await model.update({ where: { id: publication.id }, data: { payload: { ...publication.payload, completionRule } } });
        repaired += 1;
      }
      return repaired;
    };
    const repairedCoursePublications = await repairPublications(db.coursePublication);
    const repairedProgrammePublications = await repairPublications(db.programmePublication);
    console.log(JSON.stringify({ activatedLocalBatchUsers: result.count, repairedAssignmentExtension: '.pdf',
      repairedCoursePublications, repairedProgrammePublications }));
  })().finally(() => db.$disconnect());
} else if (process.argv.includes('--verify')) {
  Object.assign(process.env, env);
  require('tsx/cjs');
  const { prisma } = require('../src/server/db.ts');
  const { loadLearnerPath, assertLessonOpenable } = require('../src/server/services/learner-access.ts');
  const { getOwnAssignmentView } = require('../src/server/services/submission-service.ts');
  (async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'learner4@kqnexus.test' } });
    const actor = { userId: user.id, roles: [] };
    const enrolment = await prisma.enrolment.findFirstOrThrow({ where: { userId: user.id, status: 'ACTIVE' } });
    const path = await loadLearnerPath(actor, enrolment.id);
    const lessons = path?.courses.flatMap(course => course.modules.flatMap(module => module.lessons)) || [];
    for (const type of ['QUIZ', 'ASSIGNMENT']) {
      const lesson = lessons.find(lesson => lesson.type === type);
      if (!lesson || !assertLessonOpenable(path, lesson.id).ok) throw new Error(`${type} lesson is not reachable in the local fixture`);
    }
    const assignment = await prisma.assessment.findFirstOrThrow({ where: { type: 'ASSIGNMENT' } });
    if (!await getOwnAssignmentView(actor, { assessmentId: assignment.id, enrolmentId: enrolment.id })) throw new Error('Assignment view unavailable');
    console.log('Local quiz and assignment lessons are open; owner-scoped assignment view exists.');
    console.log('Local draft grade count:', await prisma.grade.count({ where: { status: 'DRAFT' } }));
  })().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
} else if (process.argv.includes('--dev')) {
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--port', '3000'], { env, stdio: 'inherit' });
  child.on('exit', code => process.exit(code || 0));
} else {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env, stdio: 'inherit' });
  execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'prisma/seed.ts'], { env, stdio: 'inherit' });
  Object.assign(process.env, env);
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  (async () => {
    const quiz = await db.assessment.findFirstOrThrow({ where: { type: 'QUIZ' }, include: { questions: true } });
    if (!quiz.questions.some(question => question.type === 'MULTI_CHOICE')) {
      await db.quizQuestion.create({ data: { assessmentId: quiz.id, position: 3, type: 'MULTI_CHOICE',
        prompt: 'Which two actions reduce site hazards?', marks: 1, options: { create: [
          { position: 1, label: 'Report near misses promptly', isCorrect: true },
          { position: 2, label: 'Keep evacuation routes clear', isCorrect: true },
          { position: 3, label: 'Ignore damaged equipment until the next inspection', isCorrect: false },
        ] } } });
      await db.assessment.update({ where: { id: quiz.id }, data: { totalMarks: 3 } });
    }
    const assignment = await db.assessment.findFirstOrThrow({ where: { type: 'ASSIGNMENT' } });
    // Due dates are deliberately past while the hard cutoff remains open.
    await db.assessment.update({ where: { id: assignment.id }, data: { dueAt: new Date(Date.now() - 86400000), availableUntil: null } });
    const module = await db.module.findFirstOrThrow({ where: { courseId: quiz.courseId }, orderBy: { position: 'asc' } });
    const ensureLesson = async (type, title, assessmentId) => {
      const existing = await db.lesson.findFirst({ where: { module: { courseId: quiz.courseId }, type } });
      if (existing) return existing;
      const last = await db.lesson.aggregate({ where: { moduleId: module.id }, _max: { position: true } });
      return db.lesson.create({ data: { moduleId: module.id, position: (last._max.position ?? 0) + 1,
        type, title, assessmentId, required: false } });
    };
    const lesson = await ensureLesson('QUIZ', 'Phase 10 quiz walkthrough', quiz.id);
    const assignmentLesson = await ensureLesson('ASSIGNMENT', 'Phase 10 assignment walkthrough', assignment.id);
    if (lesson) await db.lesson.update({ where: { id: lesson.id }, data: { assessmentId: quiz.id } });
    if (assignmentLesson) await db.lesson.update({ where: { id: assignmentLesson.id }, data: { assessmentId: assignment.id } });
    await db.lesson.updateMany({ data: { required: false } });
    await db.cohort.updateMany({ data: { startsAt: new Date(Date.now() - 86400000),
      endsAt: new Date(Date.now() + 90 * 86400000), capacity: 100 } });
    // The general seed predates pinned publications. Build real obligation
    // payloads for this isolated database so learner routes are reachable.
    require('tsx/cjs');
    const { buildCourseObligationTree, buildProgrammeObligationTree } = require('../src/server/services/publication.ts');
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@kqnexus.test' } });
    for (const course of await db.course.findMany({ include: { modules: { include: { lessons: true } } } })) {
      let publication = await db.coursePublication.findFirst({ where: { courseId: course.id }, orderBy: { version: 'desc' } });
      const payload = buildCourseObligationTree(course);
      if (!publication || !require('node:util').isDeepStrictEqual(publication.payload, payload)) {
        publication = await db.coursePublication.create({ data: { courseId: course.id, version: (publication?.version ?? 0) + 1,
          publishedById: admin.id, reason: 'Isolated Phase 10 walkthrough fixture', payload } });
      }
      await db.cohortCourse.updateMany({ where: { courseId: course.id }, data: { coursePublicationId: publication.id } });
      await db.cohort.updateMany({ where: { courseId: course.id }, data: { coursePublicationId: publication.id } });
    }
    for (const programme of await db.programme.findMany({ include: { courses: true } })) {
      let publication = await db.programmePublication.findFirst({ where: { programmeId: programme.id }, orderBy: { version: 'desc' } });
      if (!publication) publication = await db.programmePublication.create({ data: { programmeId: programme.id, version: 1,
        publishedById: admin.id, reason: 'Isolated Phase 10 walkthrough fixture', payload: buildProgrammeObligationTree(programme) } });
      await db.cohort.updateMany({ where: { programmeId: programme.id }, data: { programmePublicationId: publication.id } });
    }
    const batchCohort = await db.cohort.findFirstOrThrow({ where: { cohortCourses: { some: { courseId: quiz.courseId } } }, orderBy: { code: 'asc' } });
    const { S3Client, PutObjectCommand, HeadBucketCommand, CreateBucketCommand } = require('@aws-sdk/client-s3');
    const storage = new S3Client({ endpoint: env.S3_ENDPOINT, region: env.S3_REGION || 'us-east-1', forcePathStyle: true,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } });
    const bucket = env.S3_BUCKET || 'lms-private';
    try { await storage.send(new HeadBucketCommand({ Bucket: bucket })); }
    catch (error) { if (error.$metadata?.httpStatusCode !== 404) throw error; await storage.send(new CreateBucketCommand({ Bucket: bucket })); }
    const body = Buffer.from('%PDF-1.4\n% Phase 10 local batch fixture\n%%EOF\n');
    for (let index = 1; index <= 20; index++) {
      const user = await db.user.upsert({ where: { email: `phase10-batch-${index}@kqnexus.test` }, update: { status: 'ACTIVE' },
        create: { email: `phase10-batch-${index}@kqnexus.test`, name: `Batch learner ${index}`, passwordHash: admin.passwordHash, status: 'ACTIVE', emailVerified: new Date() } });
      let enrolment = await db.enrolment.findFirst({ where: { cohortId: batchCohort.id, userId: user.id } });
      if (!enrolment) enrolment = await db.enrolment.create({ data: { cohortId: batchCohort.id, userId: user.id, status: 'ACTIVE', activatedAt: new Date(), reason: 'Local batch walkthrough fixture' } });
      let submission = await db.submission.findFirst({ where: { assessmentId: assignment.id, enrolmentId: enrolment.id } });
      if (!submission) {
        const key = `submissions/${enrolment.id}/${assignment.id}/phase10-fixture`;
        await storage.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'application/pdf' }));
        submission = await db.submission.create({ data: { assessmentId: assignment.id, enrolmentId: enrolment.id, versionUsed: assignment.version,
          storageKey: key, filename: 'walkthrough.pdf', mimeType: 'application/pdf', sizeBytes: body.length, uploadStatus: 'READY', isLate: true } });
      }
      if (!await db.grade.findFirst({ where: { submissionId: submission.id } })) await db.grade.create({ data: {
        assessmentId: assignment.id, enrolmentId: enrolment.id, submissionId: submission.id,
        score: 75, maxScore: 100, feedback: 'Local draft batch fixture.', status: 'DRAFT', gradedById: admin.id } });
    }
    await db.cohort.update({ where: { id: batchCohort.id }, data: { seatsTaken: await db.enrolment.count({ where: {
      cohortId: batchCohort.id, OR: [{ status: 'ACTIVE' }, { status: 'PENDING_PAYMENT', holdExpiresAt: { not: null } }] } }) } });
    const cohorts = await db.cohort.findMany({ where: { OR: [{ courseId: quiz.courseId }, { cohortCourses: { some: { courseId: quiz.courseId } } }] }, include: { enrolments: { where: { status: 'ACTIVE' }, include: { user: { select: { email: true } } } } } });
    console.log(JSON.stringify({ database, quizId: quiz.id, assignmentId: assignment.id, courseId: quiz.courseId,
      quizLessonId: lesson?.id, assignmentLessonId: assignmentLesson?.id,
      cohorts: cohorts.map(c => ({ id: c.id, learners: c.enrolments.map(e => ({ id: e.id, email: e.user.email })) })) }, null, 2));
  })().finally(() => db.$disconnect());
}
