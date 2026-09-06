/** Decorative approved glyph; the adjacent wordmark provides its accessible name. */
export function BrandMark({ className = "size-[26px]" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-sm text-accent-contrast ${className}`}
      style={{ background: "linear-gradient(140deg, var(--color-accent), var(--color-accent-deep))" }}
    >
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" focusable="false">
        <path d="M10 3 3.5 6.2 10 9.4l6.5-3.2L10 3Z" />
        <path d="M3.5 10.2 10 13.4l6.5-3.2" />
      </svg>
    </span>
  );
}
