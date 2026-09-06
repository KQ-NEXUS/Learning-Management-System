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
 */

export type ComposerModule = { id: string; title: string };

export type ModuleComposerProps = {
  modules: ComposerModule[];
  onAddModule: (title: string) => void | Promise<void>;
  onRenameModule: (moduleId: string, title: string) => void | Promise<void>;
  pending?: boolean;
  error?: string | null;
};

const BTN =
  "rounded-md border border-input-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-surface-2 disabled:opacity-50";
const PRIMARY =
  "rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-contrast hover:opacity-90 disabled:opacity-50";

function ModuleRenameRow({
  module,
  onRename,
  pending,
}: {
  module: ComposerModule;
  onRename: (moduleId: string, title: string) => void | Promise<void>;
  pending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(module.title);

  if (!editing) {
    return (
      <li className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate">{module.title}</span>
        <button
          type="button"
          className={BTN}
          onClick={() => {
            setName(module.title);
            setEditing(true);
          }}
        >
          Rename
        </button>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-2">
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
        disabled={pending || !name.trim()}
        onClick={() => {
          void onRename(module.id, name.trim());
          setEditing(false);
        }}
      >
        Save name
      </button>
      <button type="button" className={BTN} onClick={() => setEditing(false)}>
        Cancel
      </button>
    </li>
  );
}

export function ModuleComposer({
  modules,
  onAddModule,
  onRenameModule,
  pending = false,
  error = null,
}: ModuleComposerProps) {
  const [title, setTitle] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const hasNoModules = modules.length === 0;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setLocalError("Enter a title for the module.");
      return;
    }
    setLocalError(null);
    void onAddModule(trimmed);
    setTitle("");
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-4 shadow-xs">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold tracking-tight">Modules</h2>
        {hasNoModules && (
          <p className="max-w-prose text-xs text-muted-foreground">
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
          error={localError ?? error ?? undefined}
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
        <button type="submit" className={PRIMARY} disabled={pending}>
          Add module
        </button>
      </form>

      {modules.length > 0 && (
        <ul className="flex flex-col gap-1.5 border-t border-border pt-3">
          {modules.map((module) => (
            <ModuleRenameRow
              key={module.id}
              module={module}
              onRename={onRenameModule}
              pending={pending}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
