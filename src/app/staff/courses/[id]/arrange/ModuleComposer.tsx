"use client";

import { useState } from "react";
import { FormField, TextInput } from "@/components/primitives";

/**
 * The inline Module composer.
 *
 * It lives on the arrange page because that is where a Course's structure is
 * managed — and because a Course with zero Modules must have a visible way
 * forward on the first screen a staff member opens. This is the only Module
 * creation surface in the phase (plan 04-09 objective): `createModule` exists
 * in plan 04-04, but a service with no caller is not a delivered CAT-03.
 *
 * When the Course has no Modules, an empty-state prompt explains that a
 * Module has to exist before a Lesson can, rather than showing an empty board
 * with no way forward.
 *
 * WR-04 (04.1 gap closure): a failed add keeps the typed title in the add
 * input and surfaces the error under that input; a failed rename keeps the
 * row in edit mode with the typed name and surfaces the error next to that
 * row. Neither failure ever moves the other operation's error, and neither
 * clears its field. Success is the only path that clears the add input or
 * exits rename mode.
 */

export type ComposerModule = { id: string; title: string };

/**
 * The result contract every composer callback resolves to. A `void`/`undefined`
 * resolution is treated as success — only an explicit `{ ok: false }` keeps the
 * field populated and shows an error.
 */
export type ComposerResult = { ok: true } | { ok: false; message: string };

type ComposerCallbackResult = void | ComposerResult | Promise<void | ComposerResult>;

export type ModuleComposerProps = {
  modules: ComposerModule[];
  onAddModule: (title: string) => ComposerCallbackResult;
  onRenameModule: (moduleId: string, title: string) => ComposerCallbackResult;
};

const ADD_FALLBACK_ERROR =
  "That module could not be added. Your title is still here — try again.";
const RENAME_FALLBACK_ERROR =
  "That name could not be saved. Your text is still here — try again.";

/**
 * Normalises a callback resolution into an error message or `null`. A rejected
 * promise is caught by the caller; a resolved `void` or `{ ok: true }` is
 * success; a resolved `{ ok: false }` yields its message (or a generic
 * fallback).
 */
function failureMessage(
  result: void | ComposerResult,
  fallback: string,
): string | null {
  if (result && result.ok === false) {
    return result.message || fallback;
  }
  return null;
}

const BTN =
  "rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-2 disabled:opacity-50";
const PRIMARY =
  "rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:opacity-90 disabled:opacity-50";

function ModuleRenameRow({
  module,
  onRename,
}: {
  module: ComposerModule;
  onRename: (moduleId: string, title: string) => ComposerCallbackResult;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(module.title);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function startEditing() {
    setName(module.title);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function save() {
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a name for the module.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const message = failureMessage(
        await onRename(module.id, trimmed),
        RENAME_FALLBACK_ERROR,
      );
      if (message) {
        // Stay in edit mode with the typed name intact so the retry happens
        // at this control, not under the unrelated add input.
        setError(message);
        return;
      }
      setEditing(false);
      setError(null);
    } catch {
      setError(RENAME_FALLBACK_ERROR);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <li className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate">{module.title}</span>
        <button type="button" className={BTN} onClick={startEditing}>
          Rename
        </button>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`rename-${module.id}`}>
          Rename {module.title}
        </label>
        <TextInput
          id={`rename-${module.id}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className={PRIMARY}
          disabled={saving || !name.trim()}
          onClick={save}
        >
          Save name
        </button>
        <button
          type="button"
          className={BTN}
          disabled={saving}
          onClick={cancel}
        >
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

export function ModuleComposer({
  modules,
  onAddModule,
  onRenameModule,
}: ModuleComposerProps) {
  const [title, setTitle] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const hasNoModules = modules.length === 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setLocalError("Enter a title for the module.");
      return;
    }
    setLocalError(null);
    setSubmitting(true);
    try {
      const message = failureMessage(
        await onAddModule(trimmed),
        ADD_FALLBACK_ERROR,
      );
      if (message) {
        // Keep the typed title so the staff member retries here, not by
        // re-typing.
        setLocalError(message);
        return;
      }
      setTitle("");
    } catch {
      setLocalError(ADD_FALLBACK_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface px-4 py-4 shadow-xs">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold tracking-tight">Modules</h2>
        {hasNoModules && (
          <p className="max-w-prose text-sm text-muted-foreground">
            This course has no modules yet. A module has to exist before a lesson
            can — add the first one below.
          </p>
        )}
      </div>

      <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-2">
        <FormField
          name="module-title"
          label="Module title"
          required
          error={localError ?? undefined}
        >
          {(field) => (
            <TextInput
              {...field}
              value={title}
              required
              autoFocus={hasNoModules}
              placeholder="e.g. Getting started"
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </FormField>
        <button type="submit" className={PRIMARY} disabled={submitting}>
          Add module
        </button>
      </form>

      {modules.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-border pt-4">
          {modules.map((module) => (
            <ModuleRenameRow
              key={module.id}
              module={module}
              onRename={onRenameModule}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
