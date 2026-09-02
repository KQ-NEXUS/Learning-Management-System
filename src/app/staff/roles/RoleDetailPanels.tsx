"use client";

import { useState } from "react";
import { ConfirmModal, type FieldError } from "@/components/primitives";
import type { RoleRecord } from "@/server/services/role-service";
import { RoleForm } from "./RoleForm";
import { updateRoleAction, setRoleActiveAction } from "./actions";

/**
 * The Permissions tab IS the role edit form, embedded inline (02-UI-SPEC.md) —
 * not a read-only view plus a separate edit screen. This component owns the
 * ConfirmModal that gates a permission reduction (D-09), including the extra
 * confirmation on a seeded default role (D-05) — RoleForm just renders fields
 * and forwards submit; every reason-gated decision lives here.
 */
export function RolePermissionsPanel({
  role,
  minReasonLength,
  assignmentCount,
}: {
  role: RoleRecord;
  minReasonLength: number;
  assignmentCount: number;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(role.permissions));
  const [formErrors, setFormErrors] = useState<FieldError[]>([]);
  const [formPending, setFormPending] = useState(false);

  const [pendingFormData, setPendingFormData] = useState<FormData | null>(null);
  const [modalPending, setModalPending] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const removedNow = role.permissions.filter((p) => !selected.has(p));

  async function submit(formData: FormData) {
    // D-05/D-09/D-39 — any reduction (default role or not) opens the
    // ConfirmModal instead of submitting directly; an addition-only edit
    // submits with no modal at all (D-10).
    if (removedNow.length > 0) {
      setModalError(null);
      setPendingFormData(formData);
      return;
    }

    setFormPending(true);
    const result = await updateRoleAction({ errors: [] }, formData);
    setFormPending(false);
    setFormErrors(result.errors);
  }

  async function confirmRemoval(reason: string) {
    if (!pendingFormData) return;
    pendingFormData.set("reason", reason);

    setModalPending(true);
    const result = await updateRoleAction({ errors: [] }, pendingFormData);
    setModalPending(false);

    // The RBAC-07 block (ContinuityBlock) and a stale-version conflict both
    // surface as a "form" error — feed them into this same modal's error
    // slot rather than a new banner (02-UI-SPEC.md ContinuityBlock). The
    // action is never pre-emptively disabled (D-27) — this is reactive only.
    const blocking = result.errors.find((e) => e.name === "form" || e.name === "reason");
    if (blocking) {
      setModalError(blocking.message);
      return;
    }

    if (result.errors.length > 0) {
      setFormErrors(result.errors);
    }
    setPendingFormData(null);
  }

  return (
    <>
      <RoleForm
        mode="edit"
        role={role}
        errors={formErrors}
        pending={formPending}
        onSubmit={submit}
        selected={selected}
        onSelectionChange={setSelected}
      />

      <ConfirmModal
        open={pendingFormData !== null}
        tone="danger"
        title={`Remove permission(s) from ${role.name}?`}
        description={
          role.isDefault
            ? `${role.name} is a default role currently used by ${assignmentCount} active assignment${
                assignmentCount === 1 ? "" : "s"
              }. Removing permission(s) takes effect immediately for everyone holding it.`
            : `This removes ${removedNow.length} permission${
                removedNow.length === 1 ? "" : "s"
              } from ${role.name}, effective immediately for every active assignment.`
        }
        confirmLabel="Remove permission(s)"
        minReasonLength={minReasonLength}
        pending={modalPending}
        error={modalError}
        onConfirm={confirmRemoval}
        onCancel={() => {
          setPendingFormData(null);
          setModalError(null);
        }}
      />
    </>
  );
}

const BTN = "border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-50";
const BTN_DANGER =
  "border border-danger/30 bg-white px-2.5 py-1.5 text-xs font-medium text-danger hover:bg-danger-surface";

/** Rendered in DetailLayout's `actions` slot. */
export function RoleActivationControl({
  role,
  minReasonLength,
  assignmentCount,
}: {
  role: RoleRecord;
  minReasonLength: number;
  assignmentCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(reason: string) {
    setPending(true);
    const result = await setRoleActiveAction(role.id, !role.active, reason);
    setPending(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setError(null);
        }}
        className={role.active ? BTN_DANGER : BTN}
      >
        {role.active ? "Deactivate" : "Reactivate"}
      </button>

      <ConfirmModal
        open={open}
        tone={role.active ? "danger" : "default"}
        title={role.active ? `Deactivate ${role.name}?` : `Reactivate ${role.name}?`}
        description={
          role.active
            ? `This role's ${assignmentCount} active assignment${
                assignmentCount === 1 ? "" : "s"
              } will immediately stop granting access.`
            : "Access is restored immediately — no reassignment is needed."
        }
        confirmLabel={role.active ? "Deactivate role" : "Reactivate"}
        // Deactivation demands a reason (D-11); reactivation demands none —
        // tone default, no minReasonLength (D-36 wording, reused for roles).
        minReasonLength={role.active ? minReasonLength : undefined}
        pending={pending}
        error={error}
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
