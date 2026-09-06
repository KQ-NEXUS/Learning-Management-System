"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrangeBoard, type ArrangeContainer } from "@/components/catalogue";
import type { ProgrammeMemberRow } from "@/server/services/programme-service";
import {
  addCourseAction,
  removeCourseAction,
  saveProgrammeCourseOrderAction,
} from "./actions";

/**
 * A Programme has ONE ordered list of member Courses (not modules), so this
 * screen renders one ArrangeBoard with cross-container moves switched off.
 *
 * The two things this screen exists to make obvious (CAT-02):
 *  - Adding a Course here creates a REFERENCE. It is not copied; editing it
 *    later changes it everywhere. Each row names the other Programmes it is in.
 *  - Removing a Course here only takes it out of THIS Programme's draft
 *    ordering — the Course still exists, other Programmes are untouched, and
 *    already-published Programme versions are frozen (D-14 / D-18).
 */

type CandidateCourse = { id: string; title: string; slug: string; status: string };

const CONTAINER_ID = "programme-courses";

export function ProgrammeArrangeClient({
  programmeId,
  token: initialToken,
  members,
  addableCourses,
}: {
  programmeId: string;
  token: string;
  members: ProgrammeMemberRow[];
  addableCourses: CandidateCourse[];
}) {
  const router = useRouter();
  const [token, setToken] = useState(initialToken);
  const memberById = useMemo(
    () => new Map(members.map((m) => [m.membershipId, m])),
    [members],
  );

  const initial: ArrangeContainer[] = useMemo(
    () => [
      {
        id: CONTAINER_ID,
        label: "Course order",
        items: members.map((m) => ({
          id: m.membershipId,
          label: m.title,
          sublabel:
            (m.status !== "PUBLISHED" ? `${m.status} · ` : "") +
            (m.otherProgrammeTitles.length > 0
              ? `also in ${m.otherProgrammeTitles.join(", ")}`
              : "only in this programme"),
        })),
      },
    ],
    [members],
  );

  const [containers, setContainers] = useState(initial);
  const savedKey = useMemo(
    () => JSON.stringify(initial[0].items.map((i) => i.id)),
    [initial],
  );
  const currentKey = JSON.stringify(containers[0].items.map((i) => i.id));
  const dirty = currentKey !== savedKey;

  const [saving, setSaving] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [busyCourseId, setBusyCourseId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function handleSave() {
    setSaving(true);
    setOrderError(null);
    setStale(false);
    const result = await saveProgrammeCourseOrderAction({
      programmeId,
      token,
      membershipIds: containers[0].items.map((i) => i.id),
    });
    if (result.ok) {
      setToken(result.token);
      router.refresh();
    } else {
      setOrderError(result.message);
      setStale(result.reason === "STALE");
    }
    setSaving(false);
  }

  async function handleAdd(courseId: string) {
    setBusyCourseId(courseId);
    setMembershipError(null);
    const result = await addCourseAction({ programmeId, courseId });
    if (result.ok) router.refresh();
    else setMembershipError(result.message);
    setBusyCourseId(null);
  }

  async function handleRemove(membershipId: string) {
    const member = memberById.get(membershipId);
    if (!member) return;
    setBusyCourseId(member.courseId);
    setMembershipError(null);
    const result = await removeCourseAction({ programmeId, courseId: member.courseId });
    if (result.ok) router.refresh();
    else setMembershipError(result.message);
    setBusyCourseId(null);
  }

  const candidates = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return addableCourses.filter(
      (course) =>
        !needle ||
        course.title.toLowerCase().includes(needle) ||
        course.slug.toLowerCase().includes(needle),
    );
  }, [addableCourses, search]);

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-prose rounded-xl border border-border bg-surface-2 px-3 py-2 text-xs text-foreground shadow-xs">
        Adding a course here <strong>references</strong> it — the course is not copied, and editing it
        later changes it in every programme it belongs to. Removing it here only takes it out of this
        programme&apos;s draft order; the course itself, other programmes, and any already-published
        version of this programme are untouched.
      </p>

      {membershipError && (
        <p role="alert" className="border border-danger/30 bg-danger-surface px-3 py-2 text-sm text-danger">
          {membershipError}
        </p>
      )}

      {members.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface px-3 py-3 text-sm text-muted-foreground shadow-xs">
          No courses in this programme yet. Add one below.
        </p>
      ) : (
        <>
          <ArrangeBoard
            title="Course order"
            containers={containers}
            allowCrossContainer={false}
            dirty={dirty}
            saving={saving}
            error={orderError}
            emptyContainerLabel="No courses in this programme yet."
            onArrangementChange={setContainers}
            onSave={handleSave}
            renderItemAction={(item) => (
              <button
                type="button"
                className="rounded-md border border-danger/40 bg-surface px-2 py-1 text-[11px] font-semibold text-danger hover:bg-danger-surface disabled:opacity-40"
                disabled={busyCourseId === memberById.get(item.id)?.courseId}
                aria-label={`Remove ${item.label} from this programme`}
                onClick={() => handleRemove(item.id)}
              >
                Remove
              </button>
            )}
          />
          {stale && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground shadow-xs">
              <span>Someone else changed this order while you were working.</span>
              <button
                type="button"
                onClick={() => router.refresh()}
                className="rounded-md border border-input-border bg-surface px-2 py-1 text-xs font-semibold text-foreground hover:bg-surface-2"
              >
                Reload
              </button>
            </div>
          )}
        </>
      )}

      <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 shadow-card">
        <h2 className="text-sm font-semibold tracking-tight">Add a course</h2>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search courses by title or slug"
          className="rounded-md border border-input-border bg-surface px-2.5 py-1.5 text-sm text-foreground"
        />
        {candidates.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {addableCourses.length === 0
              ? "Every course is already in this programme."
              : "No courses match your search."}
          </p>
        ) : (
          <ul className="flex max-h-72 flex-col divide-y divide-border overflow-y-auto">
            {candidates.map((course) => (
              <li key={course.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="truncate font-semibold text-foreground">{course.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {course.slug}
                    {course.status !== "PUBLISHED" && ` · ${course.status}`}
                  </span>
                </span>
                <button
                  type="button"
                  className="rounded-md border border-input-border bg-surface px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-surface-2 disabled:opacity-40"
                  disabled={busyCourseId === course.id}
                  onClick={() => handleAdd(course.id)}
                >
                  {busyCourseId === course.id ? "Adding…" : "Add"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
