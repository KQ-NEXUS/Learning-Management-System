"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrangeBoard,
  GuardedLink,
  type ArrangeContainer,
} from "@/components/catalogue";
import { ModuleComposer } from "./ModuleComposer";
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
  const [composerError, setComposerError] = useState<string | null>(null);

  const moduleDirty = idKey(moduleContainers) !== savedModuleKey;
  const lessonDirty = idKey(lessonContainers) !== savedLessonKey;

  async function handleSaveModuleOrder() {
    setSavingModules(true);
    setModuleError(null);
    setModuleStale(false);
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
    setSavingModules(false);
  }

  async function handleSaveLessonArrangement() {
    setSavingLessons(true);
    setLessonError(null);
    setLessonStale(false);
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
    setSavingLessons(false);
  }

  async function handleAddModule(title: string) {
    setComposerError(null);
    const res = await createModuleAction({ courseId, title });
    if (res.ok) router.refresh();
    else setComposerError(res.message);
  }

  async function handleRenameModule(moduleId: string, title: string) {
    setComposerError(null);
    const res = await renameModuleAction({ courseId, moduleId, title });
    if (res.ok) router.refresh();
    else setComposerError(res.message);
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
        error={composerError}
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
                className="border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium text-zinc-800 hover:bg-zinc-50"
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
    <div className="flex items-center gap-2 border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
      <span>Someone else changed this order while you were working.</span>
      <button
        type="button"
        onClick={onReload}
        className="border border-zinc-300 bg-white px-2 py-1 text-xs font-medium hover:bg-zinc-50"
      >
        Reload
      </button>
    </div>
  );
}
