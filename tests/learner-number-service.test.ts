/**
 * The learner number settings: who may read and change them, what a save
 * touches, and what it leaves alone (owner decisions, 2026-10-04).
 */

import { describe, expect, it, vi } from "vitest";
import { createTestWithPermission, grant } from "./support/harness";
import { AuthorizationError } from "@/server/permissions/with-permission";
import {
  createLearnerNumberService,
  InvalidLearnerNumberPatternError,
  type LearnerNumberServiceDeps,
} from "@/server/services/learner-number-service";

const AT = new Date("2026-10-04T12:00:00.000Z");

function harness(
  grants = [grant("users.manage")],
  stored: { pattern: string | null; nextSequence: number } | null = { pattern: null, nextSequence: 1 },
) {
  let row = stored;
  const findUnique = vi.fn(async () => row);
  const upsert = vi.fn(async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
    row = row
      ? { ...row, pattern: args.update.pattern as string }
      : { pattern: args.create.pattern as string, nextSequence: args.create.nextSequence as number };
    return row;
  });
  const count = vi.fn(async (args: { where: Record<string, unknown> }) => ("isStaff" in args.where ? 7 : 3));
  const audit = vi.fn(async () => undefined);
  const service = createLearnerNumberService({
    config: { findUnique, upsert } as unknown as LearnerNumberServiceDeps["config"],
    user: { count } as unknown as LearnerNumberServiceDeps["user"],
    withPermission: createTestWithPermission(grants).withPermission as unknown as LearnerNumberServiceDeps["withPermission"],
    audit: audit as unknown as LearnerNumberServiceDeps["audit"],
    now: () => AT,
  });
  return { service, findUnique, upsert, count, audit };
}

describe("getLearnerNumberSettings", () => {
  it("reports numbering as off, with no preview, until a pattern is saved", async () => {
    const { service } = harness();
    expect(await service.getLearnerNumberSettings()).toEqual({
      pattern: null,
      nextSequence: 1,
      issued: 3,
      withoutNumber: 7,
      preview: [],
    });
  });

  it("previews from where the counter stands, not from 1", async () => {
    const { service } = harness(undefined, { pattern: "KQ/{YY}/####", nextSequence: 41 });
    const settings = await service.getLearnerNumberSettings();
    expect(settings.preview[0]).toBe("KQ/26/0041");
    expect(settings.preview[1]).toBe("KQ/26/0042");
  });

  it("counts only learners, never staff, as being without a number", async () => {
    const { service, count } = harness();
    await service.getLearnerNumberSettings();
    expect(count).toHaveBeenCalledWith({ where: { isStaff: false, learnerNumber: null } });
  });

  it("is refused without users.manage, and reads nothing", async () => {
    const { service, findUnique, count } = harness([grant("cohorts.manage")]);
    await expect(service.getLearnerNumberSettings()).rejects.toBeInstanceOf(AuthorizationError);
    expect(findUnique).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });
});

describe("saveLearnerNumberPattern", () => {
  it("saves the trimmed pattern and returns the new settings", async () => {
    const { service, upsert } = harness();
    const settings = await service.saveLearnerNumberPattern({ pattern: "  KQL-######  " });

    expect(upsert.mock.calls[0]![0].update).toMatchObject({ pattern: "KQL-######" });
    expect(settings.pattern).toBe("KQL-######");
    expect(settings.preview[0]).toBe("KQL-000001");
  });

  it("never moves the counter when the pattern changes", async () => {
    const { service, upsert } = harness(undefined, { pattern: "KQL-####", nextSequence: 58 });
    const settings = await service.saveLearnerNumberPattern({ pattern: "STU-#####" });

    expect(upsert.mock.calls[0]![0].update).not.toHaveProperty("nextSequence");
    expect(settings.nextSequence).toBe(58);
    expect(settings.preview[0]).toBe("STU-00058");
  });

  it("records who changed the pattern, and from what to what", async () => {
    const { service, audit } = harness(undefined, { pattern: "KQL-####", nextSequence: 5 });
    await service.saveLearnerNumberPattern({ pattern: "STU-#####" });

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "learner_number.pattern_changed",
        targetType: "LearnerNumberConfig",
        outcome: "SUCCESS",
        before: { pattern: "KQL-####" },
        after: { pattern: "STU-#####" },
      }),
    );
  });

  it.each(["", "KQL-", "KQL-##", "KQL ####", "KQL-###-###"])("refuses the pattern %j and saves nothing", async (pattern) => {
    const { service, upsert, audit } = harness();
    await expect(service.saveLearnerNumberPattern({ pattern })).rejects.toBeInstanceOf(InvalidLearnerNumberPatternError);
    expect(upsert).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("is refused without users.manage, and saves nothing", async () => {
    const { service, upsert } = harness([grant("cohorts.manage")]);
    await expect(service.saveLearnerNumberPattern({ pattern: "KQL-######" })).rejects.toBeInstanceOf(AuthorizationError);
    expect(upsert).not.toHaveBeenCalled();
  });
});
