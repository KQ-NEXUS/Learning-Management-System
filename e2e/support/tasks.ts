/**
 * Runs one scheduled task on demand for the browser journey (Phase 15, plan
 * 15-15). Netlify scheduled functions do not run on a local server or a deploy
 * preview (RESEARCH Pitfall 9), so a journey step that needs email dispatch,
 * export processing or reconciliation calls this between page actions.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

export function runTask(name: string, target: "local" | "staging" = "local"): void {
  // Run from the repository root with a relative script path: the checkout path
  // can contain spaces, which a Windows shell would split.
  const root = path.resolve(__dirname, "../..");
  const result = spawnSync("npx", ["tsx", "scripts/ops/run-task.ts", name, "--target", target], {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").slice(-5).join("\n");
    throw new Error(`Task "${name}" failed (exit ${result.status ?? "none"}).\n${detail}`);
  }
}
