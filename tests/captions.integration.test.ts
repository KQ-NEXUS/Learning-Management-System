/**
 * Real-PostgreSQL proof for lesson video captions (NFR-09 / NFR-06, plan 15-23).
 *
 * Proves, against stored rows in a disposable database, through the real lesson
 * resource service factory and a real Prisma delegate:
 *   - the attach rules: a caption must name an ordinary resource of a VIDEO lesson
 *     in the SAME lesson, with a BCP 47 language, a label and a text/vtt file
 *     within 1 MB (anything else is refused and writes no row);
 *   - captions never appear in the ordinary resource lists, so the lesson
 *     renderer's "first resource is the video" rule holds;
 *   - an enrolled learner can read a READY caption, another learner cannot, a
 *     caption that is still UPLOADING (or ERROR) is not served to anyone, and a
 *     resource that is not a caption is refused by the caption reader;
 *   - staff holding courses.view for the course can read a READY caption, staff
 *     scoped to a different course cannot;
 *   - learners are only offered READY caption tracks;
 *   - removing the video removes its caption rows and asks storage to delete the
 *     caption objects too.
 *
 * "May this learner open the lesson" is injected (`canOpenLesson`); the real
 * pinned-version / unlock / access-window logic has its own suites. Object
 * storage is mocked at the service boundary (no local object store is used here).
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
  createLessonResourceService,
  CaptionAttachmentError,
  type LessonResourceDelegate,
} from "@/server/services/lesson-resource-service";
import type { RawGrant } from "@/server/permissions/with-permission";

const VTT = "WEBVTT\n\n00:00.000 --> 00:02.000\nHello\n";

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

const enrolledLearners = new Set(["learner-enrolled"]);
const stored = new Map<string, Uint8Array>();
const deletedKeys: string[] = [];

function buildService(grants: RawGrant[], userId: string) {
  const { withPermission } = createTestWithPermission(grants, { userId });
  const storage = {
    inspect: vi.fn(async () => ({ sizeBytes: BigInt(0), contentType: null as string | null })),
    promote: vi.fn(async () => {}),
    delete: vi.fn(async (key: string) => {
      deletedKeys.push(key);
    }),
    finalKey: (key: string) => key,
    readBounded: vi.fn(async (key: string, maxBytes: number) => {
      const bytes = stored.get(key);
      if (!bytes) throw new Error("no such key");
      if (bytes.byteLength > maxBytes) throw new Error("too large");
      return bytes;
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
    canOpenLesson: async (actor, lessonId) =>
      enrolledLearners.has(actor.userId) && lessonId === seeded.videoLessonId,
  });
  return { service, storage };
}

async function seedCourse(label: string) {
  const course = await database.prisma.course.create({
    data: { slug: `captions-${label}`, title: `Captions ${label}` },
    select: { id: true },
  });
  const mod = await database.prisma.module.create({
    data: { courseId: course.id, title: "Module", position: 0 },
    select: { id: true },
  });
  return { courseId: course.id, moduleId: mod.id };
}

async function seedResource(
  lessonId: string,
  title: string,
  extra: Record<string, unknown> = {},
) {
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
      data: { email: "captions-staff@example.test", name: "Captions Staff" },
      select: { id: true },
    })
  ).id;

  const a = await seedCourse("a");
  const b = await seedCourse("b");
  const video = await database.prisma.lesson.create({
    data: { moduleId: a.moduleId, title: "Video", type: "VIDEO", position: 0 },
    select: { id: true },
  });
  const file = await database.prisma.lesson.create({
    data: { moduleId: a.moduleId, title: "File", type: "FILE", position: 1 },
    select: { id: true },
  });
  const otherVideo = await database.prisma.lesson.create({
    data: { moduleId: a.moduleId, title: "Other video", type: "VIDEO", position: 2 },
    select: { id: true },
  });
  seeded = {
    courseId: a.courseId,
    otherCourseId: b.courseId,
    videoLessonId: video.id,
    fileLessonId: file.id,
    otherVideoLessonId: otherVideo.id,
    videoResourceId: await seedResource(video.id, "video"),
    fileResourceId: await seedResource(file.id, "handout", { mimeType: "application/pdf" }),
    otherVideoResourceId: await seedResource(otherVideo.id, "other-video"),
  };
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await database?.stop();
}, TEST_DB_TIMEOUT_MS);

const staffGrants = () => [grant("courses.edit"), grant("courses.view")];

const captionInput = (overrides: Record<string, unknown> = {}) => ({
  lessonId: seeded.videoLessonId,
  title: "English captions",
  storageKey: `lesson-uploads/${seeded.videoLessonId}/cap-${Math.random().toString(36).slice(2)}`,
  filename: "en.vtt",
  mimeType: "text/vtt",
  sizeBytes: BigInt(VTT.length),
  caption: { forResourceId: seeded.videoResourceId, language: "en", label: "English" },
  ...overrides,
});

async function attachCaption(status: "READY" | "UPLOADING" | "ERROR" = "READY") {
  const { service } = buildService(staffGrants(), staffUserId);
  const begun = await service.beginLessonResourceUpload(captionInput());
  const key = `captions/${begun.id}`;
  stored.set(key, new TextEncoder().encode(VTT));
  const row = await database.prisma.lessonResource.update({
    where: { id: begun.id },
    data: { storageKey: key, uploadStatus: status },
  });
  return row;
}

describe("caption attach rules (real PostgreSQL)", () => {
  it(
    "stores a caption linked to its video with language and label",
    async () => {
      const { service } = buildService(staffGrants(), staffUserId);
      const created = await service.beginLessonResourceUpload(captionInput());
      const row = await database.prisma.lessonResource.findUniqueOrThrow({ where: { id: created.id } });
      expect(row).toMatchObject({
        captionForResourceId: seeded.videoResourceId,
        captionLanguage: "en",
        captionLabel: "English",
        mimeType: "text/vtt",
        uploadStatus: "UPLOADING",
      });
    },
    TEST_DB_TIMEOUT_MS,
  );

  it.each([
    ["a non-VTT file", { mimeType: "application/pdf" }],
    ["an oversized file", { sizeBytes: BigInt(1024 * 1024 + 1) }],
    ["a parent in another lesson", { caption: { forResourceId: "__other_video__", language: "en", label: "English" } }],
    ["a parent that is not a video lesson resource", { caption: { forResourceId: "__file__", language: "en", label: "English" } }],
    ["an unknown parent", { caption: { forResourceId: "does-not-exist", language: "en", label: "English" } }],
    ["a language that is not BCP 47", { caption: { forResourceId: "__video__", language: "english please", label: "English" } }],
    ["an empty label", { caption: { forResourceId: "__video__", language: "en", label: "  " } }],
  ] as const)("refuses %s and writes no row", async (_name, overrides) => {
    const { service } = buildService(staffGrants(), staffUserId);
    const resolved: Record<string, unknown> = { ...overrides };
    const cap = resolved.caption as { forResourceId: string; language: string; label: string } | undefined;
    if (cap) {
      const ids: Record<string, string> = {
        __video__: seeded.videoResourceId,
        __other_video__: seeded.otherVideoResourceId,
        __file__: seeded.fileResourceId,
      };
      resolved.caption = { ...cap, forResourceId: ids[cap.forResourceId] ?? cap.forResourceId };
    }
    const before = await database.prisma.lessonResource.count();
    await expect(service.beginLessonResourceUpload(captionInput(resolved))).rejects.toBeInstanceOf(
      CaptionAttachmentError,
    );
    expect(await database.prisma.lessonResource.count()).toBe(before);
  }, TEST_DB_TIMEOUT_MS);

  it("refuses a caption on a parent that is itself a caption", async () => {
    const parentCaption = await attachCaption("READY");
    const { service } = buildService(staffGrants(), staffUserId);
    await expect(
      service.beginLessonResourceUpload(
        captionInput({ caption: { forResourceId: parentCaption.id, language: "fr", label: "Francais" } }),
      ),
    ).rejects.toBeInstanceOf(CaptionAttachmentError);
  });

  it("keeps captions out of the ordinary resource lists", async () => {
    await attachCaption("READY");
    const { service } = buildService(staffGrants(), staffUserId);
    const staffList = await service.listLessonResources(seeded.videoLessonId);
    expect(staffList.map((r) => r.id)).toEqual([seeded.videoResourceId]);
    const learnerList = await service.listLessonResourcesForLearner(
      { userId: "learner-enrolled" },
      seeded.videoLessonId,
    );
    expect(learnerList.map((r) => r.id)).toEqual([seeded.videoResourceId]);
  });
});

describe("caption delivery decision (real PostgreSQL)", () => {
  it("lets an enrolled learner read a READY caption", async () => {
    const caption = await attachCaption("READY");
    const { service, storage } = buildService([], "learner-enrolled");
    const file = await service.readCaptionForLearnerOrStaff({ userId: "learner-enrolled" }, caption.id);
    expect(file).toEqual({ id: caption.id, body: VTT });
    expect(storage.readBounded).toHaveBeenCalledWith(caption.storageKey, 1024 * 1024);
  });

  it("refuses another learner and an anonymous caller without reading storage", async () => {
    const caption = await attachCaption("READY");
    const { service, storage } = buildService([], "learner-other");
    await expect(service.readCaptionForLearnerOrStaff({ userId: "learner-other" }, caption.id)).resolves.toBeNull();
    await expect(service.readCaptionForLearnerOrStaff(null, caption.id)).resolves.toBeNull();
    expect(storage.readBounded).not.toHaveBeenCalled();
  });

  it.each(["UPLOADING", "ERROR"] as const)("refuses a %s caption to everyone", async (status) => {
    const caption = await attachCaption(status);
    const learner = buildService([], "learner-enrolled").service;
    const staff = buildService(staffGrants(), staffUserId).service;
    await expect(learner.readCaptionForLearnerOrStaff({ userId: "learner-enrolled" }, caption.id)).resolves.toBeNull();
    await expect(staff.readCaptionForLearnerOrStaff({ userId: staffUserId }, caption.id)).resolves.toBeNull();
  });

  it("refuses a resource that is not a caption, and an unknown id", async () => {
    const { service } = buildService(staffGrants(), staffUserId);
    await expect(
      service.readCaptionForLearnerOrStaff({ userId: staffUserId }, seeded.videoResourceId),
    ).resolves.toBeNull();
    await expect(service.readCaptionForLearnerOrStaff({ userId: staffUserId }, "nope")).resolves.toBeNull();
  });

  it("lets staff with courses.view for the course read it, and refuses staff scoped to another course", async () => {
    const caption = await attachCaption("READY");
    const allowed = buildService([grant("courses.view", "COURSE", seeded.courseId)], "staff-a").service;
    const denied = buildService([grant("courses.view", "COURSE", seeded.otherCourseId)], "staff-b").service;
    await expect(allowed.readCaptionForLearnerOrStaff({ userId: "staff-a" }, caption.id)).resolves.toMatchObject({
      body: VTT,
    });
    await expect(denied.readCaptionForLearnerOrStaff({ userId: "staff-b" }, caption.id)).resolves.toBeNull();
  });

  it("offers a learner only READY caption tracks", async () => {
    const ready = await attachCaption("READY");
    await attachCaption("UPLOADING");
    const { service } = buildService([], "learner-enrolled");
    const tracks = await service.listLessonCaptionsForLearner({ userId: "learner-enrolled" }, seeded.videoLessonId);
    expect(tracks.map((t) => t.id)).toContain(ready.id);
    expect(tracks.every((t) => t.videoResourceId === seeded.videoResourceId)).toBe(true);
    expect(tracks.length).toBe(
      await database.prisma.lessonResource.count({
        where: { lessonId: seeded.videoLessonId, captionForResourceId: { not: null }, uploadStatus: "READY" },
      }),
    );
    const none = await buildService([], "learner-other").service.listLessonCaptionsForLearner(
      { userId: "learner-other" },
      seeded.videoLessonId,
    );
    expect(none).toEqual([]);
  });
});

describe("removing a video (real PostgreSQL)", () => {
  it("removes its caption rows and deletes the caption objects too", async () => {
    const lesson = await database.prisma.lesson.create({
      data: { moduleId: (await database.prisma.module.findFirstOrThrow({ where: { courseId: seeded.courseId } })).id, title: "Removable", type: "VIDEO", position: 10 },
      select: { id: true },
    });
    const videoId = await seedResource(lesson.id, "removable");
    const captionKey = "captions/removable-en";
    const caption = await database.prisma.lessonResource.create({
      data: {
        lessonId: lesson.id,
        title: "en",
        storageKey: captionKey,
        filename: "en.vtt",
        mimeType: "text/vtt",
        sizeBytes: BigInt(10),
        uploadStatus: "READY",
        captionForResourceId: videoId,
        captionLanguage: "en",
        captionLabel: "English",
      },
      select: { id: true },
    });

    const { service } = buildService(staffGrants(), staffUserId);
    await service.removeLessonResource(videoId);

    expect(await database.prisma.lessonResource.findUnique({ where: { id: caption.id } })).toBeNull();
    expect(deletedKeys).toContain(captionKey);
    expect(deletedKeys).toContain(`lessons/${lesson.id}/removable`);
  });
});
