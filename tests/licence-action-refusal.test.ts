import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Plan 14-18 (LIC-05, UI side): a staff action or route that the licence guard
 * refuses must show the fixed LICENCE_REFUSAL_MESSAGE, never "Your role does not
 * permit ...". `LicenceRestrictedError extends AuthorizationError`, so every
 * existing catch branch already catches it; the only change is the message value
 * (`refusalMessage(error, existingDeniedText)`), and for the lesson-resource
 * routes a 403 with the refusal body checked before the identical 404 denial.
 *
 * Name prefixes: "tracer:" (cohort and course create), "behaviour:" (the other
 * representative actions and route), "gate:" (whole-tree file gates).
 */

const mocks = vi.hoisted(() => ({
  cohortCreate: vi.fn(),
  courseCreate: vi.fn(),
  assertTemplateSelectable: vi.fn(),
  withdrawEnrolment: vi.fn(),
  roleCreate: vi.fn(),
  templateCreate: vi.fn(),
  lessonScope: vi.fn(),
  getLessonTypeById: vi.fn(),
  beginLessonResourceUpload: vi.fn(),
  completeLessonResourceUpload: vi.fn(),
  removeLessonResource: vi.fn(),
  listLessonResources: vi.fn(),
  /** What the mocked withPermission wrapper throws (null runs the handler). */
  permissionFailure: { current: null as Error | null },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("@/server/services/cohort-service", () => ({
  cohortService: { create: mocks.cohortCreate, get: vi.fn() },
  updateCohort: vi.fn(),
  OfferLockedError: class extends Error {},
}));
vi.mock("@/server/services/course-service", () => ({
  courseService: { create: mocks.courseCreate, update: vi.fn(), get: vi.fn() },
}));
vi.mock("@/server/services/certificate-template-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/certificate-template-service")>();
  return {
    ...actual,
    assertTemplateSelectable: mocks.assertTemplateSelectable,
    certificateTemplateService: { ...actual.certificateTemplateService, create: mocks.templateCreate },
  };
});
vi.mock("@/server/services/role-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/role-service")>();
  return { ...actual, roleService: { ...actual.roleService, create: mocks.roleCreate } };
});
vi.mock("@/server/services/lesson-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/lesson-service")>();
  return { ...actual, lessonScope: mocks.lessonScope, getLessonTypeById: mocks.getLessonTypeById };
});
// Fully mocked (with storage-service below): the real modules load the AWS SDK, which makes the
// first import of the routes slow. The routes only need these names.
vi.mock("@/server/services/lesson-resource-service", () => ({
  beginLessonResourceUpload: mocks.beginLessonResourceUpload,
  completeLessonResourceUpload: mocks.completeLessonResourceUpload,
  removeLessonResource: mocks.removeLessonResource,
  listLessonResources: mocks.listLessonResources,
  ResourceUploadValidationError: class ResourceUploadValidationError extends Error {
    constructor(
      message: string,
      readonly resource: unknown,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/server/services/storage-service", () => ({
  buildStagedStorageKey: () => "lesson-uploads/l1/opaque",
  presignLessonUploadUrl: async () => "https://storage.example/presigned-put",
}));
// Real error classes and refusal helpers; only the withPermission wrapper is replaced so a
// route's authorization outcome is controlled without a database or session.
vi.mock("@/server/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/permissions")>();
  return {
    ...actual,
    withPermission:
      () =>
      (handler: (input: unknown, ctx: { actor: { userId: string } }) => unknown) =>
      async (input: unknown) => {
        if (mocks.permissionFailure.current) throw mocks.permissionFailure.current;
        return handler(input, { actor: { userId: "tester" } });
      },
  };
});
vi.mock("@/server/services/enrolment-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/enrolment-service")>();
  return { ...actual, withdrawEnrolment: mocks.withdrawEnrolment };
});

import { createCohortAction } from "@/app/staff/cohorts/actions";
import { createCourseAction } from "@/app/staff/courses/actions";
import { AuthenticationError, AuthorizationError, LicenceRestrictedError } from "@/server/permissions";
import { LICENCE_REFUSAL_MESSAGE } from "@/server/licence/policy";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const APP_ROOT = path.join(REPO_ROOT, "src", "app");

function posix(p: string): string {
  return p.split(path.sep).join("/");
}

function readSource(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(posix(path.relative(REPO_ROOT, full)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Classification (T-14-18-04). BLOCKED: the licence guard can refuse it, so it
// must surface the refusal. CONTINUITY: never receives a licence refusal (D-06,
// D-07). READ: a page, a component, or a download or csv route handler.
// ---------------------------------------------------------------------------

/** The four lesson-resource routes (blocked class via courses.edit). */
const BLOCKED_ROUTE_FILES = [
  "src/app/api/lesson-resources/route.ts",
  "src/app/api/lesson-resources/upload-intent/route.ts",
  "src/app/api/lesson-resources/[id]/route.ts",
  "src/app/api/lesson-resources/[id]/complete/route.ts",
] as const;

const BLOCKED_ACTION_FILES = [
  "src/app/staff/cohorts/actions.ts",
  "src/app/staff/courses/actions.ts",
  "src/app/staff/cohorts/[id]/enrolment-actions.ts",
  "src/app/staff/cohorts/[id]/instructor-actions.ts",
  "src/app/staff/cohorts/[id]/publish-actions.ts",
  "src/app/staff/cohorts/[id]/session-actions.ts",
  "src/app/staff/courses/[id]/arrange/actions.ts",
  "src/app/staff/courses/[id]/assessments/actions.ts",
  "src/app/staff/courses/[id]/assessments/question-actions.ts",
  "src/app/staff/courses/[id]/lessons/[lessonId]/actions.ts",
  "src/app/staff/courses/[id]/publish-actions.ts",
  "src/app/staff/programmes/actions.ts",
  "src/app/staff/programmes/[id]/arrange/actions.ts",
  "src/app/staff/programmes/[id]/publish-actions.ts",
  "src/app/staff/certificates/templates/template-actions.ts",
  "src/app/staff/certificates/templates/template-asset-actions.ts",
  "src/app/staff/learner-numbers/actions.ts",
  "src/app/staff/roles/actions.ts",
  "src/app/staff/users/actions.ts",
] as const;

const BLOCKED_FILES: readonly string[] = [...BLOCKED_ACTION_FILES, ...BLOCKED_ROUTE_FILES];

/** Continuity files: the twelve the plan lists, then the two licence-kind files. */
const CONTINUITY_ACTION_FILES = [
  "src/app/staff/certificates/certificate-actions.ts",
  "src/app/staff/certificates/issued/[id]/certificate-record-actions.ts",
  "src/app/staff/cohorts/[id]/attendance-actions.ts",
  "src/app/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/actions.ts",
  "src/app/staff/cohorts/[id]/grading-actions.ts",
  "src/app/staff/cohorts/[id]/progress-actions.ts",
  "src/app/staff/email-log/actions.ts",
  "src/app/staff/payments/actions.ts",
  "src/app/staff/reconciliation/actions.ts",
  "src/app/staff/reports/actions.ts",
  "src/app/staff/audit/actions.ts",
  "src/app/staff/support/action-result.ts",
] as const;

/**
 * Licence-kind files added by plans 14-10 to 14-15 after the plan inventory was
 * taken: the licence activation action and the diagnostic route are wrapped in
 * `licence.activate`, which is continuity by effect (the recovery route is never
 * blockable), so they never receive a LicenceRestrictedError.
 */
const LICENCE_CONTINUITY_FILES = [
  "src/app/staff/licence/actions.ts",
  "src/app/api/staff/licence/diagnostic/route.ts",
] as const;

const CONTINUITY_FILES: readonly string[] = [...CONTINUITY_ACTION_FILES, ...LICENCE_CONTINUITY_FILES];

function isReadFile(file: string): boolean {
  if (file.endsWith(".tsx")) return true;
  return /\/route\.ts$/.test(file) && (file.includes("/download") || file.includes("/csv"));
}

const REFUSAL_IMPORT =
  /import\s*\{[^}]*\b(?:refusalMessage|isLicenceRestricted)\b[^}]*\}\s*from\s*"@\/server\/permissions"/;
const REFUSAL_CALL = /\b(?:refusalMessage|isLicenceRestricted)\(/;

function usesRefusalHelper(text: string): boolean {
  return REFUSAL_IMPORT.test(text) && REFUSAL_CALL.test(text);
}

function usesRouteRefusal(text: string): boolean {
  return (
    /\bisLicenceRestricted\(/.test(text) &&
    /permissions\.isLicenceRestricted|import\s*\{[^}]*\bisLicenceRestricted\b[^}]*\}\s*from\s*"@\/server\/permissions"/.test(text) &&
    text.includes("LICENCE_REFUSAL_MESSAGE") &&
    text.includes("status: 403")
  );
}

// ---------------------------------------------------------------------------
// Tracer: cohort create and course create
// ---------------------------------------------------------------------------

const previousCohort = { ok: false as const, errors: [], message: null };

function cohortForm(): FormData {
  const data = new FormData();
  Object.entries({
    code: "C1",
    title: "Cohort",
    courseId: "course-1",
    deliveryMode: "SELF_PACED",
    timezone: "Africa/Lagos",
    startsAt: "2026-07-01T09:00",
    endsAt: "2026-08-01T17:00",
    enrolmentOpensAt: "2026-05-01T09:00",
    enrolmentClosesAt: "2026-06-01T17:00",
    capacity: "20",
    priceNgnMinor: "45000000",
  }).forEach(([key, value]) => data.set(key, value));
  return data;
}

function courseForm(): FormData {
  const data = new FormData();
  data.set("title", "Safety");
  data.set("slug", "safety");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertTemplateSelectable.mockResolvedValue(undefined);
  mocks.permissionFailure.current = null;
  mocks.lessonScope.mockResolvedValue({ courseIds: ["c1"] });
  mocks.getLessonTypeById.mockResolvedValue("FILE");
});

describe("tracer: refused create actions show the licence refusal", () => {
  it("tracer: createCohortAction maps a LicenceRestrictedError to the licence refusal in its own shape", async () => {
    mocks.cohortCreate.mockRejectedValueOnce(new LicenceRestrictedError("cohorts.manage"));
    expect(await createCohortAction(previousCohort, cohortForm())).toEqual({
      ok: false,
      errors: [],
      message: LICENCE_REFUSAL_MESSAGE,
    });
  });

  it("tracer: createCohortAction keeps the role-denial text for a genuine AuthorizationError", async () => {
    mocks.cohortCreate.mockRejectedValueOnce(new AuthorizationError("cohorts.manage"));
    expect(await createCohortAction(previousCohort, cohortForm())).toEqual({
      ok: false,
      errors: [],
      message: "Your role does not permit creating or editing cohorts.",
    });
  });

  it("tracer: createCohortAction keeps the role-denial text for an AuthenticationError", async () => {
    mocks.cohortCreate.mockRejectedValueOnce(new AuthenticationError());
    expect(await createCohortAction(previousCohort, cohortForm())).toMatchObject({
      ok: false,
      message: "Your role does not permit creating or editing cohorts.",
    });
  });

  it("tracer: createCourseAction maps a LicenceRestrictedError to the licence refusal in its own shape", async () => {
    mocks.courseCreate.mockRejectedValueOnce(new LicenceRestrictedError("courses.create"));
    expect(await createCourseAction(previousCohort, courseForm())).toEqual({
      ok: false,
      errors: [],
      message: LICENCE_REFUSAL_MESSAGE,
    });
  });

  it("tracer: createCourseAction keeps the role-denial text (verb creating) for a genuine AuthorizationError", async () => {
    mocks.courseCreate.mockRejectedValueOnce(new AuthorizationError("courses.create"));
    expect(await createCourseAction(previousCohort, courseForm())).toEqual({
      ok: false,
      errors: [],
      message: "Your role does not permit creating courses.",
    });
  });

  it("tracer: the refusal text never contains the role-denial wording (T-14-18-02)", () => {
    expect(LICENCE_REFUSAL_MESSAGE).not.toMatch(/Your role does not permit/);
  });
});

// ---------------------------------------------------------------------------
// Cohort and course action groups (Task 2)
// ---------------------------------------------------------------------------

const COHORT_AND_COURSE_GROUP_FILES = [
  "src/app/staff/cohorts/[id]/enrolment-actions.ts",
  "src/app/staff/cohorts/[id]/instructor-actions.ts",
  "src/app/staff/cohorts/[id]/publish-actions.ts",
  "src/app/staff/cohorts/[id]/session-actions.ts",
  "src/app/staff/courses/[id]/arrange/actions.ts",
  "src/app/staff/courses/[id]/assessments/actions.ts",
  "src/app/staff/courses/[id]/assessments/question-actions.ts",
  "src/app/staff/courses/[id]/lessons/[lessonId]/actions.ts",
  "src/app/staff/courses/[id]/publish-actions.ts",
] as const;

describe("behaviour: cohort and course action groups", () => {
  const withdrawInput = {
    cohortId: "cohort-1",
    enrolmentId: "enr-1",
    reason: "The learner asked to withdraw.",
  };

  it("behaviour: withdrawEnrolmentAction shows the licence refusal for a LicenceRestrictedError", async () => {
    const { withdrawEnrolmentAction } = await import("@/app/staff/cohorts/[id]/enrolment-actions");
    mocks.withdrawEnrolment.mockRejectedValueOnce(new LicenceRestrictedError("enrolments.manage"));
    expect(await withdrawEnrolmentAction(withdrawInput)).toEqual({ ok: false, message: LICENCE_REFUSAL_MESSAGE });
  });

  it("behaviour: withdrawEnrolmentAction keeps the role-denial text for AuthorizationError and AuthenticationError", async () => {
    const { withdrawEnrolmentAction } = await import("@/app/staff/cohorts/[id]/enrolment-actions");
    mocks.withdrawEnrolment.mockRejectedValueOnce(new AuthorizationError("enrolments.manage"));
    expect(await withdrawEnrolmentAction(withdrawInput)).toEqual({
      ok: false,
      message: "Your role does not permit this action on this enrolment.",
    });
    mocks.withdrawEnrolment.mockRejectedValueOnce(new AuthenticationError());
    expect(await withdrawEnrolmentAction(withdrawInput)).toEqual({
      ok: false,
      message: "Your role does not permit this action on this enrolment.",
    });
  });

  it.each(COHORT_AND_COURSE_GROUP_FILES)("behaviour: %s imports and calls refusalMessage", (file) => {
    const text = readSource(file);
    expect(text, file).toMatch(/import\s*\{[^}]*\brefusalMessage\b[^}]*\}\s*from\s*"@\/server\/permissions"/);
    expect(text, file).toContain("refusalMessage(");
  });

  it("behaviour: every authorization branch in the group wraps its message (call count matches branch count)", () => {
    for (const file of COHORT_AND_COURSE_GROUP_FILES) {
      const text = readSource(file);
      const branches = (text.match(/instanceof AuthorizationError/g) ?? []).length;
      const wraps = (text.match(/refusalMessage\(/g) ?? []).length;
      expect(wraps, `${file}: ${branches} authorization branches, ${wraps} refusalMessage calls`).toBe(branches);
    }
  });
});

// ---------------------------------------------------------------------------
// Programme, template, role, user actions and the lesson-resource routes (Task 3)
// ---------------------------------------------------------------------------

describe("behaviour: role and template actions", () => {
  function roleForm(): FormData {
    const data = new FormData();
    data.set("name", "Auditor");
    return data;
  }

  it("behaviour: createRoleAction shows the licence refusal for a LicenceRestrictedError, in its own shape", async () => {
    const { createRoleAction } = await import("@/app/staff/roles/actions");
    mocks.roleCreate.mockRejectedValueOnce(new LicenceRestrictedError("roles.manage"));
    expect(await createRoleAction({ errors: [] }, roleForm())).toEqual({
      errors: [{ name: "form", message: LICENCE_REFUSAL_MESSAGE }],
    });
  });

  it("behaviour: createRoleAction keeps its existing text for a genuine AuthorizationError", async () => {
    const { createRoleAction } = await import("@/app/staff/roles/actions");
    mocks.roleCreate.mockRejectedValueOnce(new AuthorizationError("roles.manage"));
    expect(await createRoleAction({ errors: [] }, roleForm())).toEqual({
      errors: [{ name: "form", message: "You do not have access to create roles." }],
    });
  });

  it("behaviour: createTemplateAction shows the licence refusal for a LicenceRestrictedError", async () => {
    const { createTemplateAction } = await import("@/app/staff/certificates/templates/template-actions");
    mocks.templateCreate.mockRejectedValueOnce(new LicenceRestrictedError("certificates.manage"));
    expect(await createTemplateAction({ name: "Standard" })).toEqual({ ok: false, message: LICENCE_REFUSAL_MESSAGE });
  });

  it("behaviour: createTemplateAction keeps DENIED_MESSAGE for AuthorizationError and AuthenticationError", async () => {
    const { createTemplateAction } = await import("@/app/staff/certificates/templates/template-actions");
    mocks.templateCreate.mockRejectedValueOnce(new AuthorizationError("certificates.manage"));
    expect(await createTemplateAction({ name: "Standard" })).toEqual({
      ok: false,
      message: "Your role does not permit managing certificate templates.",
    });
    mocks.templateCreate.mockRejectedValueOnce(new AuthenticationError());
    expect(await createTemplateAction({ name: "Standard" })).toEqual({
      ok: false,
      message: "Your role does not permit managing certificate templates.",
    });
  });
});

describe("behaviour: lesson-resource routes", () => {
  const intentRequest = () =>
    new Request("http://localhost/api/lesson-resources/upload-intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lessonId: "l1",
        title: "Slides",
        filename: "slides.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2000,
      }),
    });
  const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) });

  it("behaviour: upload-intent answers a LicenceRestrictedError with 403 and { error: LICENCE_REFUSAL_MESSAGE }", async () => {
    const { POST } = await import("@/app/api/lesson-resources/upload-intent/route");
    mocks.permissionFailure.current = new LicenceRestrictedError("courses.edit");
    const response = await POST(intentRequest());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: LICENCE_REFUSAL_MESSAGE });
    expect(mocks.beginLessonResourceUpload).not.toHaveBeenCalled();
  });

  it("behaviour: upload-intent keeps the identical empty 404 for AuthorizationError and AuthenticationError", async () => {
    const { POST } = await import("@/app/api/lesson-resources/upload-intent/route");
    for (const failure of [new AuthorizationError("courses.edit"), new AuthenticationError()]) {
      mocks.permissionFailure.current = failure;
      const response = await POST(intentRequest());
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
    }
  });

  it("behaviour: complete, delete and list answer a LicenceRestrictedError with 403 and the fixed body", async () => {
    const { POST: complete } = await import("@/app/api/lesson-resources/[id]/complete/route");
    const { DELETE: remove } = await import("@/app/api/lesson-resources/[id]/route");
    const { GET: list } = await import("@/app/api/lesson-resources/route");
    const refusal = new LicenceRestrictedError("courses.edit");
    mocks.completeLessonResourceUpload.mockRejectedValueOnce(refusal);
    mocks.removeLessonResource.mockRejectedValueOnce(refusal);
    mocks.listLessonResources.mockRejectedValueOnce(refusal);

    const responses = [
      await complete(new Request("http://localhost/complete", { method: "POST" }), routeCtx("res-1")),
      await remove(new Request("http://localhost/res", { method: "DELETE" }), routeCtx("res-1")),
      await list(new Request("http://localhost/api/lesson-resources?lessonId=l1")),
    ];
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: LICENCE_REFUSAL_MESSAGE });
    }
  });

  it("behaviour: complete, delete and list keep the empty 404 for a genuine denial", async () => {
    const { POST: complete } = await import("@/app/api/lesson-resources/[id]/complete/route");
    const { DELETE: remove } = await import("@/app/api/lesson-resources/[id]/route");
    const { GET: list } = await import("@/app/api/lesson-resources/route");
    mocks.completeLessonResourceUpload.mockRejectedValueOnce(new AuthorizationError("courses.edit"));
    mocks.removeLessonResource.mockRejectedValueOnce(new AuthenticationError());
    mocks.listLessonResources.mockRejectedValueOnce(new AuthorizationError("courses.view"));

    const responses = [
      await complete(new Request("http://localhost/complete", { method: "POST" }), routeCtx("res-1")),
      await remove(new Request("http://localhost/res", { method: "DELETE" }), routeCtx("res-1")),
      await list(new Request("http://localhost/api/lesson-resources?lessonId=l1")),
    ];
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
    }
  });
});

describe("behaviour: programme, template and user action files wrap every authorization branch", () => {
  const WRAPPED_FILES = [
    "src/app/staff/programmes/actions.ts",
    "src/app/staff/programmes/[id]/arrange/actions.ts",
    "src/app/staff/programmes/[id]/publish-actions.ts",
    "src/app/staff/certificates/templates/template-actions.ts",
    "src/app/staff/certificates/templates/template-asset-actions.ts",
    "src/app/staff/roles/actions.ts",
    "src/app/staff/users/actions.ts",
  ];

  it.each(WRAPPED_FILES)("behaviour: %s calls refusalMessage once per authorization branch", (file) => {
    const text = readSource(file);
    const branches = (text.match(/instanceof AuthorizationError/g) ?? []).length;
    const wraps = (text.match(/refusalMessage\(/g) ?? []).length;
    expect(branches).toBeGreaterThan(0);
    expect(wraps, `${file}: ${branches} authorization branches, ${wraps} refusalMessage calls`).toBe(branches);
  });
});

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

describe("gate: blocked-class files surface the licence refusal", () => {
  it("gate: the BLOCKED list has 23 entries and each exists", () => {
    expect(BLOCKED_FILES).toHaveLength(23);
    expect(new Set(BLOCKED_FILES).size).toBe(23);
    for (const file of BLOCKED_FILES) {
      expect(() => readSource(file), file).not.toThrow();
    }
  });

  it.each(BLOCKED_ACTION_FILES)("gate: %s imports and calls the refusal helper", (file) => {
    expect(usesRefusalHelper(readSource(file)), `${file} must call refusalMessage or isLicenceRestricted`).toBe(true);
  });

  it.each(BLOCKED_ROUTE_FILES)("gate: %s answers a licence refusal with 403 and the fixed body", (file) => {
    expect(usesRouteRefusal(readSource(file)), `${file} needs isLicenceRestricted, LICENCE_REFUSAL_MESSAGE and status: 403`).toBe(true);
  });

  it("gate: no CONTINUITY file is also BLOCKED, and every CONTINUITY file exists", () => {
    expect(CONTINUITY_ACTION_FILES).toHaveLength(12);
    for (const file of CONTINUITY_FILES) {
      expect(BLOCKED_FILES, file).not.toContain(file);
      expect(() => readSource(file), file).not.toThrow();
    }
  });
});

describe("gate: classification of every file under src/app that references AuthorizationError", () => {
  it("gate: each is BLOCKED, CONTINUITY or READ; a new unclassified file fails with its path", () => {
    const unclassified = listSourceFiles(APP_ROOT)
      .filter((file) => /\bAuthorizationError\b/.test(readSource(file)))
      .filter((file) => !BLOCKED_FILES.includes(file) && !CONTINUITY_FILES.includes(file) && !isReadFile(file));
    expect(unclassified, `unclassified files referencing AuthorizationError: ${unclassified.join(", ")}`).toEqual([]);
  });

  it("gate: the classifier rejects a made-up action file (the check can fail)", () => {
    const fake = "src/app/staff/example/new-actions.ts";
    expect(BLOCKED_FILES.includes(fake) || CONTINUITY_FILES.includes(fake) || isReadFile(fake)).toBe(false);
    expect(isReadFile("src/app/staff/x/page.tsx")).toBe(true);
    expect(isReadFile("src/app/api/x/download/route.ts")).toBe(true);
    expect(isReadFile("src/app/staff/x/csv/route.ts")).toBe(true);
    expect(isReadFile("src/app/api/x/route.ts")).toBe(false);
  });

  it("gate: the helper-usage check rejects text that imports without calling and calls without importing", () => {
    expect(usesRefusalHelper('import { refusalMessage } from "@/server/permissions";')).toBe(false);
    expect(usesRefusalHelper("refusalMessage(error, 'x')")).toBe(false);
    expect(
      usesRefusalHelper('import { AuthorizationError, refusalMessage } from "@/server/permissions";\nconst m = refusalMessage(e, "x");'),
    ).toBe(true);
  });
});
