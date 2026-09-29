/**
 * UX batch D — "Skip to main content", the first focusable element in every
 * shell. Hidden until it receives keyboard focus, so keyboard and
 * screen-reader users can jump past the navigation.
 */
export const MAIN_CONTENT_ID = "main-content";

export function SkipLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground focus:shadow-lg"
    >
      Skip to main content
    </a>
  );
}
