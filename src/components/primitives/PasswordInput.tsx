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
  "min-h-[52px] rounded-[10px] border-[1.5px] border-field bg-paper px-4 text-base font-medium text-ink placeholder:text-placeholder hover:border-ink";

export function PasswordInput({
  className,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative w-full">
      <input
        {...rest}
        type={visible ? "text" : "password"}
        className={`${className ?? DEFAULT_INPUT_CLASS} w-full pr-14`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute inset-y-1 right-1 flex w-11 items-center justify-center rounded-[7px] text-ink-soft hover:bg-ground hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-orange"
      >
        {visible ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
      </button>
    </div>
  );
}
