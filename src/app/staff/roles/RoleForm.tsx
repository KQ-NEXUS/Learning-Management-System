"use client";

import { useActionState, useState } from "react";
import { ResourceForm, FormField, TextInput, type FieldError } from "@/components/primitives";
import { createRoleAction, type CreateRoleState } from "./actions";
import { PermissionPicker } from "./PermissionPicker";
import { EffectiveAccessPreview } from "./EffectiveAccessPreview";

const INITIAL: CreateRoleState = { errors: [] };

export type CloneSource = { id: string; name: string; permissions: string[] };

export type RoleFormRole = {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  version: number;
};

export type RoleFormProps = {
  initialPermissions?: readonly string[];
  cloneSources?: CloneSource[];
  /**
   * Edit mode (Plan 02-03): the host (RoleDetailPanels) owns the ConfirmModal
   * that gates a reduction, so it also owns errors/pending/onSubmit and the
   * selection state — RoleForm just renders the fields and forwards submit.
   */
  mode?: "create" | "edit";
  role?: RoleFormRole;
  errors?: FieldError[];
  pending?: boolean;
  onSubmit?: (formData: FormData) => void | Promise<void>;
  selected?: Set<string>;
  onSelectionChange?: (next: Set<string>) => void;
};

export function RoleForm({
  initialPermissions = [],
  cloneSources = [],
  mode = "create",
  role,
  errors: externalErrors,
  pending: externalPending,
  onSubmit: externalOnSubmit,
  selected: externalSelected,
  onSelectionChange,
}: RoleFormProps) {
  const isEdit = mode === "edit";

  const [createState, createAction, createPending] = useActionState(createRoleAction, INITIAL);
  const [cloneId, setCloneId] = useState("");
  const [internalSelected, setInternalSelected] = useState<Set<string>>(
    () => new Set(initialPermissions),
  );

  const selected = isEdit ? (externalSelected ?? new Set<string>()) : internalSelected;
  const setSelected = isEdit ? (onSelectionChange ?? (() => {})) : setInternalSelected;
  const errors = isEdit ? (externalErrors ?? []) : createState.errors;
  const pending = isEdit ? (externalPending ?? false) : createPending;
  const onSubmit = isEdit ? (externalOnSubmit ?? (() => {})) : createAction;

  function handleCloneChange(id: string) {
    setCloneId(id);
    const source = cloneSources.find((c) => c.id === id);
    setSelected(new Set(source ? source.permissions : []));
  }

  return (
    <ResourceForm
      title={isEdit ? `Edit ${role?.name ?? ""}` : "New role"}
      errors={errors}
      pending={pending}
      submitLabel={isEdit ? "Save changes" : "Create role"}
      onSubmit={onSubmit}
    >
      {isEdit && role && (
        <>
          <input type="hidden" name="id" value={role.id} />
          <input type="hidden" name="expectedVersion" value={role.version} />
        </>
      )}

      {!isEdit && cloneSources.length > 0 && (
        <FormField
          name="cloneSource"
          label="Start from"
          hint="Optional — copies that role's permissions as a starting point."
        >
          {(props) => (
            <select
              {...props}
              value={cloneId}
              onChange={(e) => handleCloneChange(e.target.value)}
              className="border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
            >
              <option value="">Blank slate</option>
              {cloneSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          )}
        </FormField>
      )}

      <FormField name="name" label="Name" required>
        {(props) => <TextInput {...props} defaultValue={isEdit ? role?.name : undefined} required />}
      </FormField>

      <FormField name="description" label="Description">
        {(props) => (
          <TextInput {...props} defaultValue={isEdit ? (role?.description ?? "") : undefined} />
        )}
      </FormField>

      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="flex-1">
          <PermissionPicker selected={selected} onChange={setSelected} />
        </div>
        <div className="lg:w-80">
          <EffectiveAccessPreview selected={selected} />
        </div>
      </div>

      {Array.from(selected).map((permission) => (
        <input key={permission} type="hidden" name="permission" value={permission} />
      ))}
    </ResourceForm>
  );
}
