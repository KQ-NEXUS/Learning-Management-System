/**
 * The single source of truth for D-30: `Lesson.body` is sanitised against
 * this allow-list on save AND again on render — the same function, both
 * times, so a stored value that somehow bypassed the write-time pass (a
 * direct DB edit, a future import path) is still safe when rendered.
 *
 * Four of the five 2026 `sanitize-html` advisories are unreachable through
 * this allow-list because the tags/attributes they exploit (`svg`, `xmp`,
 * the default `nonTextTags`) are simply not in it — see 04-RESEARCH.md
 * "Pitfall 2: Choosing the sanitiser on brand rather than on threat
 * surface" for the advisory-by-advisory analysis. The fifth (an incomplete
 * `javascript:` scheme check) is fixed upstream in sanitize-html >= 2.17.7,
 * which is why that floor is pinned in package.json.
 *
 * Growing this allow-list past the nine D-30 tags requires re-reading that
 * Pitfall 2 analysis first — a new tag can reopen an advisory that is
 * currently unreachable.
 */
import sanitizeHtml from "sanitize-html";

/** D-29: no `h1` — the page title owns the document's single H1. */
export const LESSON_BODY_ALLOWED_TAGS = Object.freeze([
  "h2",
  "h3",
  "p",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "a",
] as const);

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...LESSON_BODY_ALLOWED_TAGS],
  allowedAttributes: { a: ["href", "rel", "target"] },
  // Restricting schemes (rather than trusting sanitize-html's default list)
  // is what makes `javascript:`, `data:`, and other non-http(s)/mailto
  // hrefs unreachable regardless of upstream default changes.
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesAppliedToAttributes: ["href"],
  // Protocol-relative URLs (`//evil.com`) inherit the page's scheme and
  // would otherwise slip past the allowedSchemes check entirely.
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    // Every surviving anchor opens in a new tab with the opener severed
    // (T-04-03: reverse tabnabbing) and is marked nofollow.
    a: sanitizeHtml.simpleTransform("a", {
      rel: "noopener noreferrer nofollow",
      target: "_blank",
    }),
  },
};

/** Called on save AND again on render (D-30). Same function, both times. */
export function sanitizeLessonBody(dirty: string): string {
  return sanitizeHtml(dirty, OPTIONS);
}
