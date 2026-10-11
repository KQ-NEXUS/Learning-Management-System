/**
 * Viewport list and the horizontal-scroll check for the responsive sweep
 * (Phase 15, plan 15-20; D-15, NFR-10).
 *
 * `VIEWPORTS` are the seven agreed sizes. `ZOOM_200` emulates 200 percent zoom as
 * a 640 by 360 CSS-pixel viewport (ledger A9: a 1280 by 720 window at 200 percent
 * zoom lays the page out in 640 by 360 CSS pixels, and Playwright cannot press the
 * browser's own zoom keys).
 *
 * The check is deliberately about real overflow, not about hiding it:
 *   - the page itself must not scroll sideways (document scrollWidth at most
 *     clientWidth), and neither `html` nor `body` may switch horizontal overflow
 *     off (`hidden` or `clip`), because that would hide the very thing measured;
 *   - text or a control that an ancestor with `overflow: hidden` cuts off at the
 *     right is reported (hidden overflow is not a fix; ellipsis truncation is
 *     intended and is not reported);
 *   - a wide table or other block may scroll inside its own container only when
 *     the container is `role="region"`, has `tabindex="0"` and an `aria-label`
 *     (so a keyboard user can reach and scroll it) AND the container is on the
 *     responsive allow-list, which carries the reason it scrolls;
 *   - a strip of tabs (kind "tabs") may scroll inside itself when it is labelled
 *     (`aria-label`), is a `tablist` or `group`, and holds focusable controls, so a
 *     keyboard user reaches every tab by focus alone (a `tabindex="0"` stop on the
 *     strip itself would be a redundant extra stop). It also needs an allow-list
 *     entry with its reason.
 */

import { expect, type Page } from "@playwright/test";

export type Viewport = { name: string; width: number; height: number };

/** The seven agreed sizes (D-15): phones, tablet portrait and landscape, laptop, desktop, wide desktop. */
export const VIEWPORTS: readonly Viewport[] = [
  { name: "320x640", width: 320, height: 640 },
  { name: "360x740", width: 360, height: 740 },
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1920x1080", width: 1920, height: 1080 },
];

/** 200 percent zoom of a 1280 by 720 window, as a CSS-pixel viewport (ledger A9). */
export const ZOOM_200: Viewport = { name: "zoom-200 (640x360)", width: 640, height: 360 };

/** Every size the sweep visits: the seven viewports and the zoom size. */
export const ALL_SIZES: readonly Viewport[] = [...VIEWPORTS, ZOOM_200];

/** A container that may scroll sideways on its own, with the reason it is allowed to. */
export type ScrollAllowance = {
  /** CSS selector of the scrolling container (for example `[aria-label="Released results"]`). */
  selector: string;
  /**
   * What kind of container it is. "region" (default): a wide block that needs role="region", tabindex="0" and an
   * aria-label. "tabs": a labelled strip of tabs whose controls are themselves focusable.
   */
  kind?: "region" | "tabs";
  /** Why this container scrolls instead of reflowing. Required: an allowance without a reason is rejected. */
  reason: string;
};

export type Offender = { element: string; right: number; width: number; clippedBy?: string; clipperRight?: number };

export type Scroller = {
  element: string;
  scrollWidth: number;
  clientWidth: number;
  role: string | null;
  tabIndex: number | null;
  ariaLabel: string | null;
  /** Visible links and buttons inside it (a keyboard user reaches a tab strip through these). */
  focusableChildren: number;
  /** The reason of the allow-list entry that covers it, or null when none does. */
  allowedBy: string | null;
  /** The kind of the allow-list entry that covers it. */
  allowedKind: "region" | "tabs" | null;
};

export type OverflowReport = {
  innerWidth: number;
  clientWidth: number;
  scrollWidth: number;
  documentScrolls: boolean;
  /** Computed overflow-x of html and body when it is hidden or clip (null when it is not). */
  rootClipsOverflow: string | null;
  /** Widest elements that stick out to the right of the page and are not inside a scrolling or clipping container. */
  offenders: Offender[];
  /** Elements cut off at the right by an ancestor with overflow hidden or clip (sideways overflow that is hidden, not fixed). */
  clipped: Offender[];
  /** Elements that scroll sideways inside themselves. */
  scrollers: Scroller[];
};

export type OverflowCheck = { report: OverflowReport; problems: string[] };

/** Reads the overflow facts from the page. Runs in the page, so it takes only plain values. */
async function measure(page: Page, allowList: readonly ScrollAllowance[]): Promise<OverflowReport> {
  return page.evaluate((allow) => {
    const doc = document.documentElement;
    const body = document.body;

    const describe = (el: Element): string => {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : "";
      const label = el.getAttribute("aria-label");
      const classes = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join(".") : "";
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      return `${tag}${id}${classes ? `.${classes}` : ""}${label ? `[aria-label="${label}"]` : ""}${text ? ` "${text}"` : ""}`;
    };

    const REPLACED = new Set(["IMG", "SVG", "VIDEO", "CANVAS", "IFRAME", "INPUT", "SELECT", "TEXTAREA", "BUTTON"]);

    const clipKind = (el: Element): "scroll" | "hidden" | null => {
      const overflowX = getComputedStyle(el).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return "scroll";
      if (overflowX === "hidden" || overflowX === "clip") return "hidden";
      return null;
    };

    const rootStyle = [doc, body].map((el) => getComputedStyle(el).overflowX);
    const rootClips = rootStyle.find((value) => value === "hidden" || value === "clip") ?? null;

    const offenders: Array<{ element: string; right: number; width: number }> = [];
    const clipped: Array<{ element: string; right: number; width: number; clippedBy: string; clipperRight: number }> = [];
    const scrollers: Array<{
      element: string;
      scrollWidth: number;
      clientWidth: number;
      role: string | null;
      tabIndex: number | null;
      ariaLabel: string | null;
      focusableChildren: number;
      allowedBy: string | null;
      allowedKind: "region" | "tabs" | null;
    }> = [];

    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();

      const overflowX = style.overflowX;
      if ((overflowX === "auto" || overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
        const match = allow.find((entry) => {
          try {
            return el.matches(entry.selector);
          } catch {
            return false;
          }
        });
        scrollers.push({
          element: describe(el),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          role: el.getAttribute("role"),
          tabIndex: el.hasAttribute("tabindex") ? (el as HTMLElement).tabIndex : null,
          ariaLabel: el.getAttribute("aria-label"),
          focusableChildren: Array.from(el.querySelectorAll("a[href], button:not([disabled]), [role='tab']")).filter((child) => {
            const box = child.getBoundingClientRect();
            return box.width > 0 && box.height > 0;
          }).length,
          allowedBy: match ? match.reason : null,
          allowedKind: match ? match.kind : null,
        });
      }

      // A box that sticks out to the right. Skip one-pixel clipped text (screen-reader-only), fixed boxes
      // (they cannot widen the page) and decorative content marked aria-hidden.
      if (rect.width <= 1 || rect.height <= 1) continue;
      if (style.position === "fixed" || el.closest('[aria-hidden="true"]')) continue;

      // Where the element's own content ends: a replaced or interactive element ends at its box; anything
      // else ends where its own text ends (a wide wrapper with narrow text inside is not cut off).
      let contentRight: number | null = null;
      if (REPLACED.has(el.tagName.toUpperCase())) {
        contentRight = rect.right;
      } else {
        for (const node of Array.from(el.childNodes)) {
          if (node.nodeType !== Node.TEXT_NODE || (node.textContent ?? "").trim() === "") continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const box of Array.from(range.getClientRects())) {
            if (box.width > 0 && (contentRight === null || box.right > contentRight)) contentRight = box.right;
          }
        }
      }

      // The nearest ancestor that scrolls or clips. A scrolling one is judged by the scroller rules above.
      let nearest: Element | null = null;
      let kind: "scroll" | "hidden" | null = null;
      for (let parent = el.parentElement; parent && parent !== body && parent !== doc; parent = parent.parentElement) {
        kind = clipKind(parent);
        if (kind) {
          nearest = parent;
          break;
        }
      }
      if (nearest && kind === "scroll") continue;

      if (contentRight !== null) {
        // Text that is meant to end in an ellipsis is cut off on purpose.
        const truncatesItself = clipKind(el) === "hidden" && style.textOverflow === "ellipsis";
        const clipperRight = nearest ? nearest.getBoundingClientRect().right : null;
        if (nearest && kind === "hidden" && clipperRight !== null && contentRight > clipperRight + 1 && !truncatesItself) {
          clipped.push({
            element: describe(el),
            right: Math.round(contentRight),
            width: Math.round(rect.width),
            clippedBy: describe(nearest),
            clipperRight: Math.round(clipperRight),
          });
          continue;
        }
        if (clipKind(el) === "hidden" && !truncatesItself && contentRight > rect.right + 1 && el.scrollWidth > el.clientWidth + 1) {
          clipped.push({
            element: describe(el),
            right: Math.round(contentRight),
            width: Math.round(rect.width),
            clippedBy: describe(el),
            clipperRight: Math.round(rect.right),
          });
          continue;
        }
      }
      if (nearest && kind === "hidden") continue;
      if (rect.right > doc.clientWidth + 1) offenders.push({ element: describe(el), right: Math.round(rect.right), width: Math.round(rect.width) });
    }

    offenders.sort((a, b) => b.right - a.right);

    return {
      innerWidth: window.innerWidth,
      clientWidth: doc.clientWidth,
      scrollWidth: doc.scrollWidth,
      documentScrolls: doc.scrollWidth > doc.clientWidth,
      rootClipsOverflow: rootClips,
      offenders: offenders.slice(0, 5),
      clipped: clipped.slice(0, 5),
      scrollers,
    };
  }, allowList.map((entry) => ({ selector: entry.selector, reason: entry.reason, kind: entry.kind ?? "region" })));
}

/**
 * Measures the page and returns the problems found, without throwing, so a sweep
 * can collect every finding of a screen before it fails.
 */
export async function checkHorizontalScroll(page: Page, allowList: readonly ScrollAllowance[] = []): Promise<OverflowCheck> {
  for (const entry of allowList) {
    if (entry.reason.trim() === "") throw new Error(`Allow-list entry ${entry.selector} has no reason.`);
  }
  const report = await measure(page, allowList);
  const problems: string[] = [];

  if (report.documentScrolls) {
    const widest = report.offenders[0];
    problems.push(
      `the page scrolls sideways: scrollWidth ${report.scrollWidth} is wider than clientWidth ${report.clientWidth}` +
        (widest ? `; widest element sticking out: ${widest.element} (right edge at ${widest.right}px, ${widest.width}px wide)` : ""),
    );
  }
  if (report.rootClipsOverflow) {
    problems.push(
      `html or body sets overflow-x: ${report.rootClipsOverflow}, which would hide a sideways scroll instead of fixing it`,
    );
  }
  for (const cut of report.clipped) {
    problems.push(
      `content is cut off at the right: ${cut.element} reaches ${cut.right}px but ${cut.clippedBy} stops at ${cut.clipperRight}px with overflow hidden (hidden overflow is not a fix)`,
    );
  }
  for (const scroller of report.scrollers) {
    if (scroller.allowedBy === null) {
      problems.push(
        `${scroller.element} scrolls sideways inside itself (${scroller.scrollWidth}px of content in ${scroller.clientWidth}px) and is not on the responsive allow-list`,
      );
      continue;
    }
    const missing: string[] = [];
    if (scroller.allowedKind === "tabs") {
      if (scroller.role !== "tablist" && scroller.role !== "group") missing.push('role="tablist" or role="group"');
      if (!scroller.ariaLabel || scroller.ariaLabel.trim() === "") missing.push("an aria-label");
      if (scroller.focusableChildren < 1) missing.push("a focusable control inside");
    } else {
      if (scroller.role !== "region") missing.push('role="region"');
      if (scroller.tabIndex !== 0) missing.push('tabindex="0"');
      if (!scroller.ariaLabel || scroller.ariaLabel.trim() === "") missing.push("an aria-label");
    }
    if (missing.length > 0) {
      problems.push(`${scroller.element} is on the allow-list but lacks ${missing.join(", ")}, so a keyboard user cannot scroll it`);
    }
  }
  return { report, problems };
}

/** Fails the test unless the page does not scroll sideways (see the file comment for the allow-list rules). */
export async function assertNoHorizontalScroll(
  page: Page,
  allowList: readonly ScrollAllowance[] = [],
  label = "page",
): Promise<OverflowReport> {
  const { report, problems } = await checkHorizontalScroll(page, allowList);
  expect(problems, `${label}: ${problems.join("; ")}`).toEqual([]);
  return report;
}
