"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrangeBoard,
  GuardedLink,
  type ArrangeContainer,
} from "@/components/catalogue";
import { ModuleComposer, type ComposerResult } from "./ModuleComposer";
import {
  createModuleAction,
  renameModuleAction,
  restoreItemAction,
  saveLessonArrangementAction,
  saveModuleOrderAction,
} from "./actions";

/**
 * The arrange screen's client island.
 *
 * Holds the proposed arrangement for two boards — Modules (no cross-container
 * moves) and Lessons grouped by Module (`allowCrossContainer`, D-21) — and
 * wires the composer and both boards to the Server Actions. Nothing is
 * written until "Save order"; a stale save comes back as `reason: "STALE"`
 * with a Reload offered (D-23). The order token is refreshed in place on a
 * successful save so a second save needs no reload.
 */

type LessonLite = { id: string; title: string; type: string; required: boolean };
type ModuleLite = { id: string; title: string; lessons: LessonLite[] };

export type ArrangeClientProps = {
  courseId: string;
  token: string;
  modules: ModuleLite[];
  withdrawnModules: { id: string; title: string }[];
  withdrawnLessons: { id: string; title: string; moduleTitle: string }[];
};

function buildModuleContainers(modules: ModuleLite[]): ArrangeContainer[] {
  return [
    {
      id: "modules",
      label: "Module order",
      items: modules.map((m) => ({ id: m.id, label: m.title })),
    },
  ];
}

function buildLessonContainers(modules: ModuleLite[]): ArrangeContainer[] {
  return modules.map((m) => ({
    id: m.id,
    label: m.title,
    items: m.lessons.map((l) => ({
      id: l.id,
      label: l.title,
      sublabel: l.type,
      badge: l.required ? "Required" : "Optional",
    })),
  }));
}

const idKey = (containers: ArrangeContainer[]) =>
  JSON.stringify(
    containers.map((c) => ({ id: c.id, items: c.items.map((i) => i.id) })),
  );

export function ArrangeClient({
  courseId,
  token: initialToken,
  modules,
  withdrawnModules,
  withdrawnLessons,
}: ArrangeClientProps) {
  const router = useRouter();
  const [token, setToken] = useState(initialToken);

  const [moduleContainers, setModuleContainers] = useState(() =>
    buildModuleContainers(modules),
  );
  const [lessonContainers, setLessonContainers] = useState(() =>
    buildLessonContainers(modules),
  );
  const [savedModuleKey, setSavedModuleKey] = useState(() =>
    idKey(buildModuleContainers(modules)),
  );
  const [savedLessonKey, setSavedLessonKey] = useState(() =>
    idKey(buildLessonContainers(modules)),
  );

  const [savingModules, setSavingModules] = useState(false);
  const [savingLessons, setSavingLessons] = useState(false);
  const [moduleError, setModuleError] = useState<string | null>(null);
  const [lessonError, setLessonError] = useState<string | null>(null);
  const [moduleStale, setModuleStale] = useState(false);
  const [lessonStale, setLessonStale] = useState(false);

  const moduleDirty = idKey(moduleContainers) !== savedModuleKey;
  const lessonDirty = idKey(lessonContainers) !== savedLessonKey;

  async function handleSaveModuleOrder() {
    setSavingModules(true);
    setModuleError(null);
    setModuleStale(false);
    try {
      const res = await saveModuleOrderAction({
        courseId,
        token,
        moduleIds: moduleContainers[0].items.map((i) => i.id),
      });
      if (res.ok) {
        setToken(res.token);
        setSavedModuleKey(idKey(moduleContainers));
      } else {
        setModuleError(res.message);
        setModuleStale(res.reason === "STALE");
      }
    } catch {
      // An unexpected rejection (network drop, action runtime error) leaves the
      // outcome unknown — surface a generic retryable message, never the caught
      // value, and do not imply the order was applied. `moduleStale` stays false.
      setModuleError(
        "Something went wrong saving the module order. Nothing was changed — try again.",
      );
    } finally {
      setSavingModules(false);
    }
  }

  async function handleSaveLessonArrangement() {
    setSavingLessons(true);
    setLessonError(null);
    setLessonStale(false);
    try {
      const res = await saveLessonArrangementAction({
        courseId,
        token,
        arrangement: lessonContainers.map((c) => ({
          moduleId: c.id,
          lessonIds: c.items.map((i) => i.id),
        })),
      });
      if (res.ok) {
        setToken(res.token);
        setSavedLessonKey(idKey(lessonContainers));
      } else {
        setLessonError(res.message);
        setLessonStale(res.reason === "STALE");
      }
    } catch {
      setLessonError(
        "Something went wrong saving the lesson arrangement. Nothing was changed — try again.",
      );
    } finally {
      setSavingLessons(false);
    }
  }

  // Both handlers translate the already-resolved discriminated action result
  // for the composer and catch an unexpected rejection (network drop, action
  // runtime error) so the composer always receives a definite result and can
  // keep the edited text for a retry. There is no pending state to strand here
  // — the composer owns per-control busy state and clears it in its own
  // `finally`.
  async function handleAddModule(title: string): Promise<ComposerResult> {
    try {
      const res = await createModuleAction({ courseId, title });
      if (res.ok) {
        router.refresh();
        return { ok: true };
      }
      return { ok: false, message: res.message };
    } catch {
      return {
        ok: false,
        message: "Something went wrong adding the module. Try again.",
      };
    }
  }

  async function handleRenameModule(
    moduleId: string,
    title: string,
  ): Promise<ComposerResult> {
    try {
      const res = await renameModuleAction({ courseId, moduleId, title });
      if (res.ok) {
        router.refresh();
        return { ok: true };
      }
      return { ok: false, message: res.message };
    } catch {
      return {
        ok: false,
        message: "Something went wrong renaming the module. Try again.",
      };
    }
  }

  async function handleRestore(kind: "module" | "lesson", id: string) {
    const res = await restoreItemAction({ courseId, kind, id });
    if (res.ok) router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <ModuleComposer
        modules={modules.map((m) => ({ id: m.id, title: m.title }))}
        onAddModule={handleAddModule}
        onRenameModule={handleRenameModule}
      />

      {modules.length > 0 && (
        <>
          <ArrangeBoard
            title="Module order"
            containers={moduleContainers}
            withdrawn={withdrawnModules.map((m) => ({
              id: m.id,
              label: m.title,
              kind: "Module",
            }))}
            dirty={moduleDirty}
            saving={savingModules}
            error={moduleError}
            onArrangementChange={setModuleContainers}
            onSave={handleSaveModuleOrder}
            onRestore={(id) => handleRestore("module", id)}
          />
          {moduleStale && <ReloadRow onReload={() => router.refresh()} />}

          <ArrangeBoard
            title="Lessons by module"
            containers={lessonContainers}
            withdrawn={withdrawnLessons.map((l) => ({
              id: l.id,
              label: l.title,
              kind: l.moduleTitle,
            }))}
            dirty={lessonDirty}
            saving={savingLessons}
            error={lessonError}
            allowCrossContainer
            onArrangementChange={setLessonContainers}
            onSave={handleSaveLessonArrangement}
            onRestore={(id) => handleRestore("lesson", id)}
            renderContainerAction={(containerId) => (
              <GuardedLink
                href={`/staff/courses/${courseId}/lessons/new?moduleId=${containerId}`}
                className="rounded-md border border-input-border bg-surface px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-surface-2"
              >
                Add lesson
              </GuardedLink>
            )}
          />
          {lessonStale && <ReloadRow onReload={() => router.refresh()} />}
        </>
      )}
    </div>
  );
}

function ReloadRow({ onReload }: { onReload: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm text-foreground shadow-xs">
      <span>Someone else changed this order while you were working.</span>
      <button
        type="button"
        onClick={onReload}
        className="rounded-md border border-input-border bg-surface px-2 py-1 text-sm font-semibold hover:bg-surface-2"
      >
        Reload
      </button>
    </div>
  );
}
