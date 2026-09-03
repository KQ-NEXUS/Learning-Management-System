"use server";

import { revalidatePath } from "next/cache";
import {
  staffAccountService,
  DuplicateStaffEmailError,
  StaffAccountReasonRequiredError,
  type StaffSearchRow,
} from "@/server/services/staff-account-service";
import {
  assignmentService,
  AssignmentReasonRequiredError,
} from "@/server/services/assignment-service";
import { scopeLookupService } from "@/server/services/scope-lookup-service";
import { ContinuityError } from "@/server/services/continuity-service";
import { AuthorizationError, ScopeError } from "@/server/permissions";
import type { ScopeType } from "@/server/permissions";
import type { FieldError } from "@/components/primitives";
import type { ScopeTarget } from "@/server/services/scope-lookup-service";

export type CreateStaffAccountState = {
  errors: FieldError[];
  created: { name: string; email: string; temporaryPassword: string; userId: string } | null;
};

export async function createStaffAccountAction(
  _prev: CreateStaffAccountState,
  formData: FormData,
): Promise<CreateStaffAccountState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const temporaryPasswordInput = String(formData.get("temporaryPassword") ?? "").trim();
  const roleId = String(formData.get("roleId") ?? "");
  const scopeType = String(formData.get("scopeType") ?? "GLOBAL") as ScopeType;
  const scopeId = String(formData.get("scopeId") ?? "") || null;
  const endsAtRaw = String(formData.get("endsAt") ?? "");

  const errors: FieldError[] = [];
  if (!name) errors.push({ name: "name", message: "Enter a name." });
  if (!email) errors.push({ name: "email", message: "Enter an email address." });
  if (!roleId) errors.push({ name: "roleId", message: "Choose a role." });
  if (scopeType !== "GLOBAL" && !scopeId) {
    errors.push({ name: "scopeId", message: "Choose a scope target." });
  }
  if (errors.length > 0) return { errors, created: null };

  try {
    // Exactly one call, carrying the account fields and the first role plus
    // scope together — plan 06's single transaction stays intact (D-22).
    const result = await staffAccountService.create({
      name,
      email,
      temporaryPassword: temporaryPasswordInput || undefined,
      roleId,
      scopeType,
      scopeId,
      endsAt: endsAtRaw ? new Date(endsAtRaw) : null,
    });

    revalidatePath("/staff/users");

    // No redirect on success — the plaintext temporary password must never
    // enter a URL. It is returned exactly once, in this state object.
    return {
      errors: [],
      created: {
        name: result.user.name,
        email: result.user.email,
        temporaryPassword: result.temporaryPassword,
        userId: result.user.id,
      },
    };
  } catch (error) {
    if (error instanceof DuplicateStaffEmailError) {
      return { errors: [{ name: "email", message: error.message }], created: null };
    }
    if (error instanceof ScopeError) {
      return { errors: [{ name: "scopeType", message: error.message }], created: null };
    }
    if (error instanceof AuthorizationError) {
      return {
        errors: [{ name: "form", message: "You do not have access to create staff accounts." }],
        created: null,
      };
    }
    throw error;
  }
}

export async function searchScopeTargetsAction(
  scopeType: ScopeType,
  query: string,
): Promise<ScopeTarget[]> {
  switch (scopeType) {
    case "PROGRAMME":
      return scopeLookupService.programmes(query);
    case "COURSE":
      return scopeLookupService.courses(query);
    case "COHORT":
      return scopeLookupService.cohorts(query);
    default:
      return [];
  }
}

export type ActionResultState = { error: string | null };

export async function revokeAssignmentAction(
  assignmentId: string,
  reason: string,
): Promise<ActionResultState> {
  try {
    await assignmentService.revoke({ assignmentId, reason });
  } catch (error) {
    if (error instanceof AssignmentReasonRequiredError || error instanceof ContinuityError) {
      // D-26 — the continuity message crosses to the client verbatim.
      return { error: error.message };
    }
    if (error instanceof AuthorizationError) {
      return { error: "You do not have access to revoke this assignment." };
    }
    throw error;
  }

  revalidatePath("/staff/users");
  return { error: null };
}

export async function deactivateStaffAccountAction(
  userId: string,
  reason: string,
): Promise<ActionResultState> {
  try {
    await staffAccountService.deactivate({ userId, reason });
  } catch (error) {
    if (error instanceof StaffAccountReasonRequiredError || error instanceof ContinuityError) {
      return { error: error.message };
    }
    if (error instanceof AuthorizationError) {
      return { error: "You do not have access to deactivate this account." };
    }
    throw error;
  }

  revalidatePath("/staff/users");
  revalidatePath(`/staff/users/${userId}`);
  return { error: null };
}

export async function reactivateStaffAccountAction(userId: string): Promise<ActionResultState> {
  try {
    await staffAccountService.reactivate({ userId });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: "You do not have access to reactivate this account." };
    }
    throw error;
  }

  revalidatePath("/staff/users");
  revalidatePath(`/staff/users/${userId}`);
  return { error: null };
}

export async function searchStaffUsersAction(query: string): Promise<StaffSearchRow[]> {
  return staffAccountService.search(query);
}

export type CreateAssignmentState = { errors: FieldError[]; success: boolean };

export async function createAssignmentAction(
  _prev: CreateAssignmentState,
  formData: FormData,
): Promise<CreateAssignmentState> {
  const userId = String(formData.get("userId") ?? "");
  const roleId = String(formData.get("roleId") ?? "");
  const scopeType = String(formData.get("scopeType") ?? "GLOBAL") as ScopeType;
  const scopeId = String(formData.get("scopeId") ?? "") || null;
  const endsAtRaw = String(formData.get("endsAt") ?? "");

  const errors: FieldError[] = [];
  if (!userId) errors.push({ name: "userId", message: "Choose a user." });
  if (!roleId) errors.push({ name: "roleId", message: "Choose a role." });
  if (scopeType !== "GLOBAL" && !scopeId) {
    errors.push({ name: "scopeId", message: "Choose a scope target." });
  }
  if (errors.length > 0) return { errors, success: false };

  try {
    await assignmentService.create({
      userId,
      roleId,
      scopeType,
      scopeId,
      endsAt: endsAtRaw ? new Date(endsAtRaw) : null,
    });
  } catch (error) {
    if (error instanceof ScopeError) {
      return { errors: [{ name: "scopeType", message: error.message }], success: false };
    }
    if (error instanceof AuthorizationError) {
      return {
        errors: [{ name: "form", message: "You do not have access to assign roles." }],
        success: false,
      };
    }
    throw error;
  }

  revalidatePath(`/staff/users/${userId}`);
  return { errors: [], success: true };
}
