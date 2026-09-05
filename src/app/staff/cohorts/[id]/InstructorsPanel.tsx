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
  "border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50";
const BTN_PRIMARY =
  "bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-contrast hover:opacity-90 disabled:opacity-50";

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
    <section className="flex flex-col gap-2 border border-zinc-200 p-4">
      <h2 className="text-sm font-medium text-zinc-900">Instructors</h2>
      {instructors.length === 0 ? (
        <p className="text-xs text-zinc-500">No instructor assigned to this cohort.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {instructors.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 text-xs">
              <span>
                {row.userName} <span className="text-zinc-500">{row.userEmail}</span>
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
        <div className="flex items-end gap-2 pt-1">
          <label className="flex flex-col gap-1 text-xs">
            Add instructor (user id)
            <input
              type="text"
              className="border border-zinc-300 px-2 py-1 text-xs"
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
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </section>
  );
}
