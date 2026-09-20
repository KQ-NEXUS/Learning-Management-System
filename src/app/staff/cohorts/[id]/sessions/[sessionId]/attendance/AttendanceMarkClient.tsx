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
  /** ISO instant — the marking window's close time (D-06). */
  windowClosesAt: string;
  /** Courtesy echo of `!isBeforeSessionStart` (D-09) — not the enforcement. */
  canSetLiveStates: boolean;
  roster: RegisterRow[];
};

const STATE_ORDER: AttendanceStateValue[] = ["PRESENT", "ABSENT", "LATE", "EXCUSED", "NOT_RECORDED"];

const LIVE_STATES: ReadonlySet<AttendanceStateValue> = new Set(["PRESENT", "ABSENT", "LATE"]);

/** How a chosen state reads at a glance: each state is its own colour, checked via the hidden radio. */
const STATE_SELECTED: Record<AttendanceStateValue, string> = {
  PRESENT: "has-checked:border-accent has-checked:bg-accent has-checked:text-accent-contrast",
  ABSENT: "has-checked:border-danger has-checked:bg-danger has-checked:text-white",
  LATE: "has-checked:border-warning has-checked:bg-warning has-checked:text-white",
  EXCUSED: "has-checked:border-muted-foreground has-checked:bg-muted-foreground has-checked:text-white",
  NOT_RECORDED: "has-checked:border-foreground has-checked:font-semibold",
};

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
    <div className="flex flex-col gap-4">
      {!canSetLiveStates && (
        <div role="status" className="rounded-md border border-warning/30 bg-warning/10 px-4 py-2 text-sm text-foreground">
          {PRE_START_HINT}
        </div>
      )}

      {windowClosed && roster.length > 0 && (
        <div role="status" className="rounded-md border border-border bg-surface-2 px-4 py-2 text-sm text-foreground">
          The marking window for this session closed on {new Date(windowClosesAt).toISOString()}. Changes
          now need a reason and are recorded as corrections in the audit history.
        </div>
      )}

      {saveError && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-surface px-4 py-2 text-sm text-danger">
          {saveError}
        </p>
      )}

      {roster.length === 0 ? (
        <div className="flex flex-col items-start gap-2 border-t border-foreground py-12">
          <p className="text-sm font-semibold text-foreground">Nothing to mark yet</p>
          <p className="max-w-prose text-sm text-muted-foreground">
            Attendance opens when the session starts. Before then you can only mark excused or
            not-recorded.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <dl className="flex flex-wrap gap-9">
              {(
                [
                  ["PRESENT", "Present"],
                  ["ABSENT", "Absent"],
                  ["LATE", "Late"],
                  ["EXCUSED", "Excused"],
                  ["NOT_RECORDED", "Not recorded"],
                ] as const
              ).map(([value, label]) => (
                <div key={value}>
                  <dd className="font-mono text-[28px] leading-[1.2] font-medium tabular-nums text-foreground">
                    {roster.filter((row) => (draft[row.enrolmentId]?.state ?? row.state) === value).length}
                  </dd>
                  <dt className="text-[13px] text-muted-foreground">{label}</dt>
                </div>
              ))}
            </dl>
            <p aria-live="polite" className="text-[13px] text-muted-foreground">
              {roster.length} {roster.length === 1 ? "learner" : "learners"} · {changedRows.length} changed
            </p>
          </div>

          <ul className="flex flex-col gap-2">
            {roster.map((row) => {
              const current = draft[row.enrolmentId]?.state ?? row.state;
              return (
                <li
                  key={row.enrolmentId}
                  className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-t border-foreground pt-5"
                >
                  <fieldset className="flex flex-col gap-1">
                    <legend className="text-sm font-semibold text-foreground">{row.learnerName}</legend>
                    <span className="text-[13px] text-muted-foreground">{row.learnerEmail}</span>
                    {row.isCorrection && (
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
                          className={`flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent ${
                            disabled ? "border-border text-muted-foreground" : `cursor-pointer border-input-border text-foreground hover:bg-surface-2 ${STATE_SELECTED[state]}`
                          }`}
                        >
                          <input
                            type="radio"
                            className="sr-only"
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
            <div className="flex items-center gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={handleSave}
                disabled={!dirty || saving}
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save attendance"}
              </button>
              {dirty && !saving && (
                <span className="text-xs text-muted-foreground">Unsaved changes — nothing is written until you save.</span>
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
