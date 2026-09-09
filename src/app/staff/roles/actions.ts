"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { roleService } from "@/server/services/role-service";
import {
  InvalidPermissionSetError,
  ReasonRequiredError,
  RoleVersionConflictError,
} from "@/server/services/role-service";
import { ContinuityError } from "@/server/services/continuity-service";
import { AuthorizationError } from "@/server/permissions";
import type { FieldError } from "@/components/primitives";

export type CreateRoleState = { errors: FieldError[] };
export type UpdateRoleState = { errors: FieldError[] };
export type SetRoleActiveState = { error: string | null };

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export async function createRoleAction(
  _prev: CreateRoleState,
  formData: FormData,
): Promise<CreateRoleState> {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const permissions = formData.getAll("permission").map(String);

  if (!name) {
    return { errors: [{ name: "name", message: "Enter a role name." }] };
  }

  try {
    await roleService.create({
      name,
      description: description || null,
      permissions,
    });
  } catch (error) {
    if (error instanceof InvalidPermissionSetError) {
      return { errors: [{ name: "permissions", message: error.message }] };
    }
    if (isUniqueConstraintError(error)) {
      return {
        errors: [{ name: "name", message: "That role name is already taken." }],
      };
    }
    if (error instanceof AuthorizationError) {
      return {
        errors: [{ name: "form", message: "You do not have access to create roles." }],
      };
    }
    throw error;
  }

  revalidatePath("/staff/roles");
  redirect("/staff/roles");
}

export async function updateRoleAction(
  _prev: UpdateRoleState,
  formData: FormData,
): Promise<UpdateRoleState> {
  const id = String(formData.get("id") ?? "");
  const expectedVersion = Number(formData.get("expectedVersion") ?? "0");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const permissions = formData.getAll("permission").map(String);
  const reason = String(formData.get("reason") ?? "").trim();

  if (!name) {
    return { errors: [{ name: "name", message: "Enter a role name." }] };
  }

  try {
    await roleService.update({
      id,
      expectedVersion,
      name,
      description: description || null,
      permissions,
      reason: reason || null,
    });
  } catch (error) {
    if (error instanceof InvalidPermissionSetError) {
      return { errors: [{ name: "permissions", message: error.message }] };
    }
    if (error instanceof ReasonRequiredError) {
      return { errors: [{ name: "reason", message: error.message }] };
    }
    // D-26 — the continuity/version-conflict message crosses to the client
    // verbatim, with nothing interpolated in either direction.
    if (error instanceof RoleVersionConflictError || error instanceof ContinuityError) {
      return { errors: [{ name: "form", message: error.message }] };
    }
    if (isUniqueConstraintError(error)) {
      return { errors: [{ name: "name", message: "That role name is already taken." }] };
    }
    if (error instanceof AuthorizationError) {
      return { errors: [{ name: "form", message: "You do not have access to edit roles." }] };
    }
    throw error;
  }

  revalidatePath("/staff/roles");
  revalidatePath(`/staff/roles/${id}`);
  return { errors: [] };
}

/**
 * Invoked directly from RoleActivationControl's ConfirmModal.onConfirm — not
 * a native form submission, so it takes plain arguments rather than the
 * (prev, formData) shape.
 */
export async function setRoleActiveAction(
  id: string,
  active: boolean,
  reason: string,
): Promise<SetRoleActiveState> {
  try {
    await roleService.setActive({ id, active, reason: reason.trim() || null });
  } catch (error) {
    if (error instanceof ReasonRequiredError || error instanceof ContinuityError) {
      return { error: error.message };
    }
    if (error instanceof AuthorizationError) {
      return { error: "You do not have access to change this role's status." };
    }
    throw error;
  }

  revalidatePath("/staff/roles");
  revalidatePath(`/staff/roles/${id}`);
  return { error: null };
}
