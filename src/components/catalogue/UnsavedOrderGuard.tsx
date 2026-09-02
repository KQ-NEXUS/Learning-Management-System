"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { ConfirmModal } from "@/components/primitives";

/**
 * D-22 — the unsaved-order guard.
 *
 * This dialog and the `beforeunload` prompt are COURTESY only. The real
 * guarantee that a stale arrangement can never be committed is server-side:
 * `reorder-service.ts` throws `StaleOrderError` when the course's `updatedAt`
 * has moved under the caller, and the publish path refuses a course whose
 * order has unsaved changes (D-22). A user who dismisses this dialog, force
 * reloads, or hits the back button still cannot corrupt anything — the worst
 * case is that they lose an un-saved rearrangement, which is exactly what the
 * dialog warns about.
 *
 * `window.confirm` is deliberately NOT used: it is not keyboard- or
 * screen-reader-friendly, and this phase is under NFR-09 (WCAG 2.2 AA). The
 * accessible `ConfirmModal` primitive is used instead. `beforeunload` is
 * still registered because `onNavigate` does not fire for a reload or the
 * browser back button, and there is no accessible substitute for the
 * browser's own reload prompt.
 */

type UnsavedOrderValue = {
  dirty: boolean;
  /**
   * Report whether a given source of order edits is dirty. `key` lets several
   * independent boards (Modules and Lessons on the same screen) each report
   * their own state without clobbering one another — the context is dirty
   * when ANY key is dirty.
   */
  setDirty: (dirty: boolean, key?: string) => void;
};

const UnsavedOrderContext = createContext<UnsavedOrderValue>({
  dirty: false,
  setDirty: () => {},
});

export function useUnsavedOrder(): UnsavedOrderValue {
  return useContext(UnsavedOrderContext);
}

export function UnsavedOrderProvider({ children }: { children: ReactNode }) {
  const [dirtyKeys, setDirtyKeys] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const setDirty = useCallback((dirty: boolean, key = "default") => {
    setDirtyKeys((prev) => {
      const has = prev.has(key);
      if (dirty === has) return prev;
      const next = new Set(prev);
      if (dirty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const dirty = dirtyKeys.size > 0;

  // onNavigate does not cover a reload or the back button — beforeunload does.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const value = useMemo<UnsavedOrderValue>(
    () => ({ dirty, setDirty }),
    [dirty, setDirty],
  );

  return (
    <UnsavedOrderContext.Provider value={value}>
      {children}
    </UnsavedOrderContext.Provider>
  );
}

export type GuardedLinkProps = Omit<
  ComponentProps<typeof Link>,
  "href" | "onNavigate"
> & {
  href: string;
};

/**
 * A `next/link` that, while the order is dirty, intercepts client-side
 * navigation (`onNavigate` + `event.preventDefault()`, per the Next.js docs
 * pattern for this exact case) and asks for confirmation through the
 * accessible modal before continuing. Its documented limits: it does not
 * fire for external URLs, `download` links, or modifier-key clicks, and it
 * does not cover reloads or the back button — `beforeunload` on the provider
 * is the backstop for those.
 */
export function GuardedLink({ href, children, ...rest }: GuardedLinkProps) {
  const { dirty, setDirty } = useUnsavedOrder();
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  return (
    <>
      <Link
        href={href}
        onNavigate={(event) => {
          if (dirty) {
            event.preventDefault();
            setPendingHref(href);
          }
        }}
        {...rest}
      >
        {children}
      </Link>
      <ConfirmModal
        open={pendingHref !== null}
        eyebrow="Unsaved changes"
        tone="default"
        title="Leave without saving the order?"
        description="You rearranged this course but have not pressed Save order. Leaving now discards that rearrangement — the saved order is unchanged."
        confirmLabel="Leave without saving"
        onConfirm={() => {
          const target = pendingHref;
          setPendingHref(null);
          setDirty(false);
          if (target) router.push(target);
        }}
        onCancel={() => setPendingHref(null)}
      />
    </>
  );
}
