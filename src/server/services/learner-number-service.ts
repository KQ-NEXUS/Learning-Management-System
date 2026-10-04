/**
 * Learner numbers: settings and issuing (owner decisions, 2026-10-04).
 *
 * See `@/lib/learner-number` for the format. This file owns the two things
 * that touch the database:
 *
 *   - the settings an administrator edits (`getLearnerNumberSettings`,
 *     `saveLearnerNumberPattern`), gated by `users.manage` at GLOBAL scope;
 *   - `issueLearnerNumber`, called INSIDE the transaction that creates a
 *     learner, so a number is taken only if the account is actually created.
 *
 * Issuing is one atomic statement: the counter is incremented and read back in
 * a single UPDATE … RETURNING, which Postgres serialises on the settings row.
 * Two registrations at the same instant therefore get consecutive numbers,
 * never the same one. `issueLearnerNumber` itself carries no permission check:
 * it is not an action anyone invokes, it is a step of registration.
 *
 * Nothing is issued until a pattern is saved, and saving one never gives a
 * number to a learner who registered before. The counter only moves forward.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { withPermission as liveWithPermission } from "@/server/permissions";
import { recordAudit } from "@/server/services/audit-service";
import { formatLearnerNumber, parseLearnerNumberPattern, previewLearnerNumbers } from "@/lib/learner-number";

const CONFIG_ID = "default";
/** How many counter values to try if a formatted number is somehow already taken. */
const MAX_ISSUE_ATTEMPTS = 20;

export type LearnerNumberSettings = {
  /** `null` while learner numbers are switched off. */
  pattern: string | null;
  nextSequence: number;
  /** Learners who hold a number. */
  issued: number;
  /** Learners with no number (registered before a pattern was set). */
  withoutNumber: number;
  /** The next numbers the saved pattern would issue; empty when switched off. */
  preview: string[];
};

export class InvalidLearnerNumberPatternError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLearnerNumberPatternError";
  }
}

/** The transaction surface `issueLearnerNumber` needs; a Prisma transaction client satisfies it. */
export type LearnerNumberTx = {
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]): Promise<T>;
  user: { findUnique(args: { where: { learnerNumber: string }; select: { id: true } }): Promise<{ id: string } | null> };
};

/**
 * Takes the next learner number, or returns `null` when numbers are switched
 * off. Must be called inside the transaction that creates the learner.
 */
export async function issueLearnerNumber(tx: LearnerNumberTx, at: Date): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_ISSUE_ATTEMPTS; attempt++) {
    const rows = await tx.$queryRaw<Array<{ pattern: string; sequence: number }>>(Prisma.sql`
      UPDATE "LearnerNumberConfig"
      SET "nextSequence" = "nextSequence" + 1
      WHERE "id" = ${CONFIG_ID} AND "pattern" IS NOT NULL
      RETURNING "pattern", "nextSequence" - 1 AS "sequence"
    `);
    const row = rows[0];
    if (!row) return null; // switched off

    const candidate = formatLearnerNumber(row.pattern, Number(row.sequence), at);
    // A counter value is never reused, but two DIFFERENT patterns can spell the
    // same text (A## at 12 and A1# at 2 are both "A12"). Skip a number that an
    // earlier pattern already issued rather than fail the registration.
    const taken = await tx.user.findUnique({ where: { learnerNumber: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  throw new Error("Could not issue a learner number: too many candidates were already taken.");
}

export type LearnerNumberServiceDeps = {
  config: {
    findUnique(args: { where: { id: string } }): Promise<{ pattern: string | null; nextSequence: number } | null>;
    upsert(args: {
      where: { id: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<{ pattern: string | null; nextSequence: number }>;
  };
  user: { count(args: { where: Record<string, unknown> }): Promise<number> };
  withPermission: typeof liveWithPermission;
  audit: typeof recordAudit;
  now?: () => Date;
};

export function createLearnerNumberService(deps: LearnerNumberServiceDeps) {
  const now = deps.now ?? (() => new Date());

  async function snapshot(): Promise<LearnerNumberSettings> {
    const [config, issued, withoutNumber] = await Promise.all([
      deps.config.findUnique({ where: { id: CONFIG_ID } }),
      deps.user.count({ where: { learnerNumber: { not: null } } }),
      deps.user.count({ where: { isStaff: false, learnerNumber: null } }),
    ]);
    const pattern = config?.pattern ?? null;
    const nextSequence = config?.nextSequence ?? 1;
    return {
      pattern,
      nextSequence,
      issued,
      withoutNumber,
      preview: pattern ? previewLearnerNumbers(pattern, nextSequence, now()) : [],
    };
  }

  const getLearnerNumberSettings = deps.withPermission<void>("users.manage", () => ({}))(async () => snapshot());

  /**
   * Sets the pattern new learners' numbers are formed from. Existing numbers
   * are untouched and the counter carries on from where it stands.
   */
  const saveLearnerNumberPattern = deps.withPermission<{ pattern: string }>("users.manage", () => ({}))(
    async (input, ctx) => {
      const pattern = input.pattern.trim();
      const parsed = parseLearnerNumberPattern(pattern);
      if (!parsed.ok) throw new InvalidLearnerNumberPatternError(parsed.message);

      const before = await deps.config.findUnique({ where: { id: CONFIG_ID } });
      await deps.config.upsert({
        where: { id: CONFIG_ID },
        create: { id: CONFIG_ID, pattern, nextSequence: 1, updatedById: ctx.actor.userId },
        update: { pattern, updatedById: ctx.actor.userId },
      });

      await deps.audit({
        action: "learner_number.pattern_changed",
        targetType: "LearnerNumberConfig",
        targetId: CONFIG_ID,
        actorId: ctx.actor.userId,
        outcome: "SUCCESS",
        reason: null,
        before: { pattern: before?.pattern ?? null },
        after: { pattern },
      });

      return snapshot();
    },
  );

  return { getLearnerNumberSettings, saveLearnerNumberPattern };
}

const built = createLearnerNumberService({
  config: prisma.learnerNumberConfig as unknown as LearnerNumberServiceDeps["config"],
  user: prisma.user as unknown as LearnerNumberServiceDeps["user"],
  withPermission: liveWithPermission,
  audit: recordAudit,
});

export const getLearnerNumberSettings = built.getLearnerNumberSettings;
export const saveLearnerNumberPattern = built.saveLearnerNumberPattern;
