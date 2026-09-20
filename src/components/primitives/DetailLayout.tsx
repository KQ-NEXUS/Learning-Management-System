"use client";

import { useState, type ReactNode } from "react";
import { PageHeader } from "@/components/shell/PageHeader";

/**
 * DetailLayout — the record primitive.
 *
 * Tabbed and stacked are the same configuration rendered two ways, so a
 * screen can switch without rewriting its sections. Tabs implement the
 * roving-tabindex keyboard pattern: arrows move between tabs, Home and End
 * jump to the ends, and only the active tab is in the tab order.
 *
 * A section that fails to load fails alone — the rest of the record stays
 * readable, which is why `error` lives on the section rather than the page.
 */

export type DetailSection = {
  id: string;
  label: string;
  /** Shown beside the label, e.g. a row count. */
  badge?: string | number;
  content: ReactNode;
  /** Renders in place of this section's content, leaving others intact. */
  error?: { message: string; onRetry?: () => void };
  /** Stacked mode only: draw this section in the right-hand rail (from `lg`) instead of the main column. */
  aside?: boolean;
};

export type DetailLayoutState =
  | { status: "ready" }
  | { status: "loading" }
  | { status: "denied"; permission?: string }
  | { status: "error"; message?: string; onRetry?: () => void };

export type DetailLayoutProps = {
  breadcrumbs?: { label: string; href?: string }[];
  title: string;
  /** Record identifier — rendered in mono, e.g. a slug or code. */
  identifier?: string;
  subtitle?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  sections: DetailSection[];
  mode?: "tabbed" | "stacked";
  state?: DetailLayoutState;
  /** Tabbed mode: the section to open first, when it is not the first one. */
  initialSectionId?: string;
};

export function DetailLayout({
  breadcrumbs,
  title,
  identifier,
  subtitle,
  badges,
  actions,
  sections,
  mode = "tabbed",
  state = { status: "ready" },
  initialSectionId,
}: DetailLayoutProps) {
  // `initialSectionId` (from the page's `?tab=`) opens that tab; links such as "Back to cohort" from a
  // grading page rely on it.
  const [activeId, setActiveId] = useState(
    initialSectionId && sections.some((section) => section.id === initialSectionId)
      ? initialSectionId
      : sections[0]?.id,
  );

  if (state.status === "denied") {
    return (
      <div className="flex max-w-[680px] flex-col items-start gap-3 border-t border-foreground pt-12 pb-3">
        <span className="font-mono text-sm text-muted-foreground">403</span>
        <h2 className="text-[36px] leading-[1.1] font-bold tracking-[-0.035em] text-foreground">
          You do not have access to this record
        </h2>
        <p className="max-w-prose text-base text-foreground-soft">
          Your role does not include{" "}
          {state.permission ? (
            <code className="rounded-sm bg-accent-wash px-2 font-mono text-sm">
              {state.permission}
            </code>
          ) : (
            "the required permission"
          )}{" "}
          at this scope. Ask a workspace administrator to grant it.
        </p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-col items-start gap-2 border-t border-foreground py-12">
        <p className="text-sm font-semibold text-foreground">Could not load this record</p>
        <p className="max-w-prose text-sm text-muted-foreground">
          {state.message ?? "The request failed. Nothing has been changed."}
        </p>
        {state.onRetry && (
          <button
            type="button"
            onClick={state.onRetry}
            className="rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-2"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div
        aria-busy
        className="flex flex-col gap-6 border-t border-foreground pt-5"
      >
        <span className="h-5 w-64 animate-pulse rounded-sm bg-surface-2" />
        <span className="h-3 w-40 animate-pulse rounded-sm bg-surface-2" />
        <div className="h-40 w-full animate-pulse rounded-sm bg-surface-2" />
        <p aria-live="polite" className="sr-only">
          Loading record
        </p>
      </div>
    );
  }

  const active = sections.find((s) => s.id === activeId) ?? sections[0];

  function moveFocus(currentIndex: number, delta: number) {
    const next = (currentIndex + delta + sections.length) % sections.length;
    setActiveId(sections[next].id);
    document.getElementById(`tab-${sections[next].id}`)?.focus();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={breadcrumbs}
        title={title}
        identifier={identifier}
        subtitle={subtitle}
        meta={badges}
        actions={actions}
      />

      {mode === "tabbed" ? (
        <div className="flex flex-col gap-4">
          <div
            role="tablist"
            aria-label="Record sections"
            className="flex gap-8 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b border-border [&>*]:shrink-0 [&>*]:whitespace-nowrap"
          >
            {sections.map((section, i) => {
              const selected = section.id === active?.id;
              return (
                <button
                  key={section.id}
                  id={`tab-${section.id}`}
                  role="tab"
                  type="button"
                  aria-selected={selected}
                  aria-controls={`panel-${section.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActiveId(section.id)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight") moveFocus(i, 1);
                    if (e.key === "ArrowLeft") moveFocus(i, -1);
                    if (e.key === "Home") moveFocus(i, -i);
                    if (e.key === "End") moveFocus(i, sections.length - 1 - i);
                  }}
                  className={`-mb-px flex items-center gap-1 border-b-2 px-1 py-2 text-sm ${
                    selected
                      ? "border-accent font-semibold text-foreground"
                      : "border-transparent font-normal text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {section.label}
                  {section.badge !== undefined && (
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {section.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {active && (
            <div
              id={`panel-${active.id}`}
              role="tabpanel"
              aria-labelledby={`tab-${active.id}`}
              tabIndex={0}
              className="pt-2"
            >
              <SectionBody section={active} />
            </div>
          )}
        </div>
      ) : (
        <div
          className={
            sections.some((section) => section.aside)
              ? "grid gap-12 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start"
              : "flex flex-col gap-12"
          }
        >
          {sections.some((section) => section.aside) ? (
            <>
              <div className="flex min-w-0 flex-col gap-12 lg:pr-14">
                {sections.filter((section) => !section.aside).map((section) => (
                  <StackedSection key={section.id} section={section} />
                ))}
              </div>
              <div className="flex flex-col gap-12 lg:border-l lg:border-border lg:pl-10">
                {sections.filter((section) => section.aside).map((section) => (
                  <StackedSection key={section.id} section={section} />
                ))}
              </div>
            </>
          ) : (
            sections.map((section) => <StackedSection key={section.id} section={section} />)
          )}
        </div>
      )}
    </div>
  );
}

function StackedSection({ section }: { section: DetailSection }) {
  // A section with nothing to show (e.g. a control this viewer may not use) draws no empty heading.
  if (section.content === null || section.content === undefined || section.content === false) return null;
  return (
    <section aria-labelledby={`heading-${section.id}`} className="flex flex-col gap-4">
      <h2
        id={`heading-${section.id}`}
        className="text-[22px] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground"
      >
        {section.label}
      </h2>
      <div className="border-t border-foreground">
        <SectionBody section={section} />
      </div>
    </section>
  );
}

/** A failing section degrades alone — the rest of the record stays readable. */
function SectionBody({ section }: { section: DetailSection }) {
  if (!section.error) return <>{section.content}</>;

  return (
    <div className="flex flex-col items-start gap-2 border border-border bg-surface-2 px-4 py-6">
      <p className="text-sm font-semibold text-foreground">
        {section.label} failed to load
      </p>
      <p className="max-w-prose text-sm text-muted-foreground">{section.error.message}</p>
      {section.error.onRetry && (
        <button
          type="button"
          onClick={section.error.onRetry}
          className="rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-2"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/** Label/value pairs for a record summary. */
export function DetailFacts({
  facts,
}: {
  facts: { label: string; value: ReactNode; mono?: boolean }[];
}) {
  return (
    <dl className="flex flex-col">
      {facts.map((fact) => (
        <div
          key={fact.label}
          className="grid grid-cols-1 gap-1 border-b border-border py-4 sm:grid-cols-[210px_minmax(0,1fr)] sm:gap-4"
        >
          <dt className="text-sm text-muted-foreground">{fact.label}</dt>
          <dd
            className={`text-base font-medium text-foreground ${
              fact.mono ? "font-mono text-[13px] tabular-nums" : ""
            }`}
          >
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
