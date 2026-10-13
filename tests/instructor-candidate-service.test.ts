/**
 * Who the "Add instructor" pop-up may list: active staff only, behind the same
 * permission as assigning an instructor.
 */

import { describe, expect, it, vi } from "vitest";
import { createTestWithPermission, grant } from "./support/harness";
import { AuthorizationError } from "@/server/permissions/with-permission";
import {
  createInstructorCandidateService,
  INSTRUCTOR_CANDIDATE_LIMIT,
  type InstructorCandidateDeps,
} from "@/server/services/instructor-candidate-service";

function harness(grants = [grant("cohorts.manage")]) {
  const userFindMany = vi.fn(async (args: { where: Record<string, unknown> }) => {
    void args;
    return [
      { id: "u1", name: "Ije Instructor", email: "ije@example.test", assignments: [{ role: { name: "Instructor" } }] },
      {
        id: "u2",
        name: "Tunde Bakare",
        email: "tunde@example.test",
        assignments: [{ role: { name: "Programme Manager" } }, { role: { name: "Instructor" } }, { role: { name: "Instructor" } }],
      },
      { id: "u3", name: "Zed Norole", email: "zed@example.test", assignments: [] },
    ];
  });
  const instructorFindMany = vi.fn(async () => [{ userId: "u1" }]);
  const service = createInstructorCandidateService({
    user: { findMany: userFindMany } as unknown as InstructorCandidateDeps["user"],
    cohortInstructor: { findMany: instructorFindMany } as unknown as InstructorCandidateDeps["cohortInstructor"],
    toScope: (async (cohortId: string) => ({ cohortId })) as unknown as InstructorCandidateDeps["toScope"],
    withPermission: createTestWithPermission(grants).withPermission as unknown as InstructorCandidateDeps["withPermission"],
  });
  return { service, userFindMany, instructorFindMany };
}

describe("listInstructorCandidates", () => {
  it("asks only for active staff accounts, never learners, capped and in name order", async () => {
    const { service, userFindMany } = harness();
    await service.listInstructorCandidates({ cohortId: "cohort-1" });

    const args = userFindMany.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(args.where).toEqual({ isStaff: true, status: "ACTIVE" });
    expect(args.take).toBe(INSTRUCTOR_CANDIDATE_LIMIT);
    expect(args.orderBy).toEqual({ name: "asc" });
  });

  it("returns each person's roles once each, and marks who is already an instructor here", async () => {
    const { service, instructorFindMany } = harness();
    const people = await service.listInstructorCandidates({ cohortId: "cohort-1" });

    expect(instructorFindMany).toHaveBeenCalledWith({ where: { cohortId: "cohort-1" }, select: { userId: true } });
    expect(people).toEqual([
      { id: "u1", name: "Ije Instructor", email: "ije@example.test", roles: ["Instructor"], assigned: true },
      { id: "u2", name: "Tunde Bakare", email: "tunde@example.test", roles: ["Instructor", "Programme Manager"], assigned: false },
      { id: "u3", name: "Zed Norole", email: "zed@example.test", roles: [], assigned: false },
    ]);
  });

  it("a search matches name or email, ignoring case, still limited to active staff", async () => {
    const { service, userFindMany } = harness();
    await service.listInstructorCandidates({ cohortId: "cohort-1", query: "  Tunde " });

    expect((userFindMany.mock.calls[0]![0] as { where: unknown }).where).toEqual({
      isStaff: true,
      status: "ACTIVE",
      OR: [
        { name: { contains: "Tunde", mode: "insensitive" } },
        { email: { contains: "Tunde", mode: "insensitive" } },
      ],
    });
  });

  it("someone who may not manage the cohort's instructors gets no list of staff", async () => {
    const { service, userFindMany } = harness([grant("cohorts.view")]);

    await expect(service.listInstructorCandidates({ cohortId: "cohort-1" })).rejects.toBeInstanceOf(AuthorizationError);
    expect(userFindMany).not.toHaveBeenCalled();
  });
});
