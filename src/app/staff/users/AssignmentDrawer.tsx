"use client";

import { startTransition, useActionState, useEffect, useId, useRef, useState } from "react";
import type { ScopeType } from "@/server/permissions";
import type { ScopeTarget } from "@/server/services/scope-lookup-service";
import type { StaffSearchRow } from "@/server/services/staff-account-service";
import {
  createAssignmentAction,
  searchScopeTargetsAction,
  searchStaffUsersAction,
  type CreateAssignmentState,
} from "./actions";

const INITIAL: CreateAssignmentState = { errors: [], success: false };

const SCOPE_TYPES: { value: ScopeType; label: string }[] = [
  { value: "GLOBAL", label: "Global" },
  { value: "PROGRAMME", label: "Programme" },
  { value: "COURSE", label: "Course" },
  { value: "COHORT", label: "Cohort" },
];

const EMPTY_STATE_COPY: Partial<Record<ScopeType, string>> = {
  PROGRAMME: "No Programmes exist yet — check back once catalogue authoring (Phase 4) lands.",
  COHORT: "No Cohorts exist yet — check back once scheduling (Phase 5) lands.",
};

const RESULT_CAP = 10;
const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type PreselectedUser = { id: string; name: string; email: string; status: string };

/**
 * No existing drawer or typeahead precedent in this codebase — the container
 * is built fresh, but mirrors (not imports) ConfirmModal's focus-trap and
 * ESC-suppressed-while-pending rules, since this is a panel, not a
 * confirmation.
 */
export function AssignmentDrawer({
  open,
  onClose,
  roles,
  preselectedUser,
}: {
  open: boolean;
  onClose: () => void;
  roles: { id: string; name: string }[];
  preselectedUser?: PreselectedUser;
}) {
  if (!open) return null;
  return <DrawerPanel onClose={onClose} roles={roles} preselectedUser={preselectedUser} />;
}

function DrawerPanel({
  onClose,
  roles,
  preselectedUser,
}: {
  onClose: () => void;
  roles: { id: string; name: string }[];
  preselectedUser?: PreselectedUser;
}) {
  const [state, action, pending] = useActionState(createAssignmentAction, INITIAL);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  const [selectedUser, setSelectedUser] = useState<PreselectedUser | null>(preselectedUser ?? null);
  const [userQuery, setUserQuery] = useState("");
  const [userRetry, setUserRetry] = useState(0);
  const userKey = `${userQuery}:${userRetry}`;
  const [userSearch, setUserSearch] = useState<{ key: string; rows: StaffSearchRow[]; error: string | null }>({ key: "", rows: [], error: null });
  const userSearchPending = userQuery.length > 0 && userSearch.key !== userKey;
  const userResults = userSearch.key === userKey ? userSearch.rows : [];
  const userSearchError = userSearch.key === userKey ? userSearch.error : null;

  const [roleId, setRoleId] = useState("");
  const [scopeType, setScopeType] = useState<ScopeType>("GLOBAL");
  const [scopeId, setScopeId] = useState("");
  const [scopeQuery, setScopeQuery] = useState("");
  const [scopeRetry, setScopeRetry] = useState(0);
  const scopeKey = `${scopeType}:${scopeQuery}:${scopeRetry}`;
  const [scopeSearch, setScopeSearch] = useState<{ key: string; targets: ScopeTarget[]; error: string | null }>({ key: "", targets: [], error: null });
  const scopeTargets = scopeSearch.key === scopeKey ? scopeSearch.targets : [];
  const scopePending = scopeType !== "GLOBAL" && scopeSearch.key !== scopeKey;
  const scopeError = scopeSearch.key === scopeKey ? scopeSearch.error : null;

  // Focus moves in on open, returns to the trigger on close — the same rule
  // ConfirmModal implements, mirrored here rather than imported.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const background = new Map<Element, string | null>();
    // Inert siblings at each level, never the branch containing the dialog.
    let branch: Element | null = panelRef.current?.parentElement ?? null;
    while (branch && branch !== document.body) {
      for (const sibling of Array.from(branch.parentElement?.children ?? [])) {
        if (sibling !== branch) {
          background.set(sibling, sibling.getAttribute("inert"));
          sibling.setAttribute("inert", "");
        }
      }
      branch = branch.parentElement;
    }
    (panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panelRef.current?.querySelector<HTMLElement>("h2"))?.focus();
    return () => {
      background.forEach((value, element) => value === null ? element.removeAttribute("inert") : element.setAttribute("inert", value));
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!pending) onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(element => !element.closest('[hidden], [inert]') && element.getAttribute("aria-hidden") !== "true");
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) {
        event.preventDefault();
        panelRef.current?.querySelector<HTMLElement>("h2")?.focus();
      } else if (!controls.includes(document.activeElement as HTMLElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pending, onClose]);

  // Only completions belonging to the current query can become selectable.
  useEffect(() => {
    if (selectedUser || userQuery.length === 0) return;

    let cancelled = false;
    const timeout = setTimeout(() => {
      searchStaffUsersAction(userQuery)
        .then((rows) => { if (!cancelled) setUserSearch({ key: userKey, rows: rows.slice(0, RESULT_CAP), error: null }); })
        .catch(() => { if (!cancelled) setUserSearch({ key: userKey, rows: [], error: "Search failed — try again" }); });
    }, 250);

    return () => { cancelled = true; clearTimeout(timeout); };
  }, [userQuery, userKey, selectedUser]);

  useEffect(() => {
    if (scopeType === "GLOBAL") return;
    let cancelled = false;
    searchScopeTargetsAction(scopeType, scopeQuery)
      .then((targets) => { if (!cancelled) setScopeSearch({ key: scopeKey, targets, error: null }); })
      .catch(() => { if (!cancelled) setScopeSearch({ key: scopeKey, targets: [], error: "Search failed — try again" }); });
    return () => {
      cancelled = true;
    };
  }, [scopeType, scopeQuery, scopeKey]);

  useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  const canSave =
    selectedUser !== null && roleId !== "" && (scopeType === "GLOBAL" || (!scopePending && !scopeError && scopeTargets.some(target => target.id === scopeId)));

  const formErrors = state.errors;
  const fieldError = (name: string) => state.errors.some(error => error.name === name) ? { "aria-invalid": true as const, "aria-describedby": `${titleId}-${name}-error` } : {};

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/40" onClick={event => { if (event.target === event.currentTarget && !pending) onClose(); }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto rounded-l-xl border-l border-border bg-surface p-6 shadow-card"
      >
        <div className="flex items-center justify-between">
          <h2 id={titleId} tabIndex={-1} className="text-base font-semibold tracking-tight">
            Assign role
          </h2>
          <button type="button" onClick={onClose} disabled={pending} className="text-sm text-muted-foreground">
            Close
          </button>
        </div>

        {formErrors.length > 0 && (
          <div role="alert" className="rounded-md border border-danger/30 bg-danger-surface px-4 py-2">
            <ul className="flex flex-col gap-1 text-sm text-danger">
              {formErrors.map((e) => (
                <li key={e.name} id={`${titleId}-${e.name}-error`}>{e.message}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Dispatch explicitly to preserve values on errors instead of React's automatic form reset. */}
        <form
          action={action}
          onSubmit={(event) => {
            event.preventDefault();
            if (pending) return;
            const formData = new FormData(event.currentTarget);
            startTransition(() => action(formData));
          }}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="userId" value={selectedUser?.id ?? ""} />

          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-foreground">
              User
            </span>
            {selectedUser ? (
              <div className="flex min-h-[38px] items-center justify-between rounded-md border border-input-border bg-surface-2 px-4 py-2">
                <span className="flex flex-col text-sm">
                  <span className="font-semibold text-foreground">{selectedUser.name}</span>
                  {selectedUser.email && (
                    <span className="text-[11px] text-muted-foreground">{selectedUser.email}</span>
                  )}
                </span>
                <button
                  type="button"
                  {...fieldError("userId")}
                  onClick={() => {
                    setSelectedUser(null);
                    setUserQuery("");
                    setUserRetry(value => value + 1);
                  }}
                  className="text-sm text-muted-foreground underline underline-offset-2"
                >
                  Clear
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <input
                  type="text"
                  aria-label="User"
                  {...fieldError("userId")}
                  placeholder="Start typing a name or email"
                  value={userQuery}
                  onChange={(e) => { setUserQuery(e.target.value); setUserRetry(value => value + 1); }}
                  className="h-[38px] rounded-md border border-input-border bg-surface px-4 py-2 text-sm"
                />
                {userQuery.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {userSearchPending && (
                      <span className="text-sm text-muted-foreground">Searching…</span>
                    )}
                    {userSearchError && (
                      <div role="alert" className="text-sm text-danger">{userSearchError} <button type="button" onClick={() => setUserRetry(value => value + 1)}>Retry user search</button></div>
                    )}
                    {!userSearchError && userResults.length === 0 && !userSearchPending && (
                      <span className="text-sm text-muted-foreground">
                        No users match &quot;{userQuery}&quot;
                      </span>
                    )}
                    {userResults.length > 0 && (
                      <ul className="flex max-h-48 flex-col overflow-y-auto rounded-md border border-border bg-surface">
                        {userResults.map((row) => (
                          <li key={row.id}>
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedUser({
                                  id: row.id,
                                  name: row.name,
                                  email: row.email,
                                  status: row.status,
                                })
                              }
                              className="flex w-full flex-col gap-1 px-4 py-2 text-left hover:bg-surface-2"
                            >
                              <span className="truncate text-sm font-semibold text-foreground">
                                {row.name}
                              </span>
                              <span className="truncate text-[11px] text-muted-foreground">{row.email}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="drawer-role" className="text-sm font-semibold text-foreground">
              Role
            </label>
            <select
              id="drawer-role"
              name="roleId"
              {...fieldError("roleId")}
              required
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="h-[38px] rounded-md border border-input-border bg-surface px-4 py-2 text-sm"
            >
              <option value="">Choose a role</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="drawer-scope-type" className="text-sm font-semibold text-foreground">
              Scope
            </label>
            <select
              id="drawer-scope-type"
              name="scopeType"
              {...fieldError("scopeType")}
              value={scopeType}
              onChange={(e) => {
                setScopeType(e.target.value as ScopeType);
                setScopeRetry(value => value + 1);
                setScopeId("");
                setScopeQuery("");
              }}
              className="h-[38px] rounded-md border border-input-border bg-surface px-4 py-2 text-sm"
            >
              {SCOPE_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {scopeType !== "GLOBAL" && (
            <div className="flex flex-col gap-1">
              <label htmlFor="drawer-scope-id" className="text-sm font-semibold text-foreground">
                {SCOPE_TYPES.find((s) => s.value === scopeType)?.label} target
              </label>
              {scopePending && <p role="status">Searching…</p>}
              {scopeError && <div role="alert" className="text-sm text-danger">{scopeError} <button type="button" onClick={() => { setScopeId(""); setScopeRetry(value => value + 1); }}>Retry scope search</button></div>}
              <input type="text" aria-label="Search scope targets" placeholder="Search…" value={scopeQuery} onChange={event => { setScopeQuery(event.target.value); setScopeId(""); setScopeRetry(value => value + 1); }} className="h-[38px] rounded-md border border-input-border bg-surface px-4 py-2 text-sm" />
              {scopeTargets.length === 0 && !scopeQuery && !scopePending && !scopeError ? (
                <>
                  <p className="text-[11px] text-muted-foreground">{EMPTY_STATE_COPY[scopeType]}</p>
                  <select
                    id="drawer-scope-id"
                    name="scopeId"
                    {...fieldError("scopeId")}
                    required
                    value=""
                    onChange={() => {}}
                    disabled
                    className="h-[38px] rounded-md border border-input-border bg-surface-2 px-4 py-2 text-sm"
                  >
                    <option value="">No targets available</option>
                  </select>
                </>
              ) : (
                <>
                  <select
                    id="drawer-scope-id"
                    name="scopeId"
                    {...fieldError("scopeId")}
                    required
                    disabled={scopePending || !!scopeError}
                    value={scopeId}
                    onChange={(e) => setScopeId(e.target.value)}
                    className="h-[38px] rounded-md border border-input-border bg-surface px-4 py-2 text-sm"
                  >
                    <option value="">Choose a target</option>
                    {scopeTargets.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.label}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label htmlFor="drawer-ends-at" className="text-sm font-semibold text-foreground">
              End date
              <span className="ml-1 text-[11px] font-normal text-muted-foreground">optional</span>
            </label>
            <input
              id="drawer-ends-at"
              name="endsAt"
              {...fieldError("endsAt")}
              type="date"
              className="h-[38px] rounded-md border border-input-border bg-surface px-4 py-2 text-sm"
            />
          </div>

          <div className="flex items-center gap-2 border-t border-border pt-4">
            <button
              type="submit"
              disabled={!canSave || pending}
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Saving…" : "Assign role"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-surface-2"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
