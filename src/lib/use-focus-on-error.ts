"use client";

import { useEffect, useRef } from "react";

/**
 * Moves keyboard focus to an error message each time a form action returns a
 * new result with an error, so the message is read out and the user is not left
 * on `body`. Put the returned ref and `tabIndex={-1}` on the `role="alert"` element.
 */
export function useFocusOnError<T extends HTMLElement>(state: unknown, hasError: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (hasError) ref.current?.focus();
  }, [state, hasError]);
  return ref;
}
