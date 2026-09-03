/**
 * D-29/D-30/T-04-13 — the validated allow-list for `Lesson.embedUrl` and
 * `Lesson.linkUrl`.
 *
 * `src/lib/sanitize.ts`'s D-30 allow-list does NOT cover these fields — an
 * `embedUrl` is rendered inside an `<iframe>`, a clickjacking / stored-XSS
 * surface the body sanitiser was never designed to close, which is why it
 * has its own validator here.
 *
 * Host matching is EXACT against a frozen list, never a substring and
 * never a regex — a substring match on `youtube.com` would accept
 * `youtube.com.evil.example`. Both parsers use `new URL()` inside a
 * try/catch and require an explicit scheme allow-list; `javascript:`
 * parses as a syntactically valid URL (it is not caught by the try/catch),
 * so the scheme check is what actually rejects it.
 */

export const EMBED_HOST_ALLOWLIST = Object.freeze([
  "www.youtube.com",
  "youtube.com",
  "youtu.be",
  "player.vimeo.com",
  "vimeo.com",
] as const);

export type UrlParseResult = { ok: true; url: string } | { ok: false; message: string };

/** https-only, exact-host allow-list. Used for the iframe `src`. */
export function parseEmbedUrl(raw: string): UrlParseResult {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, message: "Not a valid URL." };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, message: "Embed URLs must use https." };
  }

  if (!EMBED_HOST_ALLOWLIST.includes(parsed.hostname as (typeof EMBED_HOST_ALLOWLIST)[number])) {
    return {
      ok: false,
      message: `Embed host must be one of: ${EMBED_HOST_ALLOWLIST.join(", ")}.`,
    };
  }

  return { ok: true, url: parsed.toString() };
}

/**
 * https-only, no host allow-list — a link is an ordinary `<a href>`, not an
 * iframe, so the threat surface is narrower: reject `javascript:`, `data:`,
 * `file:` and anything else that is not https.
 */
export function parseLinkUrl(raw: string): UrlParseResult {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, message: "Not a valid URL." };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, message: "Link URLs must use https." };
  }

  return { ok: true, url: parsed.toString() };
}
