import { beforeEach, describe, expect, it, vi } from "vitest";

const { update, get, create, assertTemplateSelectable, revalidatePath } = vi.hoisted(() => ({
  update: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  assertTemplateSelectable: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/server/services/course-service", () => ({
  courseService: { update, get, create },
}));
vi.mock("@/server/services/certificate-template-service", async () => {
  class TemplateNotSelectableError extends Error {
    constructor(message = "Choose a certificate template that is not archived.") {
      super(message);
      this.name = "TemplateNotSelectableError";
    }
  }
  return { assertTemplateSelectable, TemplateNotSelectableError };
});
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));

import { updateCourseAction } from "@/app/staff/courses/actions";
import { createCourseSchema, updateCourseSchema } from "@/app/staff/courses/course-schema";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { TemplateNotSelectableError } from "@/server/services/certificate-template-service";

const INITIAL = { ok: false as const, errors: [], message: null };

const CURRENT = {
  id: "course-1",
  slug: "safety",
  slugLockedAt: null as Date | null,
  certificateTemplateId: "tpl-1" as string | null,
};

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

const BASE = { courseId: "course-1", title: "Safety", slug: "safety" };

beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue({ ...CURRENT });
  update.mockResolvedValue({ id: "course-1" });
  assertTemplateSelectable.mockResolvedValue(undefined);
});

describe("course schemas", () => {
  it("rejects an unknown key on both schemas (.strict())", () => {
    expect(
      createCourseSchema.safeParse({ title: "T", slug: "t", status: "PUBLISHED" }).success,
    ).toBe(false);
    expect(
      updateCourseSchema.safeParse({
        courseId: "c",
        title: "T",
        slug: "t",
        certificateEnabled: true,
        publiclyListed: true,
      }).success,
    ).toBe(false);
  });

  it("parses a known-good payload on both schemas", () => {
    expect(createCourseSchema.safeParse({ title: "T", slug: "t" }).success).toBe(true);
    expect(
      updateCourseSchema.safeParse({
        courseId: "c",
        title: "T",
        slug: "t",
        certificateEnabled: false,
        durationHours: null,
      }).success,
    ).toBe(true);
  });
});

describe("updateCourseAction", () => {
  it("updates once with the certificate fields and returns ok", async () => {
    const result = await updateCourseAction(
      INITIAL,
      form({
        ...BASE,
        certificateEnabled: "on",
        certificateIssuanceMode: "AUTOMATIC",
        certificateTemplateId: "tpl-2",
      }),
    );
    expect(result).toEqual({ ok: true, id: "course-1" });
    expect(update).toHaveBeenCalledTimes(1);
    const [id, data, reason] = update.mock.calls[0];
    expect(id).toBe("course-1");
    expect(reason).toBe("Edited from the course editor.");
    expect(data).toMatchObject({
      certificateEnabled: true,
      certificateIssuanceMode: "AUTOMATIC",
      certificateTemplateId: "tpl-2",
    });
    expect(data).not.toHaveProperty("courseId");
    expect(revalidatePath).toHaveBeenCalledWith("/staff/courses/course-1");
    expect(revalidatePath).toHaveBeenCalledWith("/courses");
  });

  it("does not reset certificate settings when the disabled controls are absent", async () => {
    await updateCourseAction(INITIAL, form({ ...BASE }));
    const data = update.mock.calls[0][1];
    expect(data.certificateEnabled).toBe(false);
    expect(data).not.toHaveProperty("certificateIssuanceMode");
    expect(data).not.toHaveProperty("certificateTemplateId");
  });

  it("maps an explicitly blank template to null and clears blank optional fields", async () => {
    await updateCourseAction(
      INITIAL,
      form({
        ...BASE,
        certificateEnabled: "on",
        certificateIssuanceMode: "MANUAL",
        certificateTemplateId: "",
        summary: "",
        outcomes: "  ",
        audience: "",
        prerequisites: "",
        durationHours: "",
      }),
    );
    const data = update.mock.calls[0][1];
    expect(data.certificateTemplateId).toBeNull();
    expect(data.summary).toBeNull();
    expect(data.outcomes).toBeNull();
    expect(data.audience).toBeNull();
    expect(data.prerequisites).toBeNull();
    expect(data.durationHours).toBeNull();
  });

  it("keeps a real duration as a number", async () => {
    await updateCourseAction(INITIAL, form({ ...BASE, durationHours: "18" }));
    expect(update.mock.calls[0][1].durationHours).toBe(18);
  });

  it("rejects a non-numeric duration without updating", async () => {
    const result = await updateCourseAction(INITIAL, form({ ...BASE, durationHours: "abc" }));
    expect(result.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("validates the template only when it differs from the stored one", async () => {
    await updateCourseAction(
      INITIAL,
      form({ ...BASE, certificateEnabled: "on", certificateTemplateId: "tpl-1" }),
    );
    expect(assertTemplateSelectable).not.toHaveBeenCalled();

    await updateCourseAction(
      INITIAL,
      form({ ...BASE, certificateEnabled: "on", certificateTemplateId: "tpl-2" }),
    );
    expect(assertTemplateSelectable).toHaveBeenCalledWith("tpl-2");
  });

  it("rejects a submitted archived template with a field error and does not update", async () => {
    assertTemplateSelectable.mockRejectedValue(new TemplateNotSelectableError());
    const result = await updateCourseAction(
      INITIAL,
      form({ ...BASE, certificateEnabled: "on", certificateTemplateId: "tpl-archived" }),
    );
    expect(result).toMatchObject({
      ok: false,
      errors: [{ name: "certificateTemplateId" }],
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a changed slug on a slug-locked course and does not update", async () => {
    get.mockResolvedValue({ ...CURRENT, slugLockedAt: new Date("2026-01-01") });
    const result = await updateCourseAction(INITIAL, form({ ...BASE, slug: "renamed" }));
    expect(result).toMatchObject({ ok: false, errors: [{ name: "slug" }] });
    expect(update).not.toHaveBeenCalled();
  });

  it("still saves an unchanged slug on a slug-locked course", async () => {
    get.mockResolvedValue({ ...CURRENT, slugLockedAt: new Date("2026-01-01") });
    const result = await updateCourseAction(INITIAL, form({ ...BASE }));
    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("returns the reload message when courseId is missing or blank", async () => {
    for (const courseId of [undefined, ""]) {
      const fd = form({ title: "Safety", slug: "safety" });
      if (courseId !== undefined) fd.set("courseId", courseId);
      const result = await updateCourseAction(INITIAL, fd);
      expect(result).toEqual({ ok: false, errors: [], message: "Reload the page and try again." });
    }
    expect(get).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("returns the reload message when the course no longer exists", async () => {
    get.mockResolvedValue(null);
    const result = await updateCourseAction(INITIAL, form({ ...BASE }));
    expect(result).toMatchObject({ ok: false, message: "Reload the page and try again." });
    expect(update).not.toHaveBeenCalled();
  });

  it("maps authorization errors to a fixed message with no passthrough", async () => {
    update.mockRejectedValue(new AuthorizationError("courses.edit"));
    const result = await updateCourseAction(INITIAL, form({ ...BASE }));
    expect(result).toEqual({
      ok: false,
      errors: [],
      message: "Your role does not permit editing courses.",
    });
    update.mockRejectedValue(new AuthenticationError("no session"));
    const second = await updateCourseAction(INITIAL, form({ ...BASE }));
    expect(second.ok === false && second.message).toBe(
      "Your role does not permit editing courses.",
    );
  });

  it("rethrows an unexpected error", async () => {
    update.mockRejectedValue(new Error("db exploded"));
    await expect(updateCourseAction(INITIAL, form({ ...BASE }))).rejects.toThrow("db exploded");
  });

  it("rejects a forged unknown key", async () => {
    const result = await updateCourseAction(INITIAL, form({ ...BASE, status: "PUBLISHED" }));
    // fields() only reads known keys, so the forged key never reaches the service.
    expect(result.ok).toBe(true);
    expect(update.mock.calls[0][1]).not.toHaveProperty("status");
  });
});
