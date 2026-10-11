import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCertificateStorageKey,
  buildExportStorageKey,
  buildStagedSubmissionStorageKey,
  buildStagedTemplateAssetStorageKey,
  buildStagedTicketAttachmentKey,
  buildStagedStorageKey,
  buildStorageKey,
  buildSubmissionStorageKey,
  buildTemplateAssetStorageKey,
  finalStorageKeyFor,
  finalSubmissionKeyFor,
  finalTemplateAssetKeyFor,
  finalTicketAttachmentKeyFor,
} from "@/server/services/storage-service";

/**
 * Object keys are unpredictable (Phase 15, plan 15-27, Task 3; NFR-06, T-15-27-03).
 *
 * A private object is reachable only through a short-lived signed URL, but the
 * key still must not be guessable or derivable from data an outsider might know
 * (a filename, a learner, a counter): "no predictable object paths" is on the
 * never-waive list (D-07). This file proves it three ways:
 *
 *   1. every builder that MINTS a key ends in a random UUID v4 segment, two calls
 *      with the same inputs differ, and the filename never appears in a key;
 *   2. every builder that only PROMOTES a staged key keeps that random segment
 *      and refuses a key from another domain;
 *   3. a scan of the source fails when a new key builder is added without being
 *      classified here, so a predictable builder cannot slip in unseen.
 *
 * The export key is the one deliberate exception, asserted for what it is: it is
 * `exports/<job id>/<dataset version>.csv`, stable across background retries (the
 * worker may run twice for one job). Its only random part is the export job id
 * (a database-generated cuid), not a UUID v4. See the plan 15-27 summary for the
 * owner decision this raises.
 *
 * No network, no storage and no database: the builders are pure.
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const lastSegment = (key: string) => key.split("/").at(-1) ?? "";

/** Builders that mint a fresh key: [name, call, expected prefix]. */
const MINTING: ReadonlyArray<readonly [string, () => string, string]> = [
  ["buildStorageKey", () => buildStorageKey({ lessonId: "lesson-1" }), "lessons/lesson-1/"],
  ["buildStagedStorageKey", () => buildStagedStorageKey({ lessonId: "lesson-1" }), "lesson-uploads/lesson-1/"],
  [
    "buildSubmissionStorageKey",
    () => buildSubmissionStorageKey({ enrolmentId: "enr-1", assessmentId: "asm-1" }),
    "submissions/enr-1/asm-1/",
  ],
  [
    "buildStagedSubmissionStorageKey",
    () => buildStagedSubmissionStorageKey({ enrolmentId: "enr-1", assessmentId: "asm-1" }),
    "submission-uploads/enr-1/asm-1/",
  ],
  ["buildStagedTicketAttachmentKey", () => buildStagedTicketAttachmentKey({ ticketId: "tkt-1" }), "ticket-uploads/tkt-1/"],
  ["buildCertificateStorageKey", () => buildCertificateStorageKey({ certificateId: "cert-1" }), "certificates/cert-1/"],
  ["buildTemplateAssetStorageKey", () => buildTemplateAssetStorageKey({ templateId: "tpl-1" }), "certificate-template-assets/tpl-1/"],
  [
    "buildStagedTemplateAssetStorageKey",
    () => buildStagedTemplateAssetStorageKey({ templateId: "tpl-1" }),
    "certificate-template-asset-uploads/tpl-1/",
  ],
];

/** Builders that derive a final key from a staged key: [name, call, staged prefix, final prefix]. */
const PROMOTING: ReadonlyArray<readonly [string, (staged: string) => string, string, string]> = [
  ["finalStorageKeyFor", finalStorageKeyFor, "lesson-uploads/", "lessons/"],
  ["finalSubmissionKeyFor", finalSubmissionKeyFor, "submission-uploads/", "submissions/"],
  ["finalTicketAttachmentKeyFor", finalTicketAttachmentKeyFor, "ticket-uploads/", "ticket-attachments/"],
  ["finalTemplateAssetKeyFor", finalTemplateAssetKeyFor, "certificate-template-asset-uploads/", "certificate-template-assets/"],
];

const EXPORT_BUILDERS = ["buildExportStorageKey"] as const;

describe("minting key builders end in a random UUID v4 segment", () => {
  it.each(MINTING)("%s", (_name, build, prefix) => {
    const key = build();
    expect(key.startsWith(prefix)).toBe(true);
    expect(key.slice(prefix.length)).toBe(lastSegment(key));
    expect(lastSegment(key)).toMatch(UUID_V4);
  });

  it.each(MINTING)("%s returns a different key on every call with the same inputs", (_name, build) => {
    const keys = new Set(Array.from({ length: 50 }, () => build()));
    expect(keys.size).toBe(50);
  });

  it("the original filename and extension never appear in any minted key", () => {
    for (const [, build] of MINTING) {
      const key = build();
      expect(key).not.toMatch(/\.[A-Za-z0-9]{1,5}$/);
      expect(key.toLowerCase()).not.toContain("report");
    }
  });
});

describe("promoting key builders keep the random segment and stay inside their own domain", () => {
  it.each(PROMOTING)("%s", (_name, promote, stagedPrefix, finalPrefix) => {
    const staged = `${stagedPrefix}scope-1/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`;
    const final = promote(staged);
    expect(final.startsWith(finalPrefix)).toBe(true);
    expect(lastSegment(final)).toBe(lastSegment(staged));
    expect(lastSegment(final)).toMatch(UUID_V4);
  });

  it.each(PROMOTING)("%s refuses a key that is not from its own staging domain", (_name, promote, stagedPrefix) => {
    expect(() => promote("lessons/lesson-1/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")).toThrow();
    expect(() => promote(`x/${stagedPrefix}aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`)).toThrow();
  });

  it("a lesson staging key can never be promoted into submissions, tickets or templates (and the reverse)", () => {
    const lessonStaged = buildStagedStorageKey({ lessonId: "lesson-1" });
    expect(() => finalSubmissionKeyFor(lessonStaged)).toThrow();
    expect(() => finalTicketAttachmentKeyFor(lessonStaged)).toThrow();
    expect(() => finalTemplateAssetKeyFor(lessonStaged)).toThrow();
    expect(() => finalStorageKeyFor(buildStagedSubmissionStorageKey({ enrolmentId: "e", assessmentId: "a" }))).toThrow();
  });

  it("promoting a freshly minted staged key yields a final key with the same random segment", () => {
    const staged = buildStagedSubmissionStorageKey({ enrolmentId: "enr-1", assessmentId: "asm-1" });
    const final = finalSubmissionKeyFor(staged);
    expect(final).toBe(staged.replace("submission-uploads/", "submissions/"));
    expect(lastSegment(final)).toMatch(UUID_V4);
  });
});

describe("the export key (the one deterministic builder)", () => {
  it("is exports/<job id>/<version>.csv and carries nothing but the job id", () => {
    const key = buildExportStorageKey("cmexamplejobid0001abcd", "1.0");
    expect(key).toBe("exports/cmexamplejobid0001abcd/1.0.csv");
  });

  it("is stable for one job (a background retry must find the same object)", () => {
    expect(buildExportStorageKey("cmexamplejobid0001abcd", "1.0")).toBe(buildExportStorageKey("cmexamplejobid0001abcd", "1.0"));
  });

  it("differs between jobs", () => {
    expect(buildExportStorageKey("cmexamplejobid0001abcd", "1.0")).not.toBe(buildExportStorageKey("cmexamplejobid0002abcd", "1.0"));
  });

  it("refuses an id that could climb out of the exports folder", () => {
    expect(() => buildExportStorageKey("../leak", "1.0")).toThrow();
    expect(() => buildExportStorageKey("a/b/c/d/e/f/g/h", "1.0")).toThrow();
  });
});

describe("no key builder escapes classification", () => {
  it("every exported key builder in storage-service.ts is covered above", () => {
    const source = readFileSync(path.resolve(import.meta.dirname, "..", "src", "server", "services", "storage-service.ts"), "utf8");
    const exported = [...source.matchAll(/export function ((?:build|final)\w*(?:Key|KeyFor)\w*)\(/g)].map((match) => match[1]!);
    expect(exported.length).toBeGreaterThanOrEqual(13);

    const covered = new Set<string>([...MINTING.map(([name]) => name), ...PROMOTING.map(([name]) => name), ...EXPORT_BUILDERS]);
    const unclassified = exported.filter((name) => !covered.has(name));
    expect(unclassified).toEqual([]);
  });

  it("no key builder interpolates a filename, title or extension parameter", () => {
    const source = readFileSync(path.resolve(import.meta.dirname, "..", "src", "server", "services", "storage-service.ts"), "utf8");
    const builderBodies = [...source.matchAll(/export function (?:build|final)\w*Key\w*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)].map((match) => match[1]!);
    expect(builderBodies.length).toBeGreaterThanOrEqual(13);
    for (const body of builderBodies) {
      expect(body).not.toMatch(/filename|extension|\.name\b|originalName/i);
    }
  });
});
