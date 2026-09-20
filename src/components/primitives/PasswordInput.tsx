"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * A password field with a show/hide toggle at its right edge, so a learner can check what they
 * typed. Drop-in for `<input type="password">`: every input prop (name, autoComplete, required,
 * minLength, ...) passes straight through, and the field stays uncontrolled so it works with
 * `<form action>` exactly as before.
 *
 * The toggle is a real `type="button"` (it never submits the form), announces its state with
 * `aria-pressed`, and the field starts hidden on every mount.
 */
const DEFAULT_INPUT_CLASS =
  "h-12 w-full rounded-md border border-input-border bg-surface px-4 text-sm text-foreground placeholder:text-muted-foreground";

export function PasswordInput({
  className,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        {...rest}
        type={visible ? "text" : "password"}
        className={`${className ?? DEFAULT_INPUT_CLASS} pr-12`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        {visible ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
      </button>
    </div>
  );
}
