/**
 * Real-PostgreSQL proof for caption AUTHORING (NFR-09, plan 15-24).
 *
 * Plan 15-23 made captions storable, deliverable and playable
 * (tests/captions.integration.test.ts). This file proves the staff side, through
 * the real lesson resource service factory, the real publish loaders and a real
 * Prisma delegate on a disposable database:
 *   - a staff editor can create a caption upload for a video, complete it, and the
 *     learner's lesson data then lists the caption (READY only);
 *   - a failed completion leaves the caption FAILED and never offers it to learners;
 *   - a learner, a staff member who can only view, and a staff member who can edit
 *     only another course are refused for add, complete and remove, and nothing
 *     changes;
 *   - bad input (non-vtt, over 1 MB, a language like "english!", a parent that is
 *     not a video of the same lesson) is refused with a plain message and writes no
 *     row;
 *   - removing a caption removes the row and its object, hides it from learners,
 *     and refuses to remove anything that is not a caption;
 *   - the publication readiness list warns "N video lesson(s) have no captions."
 *     for video lessons without a READY caption, never blocks, and the course
 *     still publishes (decision option-a in 15-DECISIONS.md).
 *
 * "May this learner open the lesson" is injected (`canOpenLesson`); the real
 * pinned-version, unlock and access-window logic has its own suites. Object
 * storage is replaced at the service boundary (no object store is used here); a
 * stored object only "exists" once the test records it, which is what completion
 * inspects.
 *
 * SAFETY: the only database is a disposable Testcontainers instance from
 * `startTestDatabase()`; nothing reads `.env` or reaches a shared database.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with a
 * container-start error, which is the expected failure mode, not a code bug.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { createTestWithPermission, grant } from "./support/harness";
import {
  CaptionAttachmentError,
  ResourceUploadValidationError,
  createLessonResourceService,
  type LessonResourceDelegate,
} from "@/server/services/lesson-resource-service";
import { createPrismaBackedPublishService } from "@/server/services/publish-service";
import { blockingFailures, evaluateCourseReadiness } from "@/server/services/readiness-service";
import { AuthorizationError, type RawGrant } from "@/server/permissions/with-permission";

const VTT = "WEBVTT\n\n00:00.000 --> 00:02.000\nHello\n";
const FILE_MESSAGE = "Captions must be a WebVTT (.vtt) file of 1 MB or less.";
const LANGUAGE_MESSAGE = "Enter the caption language as a language code such as en or fr-CA.";
const PARENT_MESSAGE = "Captions can only be added to a video in the same lesson.";

let database: TestDatabase;
let staffUserId: string;
let seeded: {
  courseId: string;
  otherCourseId: string;
  videoLessonId: string;
  fileLessonId: string;
  otherVideoLessonId: string;
  videoResourceId: string;
  fileResourceId: string;
  otherVideoResourceId: string;
};

const LEARNER = "learner-enrolled";
/** Objects "in storage": staged or final key -> size and content type. */
const objects = new Map<string, { sizeBytes: bigint; contentType: string | null }>();
const bodies = new Map<string, Uint8Array>();
const deletedKeys: string[] = [];

function buildService(grants: RawGrant[], userId: string) {
  const { withPermission } = createTestWithPermission(grants, { userId });
  const storage = {
    inspect: vi.fn(async (key: string) => {
      const found = objects.get(key);
      if (!found) throw new Error("no such object");
      return found;
    }),
    promote: vi.fn(async ({ stagedKey, finalKey }: { stagedKey: string; finalKey: string }) => {
      const found = objects.get(stagedKey);
      if (found) objects.set(finalKey, found);
      const body = bodies.get(stagedKey);
      if (body) bodies.set(finalKey, body);
    }),
    delete: vi.fn(async (key: string) => {
      deletedKeys.push(key);
      objects.delete(key);
      bodies.delete(key);
    }),
    finalKey: (key: string) => `final/${key}`,
    readBounded: vi.fn(async (key: string) => {
      const body = bodies.get(key);
      if (!body) throw new Error("no such key");
      return body;
    }),
  };
  const service = createLessonResourceService({
    delegate: database.prisma.lessonResource as unknown as LessonResourceDelegate,
    resolveLessonContext: async (lessonId) => {
      const row = await database.prisma.lesson.findUnique({
        where: { id: lessonId },
        select: { type: true, module: { select: { courseId: true } } },
      });
      return row ? { courseId: row.module.courseId, type: row.type } : null;
    },
    withPermission,
    audit: async () => {},
    storage,
    canOpenLesson: async (actor, lessonId) => actor.userId === LEARNER && lessonId === seeded.videoLessonId,
  });
  return { service, storage };
}

const editorGrants = (): RawGrant[] => [grant("courses.edit"), grant("courses.view")];
const editor = () => buildService(editorGrants(), staffUserId);

async function seedCourse(label: string) {
  const course = await database.prisma.course.create({
    data: {
      slug: `captions-authoring-${label}`,
      title: `Captions authoring ${label}`,
      summary: "A course used to prove caption authoring.",
      completionRule: { kind: "ALL_REQUIRED" },
      completionRuleVersion: 1,
    },
    select: { id: true },
  });
  const mod = await database.prisma.module.create({
    data: { courseId: course.id, title: "Module", position: 0 },
    select: { id: true },
  });
  return { courseId: course.id, moduleId: mod.id };
}

async function seedLesson(moduleId: string, title: string, type: string, position: number) {
  return (
    await database.prisma.lesson.create({
      data: { moduleId, title, type: type as never, position, required: true },
      select: { id: true },
    })
  ).id;
}

async function seedResource(lessonId: string, title: string, extra: Record<string, unknown> = {}) {
  const row = await database.prisma.lessonResource.create({
    data: {
      lessonId,
      title,
      storageKey: `lessons/${lessonId}/${title}`,
      filename: `${title}.mp4`,
      mimeType: "video/mp4",
      sizeBytes: BigInt(1000),
      uploadStatus: "READY",
      ...extra,
    },
    select: { id: true },
  });
  return row.id;
}

beforeAll(async () => {
  database = await startTestDatabase();

  // uploadedById is a real foreign key, so the uploading staff member must exist.
  staffUserId = (
    await database.prisma.user.create({
      data: { email: "captions-authoring-staff@example.test", name: "Captions Author" },
      select: { id: true },
    })
  ).id;

  const a = await seedCourse("a");
  const b = await seedCourse("b");
  const video = await seedLesson(a.moduleId, "Video", "VIDEO", 0);
  const file = await seedLesson(a.moduleId, "File", "FILE", 1);
  const otherVideo = await seedLesson(a.moduleId, "Other video", "VIDEO", 2);
  seeded = {
    courseId: a.courseId,
    otherCourseId: b.courseId,
    videoLessonId: video,
    fileLessonId: file,
    otherVideoLessonId: otherVideo,
    videoResourceId: await seedResource(video, "video"),
    fileResourceId: await seedResource(file, "handout", { mimeType: "application/pdf" }),
    otherVideoResourceId: await seedResource(otherVideo, "other-video"),
  };
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await database?.stop();
}, TEST_DB_TIMEOUT_MS);

let keyCounter = 0;
const captionInput = (overrides: Record<string, unknown> = {}) => ({
  lessonId: seeded.videoLessonId,
  title: "English captions",
  storageKey: `lesson-uploads/${seeded.videoLessonId}/cap-${(keyCounter += 1)}`,
  filename: "en.vtt",
  mimeType: "text/vtt",
  sizeBytes: BigInt(VTT.length),
  caption: { forResourceId: seeded.videoResourceId, language: "en", label: "English" },
  ...overrides,
});

/** The browser's PUT: after this the staged object exists with the declared type and size. */
function putObject(storageKey: string, contentType = "text/vtt", sizeBytes = BigInt(VTT.length)) {
  objects.set(storageKey, { sizeBytes, contentType });
  bodies.set(storageKey, new TextEncoder().encode(VTT));
}

/** The whole staff flow: intent, direct PUT, completion. Returns the READY row. */
async function addReadyCaption(
  parent: { lessonId: string; videoResourceId: string },
  language = "en",
  label = "English",
) {
  const { service } = editor();
  const begun = await service.beginLessonResourceUpload(
    captionInput({
      lessonId: parent.lessonId,
      caption: { forResourceId: parent.videoResourceId, language, label },
    }),
  );
  putObject(begun.storageKey);
  return service.completeLessonResourceUpload(begun.id);
}

describe("caption authoring tracer (real PostgreSQL)", () => {
  it(
    "a staff editor adds a caption through intent and completion, and learners then see it",
    async () => {
      const { service, storage } = editor();

      const begun = await service.beginLessonResourceUpload(captionInput());
      expect(begun).toMatchObject({
        uploadStatus: "UPLOADING",
        captionForResourceId: seeded.videoResourceId,
        captionLanguage: "en",
        captionLabel: "English",
      });

      // Mid-upload: staff see it as in progress, learners are not offered it.
      const midStaff = await service.listLessonCaptions(seeded.videoLessonId);
      expect(midStaff.find((track) => track.id === begun.id)).toMatchObject({ uploadStatus: "UPLOADING" });
      const learner = buildService([], LEARNER).service;
      const midLearner = await learner.listLessonCaptionsForLearner({ userId: LEARNER }, seeded.videoLessonId);
      expect(midLearner.map((track) => track.id)).not.toContain(begun.id);

      putObject(begun.storageKey);
      const done = await service.completeLessonResourceUpload(begun.id);
      expect(done.uploadStatus).toBe("READY");
      expect(storage.promote).toHaveBeenCalledOnce();

      const learnerTracks = await learner.listLessonCaptionsForLearner({ userId: LEARNER }, seeded.videoLessonId);
      expect(learnerTracks).toContainEqual({
        id: begun.id,
        videoResourceId: seeded.videoResourceId,
        language: "en",
        label: "English",
      });
      const staffTracks = await service.listLessonCaptions(seeded.videoLessonId);
      expect(staffTracks.find((track) => track.id === begun.id)).toMatchObject({
        uploadStatus: "READY",
        uploadDetail: null,
      });

      // The player can fetch the file through the authorised reader.
      const served = await learner.readCaptionForLearnerOrStaff({ userId: LEARNER }, begun.id);
      expect(served).toEqual({ id: begun.id, body: VTT });
    },
    TEST_DB_TIMEOUT_MS,
  );

  it("a completion that does not match the request leaves the caption failed and never offers it", async () => {
    const { service } = editor();
    const begun = await service.beginLessonResourceUpload(
      captionInput({ caption: { forResourceId: seeded.videoResourceId, language: "fr", label: "Francais" } }),
    );
    // The browser sent a different amount than it declared.
    putObject(begun.storageKey, "text/vtt", BigInt(VTT.length + 5));

    await expect(service.completeLessonResourceUpload(begun.id)).rejects.toBeInstanceOf(
      ResourceUploadValidationError,
    );

    const staffTracks = await service.listLessonCaptions(seeded.videoLessonId);
    expect(staffTracks.find((track) => track.id === begun.id)).toMatchObject({
      uploadStatus: "ERROR",
      uploadDetail: "The stored file does not match its upload request.",
    });
    const learner = buildService([], LEARNER).service;
    const learnerTracks = await learner.listLessonCaptionsForLearner({ userId: LEARNER }, seeded.videoLessonId);
    expect(learnerTracks.map((track) => track.id)).not.toContain(begun.id);
    expect(await learner.readCaptionForLearnerOrStaff({ userId: LEARNER }, begun.id)).toBeNull();
  });
});

describe("who may author captions (real PostgreSQL)", () => {
  const actors: Array<[string, RawGrant[], string]> = [
    ["a learner with no grants", [], LEARNER],
    ["a staff member who can only view the course", [grant("courses.view")], "staff-viewer"],
    [
      "a staff member who can edit only another course",
      [grant("courses.edit", "COURSE", "other-course"), grant("courses.view", "COURSE", "other-course")],
      "staff-elsewhere",
    ],
  ];

  it.each(actors)("refuses %s for add, complete and remove, and changes nothing", async (_name, grants, userId) => {
    const scoped = grants.map((g) =>
      g.scopeId === "other-course" ? { ...g, scopeId: seeded.otherCourseId } : g,
    );
    const { service } = buildService(scoped, userId);

    const before = await database.prisma.lessonResource.count();
    await expect(service.beginLessonResourceUpload(captionInput())).rejects.toBeInstanceOf(AuthorizationError);
    expect(await database.prisma.lessonResource.count()).toBe(before);

    // An existing caption cannot be completed or removed by them either.
    const existing = await editor().service.beginLessonResourceUpload(captionInput());
    putObject(existing.storageKey);
    await expect(service.completeLessonResourceUpload(existing.id)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(service.removeCaption(existing.id)).rejects.toBeInstanceOf(AuthorizationError);
    const row = await database.prisma.lessonResource.findUniqueOrThrow({ where: { id: existing.id } });
    expect(row.uploadStatus).toBe("UPLOADING");
  }, TEST_DB_TIMEOUT_MS);
});

describe("caption input refusals (real PostgreSQL)", () => {
  it.each([
    ["a non-vtt file", { mimeType: "application/x-subrip", filename: "en.srt" }, FILE_MESSAGE],
    ["a file over 1 MB", { sizeBytes: BigInt(1024 * 1024 + 1) }, FILE_MESSAGE],
    [
      "a language like english!",
      { caption: { forResourceId: "__video__", language: "english!", label: "English" } },
      LANGUAGE_MESSAGE,
    ],
    [
      "a video of another lesson",
      { caption: { forResourceId: "__other_video__", language: "en", label: "English" } },
      PARENT_MESSAGE,
    ],
    [
      "a parent that is not a video",
      { caption: { forResourceId: "__file__", language: "en", label: "English" } },
      PARENT_MESSAGE,
    ],
  ] as const)("refuses %s with a plain message and writes no row", async (_name, overrides, message) => {
    const ids: Record<string, string> = {
      __video__: seeded.videoResourceId,
      __other_video__: seeded.otherVideoResourceId,
      __file__: seeded.fileResourceId,
    };
    const resolved: Record<string, unknown> = { ...overrides };
    const cap = resolved.caption as { forResourceId: string; language: string; label: string } | undefined;
    if (cap) resolved.caption = { ...cap, forResourceId: ids[cap.forResourceId] ?? cap.forResourceId };

    const before = await database.prisma.lessonResource.count();
    const attempt = editor().service.beginLessonResourceUpload(captionInput(resolved));
    await expect(attempt).rejects.toBeInstanceOf(CaptionAttachmentError);
    await expect(attempt).rejects.toThrow(message);
    expect(await database.prisma.lessonResource.count()).toBe(before);
  }, TEST_DB_TIMEOUT_MS);
});

describe("removing captions (real PostgreSQL)", () => {
  it("removes the row and its object and hides the caption from learners", async () => {
    const first = await addReadyCaption(
      { lessonId: seeded.videoLessonId, videoResourceId: seeded.videoResourceId },
      "de",
      "Deutsch",
    );
    const second = await addReadyCaption(
      { lessonId: seeded.videoLessonId, videoResourceId: seeded.videoResourceId },
      "es",
      "Espanol",
    );
    const { service } = editor();
    const learner = buildService([], LEARNER).service;
    const learnerBefore = await learner.listLessonCaptionsForLearner({ userId: LEARNER }, seeded.videoLessonId);
    expect(learnerBefore.map((track) => track.id)).toEqual(expect.arrayContaining([first.id, second.id]));

    await service.removeCaption(first.id);

    expect(await database.prisma.lessonResource.findUnique({ where: { id: first.id } })).toBeNull();
    expect(deletedKeys).toContain(first.storageKey);
    const learnerAfter = await learner.listLessonCaptionsForLearner({ userId: LEARNER }, seeded.videoLessonId);
    expect(learnerAfter.map((track) => track.id)).not.toContain(first.id);
    expect(learnerAfter.map((track) => track.id)).toContain(second.id);
    expect(await learner.readCaptionForLearnerOrStaff({ userId: LEARNER }, first.id)).toBeNull();
  }, TEST_DB_TIMEOUT_MS);

  it("refuses to remove a resource that is not a caption, leaving it and its object alone", async () => {
    const { service } = editor();
    const keyBefore = deletedKeys.length;

    await expect(service.removeCaption(seeded.videoResourceId)).rejects.toBeInstanceOf(CaptionAttachmentError);
    await expect(service.removeCaption(seeded.fileResourceId)).rejects.toThrow(
      "Only caption files can be removed here.",
    );

    expect(await database.prisma.lessonResource.findUnique({ where: { id: seeded.videoResourceId } })).not.toBeNull();
    expect(await database.prisma.lessonResource.findUnique({ where: { id: seeded.fileResourceId } })).not.toBeNull();
    expect(deletedKeys.length).toBe(keyBefore);
  }, TEST_DB_TIMEOUT_MS);
});

describe("publication readiness warning (real PostgreSQL)", () => {
  const publisher = () => {
    const { withPermission } = createTestWithPermission(
      [grant("courses.publish"), grant("courses.view"), grant("courses.edit")],
      { userId: staffUserId },
    );
    return createPrismaBackedPublishService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      database.prisma as any,
      withPermission,
      async () => {},
    );
  };

  const captionsItem = async (courseId: string) => {
    const aggregate = await publisher().loadCourseReadinessAggregate(courseId);
    const items = evaluateCourseReadiness(aggregate);
    return { items, item: items.find((entry) => entry.id === "video-captions") };
  };

  it(
    "names how many video lessons have no READY captions, never blocks, and still publishes",
    async () => {
      const course = await seedCourse("readiness");
      const lessonOne = await seedLesson(course.moduleId, "Video one", "VIDEO", 0);
      const lessonTwo = await seedLesson(course.moduleId, "Video two", "VIDEO", 1);
      await seedLesson(course.moduleId, "Reading", "TEXT", 2);
      const videoOne = await seedResource(lessonOne, "video-one");
      const videoTwo = await seedResource(lessonTwo, "video-two");

      // Two video lessons, no captions at all.
      const none = await captionsItem(course.courseId);
      expect(none.item).toMatchObject({
        state: "WARN",
        blocking: false,
        label: "2 video lessons have no captions.",
      });

      // A caption that is still UPLOADING (or failed) does not count.
      await seedResource(lessonTwo, "pending-caption", {
        mimeType: "text/vtt",
        filename: "pending.vtt",
        uploadStatus: "UPLOADING",
        captionForResourceId: videoTwo,
        captionLanguage: "en",
        captionLabel: "English",
      });
      expect((await captionsItem(course.courseId)).item?.label).toBe("2 video lessons have no captions.");

      // One READY caption leaves one lesson without.
      await addReadyCaption({ lessonId: lessonOne, videoResourceId: videoOne });
      const one = await captionsItem(course.courseId);
      expect(one.item).toMatchObject({ state: "WARN", blocking: false, label: "1 video lesson has no captions." });
      expect(blockingFailures(one.items)).toEqual([]);

      // The warning does not stop publication (option-a).
      const current = await database.prisma.course.findUniqueOrThrow({ where: { id: course.courseId } });
      const published = await publisher().publishCourse({
        courseId: course.courseId,
        expectedUpdatedAt: current.updatedAt,
      });
      expect(published.version).toBe(1);

      // Captioning the second lesson clears the warning.
      await addReadyCaption({ lessonId: lessonTwo, videoResourceId: videoTwo }, "fr", "Francais");
      const all = await captionsItem(course.courseId);
      expect(all.item).toMatchObject({ state: "PASS", blocking: false });
    },
    TEST_DB_TIMEOUT_MS,
  );

  it("does not carry the caption state into the frozen publication payload", async () => {
    const course = await seedCourse("payload");
    const lesson = await seedLesson(course.moduleId, "Video", "VIDEO", 0);
    const video = await seedResource(lesson, "video-payload");
    await addReadyCaption({ lessonId: lesson, videoResourceId: video });

    const row = await database.prisma.course.findUniqueOrThrow({ where: { id: course.courseId } });
    await publisher().publishCourse({ courseId: course.courseId, expectedUpdatedAt: row.updatedAt });
    const publication = await database.prisma.coursePublication.findFirstOrThrow({
      where: { courseId: course.courseId },
    });
    expect(JSON.stringify(publication.payload)).not.toContain("hasCleanCaptions");
    expect(JSON.stringify(publication.payload)).not.toContain("resources");
  }, TEST_DB_TIMEOUT_MS);
});
