"use client";

import { useEffect, useId, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { FormDialog } from "@/components/primitives/FormDialog";

/**
 * PersonPickerDialog — a pop-up for choosing one person, or several, from a list.
 *
 * Replaces the fields that asked staff to type a user id (owner request,
 * 2026-10-04): nobody knows an id without looking it up, a typo only failed
 * after submitting, and there was no way to confirm the right person. Here you
 * see names, emails and roles, narrow the list by typing, pick, and confirm.
 *
 * Two ways to supply the list:
 *   - `people`: a short list already on the page (a cohort's instructors). The
 *     search box filters it in the browser.
 *   - `load(query)`: a list fetched from the server as you type (all staff).
 *     The server decides who may be listed; this component never widens it.
 *
 * Two ways to choose:
 *   - one person (the default): rows behave as radio buttons, `onConfirm`.
 *   - several (`multiple`): rows behave as tick boxes, `onConfirmMany`. Ticks
 *     are kept while you search for the next person, and everyone ticked is
 *     listed under the results so nobody is chosen out of sight.
 *
 * A person can be shown but not selectable (`disabledReason`), for example
 * someone who already holds the role being assigned.
 */

export type PickablePerson = {
  id: string;
  name: string;
  email: string;
  /** A reference shown before the email and matched by the search: a learner number. */
  reference?: string;
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
  /** `note` is shown under the list, for example to say the list was cut short. */
  load?: (query: string) => Promise<{ ok: true; people: PickablePerson[]; note?: string } | { ok: false; message: string }>;
  /** What the search box says it matches. */
  searchLabel?: string;
  /** Preselected when the dialog opens (the current facilitator). */
  selectedId?: string | null;
  /** Let several people be ticked. Use with `onConfirmMany`. */
  multiple?: boolean;
  /** With `multiple`: who is already ticked when the dialog opens. */
  selectedPeople?: PickablePerson[];
  /** With `multiple`: what one of the people being chosen is called, for "3 learners chosen". */
  noun?: { one: string; many: string };
  /** Shown when the list is empty before anything is typed. */
  emptyText?: string;
  /** The confirm action is running. */
  pending?: boolean;
  error?: string | null;
  onConfirm?: (person: PickablePerson) => void;
  onConfirmMany?: (people: PickablePerson[]) => void;
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
  searchLabel = "Search by name or email",
  selectedId = null,
  multiple = false,
  selectedPeople,
  noun = { one: "person", many: "people" },
  emptyText = "Nobody to show.",
  pending = false,
  error = null,
  onConfirm,
  onConfirmMany,
  onClose,
}: PersonPickerDialogProps) {
  const searchId = useId();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [chosenId, setChosenId] = useState<string | null>(selectedId);
  // Several: the people themselves are kept, not just their ids, because a ticked person
  // usually drops out of the list as soon as the search changes.
  const [ticked, setTicked] = useState<PickablePerson[]>(selectedPeople ?? []);
  const [remote, setRemote] = useState<{
    key: string;
    people: PickablePerson[];
    error: string | null;
    note?: string;
  } | null>(null);

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
          setRemote(
            result.ok
              ? { key, people: result.people, error: null, note: result.note }
              : { key, people: [], error: result.message },
          );
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
        (person) =>
          !needle ||
          person.name.toLowerCase().includes(needle) ||
          person.email.toLowerCase().includes(needle) ||
          (person.reference ?? "").toLowerCase().includes(needle),
      );
  const note = load && !loading ? remote?.note : undefined;
  const loadError = load ? (remote?.error ?? null) : null;
  const chosen = listed.find((person) => person.id === chosenId && !person.disabledReason) ?? null;
  const tickedIds = new Set(ticked.map((person) => person.id));

  function toggle(person: PickablePerson) {
    setTicked((current) =>
      current.some((entry) => entry.id === person.id)
        ? current.filter((entry) => entry.id !== person.id)
        : [...current, person],
    );
  }

  const countLabel = `${ticked.length} ${ticked.length === 1 ? noun.one : noun.many} chosen`;
  const canConfirm = multiple ? ticked.length > 0 : chosen !== null;

  return (
    <FormDialog open title={title} pending={pending} onClose={onClose}>
      {description && <p className="-mt-2 text-sm text-muted-foreground">{description}</p>}

      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          {searchLabel}
        </label>
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id={searchId}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchLabel}
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
        role={multiple ? "group" : "radiogroup"}
        aria-label={title}
        aria-busy={loading || undefined}
        className={`flex min-h-[120px] flex-col gap-1 overflow-y-auto rounded-md border border-border p-1 ${
          multiple ? "max-h-[260px]" : "max-h-[320px]"
        }`}
      >
        {listed.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-muted-foreground">
            {loading ? "Loading…" : needle ? `Nobody matches “${query.trim()}”.` : emptyText}
          </li>
        ) : (
          listed.map((person) => {
            const disabled = Boolean(person.disabledReason);
            const selected = multiple ? tickedIds.has(person.id) && !disabled : person.id === chosen?.id;
            return (
              <li key={person.id}>
                <button
                  type="button"
                  role={multiple ? "checkbox" : "radio"}
                  aria-checked={selected}
                  disabled={disabled}
                  onClick={() => (multiple ? toggle(person) : setChosenId(person.id))}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left ${
                    selected ? "bg-accent-wash" : "hover:bg-surface-2"
                  } disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent`}
                >
                  {multiple && (
                    <span
                      aria-hidden
                      className={`flex size-5 shrink-0 items-center justify-center rounded border ${
                        selected ? "border-accent bg-accent text-accent-contrast" : "border-input-border bg-surface"
                      }`}
                    >
                      {selected && <Check className="size-3.5" strokeWidth={3} />}
                    </span>
                  )}
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-wash text-xs font-semibold text-accent"
                  >
                    {initialsOf(person.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{person.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {person.reference && (
                        <span className="font-mono font-semibold text-foreground">{person.reference} · </span>
                      )}
                      {person.email}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-muted-foreground">
                    {person.disabledReason ?? person.detail}
                  </span>
                  {!multiple && <Check aria-hidden className={`size-4 shrink-0 text-accent ${selected ? "" : "invisible"}`} />}
                </button>
              </li>
            );
          })
        )}
      </ul>

      {note && <p className="-mt-1 text-xs text-muted-foreground">{note}</p>}

      {multiple && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-foreground" aria-live="polite">
              {countLabel}
            </p>
            {ticked.length > 1 && (
              <button
                type="button"
                onClick={() => setTicked([])}
                className="text-sm font-semibold text-accent underline-offset-2 hover:underline"
              >
                Clear all
              </button>
            )}
          </div>
          {ticked.length > 0 && (
            <ul aria-label="Chosen" className="flex max-h-[96px] flex-wrap gap-2 overflow-y-auto">
              {ticked.map((person) => (
                <li
                  key={person.id}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 py-1 pr-1 pl-3 text-xs text-foreground"
                >
                  <span className="font-semibold">{person.name}</span>
                  {person.reference && <span className="font-mono text-muted-foreground">{person.reference}</span>}
                  <button
                    type="button"
                    onClick={() => toggle(person)}
                    aria-label={`Remove ${person.name}${person.reference ? `, ${person.reference}` : ""}`}
                    className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-surface hover:text-foreground"
                  >
                    <X aria-hidden className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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
          onClick={() => {
            if (multiple) {
              if (ticked.length > 0) onConfirmMany?.(ticked);
            } else if (chosen) {
              onConfirm?.(chosen);
            }
          }}
          disabled={!canConfirm || pending}
          className="inline-flex min-h-[42px] items-center rounded-md bg-accent px-5 text-sm font-semibold text-accent-contrast hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving…" : confirmLabel}
        </button>
      </div>
    </FormDialog>
  );
}
