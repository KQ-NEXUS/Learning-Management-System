import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const schema = readFileSync(
  path.resolve(process.cwd(), "prisma/schema.prisma"),
  "utf8",
);

function sliceModel(name: string): string {
  const start = schema.indexOf(`model ${name} {`);
  if (start === -1) throw new Error(`model ${name} not found in schema`);
  const end = schema.indexOf("}", start);
  return schema.slice(start, end);
}

function sliceEnum(name: string): string {
  const start = schema.indexOf(`enum ${name} {`);
  if (start === -1) throw new Error(`enum ${name} not found in schema`);
  const end = schema.indexOf("}", start);
  return schema.slice(start, end);
}

const coursePublicationModel = sliceModel("CoursePublication");
const programmePublicationModel = sliceModel("ProgrammePublication");
const uploadStatusEnum = sliceEnum("UploadStatus");
const courseModel = sliceModel("Course");
const programmeModel = sliceModel("Programme");
const moduleModel = sliceModel("Module");
const lessonModel = sliceModel("Lesson");
const cohortModel = sliceModel("Cohort");
const cohortCourseModel = sliceModel("CohortCourse");
const lessonResourceModel = sliceModel("LessonResource");

const migrationsDir = path.resolve(process.cwd(), "prisma/migrations");
const migrationFiles = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) =>
    readFileSync(
      path.join(migrationsDir, entry.name, "migration.sql"),
      "utf8",
    ),
  );
const allMigrationSql = migrationFiles.join("\n");

describe("CoursePublication and ProgrammePublication are immutable publish records", () => {
  it("CoursePublication declares @@unique([courseId, version])", () => {
    expect(coursePublicationModel).toMatch(
      /@@unique\(\[courseId,\s*version\]\)/,
    );
  });

  it("ProgrammePublication declares @@unique([programmeId, version])", () => {
    expect(programmePublicationModel).toMatch(
      /@@unique\(\[programmeId,\s*version\]\)/,
    );
  });

  it("CoursePublication declares payload Json, publishedById String, publishedAt DateTime", () => {
    expect(coursePublicationModel).toMatch(/payload\s+Json/);
    expect(coursePublicationModel).toMatch(/publishedById\s+String\b/);
    expect(coursePublicationModel).toMatch(/publishedAt\s+DateTime\b/);
  });

  it("ProgrammePublication declares payload Json, publishedById String, publishedAt DateTime", () => {
    expect(programmePublicationModel).toMatch(/payload\s+Json/);
    expect(programmePublicationModel).toMatch(/publishedById\s+String\b/);
    expect(programmePublicationModel).toMatch(/publishedAt\s+DateTime\b/);
  });
});

describe("UploadStatus is one shared neutral vocabulary", () => {
  it("enum UploadStatus lists exactly UPLOADING, READY, ERROR", () => {
    const values = uploadStatusEnum
      .replace(/enum UploadStatus \{/, "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    expect(values).toEqual(["UPLOADING", "READY", "ERROR"]);
  });

  it("contains no scan-specific schema vocabulary", () => {
    expect(schema).not.toMatch(/scanStatus|scannedAt|scanDetail|ScanStatus/);
  });

  it("LessonResource, Submission and TicketAttachment share UploadStatus", () => {
    const matches = schema.match(/uploadStatus\s+UploadStatus\b/g) ?? [];
    expect(matches.length).toBe(3);
  });
});

describe("Course and Programme carry the D-08/D-11 listing switches", () => {
  it("Course declares publiclyListed Boolean @default(false) and slugLockedAt DateTime?", () => {
    expect(courseModel).toMatch(/publiclyListed\s+Boolean\s+@default\(false\)/);
    expect(courseModel).toMatch(/slugLockedAt\s+DateTime\?/);
  });

  it("Programme declares publiclyListed Boolean @default(false) and slugLockedAt DateTime?", () => {
    expect(programmeModel).toMatch(
      /publiclyListed\s+Boolean\s+@default\(false\)/,
    );
    expect(programmeModel).toMatch(/slugLockedAt\s+DateTime\?/);
  });
});

describe("Module and Lesson soft-delete via withdrawnAt (D-17)", () => {
  it("Module declares withdrawnAt DateTime? and no status field", () => {
    expect(moduleModel).toMatch(/withdrawnAt\s+DateTime\?/);
    expect(moduleModel).not.toMatch(/^\s*status\s+/m);
  });

  it("Lesson declares withdrawnAt DateTime? and no status field", () => {
    expect(lessonModel).toMatch(/withdrawnAt\s+DateTime\?/);
    expect(lessonModel).not.toMatch(/^\s*status\s+/m);
  });
});

describe("Publication pins exist on Cohort (both kinds) and CohortCourse (OQ-1)", () => {
  it("Cohort declares both coursePublicationId and programmePublicationId", () => {
    expect(cohortModel).toMatch(/coursePublicationId\s+String\?/);
    expect(cohortModel).toMatch(/programmePublicationId\s+String\?/);
  });

  it("CohortCourse declares coursePublicationId", () => {
    expect(cohortCourseModel).toMatch(/coursePublicationId\s+String\?/);
  });

  it("Cohort declares @@index([coursePublicationId]) and @@index([programmePublicationId])", () => {
    expect(cohortModel).toMatch(/@@index\(\[coursePublicationId\]\)/);
    expect(cohortModel).toMatch(/@@index\(\[programmePublicationId\]\)/);
  });

  it("CohortCourse declares @@index([coursePublicationId])", () => {
    expect(cohortCourseModel).toMatch(/@@index\(\[coursePublicationId\]\)/);
  });
});

describe("LessonResource carries upload audit fields and a 2GB-safe sizeBytes", () => {
  it("declares uploadedById, uploadedAt, uploadDetail", () => {
    expect(lessonResourceModel).toMatch(/uploadedById\s+String\?/);
    expect(lessonResourceModel).toMatch(/uploadedAt\s+DateTime\?/);
    expect(lessonResourceModel).toMatch(/uploadDetail\s+String\?/);
  });

  it("declares sizeBytes as BigInt, not Int (regression guard for the 2GB video cap overflow)", () => {
    expect(lessonResourceModel).toMatch(/sizeBytes\s+BigInt\b/);
    expect(lessonResourceModel).not.toMatch(/sizeBytes\s+Int\b/);
  });
});

describe("Programme has publish parity with Course (CAT-06)", () => {
  it("Programme declares contentVersion and publishedById", () => {
    expect(programmeModel).toMatch(/contentVersion\s+Int\s+@default\(1\)/);
    expect(programmeModel).toMatch(/publishedById\s+String\?/);
  });
});

describe("Position uniqueness stays a total index, never a partial CHECK (two-band negative convention)", () => {
  it("no model declares a CHECK (position constraint in the schema", () => {
    expect(schema.toLowerCase()).not.toMatch(/check\s*\(\s*position/);
  });

  it("no migration ever introduces a DEFERRABLE clause (Pitfall 1 regression guard)", () => {
    expect(allMigrationSql).not.toMatch(/DEFERRABLE/);
  });
});

describe("The manual paste-in from 002_catalogue_integrity.sql was actually applied", () => {
  it("course_publication_payload_object appears in an applied migration file", () => {
    expect(allMigrationSql).toMatch(/course_publication_payload_object/);
  });

  it("programme_publication_payload_object appears in an applied migration file", () => {
    expect(allMigrationSql).toMatch(/programme_publication_payload_object/);
  });
});
