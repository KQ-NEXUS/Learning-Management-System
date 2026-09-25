"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";

export type QueueTabItem = { value: string; label: string; count: number; href: string };

/**
 * Tab strip for the staff queue. Each tab is a real link, so a deep link works
 * without client JavaScript; arrow keys, Home and End move between tabs and
 * activate them (automatic activation) once hydrated.
 */
export function QueueTabs({
  tabs,
  active,
  idPrefix,
}: {
  tabs: readonly QueueTabItem[];
  active: string;
  idPrefix: string;
}) {
  const router = useRouter();
  const refs = useRef<Array<HTMLAnchorElement | null>>([]);

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    refs.current[next]?.focus();
    router.push(tabs[next].href);
  }

  return (
    <div
      role="tablist"
      aria-label="Support queue"
      className="flex gap-6 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab, index) => {
        const selected = tab.value === active;
        return (
          <Link
            key={tab.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            id={`${idPrefix}-tab-${tab.value}`}
            role="tab"
            href={tab.href}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-focus ${
              selected
                ? "border-accent font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
            <span className="font-mono text-xs tabular-nums">({tab.count})</span>
          </Link>
        );
      })}
    </div>
  );
}
