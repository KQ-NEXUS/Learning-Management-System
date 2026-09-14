"use server";

/**
 * The Finance payments detail page's Server Actions (PAY-03, PAY-04, PAY-05,
 * RBAC-06).
 *
 * Every export here is a public POST endpoint — the rendered
 * `ManualPaymentDialog`/`RefundDialog` button is a presentation courtesy, not
 * the access control. Both actions validate their own input shape with `zod`
 * and delegate straight to `confirmManualPayment`/`recordRefund` (07-08),
 * which re-resolve the Order's cohort scope from the row and gate on
 * `payments.confirm`/`refunds.manage` themselves — a direct POST from a
 * caller lacking the permission is refused here exactly as it would be from
 * the rendered dialog, regardless of whether the button ever rendered
 * (T-05-99/T-05-100's precedent, applied to money).
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import {
  confirmManualPayment,
  ManualPaymentValidationError,
  ManualPaymentCurrencyMismatchError,
  ManualPaymentAmountMismatchError,
  MissingCommercialSnapshotError,
  OrderNotFoundError as ManualOrderNotFoundError,
} from "@/server/services/manual-payment-service";
import {
  recordRefund,
  RefundValidationError,
  RefundExceedsEligibleValueError,
  NoCapturedPaymentError,
  MissingProviderReferenceError,
  OrderNotFoundError as RefundOrderNotFoundError,
} from "@/server/services/refund-service";

function revalidatePayment(orderId: string): void {
  revalidatePath("/staff/payments", "page");
  revalidatePath(`/staff/payments/${orderId}`, "page");
}

// ---------------------------------------------------------------------------
// confirmManualPaymentAction
// ---------------------------------------------------------------------------

const manualConfirmSchema = z
  .object({
    orderId: z.string().min(1),
    amountMinor: z.coerce.number().int().positive(),
    currency: z.enum(["NGN", "USD"]),
    manualPaidAt: z.string().min(1),
    manualChannel: z.string().trim().min(1),
    manualReference: z.string().trim().min(1),
    // The evidence/note ceiling (2000 chars) is a planner assumption — see
    // `ManualPaymentDialog.tsx`'s own header comment (07-UI-SPEC §8
    // unresolved). Enforced here too so a direct POST cannot bypass it.
    manualEvidenceKey: z.string().trim().min(1).max(2000),
    reason: z.string().trim().min(10).max(2000),
  })
  .strict();

export type ManualConfirmActionResult =
  | { ok: true; outcome: "ACTIVATED" | "EXCEPTION" }
  | {
      ok: true;
      outcome: "ALREADY_PAID";
      existingAttempt: {
        provider: string;
        confirmedAt: string | null;
        providerRef: string | null;
        providerIntentId: string | null;
      } | null;
    }
  | { ok: false; message: string };

export async function confirmManualPaymentAction(
  input: z.input<typeof manualConfirmSchema>,
): Promise<ManualConfirmActionResult> {
  const parsed = manualConfirmSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "One or more fields are missing or invalid." };
  }

  const manualPaidAt = new Date(parsed.data.manualPaidAt);
  if (Number.isNaN(manualPaidAt.getTime())) {
    return { ok: false, message: "Enter a valid date." };
  }

  try {
    const result = await confirmManualPayment({
      orderId: parsed.data.orderId,
      amountMinor: parsed.data.amountMinor,
      currency: parsed.data.currency,
      manualPaidAt,
      manualChannel: parsed.data.manualChannel,
      manualReference: parsed.data.manualReference,
      manualEvidenceKey: parsed.data.manualEvidenceKey,
      reason: parsed.data.reason,
    });

    revalidatePayment(parsed.data.orderId);

    if (result.outcome === "ALREADY_PAID") {
      return {
        ok: true,
        outcome: "ALREADY_PAID",
        existingAttempt: result.existingAttempt
          ? {
              provider: result.existingAttempt.provider,
              confirmedAt: result.existingAttempt.confirmedAt
                ? result.existingAttempt.confirmedAt.toISOString()
                : null,
              providerRef: result.existingAttempt.providerRef,
              providerIntentId: result.existingAttempt.providerIntentId,
            }
          : null,
      };
    }

    return { ok: true, outcome: result.outcome };
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      return { ok: false, message: "Your role does not permit this action on this order." };
    }
    if (
      error instanceof ManualPaymentValidationError ||
      error instanceof ManualPaymentCurrencyMismatchError ||
      error instanceof ManualPaymentAmountMismatchError ||
      error instanceof MissingCommercialSnapshotError
    ) {
      return { ok: false, message: error.message };
    }
    if (error instanceof ManualOrderNotFoundError) {
      return { ok: false, message: "This order no longer exists." };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// recordRefundAction
// ---------------------------------------------------------------------------

const refundSchema = z
  .object({
    orderId: z.string().min(1),
    amountMinor: z.coerce.number().int().positive(),
    reason: z.string().trim().min(10).max(2000),
    accessDecision: z.enum(["RETAINED", "REVOKED"]),
  })
  .strict();

export type RefundActionResult =
  | { ok: true; status: "COMPLETED" | "FAILED" | "RECORDED_MANUALLY" }
  | { ok: false; message: string };

export async function recordRefundAction(
  input: z.input<typeof refundSchema>,
): Promise<RefundActionResult> {
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "One or more fields are missing or invalid." };
  }

  try {
    const result = await recordRefund(parsed.data);
    revalidatePayment(parsed.data.orderId);
    return { ok: true, status: result.status };
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      return { ok: false, message: "Your role does not permit this action on this order." };
    }
    // PAY-05/D-22 — the eligible figure is named in the refusal itself
    // (`RefundExceedsEligibleValueError.message`), never only a generic
    // rejection.
    if (
      error instanceof RefundExceedsEligibleValueError ||
      error instanceof RefundValidationError ||
      error instanceof NoCapturedPaymentError ||
      error instanceof MissingProviderReferenceError
    ) {
      return { ok: false, message: error.message };
    }
    if (error instanceof RefundOrderNotFoundError) {
      return { ok: false, message: "This order no longer exists." };
    }
    throw error;
  }
}
