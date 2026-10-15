import type { ReactNode } from "react";

/**
 * A titled section in the IETC look (design/mockups/system.css `.sec-h`): the condensed
 * section title with an optional note or link on the right, over a 2px ink rule.
 */
export function SectionHead({ title, aside, id, as: Heading = "h2" }: { title: ReactNode; aside?: ReactNode; id?: string; as?: "h2" | "h3" }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 border-b-2 border-ink pb-3">
      <Heading id={id} className="ietc-display text-[25px] leading-none md:text-[28px]">
        {title}
      </Heading>
      {aside && <div className="text-[14.5px] text-ink-soft">{aside}</div>}
    </div>
  );
}

/** A SectionHead with its content underneath, labelled by the title. */
export function Section({ title, aside, children, id }: { title: string; aside?: ReactNode; children: ReactNode; id?: string }) {
  const headingId = id ?? `sec-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={headingId}>
      <SectionHead title={title} aside={aside} id={headingId} />
      {children}
    </section>
  );
}

/** Rows under a section head, each on a hairline (`.rows`). */
export const ROW = "border-b border-rule py-4";

/**
 * The facts strip on a tinted head (`.facts`): a label over a condensed value, divided by
 * thin rules; two columns on a phone.
 */
export function FactsStrip({ facts }: { facts: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-y-[18px] md:grid-cols-4">
      {facts.map(([label, value], i) => (
        <div key={label} className={`min-w-0 ${i % 2 === 1 ? "border-l border-ink/25 pl-4" : ""} ${i > 0 ? "md:border-l md:border-ink/25 md:px-6" : "md:pr-6"}`}>
          <dt className="text-sm font-semibold text-peach-text">{label}</dt>
          <dd className="ietc-display mt-1 text-[21px] leading-[1.1] break-words md:text-[24px]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
