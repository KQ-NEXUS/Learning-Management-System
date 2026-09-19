/**
 * Plan 11-30 Task 1: certificate-file-service.ts (CR-01b, WR-01).
 *
 * The post-commit render-and-store step. Driven entirely by in-memory fakes:
 * no Postgres, no object store, no real PDF library. The real-Postgres/MinIO
 * proof lives in tests/certificate-download.integration.test.ts.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCertificateFileService,
  registerPendingCertificateFile,
  resolveCertificateTemplate,
  runTransactionThenSettleCertificateFiles,
  type CertificateFileDeps,
  type CertificateFileRow,
  type CertificateFileStore,
} from "@/server/services/certificate-file-service";
import { EMPTY_LAYOUT_V1 } from "@/server/services/certificate-template-layout";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ISSUED_AT = new Date("2026-09-18T12:00:00.000Z");
const LEARNER = "Zoë Quirkenwald-Peverell";

type TemplateRow = { id: string; layout: unknown; isDefault: boolean };
type AwardRow = { id: string; certificateTemplateId: string | null };

function cert(over: Partial<CertificateFileRow> = {}): CertificateFileRow {
  return {
    id: over.id ?? "cert-1",
    status: over.status ?? "ACTIVE",
    scope: over.scope ?? "COURSE",
    courseId: over.courseId === undefined ? "course-1" : over.courseId,
    programmeId: over.programmeId === undefined ? null : over.programmeId,
    learnerName: over.learnerName ?? LEARNER,
    awardTitle: over.awardTitle ?? "Snapshotted Award Title",
    issuedAt: over.issuedAt ?? ISSUED_AT,
    verificationRef: over.verificationRef ?? "CERT-REF-1",
    storageKey: over.storageKey === undefined ? null : over.storageKey,
  };
}

function setup(opts?: {
  certificates?: CertificateFileRow[];
  courses?: AwardRow[];
  programmes?: AwardRow[];
  templates?: TemplateRow[];
  renderPdf?: CertificateFileDeps["renderPdf"];
  putObject?: CertificateFileDeps["putObject"];
  storeThrows?: boolean;
  timeoutMs?: number;
  /** When set, updateMany reports 0 rows and the row is stored by "another caller". */
  loseCompareAndSet?: string;
}) {
  const certificates = new Map((opts?.certificates ?? [cert()]).map((c) => [c.id, { ...c }]));
  const courses = new Map((opts?.courses ?? [{ id: "course-1", certificateTemplateId: null }]).map((c) => [c.id, c]));
  const programmes = new Map((opts?.programmes ?? []).map((p) => [p.id, p]));
  const templates = new Map(
    (opts?.templates ?? [{ id: "tmpl-default", layout: EMPTY_LAYOUT_V1, isDefault: true }]).map((t) => [t.id, t]),
  );

  const renderCalls: Array<Parameters<CertificateFileDeps["renderPdf"]>[0]> = [];
  const putCalls: Array<{ key: string; body: Uint8Array; contentType: string }> = [];
  const updateCalls: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const logCalls: Array<unknown[]> = [];
  const templateLookups: Array<{ kind: "unique" | "first"; args: unknown }> = [];

  const maybeThrow = () => {
    if (opts?.storeThrows) throw new Error(`store exploded for ${LEARNER}`);
  };

  const store: CertificateFileStore = {
    certificate: {
      findUnique: async ({ where }) => {
        maybeThrow();
        const c = certificates.get(where.id);
        return c ? { ...c } : null;
      },
      updateMany: async ({ where, data }) => {
        maybeThrow();
        updateCalls.push({ where, data });
        if (opts?.loseCompareAndSet) {
          const row = certificates.get(where.id as string);
          if (row) row.storageKey = opts.loseCompareAndSet;
          return { count: 0 };
        }
        const row = certificates.get(where.id as string);
        if (!row || row.storageKey !== null || row.status !== "ACTIVE") return { count: 0 };
        row.storageKey = data.storageKey as string;
        return { count: 1 };
      },
    },
    course: {
      findUnique: async ({ where }) => {
        const c = courses.get(where.id);
        return c ? { certificateTemplateId: c.certificateTemplateId } : null;
      },
    },
    programme: {
      findUnique: async ({ where }) => {
        const p = programmes.get(where.id);
        return p ? { certificateTemplateId: p.certificateTemplateId } : null;
      },
    },
    certificateTemplate: {
      findUnique: async ({ where }) => {
        templateLookups.push({ kind: "unique", args: where });
        const t = templates.get(where.id);
        return t ? { id: t.id, layout: t.layout } : null;
      },
      findFirst: async ({ where }) => {
        templateLookups.push({ kind: "first", args: where });
        const t = [...templates.values()].find((x) => where.isDefault === undefined || x.isDefault === where.isDefault);
        return t ? { id: t.id, layout: t.layout } : null;
      },
    },
  };

  const deps: CertificateFileDeps = {
    store,
    renderPdf:
      opts?.renderPdf ??
      (async (input) => {
        renderCalls.push(input);
        return new Uint8Array([1, 2, 3]);
      }),
    putObject:
      opts?.putObject ??
      (async (input) => {
        putCalls.push(input);
      }),
    buildKey: ({ certificateId }) => `certificates/${certificateId}/key`,
    resolveAsset: async () => new Uint8Array(),
    log: (...args: unknown[]) => {
      logCalls.push(args);
    },
    ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  };

  return {
    certificates,
    courses,
    templates,
    renderCalls,
    putCalls,
    updateCalls,
    logCalls,
    templateLookups,
    deps,
    service: createCertificateFileService(deps),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// renderAndStoreCertificateFile
// ---------------------------------------------------------------------------

describe("renderAndStoreCertificateFile", () => {
  it("renders from the CERTIFICATE ROW's snapshot, stores the PDF and compare-and-sets storageKey", async () => {
    const h = setup({ courses: [{ id: "course-1", certificateTemplateId: null }] });

    const result = await h.service.renderAndStoreCertificateFile("cert-1");

    expect(result).toEqual({ kind: "stored", storageKey: "certificates/cert-1/key" });
    expect(h.renderCalls).toHaveLength(1);
    expect(h.renderCalls[0].fields).toEqual({
      learnerName: LEARNER,
      awardTitle: "Snapshotted Award Title",
      issuedAt: ISSUED_AT,
      verificationRef: "CERT-REF-1",
    });
    expect(h.putCalls).toEqual([
      { key: "certificates/cert-1/key", body: new Uint8Array([1, 2, 3]), contentType: "application/pdf" },
    ]);
    expect(h.updateCalls).toHaveLength(1);
    expect(h.updateCalls[0].where).toMatchObject({ id: "cert-1", storageKey: null, status: "ACTIVE" });
    expect(h.updateCalls[0].data).toEqual({ storageKey: "certificates/cert-1/key" });
    expect(h.certificates.get("cert-1")?.storageKey).toBe("certificates/cert-1/key");
  });

  it("uses the snapshot even when the source course/user is renamed afterwards (T-11-126)", async () => {
    // The fake store has no user table and the course row carries no title at
    // all — the only place a title/name can come from is the certificate row.
    const h = setup();
    h.courses.set("course-1", { id: "course-1", certificateTemplateId: null, title: "Renamed Course" } as never);

    await h.service.renderAndStoreCertificateFile("cert-1");

    expect(h.renderCalls[0].fields.awardTitle).toBe("Snapshotted Award Title");
    expect(h.renderCalls[0].fields.learnerName).toBe(LEARNER);
  });

  it("resolves the award's own template (an ARCHIVED template still renders)", async () => {
    const h = setup({
      courses: [{ id: "course-1", certificateTemplateId: "tmpl-archived" }],
      templates: [
        { id: "tmpl-default", layout: EMPTY_LAYOUT_V1, isDefault: true },
        { id: "tmpl-archived", layout: EMPTY_LAYOUT_V1, isDefault: false },
      ],
    });

    const result = await h.service.renderAndStoreCertificateFile("cert-1");

    expect(result.kind).toBe("stored");
    expect(h.templateLookups).toEqual([{ kind: "unique", args: { id: "tmpl-archived" } }]);
  });

  it("resolves a PROGRAMME certificate's template through the programme row", async () => {
    const h = setup({
      certificates: [cert({ scope: "PROGRAMME", courseId: null, programmeId: "prog-1" })],
      programmes: [{ id: "prog-1", certificateTemplateId: "tmpl-p" }],
      templates: [{ id: "tmpl-p", layout: EMPTY_LAYOUT_V1, isDefault: false }],
    });

    const result = await h.service.renderAndStoreCertificateFile("cert-1");

    expect(result.kind).toBe("stored");
    expect(h.templateLookups).toEqual([{ kind: "unique", args: { id: "tmpl-p" } }]);
  });

  it("returns already-stored with zero render and zero put when a storageKey exists", async () => {
    const h = setup({ certificates: [cert({ storageKey: "certificates/cert-1/existing" })] });

    const result = await h.service.renderAndStoreCertificateFile("cert-1");

    expect(result).toEqual({ kind: "already-stored", storageKey: "certificates/cert-1/existing" });
    expect(h.renderCalls).toHaveLength(0);
    expect(h.putCalls).toHaveLength(0);
  });

  it("returns not-renderable for an unknown id", async () => {
    const h = setup();
    const result = await h.service.renderAndStoreCertificateFile("nope");
    expect(result).toEqual({ kind: "not-renderable" });
    expect(h.renderCalls).toHaveLength(0);
    expect(h.putCalls).toHaveLength(0);
  });

  it.each(["REVOKED", "SUPERSEDED"] as const)("returns not-renderable for a %s certificate", async (status) => {
    const h = setup({ certificates: [cert({ status })] });
    const result = await h.service.renderAndStoreCertificateFile("cert-1");
    expect(result).toEqual({ kind: "not-renderable" });
    expect(h.renderCalls).toHaveLength(0);
    expect(h.putCalls).toHaveLength(0);
  });

  it("returns not-renderable when no template resolves", async () => {
    const h = setup({ templates: [] });
    const result = await h.service.renderAndStoreCertificateFile("cert-1");
    expect(result).toEqual({ kind: "not-renderable" });
    expect(h.renderCalls).toHaveLength(0);
  });

  it("contains an invalid stored layout as failed (parsing moved here from issuance)", async () => {
    const h = setup({
      templates: [{ id: "tmpl-default", layout: { not: "a layout" }, isDefault: true }],
    });
    const result = await h.service.renderAndStoreCertificateFile("cert-1");
    expect(result).toEqual({ kind: "failed" });
    expect(h.renderCalls).toHaveLength(0);
    expect(h.putCalls).toHaveLength(0);
    expect(h.certificates.get("cert-1")?.storageKey).toBeNull();
  });

  it("contains a renderer failure: failed, storageKey stays null, log has id + error name only", async () => {
    class GlyphError extends Error {
      constructor() {
        super(`WinAnsi cannot encode "${LEARNER}"`);
        this.name = "GlyphError";
      }
    }
    const h = setup({
      renderPdf: async () => {
        throw new GlyphError();
      },
    });

    const result = await h.service.renderAndStoreCertificateFile("cert-1");

    expect(result).toEqual({ kind: "failed" });
    expect(h.certificates.get("cert-1")?.storageKey).toBeNull();
    expect(h.putCalls).toHaveLength(0);
    expect(h.logCalls.length).toBeGreaterThan(0);
    const logged = JSON.stringify(h.logCalls);
    expect(logged).toContain("cert-1");
    expect(logged).toContain("GlyphError");
    expect(logged).not.toContain("Quirkenwald");
    expect(logged).not.toContain("WinAnsi");
    expect(logged).not.toContain("Snapshotted Award Title");
  });

  it("contains an object-store put failure: failed, storageKey stays null", async () => {
    const h = setup({
      putObject: async () => {
        throw new Error("S3 down");
      },
    });
    const result = await h.service.renderAndStoreCertificateFile("cert-1");
    expect(result).toEqual({ kind: "failed" });
    expect(h.certificates.get("cert-1")?.storageKey).toBeNull();
    expect(h.updateCalls).toHaveLength(0);
    const logged = JSON.stringify(h.logCalls);
    expect(logged).not.toContain("S3 down");
  });

  it("a lost compare-and-set returns the winning key read back and does not throw", async () => {
    const h = setup({ loseCompareAndSet: "certificates/cert-1/winner" });
    const result = await h.service.renderAndStoreCertificateFile("cert-1");
    expect(result).toEqual({ kind: "already-stored", storageKey: "certificates/cert-1/winner" });
  });
});

// ---------------------------------------------------------------------------
// ensureCertificateFile
// ---------------------------------------------------------------------------

describe("ensureCertificateFile", () => {
  it("returns the storage key on success", async () => {
    const h = setup();
    expect(await h.service.ensureCertificateFile("cert-1")).toBe("certificates/cert-1/key");
  });

  it("returns the existing key when already stored", async () => {
    const h = setup({ certificates: [cert({ storageKey: "k-existing" })] });
    expect(await h.service.ensureCertificateFile("cert-1")).toBe("k-existing");
  });

  it("returns null for failed / not-renderable outcomes", async () => {
    const failing = setup({
      renderPdf: async () => {
        throw new Error("boom");
      },
    });
    expect(await failing.service.ensureCertificateFile("cert-1")).toBeNull();
    const revoked = setup({ certificates: [cert({ status: "REVOKED" })] });
    expect(await revoked.service.ensureCertificateFile("cert-1")).toBeNull();
  });

  it("NEVER rejects, even when the store itself throws", async () => {
    const h = setup({ storeThrows: true });
    await expect(h.service.ensureCertificateFile("cert-1")).resolves.toBeNull();
    expect(JSON.stringify(h.logCalls)).not.toContain("Quirkenwald");
  });
});

// ---------------------------------------------------------------------------
// registry + settlePendingCertificateFiles
// ---------------------------------------------------------------------------

describe("settlePendingCertificateFiles", () => {
  it("processes the ids registered for that exact tx sequentially, then clears them", async () => {
    const h = setup({
      certificates: [cert({ id: "cert-1", verificationRef: "R1" }), cert({ id: "cert-2", verificationRef: "R2" })],
    });
    const txA = {};
    const txB = {};
    registerPendingCertificateFile(txA, "cert-1");
    registerPendingCertificateFile(txB, "cert-2");

    await h.service.settlePendingCertificateFiles(txA);

    expect(h.putCalls.map((p) => p.key)).toEqual(["certificates/cert-1/key"]);
    expect(h.certificates.get("cert-2")?.storageKey).toBeNull();

    // A second settle for the same tx does nothing.
    await h.service.settlePendingCertificateFiles(txA);
    expect(h.putCalls).toHaveLength(1);

    // The other tx's list was independent and is still pending.
    await h.service.settlePendingCertificateFiles(txB);
    expect(h.putCalls.map((p) => p.key)).toEqual(["certificates/cert-1/key", "certificates/cert-2/key"]);
  });

  it("registering the same id twice for one tx processes it once", async () => {
    const h = setup();
    const tx = {};
    registerPendingCertificateFile(tx, "cert-1");
    registerPendingCertificateFile(tx, "cert-1");

    await h.service.settlePendingCertificateFiles(tx);

    expect(h.renderCalls).toHaveLength(1);
    expect(h.putCalls).toHaveLength(1);
  });

  it("does nothing for a tx that registered nothing", async () => {
    const h = setup();
    await h.service.settlePendingCertificateFiles({});
    expect(h.renderCalls).toHaveLength(0);
  });

  it("NEVER rejects: store, renderer, put and template failures are all contained", async () => {
    const storeFail = setup({ storeThrows: true });
    const txA = {};
    registerPendingCertificateFile(txA, "cert-1");
    await expect(storeFail.service.settlePendingCertificateFiles(txA)).resolves.toBeUndefined();

    const renderFail = setup({
      renderPdf: async () => {
        throw new Error("render");
      },
    });
    const txB = {};
    registerPendingCertificateFile(txB, "cert-1");
    await expect(renderFail.service.settlePendingCertificateFiles(txB)).resolves.toBeUndefined();

    const putFail = setup({
      putObject: async () => {
        throw new Error("put");
      },
    });
    const txC = {};
    registerPendingCertificateFile(txC, "cert-1");
    await expect(putFail.service.settlePendingCertificateFiles(txC)).resolves.toBeUndefined();

    const noTemplate = setup({ templates: [] });
    const txD = {};
    registerPendingCertificateFile(txD, "cert-1");
    await expect(noTemplate.service.settlePendingCertificateFiles(txD)).resolves.toBeUndefined();
  });

  it("is bounded: resolves at the timeout while the renderer never does, and swallows the late rejection", async () => {
    vi.useFakeTimers();
    let rejectRender: (e: Error) => void = () => {};
    const h = setup({
      timeoutMs: 1_000,
      renderPdf: () =>
        new Promise<Uint8Array>((_resolve, reject) => {
          rejectRender = reject;
        }),
    });
    const tx = {};
    registerPendingCertificateFile(tx, "cert-1");

    let settled = false;
    const done = h.service.settlePendingCertificateFiles(tx).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await done;
    expect(settled).toBe(true);

    // The straggler fails later: no unhandled rejection may escape.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    rejectRender(new Error("late failure"));
    await vi.advanceTimersByTimeAsync(10);
    vi.useRealTimers();
    await new Promise((r) => setImmediate(r));
    process.off("unhandledRejection", onUnhandled);
    expect(unhandled).toEqual([]);
  });

  it("pins the default timeout at 6_000 ms", async () => {
    vi.useFakeTimers();
    const h = setup({
      // no timeoutMs override -> the default applies
      renderPdf: () => new Promise<Uint8Array>(() => {}),
    });
    const tx = {};
    registerPendingCertificateFile(tx, "cert-1");
    let settled = false;
    const done = h.service.settlePendingCertificateFiles(tx).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(5_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await done;
    expect(settled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runTransactionThenSettleCertificateFiles
// ---------------------------------------------------------------------------

describe("runTransactionThenSettleCertificateFiles", () => {
  it("settles with the SAME tx the body received, only AFTER the transaction resolved", async () => {
    const order: string[] = [];
    const fakeTx = { id: "tx-1" };
    const open = async <R>(body: (tx: typeof fakeTx) => Promise<R>): Promise<R> => {
      order.push("open:start");
      const r = await body(fakeTx);
      order.push("open:commit");
      return r;
    };
    const settle = vi.fn(async (tx: typeof fakeTx) => {
      order.push(`settle:${tx.id}`);
    });

    const result = await runTransactionThenSettleCertificateFiles(
      open,
      async (tx) => {
        order.push(`body:${tx.id}`);
        return "the-result";
      },
      settle,
    );

    expect(result).toBe("the-result");
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle.mock.calls[0][0]).toBe(fakeTx);
    expect(order).toEqual(["open:start", "body:tx-1", "open:commit", "settle:tx-1"]);
  });

  it("does not settle and rethrows when the transaction rejects (rollback)", async () => {
    const fakeTx = {};
    const open = async <R>(body: (tx: typeof fakeTx) => Promise<R>): Promise<R> => {
      await body(fakeTx);
      throw new Error("P2028 rolled back");
    };
    const settle = vi.fn(async () => {});

    await expect(
      runTransactionThenSettleCertificateFiles(open, async () => "x", settle),
    ).rejects.toThrow("P2028 rolled back");
    expect(settle).not.toHaveBeenCalled();
  });

  it("the caller still receives the result when settle rejects", async () => {
    const fakeTx = {};
    const open = async <R>(body: (tx: typeof fakeTx) => Promise<R>): Promise<R> => body(fakeTx);
    const settle = vi.fn(async () => {
      throw new Error("settle exploded");
    });

    await expect(
      runTransactionThenSettleCertificateFiles(open, async () => "kept", settle),
    ).resolves.toBe("kept");
    expect(settle).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// resolveCertificateTemplate
// ---------------------------------------------------------------------------

describe("resolveCertificateTemplate", () => {
  it("uses findUnique by id when the award names a template (archived allowed)", async () => {
    const h = setup({
      templates: [{ id: "tmpl-x", layout: EMPTY_LAYOUT_V1, isDefault: false }],
    });
    const found = await resolveCertificateTemplate(h.deps.store, { certificateTemplateId: "tmpl-x" });
    expect(found?.id).toBe("tmpl-x");
    expect(h.templateLookups).toEqual([{ kind: "unique", args: { id: "tmpl-x" } }]);
  });

  it("uses findFirst({ isDefault: true }) when the award names none", async () => {
    const h = setup();
    const found = await resolveCertificateTemplate(h.deps.store, { certificateTemplateId: null });
    expect(found?.id).toBe("tmpl-default");
    expect(h.templateLookups).toEqual([{ kind: "first", args: { isDefault: true } }]);
  });
});
