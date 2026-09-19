/**
 * Cached loader for the single bundled certificate font (plan 11-29, CR-01).
 *
 * The font is the human-approved Unicode font recorded in
 * `assets/fonts/certificate/README.md`. `CERTIFICATE_FONT_FILENAME` is the
 * pinned copy of that README's `Filename:` line; a test parses the README and
 * fails if the two ever differ. This module deliberately does NOT parse the
 * README at runtime, so a documentation edit can never break production
 * rendering.
 *
 * Deployment: the file is read from the project root at runtime, so Next must
 * ship it with the server output — see `outputFileTracingIncludes` in
 * `next.config.ts`.
 *
 * No pdf-lib, database or next/* imports: this is a plain byte loader.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

export const CERTIFICATE_FONT_FILENAME = "NotoSans-Regular.ttf";

const FONT_DIRECTORY_SEGMENTS = ["assets", "fonts", "certificate"] as const;

let cachedFontBytes: Promise<Uint8Array> | null = null;

function certificateFontPath(root: string): string {
  return path.join(root, ...FONT_DIRECTORY_SEGMENTS, CERTIFICATE_FONT_FILENAME);
}

/**
 * Resolve the bundled font bytes. The in-flight/settled PROMISE is memoised so
 * concurrent renders share one read; a rejected read clears the memo so the
 * next call retries instead of caching the failure (T-11-121). There is no
 * fallback font: an unreadable file rejects.
 *
 * `root` exists only so a test can simulate a failed read; production callers
 * never pass it (the project root is `process.cwd()`).
 */
export function loadCertificateFontBytes(root: string = process.cwd()): Promise<Uint8Array> {
  if (cachedFontBytes !== null) return cachedFontBytes;

  const pending = readFile(certificateFontPath(root)).then((buffer) => new Uint8Array(buffer));
  cachedFontBytes = pending;
  pending.catch(() => {
    if (cachedFontBytes === pending) cachedFontBytes = null;
  });
  return pending;
}
