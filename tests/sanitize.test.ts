import { describe, expect, it } from "vitest";
import { LESSON_BODY_ALLOWED_TAGS, sanitizeLessonBody } from "@/lib/sanitize";

describe("sanitizeLessonBody", () => {
  it("strips h1 — the page title owns H1 (D-29)", () => {
    const out = sanitizeLessonBody("<h1>x</h1>");
    expect(out).not.toContain("<h1");
  });

  it("strips a javascript: href", () => {
    const out = sanitizeLessonBody('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain("javascript:");
  });

  it("strips a data: href", () => {
    const out = sanitizeLessonBody('<a href="data:text/html,<script>">x</a>');
    expect(out).not.toContain("data:");
  });

  it("strips a protocol-relative href", () => {
    const out = sanitizeLessonBody('<a href="//evil.com">x</a>');
    expect(out).not.toContain("//evil.com");
  });

  it("keeps a plain https href and forces a safe rel", () => {
    const out = sanitizeLessonBody('<a href="https://ok.example">x</a>');
    expect(out).toContain('href="https://ok.example"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });

  it("strips the style attribute", () => {
    const out = sanitizeLessonBody('<p style="x">t</p>');
    expect(out).toBe("<p>t</p>");
  });

  it("strips script tags and their content", () => {
    const out = sanitizeLessonBody("<script>alert(1)</script>");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
  });

  it("round-trips every allowed tag", () => {
    const dirty =
      "<h2>a</h2><h3>b</h3><ul><li>c</li></ul><ol><li>d</li></ol><strong>e</strong><em>f</em><p>g</p>";
    const out = sanitizeLessonBody(dirty);

    for (const tag of ["h2", "h3", "ul", "li", "ol", "strong", "em", "p"]) {
      expect(out).toContain(`<${tag}>`);
    }
  });

  it("is idempotent — a second pass on render changes nothing (D-30)", () => {
    const cases = [
      "<h1>x</h1>",
      '<a href="javascript:alert(1)">x</a>',
      '<a href="data:text/html,<script>">x</a>',
      '<a href="//evil.com">x</a>',
      '<a href="https://ok.example">x</a>',
      '<p style="x">t</p>',
      "<script>alert(1)</script>",
      "<h2>a</h2><h3>b</h3><ul><li>c</li></ul><ol><li>d</li></ol><strong>e</strong><em>f</em><p>g</p>",
    ];

    for (const dirty of cases) {
      const once = sanitizeLessonBody(dirty);
      const twice = sanitizeLessonBody(once);
      expect(twice).toBe(once);
    }
  });

  it("exports the allow-list as exactly the nine D-30 tags, no h1", () => {
    expect(LESSON_BODY_ALLOWED_TAGS).toEqual([
      "h2",
      "h3",
      "p",
      "ul",
      "ol",
      "li",
      "strong",
      "em",
      "a",
    ]);
    expect(LESSON_BODY_ALLOWED_TAGS).not.toContain("h1");
  });
});
