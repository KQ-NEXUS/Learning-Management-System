/**
 * Post-commit certificate file generation (CR-01b, WR-01): renders a
 * certificate's PDF from the row's own snapshotted facts, stores it, and sets
 * `Certificate.storageKey`, AFTER the transaction that issued the row has
 * committed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MECHANISM — TWO-PHASE ISSUANCE.
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase A (`certificate-issuance-service.ts`, inside the caller's transaction):
 * every database fact — the `Certificate` row with `storageKey: null`, the
 * COMPLETED transition, the audit row and the domain event — and a call to
 * `registerPendingCertificateFile(tx, certificateId)`. No PDF work, no
 * object-store call, no layout parsing.
 *
 * Phase B (this module, after commit): render, store, compare-and-set
 * `storageKey`. Best effort. It catches everything, logs only the certificate
 * id and the error NAME, is time-bounded, and can never throw to the caller.
 * If it does not complete, the row exists without a file and the file is
 * produced lazily on demand through `ensureCertificateFile` (plan 11-31 wires
 * the download route), idempotently.
 *
 * WHY NOT "catch inside the transaction": a slow object store or a large logo
 * can push the caller's interactive transaction past Prisma's default 5 s
 * timeout (P2028), which rolls the caller's lesson-progress / attendance write
 * back regardless of any try/catch around the render. Only moving the work out
 * of the transaction gives the guarantee. This also fixes WR-01 (render and S3
 * calls inside the caller's transaction, and orphaned stored objects when that
 * transaction later rolls back: the file is only ever written for a row that
 * has already committed).
 *
 * The service layer must not import `next/*`, so Next's `after()` is not used.
 * The composition roots (plan 11-31) instead await `settlePendingCertificateFiles`
 * through `runTransactionThenSettleCertificateFiles`, with the bounded wait
 * below.
 *
 * D-03 (issuance in the same transaction that satisfies the completion record),
 * D-05 (COMPLETED written only by the issuance service, only with a certificate
 * row) and D-07 (a fresh per-learner PDF, rendered from the row's own snapshot)
 * all still hold. Honest consequence for D-07: the row is committed before its
 * file exists, so a learner may briefly see an issued certificate whose file is
 * still being finalised; the download route produces it on demand.
 *
 * SETTLE TIMEOUT (`DEFAULT_SETTLE_TIMEOUT_MS`, 6_000 ms). Settle is awaited
 * inside the learner's lesson-progress request or the staff attendance
 * request, so the bound is the worst-case latency added to a click. A normal
 * render of a subset-font one-page PDF plus one object-store put finishes well
 * under two seconds; 6 s absorbs a slow store without making a lesson-complete
 * click hang for the 15 s a longer bound would allow. When it expires the row
 * simply stays file-less and the on-demand download path completes it.
 *
 * LOST COMPARE-AND-SET. Two callers may render the same certificate at once
 * (settle racing an on-demand download). `storageKey` is finalised with
 * `updateMany where { id, storageKey: null, status: ACTIVE }`; the loser's
 * just-written object is left orphaned. Accepted: it needs a genuine concurrent
 * race, and the key carries a random suffix per attempt, so nothing is ever
 * overwritten.
 *
 * LOGGING. Only the certificate id and the error's `name` are logged. Never the
 * message (a WinAnsi-style message can quote a learner's characters) and never
 * the learner name.
 *
 * Imported only by certificate-issuance-service.ts, certificate-service.ts, the
 * two composition roots and the download route; never by
 * checkout-webhook-system-service.ts or enrolment-transitions.ts (boundary
 * tests). Not a server action and not permission-gated: it takes an id only and
 * is reachable solely from already-authorised code paths (T-11-128).
 */

import {
  renderCertificatePdf,
  type CertificateAssetResolver,
} from "@/server/services/certificate-pdf-renderer";
import { parseCertificateTemplateLayout } from "@/server/services/certificate-template-layout";
import {
  buildCertificateStorageKey,
  getObjectBytes,
  putGeneratedCertificateObject,
} from "@/server/services/storage-service";
import { prisma } from "@/server/db";

/** Worst-case latency a settle may add to the caller's request (see header). */
export const DEFAULT_SETTLE_TIMEOUT_MS = 6_000;

// ---------------------------------------------------------------------------
// Structural types
// ---------------------------------------------------------------------------

/** The slice of a `Certificate` row the file step reads: its own snapshot only. */
export type CertificateFileRow = {
  id: string;
  status: "ACTIVE" | "REVOKED" | "SUPERSEDED";
  scope: "COURSE" | "PROGRAMME";
  courseId: string | null;
  programmeId: string | null;
  learnerName: string;
  awardTitle: string;
  issuedAt: Date;
  verificationRef: string;
  storageKey: string | null;
};

export type CertificateFileTemplateRow = { id: string; layout: unknown };

/** What template resolution needs: exactly `certificateTemplate`'s two lookups. */
export type CertificateTemplateSource = {
  certificateTemplate: {
    findUnique(args: { where: { id: string } }): Promise<CertificateFileTemplateRow | null>;
    findFirst(args: { where: Record<string, unknown> }): Promise<CertificateFileTemplateRow | null>;
  };
};

export type CertificateFileStore = CertificateTemplateSource & {
  certificate: {
    findUnique(args: { where: { id: string } }): Promise<CertificateFileRow | null>;
    updateMany(args: {
      where: Record<string, unknown> & { id: string };
      data: { storageKey: string };
    }): Promise<{ count: number }>;
  };
  course: {
    findUnique(args: {
      where: { id: string };
      select: { certificateTemplateId: true };
    }): Promise<{ certificateTemplateId: string | null } | null>;
  };
  programme: {
    findUnique(args: {
      where: { id: string };
      select: { certificateTemplateId: true };
    }): Promise<{ certificateTemplateId: string | null } | null>;
  };
};

export type CertificateFileLogDetail = { certificateId: string; errorName: string };

export type CertificateFileDeps = {
  store: CertificateFileStore;
  renderPdf: typeof renderCertificatePdf;
  putObject: (input: { key: string; body: Uint8Array; contentType: string }) => Promise<void>;
  buildKey: (input: { certificateId: string }) => string;
  resolveAsset: CertificateAssetResolver;
  log: (message: string, detail: CertificateFileLogDetail) => void;
  /** Bounds `settlePendingCertificateFiles`. Defaults to `DEFAULT_SETTLE_TIMEOUT_MS`. */
  timeoutMs?: number;
};

export type CertificateFileOutcome =
  | { kind: "stored"; storageKey: string }
  | { kind: "already-stored"; storageKey: string }
  | { kind: "not-renderable" }
  | { kind: "failed" };

// ---------------------------------------------------------------------------
// Shared template resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the Course/Programme template: the award's own
 * `certificateTemplateId` when set (regardless of that template's archived
 * state: RESEARCH Pitfall 5, an archived template still renders for awards
 * already pointed at it), else the library's `isDefault` template (D-10).
 * Returns `null` when neither resolves. Shared by issuance (existence check,
 * so `no-template` is still decided before any row is written) and this
 * module (the actual render).
 */
export async function resolveCertificateTemplate(
  source: CertificateTemplateSource,
  award: { certificateTemplateId: string | null },
): Promise<CertificateFileTemplateRow | null> {
  if (award.certificateTemplateId) {
    return source.certificateTemplate.findUnique({ where: { id: award.certificateTemplateId } });
  }
  return source.certificateTemplate.findFirst({ where: { isDefault: true } });
}

// ---------------------------------------------------------------------------
// Pending-file registry
// ---------------------------------------------------------------------------

// Keyed on the transaction object's identity: a rolled-back or garbage-collected
// transaction leaks nothing, and two transactions never see each other's ids.
const pendingByTransaction = new WeakMap<object, string[]>();

/**
 * Records that `certificateId` was created inside `tx` and needs its file once
 * `tx` has committed. Idempotent per (tx, id). Called by the issuance service.
 */
export function registerPendingCertificateFile(tx: object, certificateId: string): void {
  const ids = pendingByTransaction.get(tx);
  if (!ids) {
    pendingByTransaction.set(tx, [certificateId]);
    return;
  }
  if (!ids.includes(certificateId)) ids.push(certificateId);
}

function takePending(tx: object): string[] {
  const ids = pendingByTransaction.get(tx);
  if (!ids) return [];
  pendingByTransaction.delete(tx);
  return ids;
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

function errorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

export function createCertificateFileService(deps: CertificateFileDeps) {
  const { store } = deps;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS;

  function logFailure(message: string, certificateId: string, error: unknown): void {
    try {
      deps.log(message, { certificateId, errorName: errorName(error) });
    } catch {
      // A failing logger must not turn best-effort into a throw.
    }
  }

  /**
   * Renders and stores the file for one certificate. Never throws: every
   * failure is contained and reported as `{ kind: "failed" }`.
   */
  async function renderAndStoreCertificateFile(certificateId: string): Promise<CertificateFileOutcome> {
    try {
      const row = await store.certificate.findUnique({ where: { id: certificateId } });
      if (!row) return { kind: "not-renderable" };
      if (row.storageKey) return { kind: "already-stored", storageKey: row.storageKey };
      if (row.status !== "ACTIVE") return { kind: "not-renderable" };

      const award =
        row.scope === "COURSE"
          ? row.courseId
            ? await store.course.findUnique({
                where: { id: row.courseId },
                select: { certificateTemplateId: true },
              })
            : null
          : row.programmeId
            ? await store.programme.findUnique({
                where: { id: row.programmeId },
                select: { certificateTemplateId: true },
              })
            : null;
      if (!award) return { kind: "not-renderable" };

      const template = await resolveCertificateTemplate(store, award);
      if (!template) return { kind: "not-renderable" };

      const layout = parseCertificateTemplateLayout(template.layout);

      // The row's own snapshot only: a later course/user rename must never
      // change what an issued credential says (T-11-126).
      const pdfBytes = await deps.renderPdf({
        layout,
        fields: {
          learnerName: row.learnerName,
          awardTitle: row.awardTitle,
          issuedAt: row.issuedAt,
          verificationRef: row.verificationRef,
        },
        resolveAsset: deps.resolveAsset,
      });

      const storageKey = deps.buildKey({ certificateId });
      await deps.putObject({ key: storageKey, body: pdfBytes, contentType: "application/pdf" });

      const updated = await store.certificate.updateMany({
        where: { id: certificateId, storageKey: null, status: "ACTIVE" },
        data: { storageKey },
      });
      if (updated.count === 1) return { kind: "stored", storageKey };

      // Lost the compare-and-set: another caller stored first. Return its key.
      const winner = await store.certificate.findUnique({ where: { id: certificateId } });
      if (winner?.storageKey) return { kind: "already-stored", storageKey: winner.storageKey };
      return { kind: "not-renderable" };
    } catch (error) {
      logFailure("[certificate-file] render/store failed", certificateId, error);
      return { kind: "failed" };
    }
  }

  /**
   * Returns the certificate's storage key, producing the file first when it
   * does not exist yet. `null` when no file can be produced. Never rejects.
   */
  async function ensureCertificateFile(certificateId: string): Promise<string | null> {
    try {
      const outcome = await renderAndStoreCertificateFile(certificateId);
      if (outcome.kind === "stored" || outcome.kind === "already-stored") return outcome.storageKey;
      return null;
    } catch (error) {
      logFailure("[certificate-file] ensure failed", certificateId, error);
      return null;
    }
  }

  /**
   * Produces the files for every certificate registered against `tx`, one at a
   * time, then forgets them. Never rejects and never waits longer than
   * `timeoutMs`; work still running at the deadline carries on unobserved and
   * its late failure is swallowed.
   */
  async function settlePendingCertificateFiles(tx: object): Promise<void> {
    const ids = takePending(tx);
    if (ids.length === 0) return;

    const work = (async () => {
      for (const id of ids) {
        await ensureCertificateFile(id);
      }
    })();
    // A late failure (after the timeout already resolved settle) must not
    // surface as an unhandled rejection.
    work.catch(() => undefined);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    try {
      await Promise.race([work, deadline]);
    } catch {
      // Contained: settle never throws to the caller.
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  return { renderAndStoreCertificateFile, ensureCertificateFile, settlePendingCertificateFiles };
}

// ---------------------------------------------------------------------------
// Live binding
// ---------------------------------------------------------------------------

const liveService = createCertificateFileService({
  store: prisma as unknown as CertificateFileStore,
  renderPdf: renderCertificatePdf,
  putObject: putGeneratedCertificateObject,
  buildKey: buildCertificateStorageKey,
  resolveAsset: (assetKey) => getObjectBytes(assetKey),
  log: (message, detail) => console.error(message, detail.certificateId, detail.errorName),
});

export const renderAndStoreCertificateFile = liveService.renderAndStoreCertificateFile;
export const ensureCertificateFile = liveService.ensureCertificateFile;
export const settlePendingCertificateFiles = liveService.settlePendingCertificateFiles;

/**
 * Runs a transaction and, only AFTER it has committed, settles the certificate
 * files registered against the transaction object the body received. `open` is
 * any function that takes a transaction body and returns its result (it fits
 * `prisma.$transaction` and the composition roots' `client.$transaction`).
 *
 * - A rejected `open` (rollback) never settles and rethrows.
 * - A rejected `settle` is swallowed: the caller's committed write survives.
 *
 * The settle key is the transaction object identity, so `fn` and anything it
 * hands the transaction to (the issuance service) must use the SAME object.
 */
export async function runTransactionThenSettleCertificateFiles<Tx extends object, R>(
  open: (body: (tx: Tx) => Promise<R>) => Promise<R>,
  fn: (tx: Tx) => Promise<R>,
  settle: (tx: Tx) => Promise<void> = settlePendingCertificateFiles,
): Promise<R> {
  let capturedTx: Tx | undefined;
  const result = await open((tx) => {
    capturedTx = tx;
    return fn(tx);
  });
  if (capturedTx !== undefined) {
    try {
      await settle(capturedTx);
    } catch {
      // The transaction has committed; a settle failure must never reach the caller.
    }
  }
  return result;
}
