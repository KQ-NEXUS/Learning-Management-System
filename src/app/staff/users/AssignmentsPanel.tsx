"use client";

import { useState } from "react";
import { ConfirmModal } from "@/components/primitives";
import {
  revokeAssignmentAction,
  deactivateStaffAccountAction,
  reactivateStaffAccountAction,
} from "./actions";
import { AssignmentDrawer } from "./AssignmentDrawer";

export type AssignmentRow = {
  id: string;
  role: { id: string; name: string; active: boolean };
  scopeType: string;
  scopeId: string | null;
  scopeLabel?: string | null;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  active: boolean;
  revokedAt: Date | string | null;
  reason: string | null;
};

function fmtDate(value: Date | string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function scopeLabel(row: AssignmentRow): string {
  if (row.scopeType === "GLOBAL") return "Global";
  return `${row.scopeType}${row.scopeLabel ? ` · ${row.scopeLabel}` : row.scopeId ? ` · ${row.scopeId}` : ""}`;
}

const BTN = "rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-surface-2";
const BTN_DANGER =
  "rounded-md border border-danger/30 bg-surface px-4 py-2 text-sm font-semibold text-danger hover:bg-danger-surface";
const BTN_PRIMARY = "rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:opacity-90";

/**
 * Each row is RBAC-04's union of grants shown directly — no primary-role
 * concept invented on top (D-19). No bulk-select, no revoke-all, no
 * edit-in-place: assignments are immutable and each revocation is
 * individual (D-21, D-23).
 */
export function AssignmentsPanel({
  userId,
  userName,
  userEmail,
  assignments,
  roles,
  minReasonLength,
}: {
  userId: string;
  userName: string;
  userEmail: string;
  assignments: AssignmentRow[];
  roles: { id: string; name: string }[];
  minReasonLength: number;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<AssignmentRow | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = assignments.filter((a) => a.active);
  const revoked = assignments.filter((a) => !a.active);

  async function confirmRevoke(reason: string) {
    if (!revokeTarget) return;
    setPending(true);
    try {
      const result = await revokeAssignmentAction(revokeTarget.id, reason);
      if (result.error) {
        setError(result.error);
        return;
      }
      setRevokeTarget(null);
      setError(null);
    } catch {
      // A rejection keeps the ConfirmModal open with the target and typed
      // reason intact (the modal owns the reason) and clears busy. The
      // assignment is bound by id; nothing is retried automatically and the
      // revocation is never reported as done.
      setError(
        "Something went wrong. The assignment was not revoked — try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button type="button" onClick={() => setDrawerOpen(true)} className={BTN_PRIMARY}>
          Assign role
        </button>
      </div>

      {active.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-border bg-surface px-6 py-12 shadow-card">
          <p className="text-sm font-semibold text-foreground">No active role assignments</p>
          <p className="max-w-prose text-sm text-muted-foreground">
            This account currently has no access. Assign a role to grant permissions.
          </p>
          <button type="button" onClick={() => setDrawerOpen(true)} className={BTN_PRIMARY}>
            Assign role
          </button>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface px-4 py-2"
            >
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-foreground">{row.role.name}</span>
                <span className="text-[11px] text-muted-foreground">{scopeLabel(row)}</span>
              </div>
              <div className="flex items-center gap-2 font-mono text-sm tabular-nums text-muted-foreground">
                <span>{fmtDate(row.startsAt)}</span>
                <span>→</span>
                <span>{fmtDate(row.endsAt)}</span>
              </div>
              <button type="button" onClick={() => setRevokeTarget(row)} className={BTN_DANGER}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      {revoked.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Revoked
          </span>
          <ul className="flex flex-col gap-1">
            {revoked.map((row) => (
              <li key={row.id} className="rounded-xl border border-border bg-surface-2 px-4 py-2 opacity-70">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-foreground">{row.role.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{fmtDate(row.revokedAt)}</span>
                </div>
                {row.reason && <p className="mt-1 text-[11px] text-muted-foreground">{row.reason}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmModal
        open={revokeTarget !== null}
        tone="danger"
        title="Revoke this assignment?"
        description={
          revokeTarget
            ? `This removes ${userName}'s ${revokeTarget.role.name} role at ${scopeLabel(
                revokeTarget,
              )}. This cannot be undone — granting it again creates a new assignment.`
            : ""
        }
        confirmLabel="Revoke assignment"
        minReasonLength={minReasonLength}
        pending={pending}
        error={error}
        onConfirm={confirmRevoke}
        onCancel={() => {
          setRevokeTarget(null);
          setError(null);
        }}
      />

      <AssignmentDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        roles={roles}
        preselectedUser={{ id: userId, name: userName, email: userEmail, status: "ACTIVE" }}
      />
    </div>
  );
}

/** Rendered in DetailLayout's `actions` slot. */
export function AccountStatusControl({
  userId,
  userName,
  status,
  minReasonLength,
}: {
  userId: string;
  userName: string;
  status: string;
  minReasonLength: number;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isActive = status === "ACTIVE";

  async function confirm(reason: string) {
    setPending(true);
    try {
      const result = isActive
        ? await deactivateStaffAccountAction(userId, reason)
        : await reactivateStaffAccountAction(userId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
    } catch {
      // Keep the dialog open with the typed reason intact and clear busy; the
      // account status change is bound by userId and is never retried
      // automatically or reported as applied.
      setError(
        "Something went wrong. The account status was not changed — try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setError(null);
        }}
        className={isActive ? BTN_DANGER : BTN}
      >
        {isActive ? "Deactivate" : "Reactivate"}
      </button>

      <ConfirmModal
        open={open}
        tone={isActive ? "danger" : "default"}
        title={isActive ? `Deactivate ${userName}'s account?` : `Reactivate ${userName}?`}
        description={
          isActive
            ? "They will be signed out of every active session immediately. Their role assignments are kept and will apply again if reactivated."
            : "Access is restored immediately — no reassignment is needed."
        }
        confirmLabel={isActive ? "Deactivate account" : "Reactivate"}
        minReasonLength={isActive ? minReasonLength : undefined}
        pending={pending}
        error={error}
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
