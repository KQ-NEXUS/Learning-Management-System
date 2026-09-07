import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The course arrange route (`src/app/staff/courses/[id]/arrange/page.tsx`)
 * collects withdrawn lessons in a `for` loop that, before this fix, sat OUTSIDE
 * the `try/catch` that maps `AuthorizationError` to `notFound()`. A denial in
 * that loop rendered a 500 instead of the existence-hiding 404 the rest of the
 * route is careful to return — an information-bearing difference between "you
 * may not see this course" and "this course does not exist" (WR-03, RBAC-06
 * denial parity).
 *
 * Graded like `tests/lesson-preview-route.test.ts`: the page is a Server
 * Component, invoked directly; its returned element (or its `notFound()` throw)
 * is inspected. `notFound()` really throws in Next, so the mock throws too.
 */

const NOT_FOUND = "NEXT_NOT_FOUND";

const { mocks, AuthorizationError } = vi.hoisted(() => {
  class AuthorizationError extends Error {}
  return {
    AuthorizationError,
    mocks: {
      courseGet: vi.fn(),
      loadCourseTree: vi.fn(),
      listWithdrawnModules: vi.fn(),
      listWithdrawnLessons: vi.fn(),
      serialiseOrderToken: vi.fn(),
      notFound: vi.fn(() => {
        throw new Error(NOT_FOUND);
      }),
    },
  };
});

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/server/permissions", () => ({ AuthorizationError }));
vi.mock("@/server/services/course-service", () => ({
  courseService: { get: mocks.courseGet },
}));
vi.mock("@/server/services/module-service", () => ({
  listWithdrawnModules: mocks.listWithdrawnModules,
}));
vi.mock("@/server/services/lesson-service", () => ({
  loadCourseTree: mocks.loadCourseTree,
  listWithdrawnLessons: mocks.listWithdrawnLessons,
}));
vi.mock("@/server/services/reorder-service", () => ({
  serialiseOrderToken: mocks.serialiseOrderToken,
}));
vi.mock("@/components/catalogue", () => ({
  UnsavedOrderProvider: ({ children }: { children: unknown }) => children,
  GuardedLink: () => null,
}));
vi.mock("@/app/staff/courses/[id]/arrange/ArrangeClient", () => ({
  ArrangeClient: () => null,
}));

import Page from "@/app/staff/courses/[id]/arrange/page";

const run = (id = "course-1") =>
  Page({ params: Promise.resolve({ id }) } as never);

const tree = () => ({
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  modules: [
    { id: "module-1", title: "One", lessons: [] },
    { id: "module-2", title: "Two", lessons: [] },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.notFound.mockImplementation(() => {
    throw new Error(NOT_FOUND);
  });
  mocks.courseGet.mockResolvedValue({ id: "course-1", title: "Course", slug: "course" });
  mocks.loadCourseTree.mockResolvedValue(tree());
  mocks.listWithdrawnModules.mockResolvedValue([{ id: "module-3", title: "Withdrawn" }]);
  mocks.listWithdrawnLessons.mockResolvedValue([]);
  mocks.serialiseOrderToken.mockReturnValue("token");
});

describe("arrange route — a denied withdrawn-lesson load hides existence", () => {
  it("maps an AuthorizationError from listWithdrawnLessons to the same notFound response as a missing course", async () => {
    mocks.listWithdrawnLessons.mockRejectedValue(new AuthorizationError("denied"));

    await expect(run()).rejects.toThrow(NOT_FOUND);
    expect(mocks.notFound).toHaveBeenCalled();
  });

  it("lets an unrelated failure propagate instead of disguising it as not-found", async () => {
    mocks.listWithdrawnLessons.mockRejectedValue(new Error("db pool exhausted"));

    await expect(run()).rejects.toThrow("db pool exhausted");
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("keeps collecting withdrawn lessons once per module on the happy path", async () => {
    const result = await run();

    expect(result).toBeTruthy();
    expect(mocks.listWithdrawnLessons).toHaveBeenCalledTimes(3);
    expect(mocks.listWithdrawnLessons.mock.calls.map((c) => c[0])).toEqual([
      "module-1",
      "module-2",
      "module-3",
    ]);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});
