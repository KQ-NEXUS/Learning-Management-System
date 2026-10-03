"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MAX_LICENCE_FILE_CHARS } from "@/server/licence/constants";
import { formatLicenceInstant, formatUtcInstant } from "@/server/licence/display";
import {
  ACTIVATION_GENERIC_FAILURE,
  ACTIVATION_PERMISSION_NOTE,
  ACTIVATION_SUCCESS,
  LICENCE_STATE_LABELS,
  isNeutralRejection,
  rejectionSentence,
} from "@/server/licence/policy";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { refusalMessage } from "@/server/permissions/refusal";
import { licenceStaffService } from "@/server/services/licence-staff-service";

/**
 * Licence activation server actions (Phase 14, plan 14-15; LIC-03, D-14,
 * Pattern 12). Authorization is NOT done here: both actions call the staff
 * service, which wraps each call in `withPermission("licence.activate")`, so a
 * direct POST by a non-holder is refused before the licence module is touched
 * (T-14-15-01). The form is a courtesy.
 *
 * Two steps, never one: `inspectLicenceAction` verifies the submitted text and
 * returns a verified preview without persisting anything; `activateLicenceAction`
 * submits the text again and the activation transaction re-verifies it under the
 * row lock. The preview is never sent back and never trusted (T-14-15-02).
 *
 * Input hygiene (T-14-15-03): the text is trimmed, limited to 8192 characters and
 * to `A-Za-z0-9._-` BEFORE the service is called; the framework's 1 MB body cap is
 * only a backstop. Results carry fixed sentences from the closed rejection set,
 * and an unexpected failure logs only the error name, so neither a stack trace nor
 * the submitted text can reach the browser or the log (T-14-15-04).
 *
 * A "use server" module may export only async functions (types are erased), so the
 * helpers below stay private.
 */

const requestSchema = z.object({ raw: z.string() }).strict();

const LICENCE_TEXT_PATTERN = /^[A-Za-z0-9._-]+$/;
const NOTHING_CHANGED = " Nothing was changed.";

type DateText = { local: string; utc: string };

export type LicencePreviewView = {
  licenceId: string;
  clientName: string;
  deploymentId: string;
  /** The licence's signed IANA zone, shown once under the first date. */
  zone: string;
  issued: DateText;
  starts: DateText;
  expires: DateText;
  graceEnds: DateText;
  replaces: { licenceId: string; expires: DateText } | null;
  matchesDeployment: true;
};

export type LicenceRejectionView = { ok: false; code: string; message: string; neutral: boolean };

export type InspectLicenceActionResult = { ok: true; preview: LicencePreviewView } | LicenceRejectionView;
export type ActivateLicenceActionResult = { ok: true; message: string } | LicenceRejectionView;

type NormalisedInput = { ok: true; raw: string } | { ok: false; rejection: LicenceRejectionView };

function badFormat(): LicenceRejectionView {
  return {
    ok: false,
    code: "BAD_FORMAT",
    message: `${rejectionSentence("BAD_FORMAT")}${NOTHING_CHANGED}`,
    neutral: false,
  };
}

/** Shape, size and alphabet check shared by both actions; the service is never called on a failure. */
function normaliseInput(input: unknown): NormalisedInput {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, rejection: badFormat() };
  const raw = parsed.data.raw.trim();
  if (raw.length < 1 || raw.length > MAX_LICENCE_FILE_CHARS || !LICENCE_TEXT_PATTERN.test(raw)) {
    return { ok: false, rejection: badFormat() };
  }
  return { ok: true, raw };
}

function dateText(date: Date, zone: string): DateText {
  return { local: formatLicenceInstant(date, zone), utc: formatUtcInstant(date) };
}

function revalidateLicenceScreens(): void {
  revalidatePath("/staff", "layout");
  revalidatePath("/staff/licence", "page");
}

/** Maps a thrown error to a fixed result; the error message and the submitted text are never used. */
function failureFromError(error: unknown): LicenceRejectionView {
  if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
    // A licence refusal is told apart from a role denial so the user never reads the wrong reason.
    return { ok: false, code: "NOT_PERMITTED", message: refusalMessage(error, ACTIVATION_PERMISSION_NOTE), neutral: false };
  }
  console.error("[licence] activation action failed", error instanceof Error ? error.name : "UnknownError");
  return { ok: false, code: "FAILED", message: ACTIVATION_GENERIC_FAILURE, neutral: false };
}

/** Step 1: verify the submitted text and return a preview built only from the verified payload. */
export async function inspectLicenceAction(input: unknown): Promise<InspectLicenceActionResult> {
  const normalised = normaliseInput(input);
  if (!normalised.ok) return normalised.rejection;

  try {
    const result = await licenceStaffService.inspectLicenceForStaff({ raw: normalised.raw });
    if (!result.ok) {
      return {
        ok: false,
        code: result.code,
        message:
          result.code === "ALREADY_ACTIVE"
            ? rejectionSentence(result.code)
            : `${rejectionSentence(result.code)}${NOTHING_CHANGED}`,
        neutral: isNeutralRejection(result.code),
      };
    }
    const { preview } = result;
    const zone = preview.timeZone;
    return {
      ok: true,
      preview: {
        licenceId: preview.licenceId,
        clientName: preview.clientName,
        deploymentId: preview.deploymentId,
        zone,
        issued: dateText(preview.issuedAt, zone),
        starts: dateText(preview.notBefore, zone),
        expires: dateText(preview.expiresAt, zone),
        graceEnds: dateText(preview.graceEndsAt, zone),
        replaces: preview.replaces
          ? { licenceId: preview.replaces.licenceId, expires: dateText(preview.replaces.expiresAt, zone) }
          : null,
        matchesDeployment: true,
      },
    };
  } catch (error) {
    return failureFromError(error);
  }
}

/** Step 2: submit the text again; the activation transaction re-verifies it and never trusts the preview. */
export async function activateLicenceAction(input: unknown): Promise<ActivateLicenceActionResult> {
  const normalised = normaliseInput(input);
  if (!normalised.ok) return normalised.rejection;

  try {
    const result = await licenceStaffService.activateLicenceForStaff({ raw: normalised.raw });
    if (result.ok) {
      revalidateLicenceScreens();
      return { ok: true, message: ACTIVATION_SUCCESS(LICENCE_STATE_LABELS[result.snapshot.state]) };
    }

    // The state moved between inspect and activate, or the file is no longer eligible:
    // the page behind the dialog is stale, so refresh it.
    if (
      result.code === "CONCURRENT_CHANGE" ||
      result.code === "ALREADY_ACTIVE" ||
      result.code === "OLDER_THAN_ACTIVE"
    ) {
      revalidateLicenceScreens();
    }
    return {
      ok: false,
      code: result.code,
      // The concurrent-change sentence is already a complete message ("Nothing was changed. ...").
      message:
        result.code === "CONCURRENT_CHANGE"
          ? rejectionSentence(result.code)
          : `Licence not activated. ${rejectionSentence(result.code)}`,
      neutral: isNeutralRejection(result.code),
    };
  } catch (error) {
    return failureFromError(error);
  }
}
