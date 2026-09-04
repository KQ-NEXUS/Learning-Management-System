"use client";

/**
 * The attendance-marking screen (ATT-01, ATT-03).
 *
 * Mirrors the Phase-4 arrange board's "change freely, commit once" contract:
 * every state change is held in local draft state, and one accent
 * **Save attendance** button commits the whole batch through
 * `saveAttendanceAction` — sending only the entries that actually changed,
 * never the whole roster (the bulk action itself re-derives the roster from
 * the database regardless, D-10; sending only the diff here is a courtesy
 * that keeps the payload small, not the security boundary).
 *
 * Once the marking window has closed, the contract flips: every individual
 * change routes through `ConfirmModal` with a mandatory reason and commits
 * immediately via `correctAttendanceAction`, one learner at a time, so each
 * correction carries its own audited reason (ATT-03). `canSetLiveStates` is
 * a courtesy echo of the server's pre-start rule (D-09) — the real
 * enforcement lives in `attendance-service.ts` and cannot be bypassed by
 * disabling a radio button here.
 *
 * The roster comes ONLY from the server-supplied `roster` prop (D-10) — this
 * component never constructs or extends the learner set itself.
 */

import { useEffect, useState } from "react";
import { ConfirmModal } from "@/components/primitives";
import { useUnsavedOrder } from "@/components/catalogue";
import { saveAttendanceAction, correctAttendanceAction } from "../../../attendance-actions";

/** Local string union — matches `prisma/schema.prisma` `enum AttendanceState`,
 *  kept local so this client component needs no server-side type import. */
export type AttendanceStateValue = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" | "NOT_RECORDED";

export type RegisterRow = {
  enrolmentId: string;
  learnerName: string;
  learnerEmail: string;
  state: AttendanceStateValue;
  note: string | null;
  isCorrection: boolean;
};

export type AttendanceMarkClientProps = {
  cohortId: string;
  sessionId: string;
  sessionTitle: string;
  startsAtLabel: string | null;
  endsAtLabel: string | null;
  /** ISO instant — the marking window's close time (D-06). */
  windowClosesAt: string;
  /** Courtesy echo of `!isBeforeSessionStart` (D-09) — not the enforcement. */
  canSetLiveStates: boolean;
  roster: RegisterRow[];
};

const STATE_ORDER: AttendanceStateValue[] = ["PRESENT", "ABSENT", "LATE", "EXCUSED", "NOT_RECORDED"];

const LIVE_STATES: ReadonlySet<AttendanceStateValue> = new Set(["PRESENT", "ABSENT", "LATE"]);

const STATE_META: Record<AttendanceStateValue, { label: string; glyph: string }> = {
  PRESENT: { label: "Present", glyph: "✓" },
  ABSENT: { label: "Absent", glyph: "✗" },
  LATE: { label: "Late", glyph: "!" },
  EXCUSED: { label: "Excused", glyph: "•" },
  NOT_RECORDED: { label: "Not recorded", glyph: "—" },
};

const PRE_START_HINT =
  "You can only mark excused or not-recorded before the session starts. " +
  "Present, absent and late need the session to have begun.";

type DraftEntry = { state: AttendanceStateValue; note: string | null };

function toDraftMap(roster: RegisterRow[]): Record<string, DraftEntry> {
  const map: Record<string, DraftEntry> = {};
  for (const row of roster) {
    map[row.enrolmentId] = { state: row.state, note: row.note };
  }
  return map;
}

export function AttendanceMarkClient({
  cohortId,
  sessionId,
  sessionTitle,
  startsAtLabel,
  endsAtLabel,
  windowClosesAt,
  canSetLiveStates,
  roster,
}: AttendanceMarkClientProps) {
  const { setDirty } = useUnsavedOrder();

  const [committed, setCommitted] = useState<Record<string, DraftEntry>>(() => toDraftMap(roster));
  const [draft, setDraft] = useState<Record<string, DraftEntry>>(() => toDraftMap(roster));

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [pendingCorrection, setPendingCorrection] = useState<{
    enrolmentId: string;
    learnerName: string;
    from: AttendanceStateValue;
    to: AttendanceStateValue;
  } | null>(null);
  const [correctionPending, setCorrectionPending] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  // `Date.now()` is impure, so this reads it once via the lazy `useState`
  // initializer (the documented escape hatch — react-hooks/purity forbids
  // reading it inside `useMemo`, which must stay a pure function of its
  // deps) rather than on every render.
  const [windowClosed] = useState(() => new Date(windowClosesAt).getTime() < Date.now());

  const changedRows = roster.filter((row) => {
    const d = draft[row.enrolmentId];
    const c = committed[row.enrolmentId];
    return d.state !== c.state || (d.note ?? null) !== (c.note ?? null);
  });
  const dirty = changedRows.length > 0;

  useEffect(() => {
    setDirty(dirty, "attendance");
    return () => setDirty(false, "attendance");
  }, [dirty, setDirty]);

  function handleStateChange(row: RegisterRow, next: AttendanceStateValue) {
    const current = draft[row.enrolmentId]?.state ?? row.state;
    if (current === next) return;

    if (windowClosed) {
      setCorrectionError(null);
      setPendingCorrection({
        enrolmentId: row.enrolmentId,
        learnerName: row.learnerName,
        from: current,
        to: next,
      });
      return;
    }

    setDraft((prev) => ({ ...prev, [row.enrolmentId]: { ...prev[row.enrolmentId], state: next } }));
  }

  async function handleSave() {
    if (changedRows.length === 0) return;
    setSaving(true);
    setSaveError(null);
    const result = await saveAttendanceAction({
      cohortId,
      sessionId,
      entries: changedRows.map((row) => ({
        enrolmentId: row.enrolmentId,
        state: draft[row.enrolmentId].state,
        note: draft[row.enrolmentId].note ?? undefined,
      })),
    });
    setSaving(false);
    if (result.ok) {
      setCommitted(draft);
    } else {
      setSaveError(result.message);
    }
  }

  async function handleConfirmCorrection(reason: string) {
    if (!pendingCorrection) return;
    setCorrectionPending(true);
    setCorrectionError(null);
    const { enrolmentId, to } = pendingCorrection;
    const result = await correctAttendanceAction({
      cohortId,
      sessionId,
      enrolmentId,
      state: to,
      reason,
    });
    setCorrectionPending(false);
    if (result.ok) {
      setDraft((prev) => ({ ...prev, [enrolmentId]: { ...prev[enrolmentId], state: to } }));
      setCommitted((prev) => ({ ...prev, [enrolmentId]: { ...prev[enrolmentId], state: to } }));
      setPendingCorrection(null);
    } else {
      setCorrectionError(result.message);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="font-mono text-[11px] text-zinc-500">{sessionId}</p>
        <h1 className="text-lg font-semibold tracking-tight">{sessionTitle}</h1>
        {startsAtLabel && endsAtLabel && (
          <p className="font-mono text-xs text-zinc-600">
            {startsAtLabel} → {endsAtLabel}
          </p>
        )}
      </div>

      {!canSetLiveStates && (
        <div role="status" className="border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-zinc-800">
          {PRE_START_HINT}
        </div>
      )}

      {windowClosed && roster.length > 0 && (
        <div role="status" className="border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
          The marking window for this session closed on {new Date(windowClosesAt).toISOString()}. Changes
          now need a reason and are recorded as corrections in the audit history.
        </div>
      )}

      {saveError && (
        <p role="alert" className="border border-danger/30 bg-danger-surface px-3 py-2 text-sm text-danger">
          {saveError}
        </p>
      )}

      {roster.length === 0 ? (
        <div className="flex flex-col items-start gap-2 border border-zinc-200 bg-white px-6 py-10">
          <p className="text-sm font-semibold text-zinc-900">Nothing to mark yet</p>
          <p className="max-w-prose text-sm text-zinc-600">
            Attendance opens when the session starts. Before then you can only mark excused or
            not-recorded.
          </p>
        </div>
      ) : (
        <>
          <p aria-live="polite" className="text-xs text-zinc-500">
            {roster.length} {roster.length === 1 ? "learner" : "learners"} · {changedRows.length} changed
          </p>

          <ul className="flex flex-col gap-2">
            {roster.map((row) => {
              const current = draft[row.enrolmentId]?.state ?? row.state;
              return (
                <li
                  key={row.enrolmentId}
                  className="flex flex-col gap-2 border border-zinc-200 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <fieldset className="flex flex-col gap-1">
                    <legend className="text-sm font-medium text-zinc-900">{row.learnerName}</legend>
                    <span className="text-[11px] text-zinc-500">{row.learnerEmail}</span>
                    {row.isCorrection && (
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        Corrected
                      </span>
                    )}
                  </fieldset>

                  <div role="radiogroup" aria-label={`Attendance for ${row.learnerName}`} className="flex flex-wrap gap-2">
                    {STATE_ORDER.map((state) => {
                      const disabled = !canSetLiveStates && LIVE_STATES.has(state);
                      const meta = STATE_META[state];
                      return (
                        <label
                          key={state}
                          className={`flex items-center gap-1.5 border px-2 py-1 text-xs ${
                            disabled ? "border-zinc-200 text-zinc-400" : "border-zinc-300 text-zinc-800"
                          }`}
                        >
                          <input
                            type="radio"
                            name={`state-${row.enrolmentId}`}
                            value={state}
                            checked={current === state}
                            disabled={disabled}
                            onChange={() => handleStateChange(row, state)}
                          />
                          <span aria-hidden>{meta.glyph}</span>
                          <span>{meta.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>

          {!windowClosed && (
            <div className="flex items-center gap-2 border-t border-zinc-200 pt-4">
              <button
                type="button"
                onClick={handleSave}
                disabled={!dirty || saving}
                className="bg-accent px-3 py-1.5 text-xs font-medium text-accent-contrast hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save attendance"}
              </button>
              {dirty && !saving && (
                <span className="text-xs text-zinc-500">Unsaved changes — nothing is written until you save.</span>
              )}
            </div>
          )}
        </>
      )}

      <ConfirmModal
        open={pendingCorrection !== null}
        tone="danger"
        minReasonLength={10}
        title={`Change ${pendingCorrection?.learnerName ?? "this learner"}'s attendance for ${sessionTitle}?`}
        description={
          pendingCorrection
            ? `From ${STATE_META[pendingCorrection.from].label} to ${STATE_META[pendingCorrection.to].label}. The marking window has closed, so this is stored as a correction in the audit history.`
            : ""
        }
        confirmLabel="Save correction"
        pending={correctionPending}
        error={correctionError}
        onConfirm={handleConfirmCorrection}
        onCancel={() => {
          setPendingCorrection(null);
          setCorrectionError(null);
        }}
      />
    </div>
  );
}
