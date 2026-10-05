/**
 * Who the "Choose a learner" pop-up may list when staff add an enrolment:
 * learner accounts only, searchable by name, email or learner number, behind
 * the same permission as adding the enrolment.
 */

import { describe, expect, it, vi } from "vitest";
import { createTestWithPermission, grant } from "./support/harness";
import { AuthorizationError } from "@/server/permissions/with-permission";
import {
  createEnrolmentCandidateService,
  ENROLMENT_CANDIDATE_LIMIT,
  type EnrolmentCandidateDeps,
} from "@/server/services/enrolment-candidate-service";

function harness(grants = [grant("enrolments.manage")]) {
  const findMany = vi.fn(async (args: Record<string, unknown>) => {
    void args;
    return [
      { id: "u1", name: "Ngozi Eze", email: "ngozi.a@example.test", learnerNumber: "KQL-000001", status: "ACTIVE", enrolments: [] },
      {
        id: "u2",
        name: "Ngozi Eze",
        email: "ngozi.b@example.test",
        learnerNumber: "KQL-000002",
        status: "ACTIVE",
        enrolments: [{ status: "ACTIVE" }],
      },
      { id: "u3", name: "Old Learner", email: "old@example.test", learnerNumber: null, status: "PENDING_VERIFICATION", enrolments: [] },
    ];
  });
  const count = vi.fn(async (args: Record<string, unknown>) => {
    void args;
    return 312;
  });
  const service = createEnrolmentCandidateService({
    user: { findMany, count } as unknown as EnrolmentCandidateDeps["user"],
    toScope: (async (cohortId: string) => ({ cohortId })) as unknown as EnrolmentCandidateDeps["toScope"],
    withPermission: createTestWithPermission(grants).withPermission as unknown as EnrolmentCandidateDeps["withPermission"],
  });
  return { service, findMany, count };
}

const whereOf = (mock: { mock: { calls: unknown[][] } }) => (mock.mock.calls[0]![0] as { where: Record<string, unknown> }).where;

describe("listEnrolmentCandidates", () => {
  it("asks only for learner accounts that are not deactivated, capped, same names together", async () => {
    const { service, findMany } = harness();
    await service.listEnrolmentCandidates({ cohortId: "cohort-1" });

    const args = findMany.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.where).toEqual({ isStaff: false, status: { in: ["ACTIVE", "PENDING_VERIFICATION"] } });
    expect(args.take).toBe(ENROLMENT_CANDIDATE_LIMIT);
    expect(args.orderBy).toEqual([{ name: "asc" }, { email: "asc" }]);
  });

  it("searches name, email and learner number, ignoring case and stray spaces", async () => {
    const { service, findMany } = harness();
    await service.listEnrolmentCandidates({ cohortId: "cohort-1", query: "  kql-0000  " });

    expect(whereOf(findMany).OR).toEqual([
      { name: { contains: "kql-0000", mode: "insensitive" } },
      { email: { contains: "kql-0000", mode: "insensitive" } },
      { learnerNumber: { contains: "kql-0000", mode: "insensitive" } },
    ]);
  });

  it("a search never widens the list beyond learners", async () => {
    const { service, findMany, count } = harness();
    await service.listEnrolmentCandidates({ cohortId: "cohort-1", query: "admin" });

    expect(whereOf(findMany)).toMatchObject({ isStaff: false });
    expect(whereOf(count)).toEqual(whereOf(findMany));
  });

  it("returns each learner's number, and the place they already hold in this cohort only", async () => {
    const { service, findMany } = harness();
    const result = await service.listEnrolmentCandidates({ cohortId: "cohort-1" });

    const select = (findMany.mock.calls[0]![0] as { select: { enrolments: { where: Record<string, unknown> } } }).select;
    expect(select.enrolments.where).toEqual({
      cohortId: "cohort-1",
      status: { in: ["ACTIVE", "COMPLETED", "PENDING_PAYMENT"] },
    });
    expect(result.people).toEqual([
      { id: "u1", name: "Ngozi Eze", email: "ngozi.a@example.test", learnerNumber: "KQL-000001", unverified: false, enrolledStatus: null },
      { id: "u2", name: "Ngozi Eze", email: "ngozi.b@example.test", learnerNumber: "KQL-000002", unverified: false, enrolledStatus: "ACTIVE" },
      { id: "u3", name: "Old Learner", email: "old@example.test", learnerNumber: null, unverified: true, enrolledStatus: null },
    ]);
  });

  it("reports how many match in all, so the screen can say the list was cut short", async () => {
    const { service } = harness();
    expect((await service.listEnrolmentCandidates({ cohortId: "cohort-1" })).total).toBe(312);
  });

  it("is refused without enrolments.manage, and lists nobody", async () => {
    const { service, findMany, count } = harness([grant("cohorts.view")]);
    await expect(service.listEnrolmentCandidates({ cohortId: "cohort-1" })).rejects.toBeInstanceOf(AuthorizationError);
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });
});
