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

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { assignInstructorAction, listInstructorCandidatesAction, removeInstructorAction } from "./instructor-actions";
import { useToast } from "@/components/feedback/Toaster";
import { PersonPickerDialog, type PickablePerson } from "@/components/people/PersonPickerDialog";

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
  const toast = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAssign(person: PickablePerson) {
    setPending(true);
    setError(null);
    const result = await assignInstructorAction({ cohortId, userId: person.id });
    setPending(false);
    if (result.ok) {
      toast.success(`${person.name} added as an instructor`);
      setPickerOpen(false);
      router.refresh();
    } else {
      setError(result.message);
    }
  }

  // Staff are listed by the server, which checks the caller may manage this cohort's instructors.
  const loadCandidates = useCallback(
    async (query: string) => {
      const result = await listInstructorCandidatesAction({ cohortId, query });
      if (!result.ok) return result;
      return {
        ok: true as const,
        people: result.people.map((person) => ({
          id: person.id,
          name: person.name,
          email: person.email,
          detail: person.roles.join(", ") || "No role",
          disabledReason: person.assigned ? "Already an instructor" : undefined,
        })),
      };
    },
    [cohortId],
  );

  async function handleRemove(targetUserId: string) {
    setPending(true);
    setError(null);
    const result = await removeInstructorAction({ cohortId, userId: targetUserId });
    setPending(false);
    if (!result.ok) setError(result.message);
    else {
      toast.success("Instructor removed");
      router.refresh();
    }
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
        <div className="pt-4">
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={pending}
            onClick={() => {
              setError(null);
              setPickerOpen(true);
            }}
          >
            Add instructor
          </button>
        </div>
      ) : null}
      {error && !pickerOpen ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <PersonPickerDialog
        open={pickerOpen}
        title="Add instructor"
        description="Active staff accounts. Search by name or email, choose one, then add them to this cohort."
        confirmLabel="Add instructor"
        load={loadCandidates}
        emptyText="No active staff accounts."
        pending={pending}
        error={error}
        onConfirm={handleAssign}
        onClose={() => {
          if (!pending) setPickerOpen(false);
        }}
      />
    </section>
  );
}
