/**
 * The caller's own email preference store (D-16, D-19, T-13-20).
 *
 * A learner may mute exactly the four mutable categories
 * (`MUTABLE_EMAIL_CATEGORIES`) — never `ALWAYS`, `AUTH`, or `STAFF`. The
 * write set in `saveMutedCategories` is fixed to that list, so an
 * always-sent category can never be persisted as muted no matter what a
 * caller passes in; an unknown or always-sent category throws
 * `InvalidPreferenceError` and writes nothing (validated before the
 * transaction opens).
 *
 * Preferences are upserted per `(userId, category)` and never deleted
 * (matches the schema comment on `EmailPreference`): the absence of a row
 * means "not muted". Muting an email category never touches the
 * `Notification` table — a muted category still produces the in-product
 * notification (D-19).
 */

import { prisma } from "@/server/db";
import {
  MUTABLE_EMAIL_CATEGORIES,
  type MutableEmailCategory,
} from "@/server/communications/contracts";
import type { Actor } from "@/server/permissions/with-permission";

export class InvalidPreferenceError extends Error {
  constructor(message = "Invalid email preference category.") {
    super(message);
    this.name = "InvalidPreferenceError";
  }
}

const MUTABLE_SET: ReadonlySet<string> = new Set(MUTABLE_EMAIL_CATEGORIES);

export type EmailPreferenceRow = { category: string; muted: boolean };

/** The narrow slice of the Prisma client `getMutedCategories` reads from. */
export type EmailPreferenceStore = {
  emailPreference: {
    findMany(args: { where: Record<string, unknown> }): Promise<EmailPreferenceRow[]>;
  };
};

/** The narrow transaction-client shape `saveMutedCategories` writes through. */
export type EmailPreferenceTxClient = {
  emailPreference: {
    upsert(args: {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
  };
};

export function createEmailPreferenceService(deps: {
  db: EmailPreferenceStore;
  runInTransaction: <T>(fn: (tx: EmailPreferenceTxClient) => Promise<T>) => Promise<T>;
}) {
  const { db, runInTransaction } = deps;

  /** Categories currently muted for `actor`. Empty when the user has no rows. */
  async function getMutedCategories(actor: Actor): Promise<MutableEmailCategory[]> {
    const rows = await db.emailPreference.findMany({
      where: { userId: actor.userId, muted: true },
    });
    return rows
      .map((row) => row.category)
      .filter((category): category is MutableEmailCategory => MUTABLE_SET.has(category));
  }

  /**
   * Upserts exactly the four mutable categories for `actor` in one
   * transaction: `muted: true` for those in `muted`, `muted: false` for the
   * rest. Throws `InvalidPreferenceError` — before any write — when `muted`
   * contains anything outside the mutable set (an always-sent category or
   * an unknown string).
   */
  async function saveMutedCategories(
    actor: Actor,
    muted: readonly string[],
  ): Promise<MutableEmailCategory[]> {
    const requested = new Set(muted);
    for (const category of requested) {
      if (!MUTABLE_SET.has(category)) {
        throw new InvalidPreferenceError();
      }
    }

    await runInTransaction(async (tx) => {
      for (const category of MUTABLE_EMAIL_CATEGORIES) {
        const isMuted = requested.has(category);
        await tx.emailPreference.upsert({
          where: { userId_category: { userId: actor.userId, category } },
          create: { userId: actor.userId, category, muted: isMuted },
          update: { muted: isMuted },
        });
      }
    });

    return MUTABLE_EMAIL_CATEGORIES.filter((category) => requested.has(category));
  }

  return { getMutedCategories, saveMutedCategories };
}

export const emailPreferenceService = createEmailPreferenceService({
  db: prisma as unknown as EmailPreferenceStore,
  runInTransaction: (fn) =>
    prisma.$transaction((tx) => fn(tx as unknown as EmailPreferenceTxClient)),
});
