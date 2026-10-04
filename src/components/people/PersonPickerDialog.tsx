"use client";

import { useEffect, useId, useState } from "react";
import { Check, Search } from "lucide-react";
import { FormDialog } from "@/components/primitives/FormDialog";

/**
 * PersonPickerDialog — a pop-up for choosing one person from a list.
 *
 * Replaces the fields that asked staff to type a user id (owner request,
 * 2026-10-04): nobody knows an id without looking it up, a typo only failed
 * after submitting, and there was no way to confirm the right person. Here you
 * see names, emails and roles, narrow the list by typing, pick one, and confirm.
 *
 * Two ways to supply the list:
 *   - `people`: a short list already on the page (a cohort's instructors). The
 *     search box filters it in the browser.
 *   - `load(query)`: a list fetched from the server as you type (all staff).
 *     The server decides who may be listed; this component never widens it.
 *
 * A person can be shown but not selectable (`disabledReason`), for example
 * someone who already holds the role being assigned.
 */

export type PickablePerson = {
  id: string;
  name: string;
  email: string;
  /** A short line on the right: a role, or roles joined with commas. */
  detail?: string;
  /** Set to show the person greyed out with this explanation instead of selectable. */
  disabledReason?: string;
};

export type PersonPickerDialogProps = {
  open: boolean;
  title: string;
  /** One sentence under the title saying who is listed. */
  description?: string;
  confirmLabel: string;
  people?: PickablePerson[];
  load?: (query: string) => Promise<{ ok: true; people: PickablePerson[] } | { ok: false; message: string }>;
  /** Preselected when the dialog opens (the current facilitator). */
  selectedId?: string | null;
  /** Shown when the list is empty before anything is typed. */
  emptyText?: string;
  /** The confirm action is running. */
  pending?: boolean;
  error?: string | null;
  onConfirm: (person: PickablePerson) => void;
  onClose: () => void;
};

const SEARCH_DELAY_MS = 250;

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

export function PersonPickerDialog(props: PersonPickerDialogProps) {
  if (!props.open) return null;
  // Mounted only while open, so each opening starts from a clean search and selection.
  return <Picker {...props} />;
}

function Picker({
  title,
  description,
  confirmLabel,
  people,
  load,
  selectedId = null,
  emptyText = "Nobody to show.",
  pending = false,
  error = null,
  onConfirm,
  onClose,
}: PersonPickerDialogProps) {
  const searchId = useId();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [chosenId, setChosenId] = useState<string | null>(selectedId);
  const [remote, setRemote] = useState<{ key: string; people: PickablePerson[]; error: string | null } | null>(null);

  // Server-backed list: fetch a moment after typing stops. A slow answer to an
  // older query is dropped rather than shown over a newer one.
  useEffect(() => {
    if (!load) return;
    let cancelled = false;
    const key = query.trim();
    const timer = window.setTimeout(
      async () => {
        try {
          const result = await load(key);
          if (cancelled) return;
          setRemote(result.ok ? { key, people: result.people, error: null } : { key, people: [], error: result.message });
        } catch {
          if (!cancelled) setRemote({ key, people: [], error: "The list could not be loaded. Try again." });
        }
      },
      key ? SEARCH_DELAY_MS : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [load, query]);

  const needle = query.trim().toLowerCase();
  const loading = load ? remote === null || remote.key !== query.trim() : false;
  const listed: PickablePerson[] = load
    ? (remote?.people ?? [])
    : (people ?? []).filter(
        (person) => !needle || person.name.toLowerCase().includes(needle) || person.email.toLowerCase().includes(needle),
      );
  const loadError = load ? (remote?.error ?? null) : null;
  const chosen = listed.find((person) => person.id === chosenId && !person.disabledReason) ?? null;

  return (
    <FormDialog open title={title} pending={pending} onClose={onClose}>
      {description && <p className="-mt-2 text-sm text-muted-foreground">{description}</p>}

      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          Search by name or email
        </label>
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id={searchId}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name or email"
          autoComplete="off"
          aria-controls={listId}
          className="h-11 w-full rounded-md border border-input-border bg-surface pr-3 pl-9 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {(error || loadError) && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-surface px-4 py-2 text-sm text-danger">
          {error ?? loadError}
        </p>
      )}

      <div aria-live="polite" className="sr-only">
        {loading ? "Loading people" : `${listed.length} ${listed.length === 1 ? "person" : "people"} listed`}
      </div>

      <ul
        id={listId}
        role="radiogroup"
        aria-label={title}
        aria-busy={loading || undefined}
        className="flex max-h-[320px] min-h-[120px] flex-col gap-1 overflow-y-auto rounded-md border border-border p-1"
      >
        {listed.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-muted-foreground">
            {loading ? "Loading…" : needle ? `Nobody matches “${query.trim()}”.` : emptyText}
          </li>
        ) : (
          listed.map((person) => {
            const selected = person.id === chosen?.id;
            const disabled = Boolean(person.disabledReason);
            return (
              <li key={person.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  onClick={() => setChosenId(person.id)}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left ${
                    selected ? "bg-accent-wash" : "hover:bg-surface-2"
                  } disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent`}
                >
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-wash text-xs font-semibold text-accent"
                  >
                    {initialsOf(person.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{person.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{person.email}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-muted-foreground">
                    {person.disabledReason ?? person.detail}
                  </span>
                  <Check aria-hidden className={`size-4 shrink-0 text-accent ${selected ? "" : "invisible"}`} />
                </button>
              </li>
            );
          })
        )}
      </ul>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="inline-flex min-h-[42px] items-center rounded-md border border-input-border bg-surface px-4 text-sm font-semibold text-foreground hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => chosen && onConfirm(chosen)}
          disabled={!chosen || pending}
          className="inline-flex min-h-[42px] items-center rounded-md bg-accent px-5 text-sm font-semibold text-accent-contrast hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving…" : confirmLabel}
        </button>
      </div>
    </FormDialog>
  );
}
