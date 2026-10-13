"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * A 44px icon button that copies one plain value (the deployment ID, UI-SPEC
 * Licence details row). The accessible name names what is copied; the confirmation is
 * announced through a polite live region and never relies on the icon swap alone.
 */
/** How long the check mark stays before the button goes back to the copy icon. */
const COPIED_MS = 2000;

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  // The check mark and the "Copied" announcement go back after a moment, so a second copy is announced again.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard access can be refused (insecure origin, permissions); the value stays selectable on screen.
      setCopied(false);
    }
  }

  return (
    <span className="inline-flex shrink-0 items-center">
      <button
        type="button"
        aria-label={label}
        onClick={copy}
        className="inline-flex size-11 items-center justify-center rounded-md border border-input-border bg-surface text-foreground hover:bg-surface-2"
      >
        {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
      </button>
      <span role="status" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </span>
  );
}
