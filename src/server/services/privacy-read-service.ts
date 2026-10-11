/**
 * Learner privacy lookups, the read side of the D-12 privacy tool screens
 * (Phase 15, plan 15-22; NFR-11).
 *
 * Two reads back `/staff/privacy` and `/staff/privacy/[userId]`:
 *
 *   - `findLearnerForPrivacy`: finds ONE learner by exact email address (trimmed,
 *     case-insensitive) or exact learner number. There is no partial match, no
 *     list and no suggestion (the tool works on one known person at a time, so
 *     it cannot be used to browse or mass-export personal data). Staff accounts,
 *     unknown values and malformed input all return `null`, so the screen can
 *     give one "no match" answer for every one of them.
 *   - `getPrivacyRecord`: the facts the record page shows for one learner, plus
 *     the state of the signed-in staff member's latest data export for them.
 *     Unknown ids and staff accounts return `null`. A learner who has already
 *     been anonymised still has a record (the page shows the outcome).
 *
 * Authorisation: both reads run behind `privacy.manage` at Global scope through
 * `withPermission`. That permission is a licence "write" because it also guards
 * anonymisation, but finding a learner and opening their record is the way into
 * the data-export route that LIC-08 keeps open in restricted mode. Exactly like
 * `privacy-export-service.ts`, the single permission call site below carries a
 * reviewed `{ licence: "continuity" }` override (pinned in the registry
 * snapshot and in `tests/licence-enforcement-boundary.test.ts`). Anonymisation
 * itself stays blocked: it lives in `privacy-anonymise-service.ts`.
 *
 * A caller without the permission gets `AuthorizationError`, which the screens
 * turn into the standard 404, the same as an unknown id, so a denial never
 * confirms that an account exists.
 *
 * Reads only. This file never writes and never deletes (the static scan in
 * `tests/privacy-no-hard-delete.test.ts` covers every `privacy-*.ts` file).
 */

import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { withPermission } from "@/server/permissions";
import type { createWithPermission } from "@/server/permissions/with-permission";
import { privacyExportService, type LearnerExportStatus } from "@/server/services/privacy-export-service";

type WithPermission = ReturnType<typeof createWithPermission>;

/** Longest value the lookup will consider; an email address is at most 254 characters. */
export const PRIVACY_LOOKUP_MAX_LENGTH = 254;

/** The words a record's account status can take on the screen. */
export type PrivacyAccountStatus = "ACTIVE" | "PENDING_VERIFICATION" | "DEACTIVATED" | "ANONYMISED";

export type PrivacyLookupMatch = { userId: string };

export type PrivacyRecord = {
  userId: string;
  name: string;
  email: string;
  learnerNumber: string | null;
  /** `ANONYMISED` whenever `anonymisedAt` is set, whatever the stored status is. */
  accountStatus: PrivacyAccountStatus;
  registeredAt: Date;
  enrolmentCount: number;
  anonymisedAt: Date | null;
  /** The staff member who anonymised the account, or null when unknown. */
  anonymisedByName: string | null;
  /** The signed-in staff member's latest data export for this learner. */
  exportStatus: LearnerExportStatus;
};

/** The slice of persistence this service reads. */
export type PrivacyReadStore = {
  user: Pick<PrismaClient["user"], "findFirst" | "findUnique">;
};

const NO_EXPORT: LearnerExportStatus = Object.freeze({
  state: "none",
  jobId: null,
  requestedAt: null,
  expiresAt: null,
  canDownload: false,
  downloadPath: null,
  canRetry: false,
  inFlight: false,
});

/** A learner here is a non-staff account that holds no role assignment (as in the export and anonymise services). */
const LEARNER_ONLY = { isStaff: false, assignments: { none: {} } } as const;

export function createPrivacyReadService(deps: {
  store: PrivacyReadStore;
  withPermission: WithPermission;
  /** The latest export state for one learner, for the signed-in staff member. */
  exportStatus: (input: { userId: string }) => Promise<LearnerExportStatus>;
}) {
  const { store, withPermission: authorize, exportStatus } = deps;

  async function find(query: unknown): Promise<PrivacyLookupMatch | null> {
    const raw = typeof query === "string" ? query.trim() : "";
    // An address or a learner number never contains a space, so a value with
    // one is malformed input, not a search.
    if (raw.length === 0 || raw.length > PRIVACY_LOOKUP_MAX_LENGTH || /\s/.test(raw)) return null;
    // Registration and sign-in store and compare addresses lowercased, so an
    // exact lowercased match is the whole of "case-insensitive" here. No LIKE
    // or ILIKE, so `%` and `_` in the input mean nothing special.
    const user = await store.user.findFirst({
      where: { ...LEARNER_ONLY, OR: [{ email: raw.toLowerCase() }, { learnerNumber: raw }] },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    return user ? { userId: user.id } : null;
  }

  async function record(userId: unknown): Promise<PrivacyRecord | null> {
    const id = typeof userId === "string" ? userId.trim() : "";
    if (id.length === 0 || id.length > 128) return null;
    const user = await store.user.findFirst({
      where: { id, ...LEARNER_ONLY },
      select: {
        id: true,
        name: true,
        email: true,
        learnerNumber: true,
        status: true,
        createdAt: true,
        anonymisedAt: true,
        anonymisedById: true,
        _count: { select: { enrolments: true } },
      },
    });
    if (!user) return null;

    let anonymisedByName: string | null = null;
    if (user.anonymisedAt !== null && user.anonymisedById) {
      const by = await store.user.findUnique({ where: { id: user.anonymisedById }, select: { name: true } });
      anonymisedByName = by?.name ?? null;
    }

    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      learnerNumber: user.learnerNumber,
      accountStatus: user.anonymisedAt !== null ? "ANONYMISED" : user.status,
      registeredAt: user.createdAt,
      enrolmentCount: user._count.enrolments,
      anonymisedAt: user.anonymisedAt,
      anonymisedByName,
      // Nothing is left to export once the account is anonymised.
      exportStatus: user.anonymisedAt !== null ? NO_EXPORT : await exportStatus({ userId: user.id }),
    };
  }

  // ONE permission call site for the file (the licence boundary test pins one
  // reviewed override per file and permission). privacy.manage is a licence
  // "write" because it also guards anonymisation; this site carries the
  // reviewed continuity exception for LIC-08 permitted data access. Global
  // scope: an empty ResourceScope matches only a Global grant, and
  // privacy.manage is Global-only in the catalogue.
  type Operation = { kind: "find"; query: string } | { kind: "record"; userId: string };
  const run = authorize<Operation>(
    "privacy.manage",
    () => ({}),
    { licence: "continuity", reason: "LIC-08 permitted data access (lookup)" },
  )(async (operation): Promise<PrivacyLookupMatch | PrivacyRecord | null> =>
    operation.kind === "find" ? find(operation.query) : record(operation.userId),
  );

  return {
    findLearnerForPrivacy: (input: { query: string }) =>
      run({ kind: "find", query: input.query }) as Promise<PrivacyLookupMatch | null>,
    getPrivacyRecord: (input: { userId: string }) =>
      run({ kind: "record", userId: input.userId }) as Promise<PrivacyRecord | null>,
  };
}

export const privacyReadService = createPrivacyReadService({
  store: prisma as unknown as PrivacyReadStore,
  withPermission,
  exportStatus: (input) => privacyExportService.getLearnerExportStatus(input),
});
