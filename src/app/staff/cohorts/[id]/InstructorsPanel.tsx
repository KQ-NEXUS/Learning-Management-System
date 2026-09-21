"use client";

/**
 * The Overview tab's instructor list — add/remove UI for `CohortInstructor`
 * (D-27). Before this component, `assignInstructorAction` /
 * `removeInstructorAction` had no caller anywhere in the app.
 *
 * A user is picked by id, not a search picker — matching the
 * `SessionFormFields` Facilitator field and the roster tab's
 * Transfer/Add-enrolment text-input escape hatches already established in
 * this phase. `canManage` hides the add/remove controls the same way
 * `CohortDetailActions` gates Publish/Cancel.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { assignInstructorAction, removeInstructorAction } from "./instructor-actions";

export type InstructorRow = { id: string; userId: string; userName: string; userEmail: string };

export type InstructorsPanelProps = {
  cohortId: string;
  instructors: InstructorRow[];
  canManage: boolean;
};

const BTN =
  "rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY =
  "rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-50";

export function InstructorsPanel({ cohortId, instructors, canManage }: InstructorsPanelProps) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAssign() {
    setPending(true);
    setError(null);
    const result = await assignInstructorAction({ cohortId, userId: userId.trim() });
    setPending(false);
    if (result.ok) {
      setUserId("");
      router.refresh();
    } else {
      setError(result.message);
    }
  }

  async function handleRemove(targetUserId: string) {
    setPending(true);
    setError(null);
    const result = await removeInstructorAction({ cohortId, userId: targetUserId });
    setPending(false);
    if (!result.ok) setError(result.message);
    else router.refresh();
  }

  return (
    <section aria-label="Instructors" className="flex flex-col">
      <h2 className="pb-4 text-[22px] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground">
        Instructors
      </h2>
      {instructors.length === 0 ? (
        <p className="border-t border-foreground pt-4 text-sm text-muted-foreground">
          No instructor assigned to this cohort.
        </p>
      ) : (
        <ul className="border-t border-foreground">
          {instructors.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-4 border-b border-border py-4 text-sm">
              <span className="flex min-w-0 items-center gap-4">
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-wash text-[13px] font-semibold text-accent"
                >
                  {row.userName
                    .split(/s+/)
                    .map((part) => part[0])
                    .filter(Boolean)
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-foreground">{row.userName}</span>
                  <span className="block truncate text-[13px] text-muted-foreground">{row.userEmail}</span>
                </span>
              </span>
              {canManage ? (
                <button
                  type="button"
                  className={BTN}
                  disabled={pending}
                  onClick={() => handleRemove(row.userId)}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <div className="flex items-end gap-2 pt-4">
          <label className="flex flex-col gap-1 text-sm">
            Add instructor (user id)
            <input
              type="text"
              className="rounded-md border border-input-border bg-surface px-2 py-1 text-sm text-foreground"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="cmta..."
            />
          </label>
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={pending || !userId.trim()}
            onClick={handleAssign}
          >
            Add
          </button>
        </div>
      ) : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </section>
  );
}
