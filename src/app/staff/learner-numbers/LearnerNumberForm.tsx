"use client";

import { useId, useState, useTransition } from "react";
import { useToast } from "@/components/feedback/Toaster";
import { learnerNumberCapacity, parseLearnerNumberPattern, previewLearnerNumbers } from "@/lib/learner-number";
import type { LearnerNumberSettings } from "@/server/services/learner-number-service";
import { saveLearnerNumberPatternAction } from "./actions";

/**
 * The learner number settings form: one field for the pattern, with a preview
 * of the numbers it would issue next that updates as you type.
 *
 * The preview and the message under the field come from the same
 * `@/lib/learner-number` rules the server applies on save, so what is shown
 * here is what will be issued. The server still re-checks; this is a courtesy.
 */

const EXAMPLES = ["KQL-######", "KQ/{YY}/#####", "{YYYY}-STU-####"] as const;

const BTN =
  "inline-flex min-h-[46px] items-center rounded-md bg-accent px-6 text-sm font-semibold text-accent-contrast hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-50";
const CHIP =
  "rounded-md border border-input-border bg-surface px-3 py-1 font-mono text-xs text-foreground hover:bg-surface-2";

export type LearnerNumberFormProps = {
  initial: LearnerNumberSettings;
  /** Today, from the server: the preview's year must not depend on the browser's clock. */
  todayIso: string;
  save?: typeof saveLearnerNumberPatternAction;
};

export function LearnerNumberForm({ initial, todayIso, save = saveLearnerNumberPatternAction }: LearnerNumberFormProps) {
  const fieldId = useId();
  const hintId = useId();
  const toast = useToast();
  const [settings, setSettings] = useState(initial);
  const [pattern, setPattern] = useState(initial.pattern ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const today = new Date(todayIso);
  const trimmed = pattern.trim();
  const parsed = parseLearnerNumberPattern(pattern);
  const preview = parsed.ok ? previewLearnerNumbers(pattern, settings.nextSequence, today) : [];
  const capacity = parsed.ok ? learnerNumberCapacity(pattern) : null;
  const unchanged = trimmed === (settings.pattern ?? "");
  // Do not scold an empty field before anything has been typed.
  const problem = !parsed.ok && trimmed ? parsed.message : null;

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await save({ pattern });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSettings(result.settings);
      setPattern(result.settings.pattern ?? "");
      toast.success("Learner number pattern saved");
    });
  }

  return (
    <div className="flex max-w-[760px] flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-[20px] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground">Status</h2>
        <dl className="grid gap-4 border-t border-foreground pt-4 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-muted-foreground">Numbering</dt>
            <dd className="text-base font-semibold text-foreground">{settings.pattern ? "On" : "Off"}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Learners with a number</dt>
            <dd className="text-base font-semibold text-foreground tabular-nums">{settings.issued}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Learners without one</dt>
            <dd className="text-base font-semibold text-foreground tabular-nums">{settings.withoutNumber}</dd>
          </div>
        </dl>
        {!settings.pattern && (
          <p className="text-sm text-muted-foreground">
            Learner numbers are off. Save a pattern and every learner who registers from then on gets the next number.
          </p>
        )}
      </section>

      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (parsed.ok && !unchanged) submit();
        }}
      >
        <h2 className="text-[20px] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground">Pattern</h2>

        {error && (
          <p role="alert" className="rounded-md border border-danger/30 bg-danger-surface px-4 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor={fieldId} className="text-sm font-semibold text-foreground">
            Learner number pattern
          </label>
          <input
            id={fieldId}
            type="text"
            value={pattern}
            onChange={(event) => {
              setPattern(event.target.value);
              setError(null);
            }}
            maxLength={40}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={problem ? true : undefined}
            aria-describedby={hintId}
            placeholder="KQL-######"
            className="h-12 rounded-md border border-input-border bg-surface px-4 font-mono text-sm text-foreground placeholder:text-muted-foreground aria-[invalid=true]:border-danger"
          />
          <p id={hintId} className={`text-sm ${problem ? "text-danger" : "text-muted-foreground"}`} role={problem ? "alert" : undefined}>
            {problem ??
              "Type the fixed part as you want it to appear. Use # for each digit of the counter, and {YYYY} or {YY} for the year a learner registered."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Examples:</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className={CHIP}
              onClick={() => {
                setPattern(example);
                setError(null);
              }}
            >
              {example}
            </button>
          ))}
        </div>

        <div className="rounded-md border border-border bg-surface-2 p-4" aria-live="polite">
          <p className="text-sm font-semibold text-foreground">The next learners to register would get</p>
          {preview.length > 0 ? (
            <>
              <ol className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
                {preview.map((number) => (
                  <li key={number} className="font-mono text-base text-foreground tabular-nums">
                    {number}
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-sm text-muted-foreground">
                Numbers are issued in order. This pattern has room for {capacity?.toLocaleString("en-GB")} learners before
                the number gets one digit longer.
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Enter a valid pattern to see the numbers it produces.</p>
          )}
        </div>

        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
          <li>A learner&apos;s number never changes once issued.</li>
          <li>Changing the pattern affects only learners who register afterwards. The counter carries on; it does not restart.</li>
          <li>Learners who registered before a pattern was saved are not given a number.</li>
        </ul>

        <div className="flex items-center gap-3 border-t border-foreground pt-6">
          <button type="submit" disabled={pending || !parsed.ok || unchanged} className={BTN}>
            {pending ? "Saving…" : settings.pattern ? "Save pattern" : "Turn on learner numbers"}
          </button>
          {unchanged && settings.pattern && <span className="text-sm text-muted-foreground">No changes to save.</span>}
        </div>
      </form>
    </div>
  );
}
