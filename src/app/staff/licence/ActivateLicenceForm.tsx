"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode, type RefObject } from "react";
import { CircleCheck, FileCheck } from "lucide-react";
import { ConfirmModal } from "@/components/primitives";
import { BTN, BTN_PRIMARY, FIELD, NOTE, NOTE_DANGER, NOTE_SUCCESS, TEXTAREA } from "@/components/primitives/controls";
import { MAX_LICENCE_FILE_CHARS } from "@/server/licence/constants";
import {
  ACTIVATE_CONFIRM_BODY,
  ACTIVATE_CONFIRM_TITLE,
  ACTIVATION_GENERIC_FAILURE,
  rejectionSentence,
} from "@/server/licence/policy";
import { activateLicenceAction, inspectLicenceAction, type LicencePreviewView } from "./actions";

/**
 * Two-step licence activation (Phase 14, plan 14-15; LIC-03, D-14, 14-UI-SPEC
 * "Activation flow"). Choose a file or paste the text, check it (the server
 * verifies the signature and returns a preview), then confirm. The form is a
 * courtesy: authorization and verification happen in the server actions, and the
 * activation transaction re-verifies the submitted text, so the preview shown
 * here is never what gets activated (T-14-15-02).
 *
 * `activateLicenceAction` is always called with the text held in this component,
 * never with preview data. No unverified text is rendered anywhere: only the
 * verified preview fields returned by the server are shown, as plain text.
 *
 * The form offers no control that creates, edits or replaces a licence or its
 * signature (LIC-03): the only write is activating a provider-issued file. All
 * licence sentences come from `policy.ts`; the labels below are field chrome.
 */

const FILE_LABEL = "Licence file";
const CHOOSE_FILE = "Choose file";
const NO_FILE = "No file chosen";
const PASTE_LABEL = "Or paste the licence text";
const FILE_HELPER = "Use the file exactly as provided.";
const CHECK_LABEL = "Check licence";
const CHECKING_LABEL = "Checking…";
const ACTIVATE_LABEL = "Activate licence";
const CHOOSE_DIFFERENT = "Choose a different file";
const VERIFIED_HEADING = "Verified";
const MATCHES_DEPLOYMENT = "Matches this deployment";

type NoteState = { kind: "success" | "rejection" | "neutral"; message: string; seq: number };

const BAD_FORMAT_MESSAGE = `${rejectionSentence("BAD_FORMAT")} Nothing was changed.`;

export function ActivateLicenceForm() {
  const fileLabelId = useId();
  const helperId = useId();
  const noteSeq = useRef(0);
  const inputSeq = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activateButtonRef = useRef<HTMLButtonElement>(null);
  const noteRef = useRef<HTMLParagraphElement>(null);
  const returnFocusToActivate = useRef(false);

  const [pasted, setPasted] = useState("");
  const [file, setFile] = useState<{ name: string; raw: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState<{ view: LicencePreviewView; raw: string } | null>(null);
  const [note, setNote] = useState<NoteState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [activating, setActivating] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [chooserFocusSeq, setChooserFocusSeq] = useState(0);

  // Whichever of the file and the pasted text was set last wins; the other is cleared.
  const heldRaw = file ? file.raw : pasted.trim();
  const busy = checking || activating;

  function showNote(kind: NoteState["kind"], message: string) {
    noteSeq.current += 1;
    setNote({ kind, message, seq: noteSeq.current });
  }

  // The success and rejection notes take focus once, when they appear.
  useEffect(() => {
    if (note) noteRef.current?.focus();
  }, [note]);

  // Cancelling the dialog returns focus to the Activate licence button.
  useEffect(() => {
    if (!confirmOpen && returnFocusToActivate.current) {
      returnFocusToActivate.current = false;
      activateButtonRef.current?.focus();
    }
  }, [confirmOpen]);

  // "Choose a different file" removes the focused button, so focus moves to the chooser.
  useEffect(() => {
    if (chooserFocusSeq > 0) fileInputRef.current?.focus();
  }, [chooserFocusSeq]);

  function clearFileInput() {
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    inputSeq.current += 1;
    const ticket = inputSeq.current;
    setNote(null);

    // Size is checked BEFORE the file is read (T-14-15-03); an oversize file is never read.
    if (chosen.size > MAX_LICENCE_FILE_CHARS) {
      clearFileInput();
      setFile(null);
      showNote("rejection", BAD_FORMAT_MESSAGE);
      return;
    }

    let text: string;
    try {
      text = (await chosen.text()).trim();
    } catch {
      clearFileInput();
      setFile(null);
      showNote("rejection", BAD_FORMAT_MESSAGE);
      return;
    }
    if (ticket !== inputSeq.current) return; // a later choice or paste won
    if (text === "") {
      clearFileInput();
      setFile(null);
      showNote("rejection", BAD_FORMAT_MESSAGE);
      return;
    }
    setFile({ name: chosen.name, raw: text });
    setPasted("");
  }

  function onPasteChange(value: string) {
    inputSeq.current += 1;
    setPasted(value);
    setFile(null);
    clearFileInput();
    setNote(null);
  }

  async function onCheck() {
    const raw = heldRaw;
    if (raw === "" || busy) return;
    setNote(null);
    if (raw.length > MAX_LICENCE_FILE_CHARS) {
      showNote("rejection", BAD_FORMAT_MESSAGE);
      return;
    }
    setChecking(true);
    try {
      const result = await inspectLicenceAction({ raw });
      if (result.ok) {
        setPreview({ view: result.preview, raw });
      } else {
        showNote(result.neutral ? "neutral" : "rejection", result.message);
      }
    } catch {
      showNote("rejection", ACTIVATION_GENERIC_FAILURE);
    } finally {
      setChecking(false);
    }
  }

  function resetPanel() {
    inputSeq.current += 1;
    setPreview(null);
    setPasted("");
    setFile(null);
    setDialogError(null);
    setConfirmOpen(false);
    clearFileInput();
  }

  function onChooseDifferent() {
    resetPanel();
    setNote(null);
    setChooserFocusSeq((value) => value + 1);
  }

  function onCancelConfirm() {
    if (activating) return;
    returnFocusToActivate.current = true;
    setConfirmOpen(false);
    setDialogError(null);
  }

  async function onConfirm() {
    if (!preview || activating) return;
    setActivating(true);
    setDialogError(null);
    try {
      // The text that was checked, held here: never preview data (T-14-15-02).
      const result = await activateLicenceAction({ raw: preview.raw });
      if (result.ok) {
        resetPanel();
        showNote("success", result.message);
      } else {
        setDialogError(result.message);
      }
    } catch {
      setDialogError(ACTIVATION_GENERIC_FAILURE);
    } finally {
      setActivating(false);
    }
  }

  return (
    <div data-testid="licence-activate-panel" aria-busy={busy} className="flex min-w-0 flex-col gap-4 pt-4">
      {preview ? (
        <VerifiedPreview
          view={preview.view}
          activateButtonRef={activateButtonRef}
          disabled={busy}
          onActivate={() => {
            setDialogError(null);
            setConfirmOpen(true);
          }}
          onChooseDifferent={onChooseDifferent}
        />
      ) : (
        <>
          <div className={FIELD}>
            <span id={fileLabelId}>{FILE_LABEL}</span>
            <div className="flex min-w-0 items-center gap-3">
              <label
                className={`${BTN} shrink-0 cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-accent`}
              >
                {CHOOSE_FILE}
                <input
                  ref={fileInputRef}
                  type="file"
                  className="sr-only"
                  aria-describedby={fileLabelId}
                  disabled={busy}
                  onChange={onFileChange}
                />
              </label>
              <span
                className="min-w-0 flex-1 truncate font-mono text-[13px] font-normal text-muted-foreground"
                title={file?.name}
              >
                {file ? file.name : NO_FILE}
              </span>
            </div>
          </div>

          <label className={FIELD}>
            {PASTE_LABEL}
            <textarea
              value={pasted}
              onChange={(event) => onPasteChange(event.target.value)}
              disabled={busy}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              aria-describedby={helperId}
              className={`${TEXTAREA} w-full font-mono break-all`}
            />
          </label>
          <p id={helperId} className="text-sm text-muted-foreground">
            {FILE_HELPER}
          </p>

          <button type="button" className={`${BTN} self-start`} disabled={heldRaw === "" || busy} onClick={onCheck}>
            {checking ? (
              CHECKING_LABEL
            ) : (
              <>
                <FileCheck aria-hidden className="mr-2 size-4" />
                {CHECK_LABEL}
              </>
            )}
          </button>
        </>
      )}

      {note && (
        <p
          ref={noteRef}
          tabIndex={-1}
          role={note.kind === "rejection" ? "alert" : "status"}
          className={`${note.kind === "success" ? NOTE_SUCCESS : note.kind === "rejection" ? NOTE_DANGER : NOTE} break-words`}
        >
          {note.message}
        </p>
      )}

      {preview && (
        <ConfirmModal
          open={confirmOpen}
          licenceEffect="continuity"
          eyebrow="Audited action"
          title={ACTIVATE_CONFIRM_TITLE}
          description={ACTIVATE_CONFIRM_BODY(preview.view.licenceId, preview.view.clientName, preview.view.expires.local)}
          confirmLabel={ACTIVATE_LABEL}
          tone="default"
          pending={activating}
          error={dialogError}
          onConfirm={onConfirm}
          onCancel={onCancelConfirm}
        />
      )}
    </div>
  );
}

function VerifiedPreview({
  view,
  activateButtonRef,
  disabled,
  onActivate,
  onChooseDifferent,
}: {
  view: LicencePreviewView;
  activateButtonRef: RefObject<HTMLButtonElement | null>;
  disabled: boolean;
  onActivate: () => void;
  onChooseDifferent: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section aria-labelledby="licence-verified-heading" className="flex min-w-0 flex-col gap-4 border border-border bg-surface-2 p-4">
        <h3 id="licence-verified-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CircleCheck aria-hidden className="size-4 shrink-0" />
          {VERIFIED_HEADING}
        </h3>
        <dl className="flex flex-col gap-3">
          <PreviewRow label="Licence ID">
            <span className="font-mono text-[13px] tabular-nums break-all">{view.licenceId}</span>
          </PreviewRow>
          <PreviewRow label="Client">
            <span className="break-words">{view.clientName}</span>
          </PreviewRow>
          <PreviewRow label="Deployment">
            <span className="font-mono text-[13px] tabular-nums break-all">{view.deploymentId}</span>
            <span className="text-sm text-muted-foreground">{MATCHES_DEPLOYMENT}</span>
          </PreviewRow>
          <PreviewRow label="Issued">
            <DateValue date={view.issued} zone={view.zone} />
          </PreviewRow>
          <PreviewRow label="Starts">
            <DateValue date={view.starts} />
          </PreviewRow>
          <PreviewRow label="Expires">
            <DateValue date={view.expires} />
          </PreviewRow>
          <PreviewRow label="Grace ends">
            <DateValue date={view.graceEnds} />
          </PreviewRow>
          {view.replaces && (
            <PreviewRow label="Replaces">
              <span className="font-mono text-[13px] tabular-nums break-all">{view.replaces.licenceId}</span>
              <DateValue date={view.replaces.expires} prefix="Expires" />
            </PreviewRow>
          )}
        </dl>
      </section>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button ref={activateButtonRef} type="button" className={BTN_PRIMARY} disabled={disabled} onClick={onActivate}>
          {ACTIVATE_LABEL}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onChooseDifferent}
          className="min-h-11 px-1 text-sm font-semibold text-accent underline underline-offset-2 disabled:opacity-50"
        >
          {CHOOSE_DIFFERENT}
        </button>
      </div>
    </div>
  );
}

function PreviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1 text-base text-foreground">{children}</dd>
    </div>
  );
}

function DateValue({ date, zone, prefix }: { date: { local: string; utc: string }; zone?: string; prefix?: string }) {
  return (
    <>
      <span>{prefix ? `${prefix} ${date.local}` : date.local}</span>
      {zone && <span className="text-sm text-muted-foreground">{zone}</span>}
      <span className="font-mono text-[13px] tabular-nums break-all text-muted-foreground">{date.utc}</span>
    </>
  );
}
