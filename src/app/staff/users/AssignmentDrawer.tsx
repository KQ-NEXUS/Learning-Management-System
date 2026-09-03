"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
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
  const [userResults, setUserResults] = useState<StaffSearchRow[]>([]);
  const [userSearchPending, setUserSearchPending] = useState(false);
  const [userSearchError, setUserSearchError] = useState<string | null>(null);

  const [roleId, setRoleId] = useState("");
  const [scopeType, setScopeType] = useState<ScopeType>("GLOBAL");
  const [scopeId, setScopeId] = useState("");
  const [scopeQuery, setScopeQuery] = useState("");
  const [scopeTargets, setScopeTargets] = useState<ScopeTarget[]>([]);

  // Focus moves in on open, returns to the trigger on close — the same rule
  // ConfirmModal implements, mirrored here rather than imported.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("input, select, button")?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pending, onClose]);

  // Debounced typeahead — no results render until at least one character is
  // typed (D-17); the previous results stay mounted while a new search is in
  // flight, so there is no flash to empty between keystrokes.
  useEffect(() => {
    if (selectedUser || userQuery.length === 0) return;

    const timeout = setTimeout(() => {
      setUserSearchError(null);
      setUserSearchPending(true);
      searchStaffUsersAction(userQuery)
        .then((rows) => setUserResults(rows.slice(0, RESULT_CAP)))
        .catch(() => setUserSearchError("Search failed — try again"))
        .finally(() => setUserSearchPending(false));
    }, 250);

    return () => clearTimeout(timeout);
  }, [userQuery, selectedUser]);

  useEffect(() => {
    if (scopeType === "GLOBAL") return;
    let cancelled = false;
    searchScopeTargetsAction(scopeType, scopeQuery).then((targets) => {
      if (!cancelled) setScopeTargets(targets);
    });
    return () => {
      cancelled = true;
    };
  }, [scopeType, scopeQuery]);

  useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  const canSave =
    selectedUser !== null && roleId !== "" && (scopeType === "GLOBAL" || scopeId !== "");

  const formErrors = state.errors.filter((e) => e.name !== "form");

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-zinc-900/40">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-zinc-300 bg-white p-5 shadow-lg"
      >
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="text-base font-semibold tracking-tight">
            Assign role
          </h2>
          <button type="button" onClick={onClose} disabled={pending} className="text-sm text-zinc-500">
            Close
          </button>
        </div>

        {formErrors.length > 0 && (
          <div role="alert" className="border border-danger/30 bg-danger-surface px-3 py-2.5">
            <ul className="flex flex-col gap-1 text-sm text-danger">
              {formErrors.map((e) => (
                <li key={e.name}>{e.message}</li>
              ))}
            </ul>
          </div>
        )}

        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="userId" value={selectedUser?.id ?? ""} />

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
              User
            </span>
            {selectedUser ? (
              <div className="flex items-center justify-between border border-zinc-300 bg-zinc-50 px-2.5 py-1.5">
                <span className="flex flex-col text-sm">
                  <span className="font-medium text-zinc-900">{selectedUser.name}</span>
                  {selectedUser.email && (
                    <span className="text-xs text-zinc-500">{selectedUser.email}</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedUser(null);
                    setUserQuery("");
                  }}
                  className="text-xs text-zinc-500 underline underline-offset-2"
                >
                  Clear
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <input
                  type="text"
                  placeholder="Start typing a name or email"
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  className="border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
                />
                {userQuery.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {userSearchPending && (
                      <span className="text-xs text-zinc-500">Searching…</span>
                    )}
                    {userSearchError && (
                      <span className="text-xs text-danger">{userSearchError}</span>
                    )}
                    {!userSearchError && userResults.length === 0 && !userSearchPending && (
                      <span className="text-xs text-zinc-500">
                        No users match &quot;{userQuery}&quot;
                      </span>
                    )}
                    {userResults.length > 0 && (
                      <ul className="flex max-h-48 flex-col overflow-y-auto border border-zinc-200">
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
                              className="flex w-full flex-col gap-0.5 px-2.5 py-1.5 text-left hover:bg-zinc-50"
                            >
                              <span className="truncate text-sm font-medium text-zinc-900">
                                {row.name}
                              </span>
                              <span className="truncate text-xs text-zinc-500">{row.email}</span>
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

          <div className="flex flex-col gap-1.5">
            <label htmlFor="drawer-role" className="text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
              Role
            </label>
            <select
              id="drawer-role"
              name="roleId"
              required
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
            >
              <option value="">Choose a role</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="drawer-scope-type" className="text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
              Scope
            </label>
            <select
              id="drawer-scope-type"
              name="scopeType"
              value={scopeType}
              onChange={(e) => {
                setScopeType(e.target.value as ScopeType);
                setScopeId("");
                setScopeQuery("");
                setScopeTargets([]);
              }}
              className="border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
            >
              {SCOPE_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {scopeType !== "GLOBAL" && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="drawer-scope-id" className="text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
                {SCOPE_TYPES.find((s) => s.value === scopeType)?.label} target
              </label>
              {scopeTargets.length === 0 && !scopeQuery ? (
                <>
                  <p className="text-sm text-zinc-500">{EMPTY_STATE_COPY[scopeType]}</p>
                  <select id="drawer-scope-id" name="scopeId" required value="" onChange={() => {}} disabled>
                    <option value="">No targets available</option>
                  </select>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Search…"
                    value={scopeQuery}
                    onChange={(e) => setScopeQuery(e.target.value)}
                    className="border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
                  />
                  <select
                    id="drawer-scope-id"
                    name="scopeId"
                    required
                    value={scopeId}
                    onChange={(e) => setScopeId(e.target.value)}
                    className="border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
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

          <div className="flex flex-col gap-1.5">
            <label htmlFor="drawer-ends-at" className="text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
              End date
              <span className="ml-1 font-normal text-zinc-400">optional</span>
            </label>
            <input
              id="drawer-ends-at"
              name="endsAt"
              type="date"
              className="border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
            />
          </div>

          <div className="flex items-center gap-2 border-t border-zinc-200 pt-4">
            <button
              type="submit"
              disabled={!canSave || pending}
              className="bg-accent px-3 py-1.5 text-xs font-medium text-accent-contrast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Saving…" : "Assign role"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
