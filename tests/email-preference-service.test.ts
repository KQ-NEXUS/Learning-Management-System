/**
 * Unit tests for `email-preference-service.ts` (D-16, D-19, T-13-20) against
 * a small in-memory fake store, so "the store holds exactly four rows" can
 * be asserted directly rather than only through mock call assertions.
 */

import { describe, expect, it } from "vitest";
import {
  createEmailPreferenceService,
  InvalidPreferenceError,
  type EmailPreferenceTxClient,
} from "@/server/services/email-preference-service";
import type { Actor } from "@/server/permissions/with-permission";

const ACTOR: Actor = { userId: "user-1" };

function makeFakeStore() {
  const rows = new Map<string, { userId: string; category: string; muted: boolean }>();

  const db = {
    emailPreference: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        return [...rows.values()].filter((row) => {
          if (where.userId !== undefined && row.userId !== where.userId) return false;
          if (where.muted !== undefined && row.muted !== where.muted) return false;
          return true;
        });
      },
    },
  };

  const runInTransaction = async <T>(fn: (tx: EmailPreferenceTxClient) => Promise<T>) => {
    const tx: EmailPreferenceTxClient = {
      emailPreference: {
        upsert: async ({ where, create, update }) => {
          const key = where.userId_category as { userId: string; category: string };
          const mapKey = `${key.userId}:${key.category}`;
          const existing = rows.get(mapKey);
          rows.set(mapKey, existing ? { ...existing, ...update } : (create as typeof existing & {
            userId: string;
            category: string;
            muted: boolean;
          }));
        },
      },
    };
    return fn(tx);
  };

  return { db, runInTransaction, rows };
}

describe("emailPreferenceService.saveMutedCategories (D-16)", () => {
  it("upserts exactly the four mutable categories, muted true for those listed", async () => {
    const { db, runInTransaction, rows } = makeFakeStore();
    const service = createEmailPreferenceService({ db, runInTransaction });

    const saved = await service.saveMutedCategories(ACTOR, ["TICKET_UPDATES"]);

    expect(saved).toEqual(["TICKET_UPDATES"]);
    const userRows = [...rows.values()].filter((r) => r.userId === "user-1");
    expect(userRows).toHaveLength(4);
    const byCategory = Object.fromEntries(userRows.map((r) => [r.category, r.muted]));
    expect(byCategory).toEqual({
      TICKET_UPDATES: true,
      RESULT_NOTICES: false,
      SESSION_CHANGES: false,
      ENROLMENT_STATUS: false,
    });
  });

  it("throws InvalidPreferenceError and writes nothing for an always-sent category (ALWAYS)", async () => {
    const { db, runInTransaction, rows } = makeFakeStore();
    const service = createEmailPreferenceService({ db, runInTransaction });

    await expect(service.saveMutedCategories(ACTOR, ["ALWAYS"])).rejects.toBeInstanceOf(
      InvalidPreferenceError,
    );
    expect(rows.size).toBe(0);
  });

  it("throws InvalidPreferenceError and writes nothing for AUTH", async () => {
    const { db, runInTransaction, rows } = makeFakeStore();
    const service = createEmailPreferenceService({ db, runInTransaction });

    await expect(service.saveMutedCategories(ACTOR, ["AUTH"])).rejects.toBeInstanceOf(
      InvalidPreferenceError,
    );
    expect(rows.size).toBe(0);
  });

  it("throws InvalidPreferenceError and writes nothing for STAFF", async () => {
    const { db, runInTransaction, rows } = makeFakeStore();
    const service = createEmailPreferenceService({ db, runInTransaction });

    await expect(service.saveMutedCategories(ACTOR, ["STAFF"])).rejects.toBeInstanceOf(
      InvalidPreferenceError,
    );
    expect(rows.size).toBe(0);
  });

  it("throws InvalidPreferenceError and writes nothing for an unknown category", async () => {
    const { db, runInTransaction, rows } = makeFakeStore();
    const service = createEmailPreferenceService({ db, runInTransaction });

    await expect(service.saveMutedCategories(ACTOR, ["nonsense"])).rejects.toBeInstanceOf(
      InvalidPreferenceError,
    );
    expect(rows.size).toBe(0);
  });

  it("mixing TICKET_UPDATES with an always-sent category rejects the whole call", async () => {
    const { db, runInTransaction, rows } = makeFakeStore();
    const service = createEmailPreferenceService({ db, runInTransaction });

    await expect(
      service.saveMutedCategories(ACTOR, ["TICKET_UPDATES", "STAFF"]),
    ).rejects.toBeInstanceOf(InvalidPreferenceError);
    expect(rows.size).toBe(0);
  });
});

describe("emailPreferenceService.getMutedCategories", () => {
  it("returns an empty list when the user has no rows", async () => {
    const { db, runInTransaction } = makeFakeStore();
    const service = createEmailPreferenceService({ db, runInTransaction });

    expect(await service.getMutedCategories(ACTOR)).toEqual([]);
  });

  it("returns exactly the categories muted for the caller, never another user's", async () => {
    const { db, runInTransaction } = makeFakeStore();
    const service = createEmailPreferenceService({ db, runInTransaction });
    await service.saveMutedCategories(ACTOR, ["TICKET_UPDATES", "RESULT_NOTICES"]);
    await service.saveMutedCategories({ userId: "user-2" }, ["SESSION_CHANGES"]);

    const muted = await service.getMutedCategories(ACTOR);
    expect(muted.sort()).toEqual(["RESULT_NOTICES", "TICKET_UPDATES"]);
  });
});
