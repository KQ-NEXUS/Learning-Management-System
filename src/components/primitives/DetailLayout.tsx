"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

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
}: DetailLayoutProps) {
  const [activeId, setActiveId] = useState(sections[0]?.id);

  if (state.status === "denied") {
    return (
      <div className="flex flex-col items-start gap-2 rounded-xl border border-border bg-surface px-6 py-10 shadow-card">
        <span className="font-mono text-xs tracking-wide text-muted-foreground">403</span>
        <p className="text-sm font-semibold text-foreground">You do not have access to this record</p>
        <p className="max-w-prose text-sm text-muted-foreground">
          Your role does not include{" "}
          {state.permission ? (
            <code className="rounded-sm bg-surface-2 px-1 font-mono text-xs">
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
      <div className="flex flex-col items-start gap-2 rounded-xl border border-border bg-surface px-6 py-10 shadow-card">
        <p className="text-sm font-semibold text-foreground">Could not load this record</p>
        <p className="max-w-prose text-sm text-muted-foreground">
          {state.message ?? "The request failed. Nothing has been changed."}
        </p>
        {state.onRetry && (
          <button
            type="button"
            onClick={state.onRetry}
            className="rounded-md border border-input-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-surface-2"
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
        className="flex flex-col gap-5 rounded-xl border border-border bg-surface px-6 py-6 shadow-card"
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
    <div className="flex flex-col gap-5">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            {breadcrumbs.map((crumb, i) => (
              <li key={crumb.label} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden>/</span>}
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-foreground hover:underline">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="font-semibold text-foreground">{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <header className="flex flex-col gap-2 border-b border-border pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[25px] leading-[1.2] font-semibold tracking-tight text-foreground">
                {title}
              </h1>
              {badges && (
                <div className="flex flex-wrap items-center gap-1.5">{badges}</div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {identifier && (
                <p className="font-mono text-[11px] text-muted-foreground">{identifier}</p>
              )}
              {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      </header>

      {mode === "tabbed" ? (
        <div className="flex flex-col gap-4">
          <div
            role="tablist"
            aria-label="Record sections"
            className="flex flex-wrap gap-6 border-b border-border"
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
                  className={`-mb-px flex items-center gap-1.5 border-b-2 px-1 py-2 text-sm ${
                    selected
                      ? "border-accent font-semibold text-foreground"
                      : "border-transparent font-normal text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {section.label}
                  {section.badge !== undefined && (
                    <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
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
              className="rounded-xl border border-border bg-surface p-5 shadow-card"
            >
              <SectionBody section={active} />
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {sections.map((section) => (
            <section key={section.id} aria-labelledby={`heading-${section.id}`} className="flex flex-col gap-2">
              <h2
                id={`heading-${section.id}`}
                className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {section.label}
              </h2>
              <div className="rounded-xl border border-border bg-surface p-5 shadow-card">
                <SectionBody section={section} />
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
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
          className="rounded-md border border-input-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-surface-2"
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
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
      {facts.map((fact) => (
        <div key={fact.label} className="flex flex-col gap-0.5">
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {fact.label}
          </dt>
          <dd
            className={`text-sm text-foreground ${
              fact.mono ? "font-mono tabular-nums" : ""
            }`}
          >
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
