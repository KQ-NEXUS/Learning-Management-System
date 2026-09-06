/**
 * WR-04 (04.1 gap closure) — the ModuleComposer must not discard a staff
 * member's typed text when an add or rename fails, and each operation's error
 * must stay next to its own control.
 *
 * Both the reported failure paths are covered:
 *   - the callback REJECTS (promise rejection: network drop / action crash)
 *   - the callback RESOLVES to an explicit `{ ok: false, message }`
 * followed by a later user-triggered success. There is no automatic retry.
 *
 * `ModuleComposer` is a pure client component; its callbacks are the seam,
 * so no Server Actions module is imported here.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  ModuleComposer,
  type ComposerResult,
} from "@/app/staff/courses/[id]/arrange/ModuleComposer";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const flush = () =>
  act(async () => {
    // Cover the callback promise plus the component's own `finally`.
    await Promise.resolve();
    await Promise.resolve();
  });

function addInput() {
  return screen.getByLabelText(/module title/i) as HTMLInputElement;
}

describe("ModuleComposer — failed add retains text and retries at the add control", () => {
  it("keeps the typed title and shows the error under the add input when the add callback rejects, then succeeds on retry", async () => {
    const onAddModule = vi
      .fn<(title: string) => Promise<ComposerResult>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true });

    render(
      <ModuleComposer modules={[]} onAddModule={onAddModule} onRenameModule={vi.fn()} />,
    );

    fireEvent.change(addInput(), { target: { value: "Fundamentals" } });
    fireEvent.click(screen.getByRole("button", { name: /add module/i }));
    await flush();

    // Text retained, not re-typed.
    expect(addInput().value).toBe("Fundamentals");
    const addForm = addInput().closest("form") as HTMLFormElement;
    expect(within(addForm).getByRole("alert").textContent).toMatch(/still here/i);

    // A later user-triggered retry — no automatic resubmit.
    expect(onAddModule).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /add module/i }));
    await flush();

    expect(onAddModule).toHaveBeenCalledTimes(2);
    expect(addInput().value).toBe("");
  });

  it("keeps the typed title and shows the error when the add callback resolves to { ok: false }", async () => {
    const onAddModule = vi
      .fn<(title: string) => Promise<ComposerResult>>()
      .mockResolvedValue({ ok: false, message: "Your role does not permit editing this course." });

    render(
      <ModuleComposer modules={[]} onAddModule={onAddModule} onRenameModule={vi.fn()} />,
    );

    fireEvent.change(addInput(), { target: { value: "Getting started" } });
    fireEvent.click(screen.getByRole("button", { name: /add module/i }));
    await flush();

    expect(addInput().value).toBe("Getting started");
    const addForm = addInput().closest("form") as HTMLFormElement;
    expect(within(addForm).getByRole("alert").textContent).toMatch(
      /Your role does not permit editing this course\./,
    );
  });

  it("does not allow a duplicate concurrent submit while an add is in flight", async () => {
    let resolveAdd!: (value: ComposerResult) => void;
    const onAddModule = vi
      .fn<(title: string) => Promise<ComposerResult>>()
      .mockImplementation(() => new Promise((resolve) => { resolveAdd = resolve; }));

    render(
      <ModuleComposer modules={[]} onAddModule={onAddModule} onRenameModule={vi.fn()} />,
    );

    fireEvent.change(addInput(), { target: { value: "One" } });
    fireEvent.click(screen.getByRole("button", { name: /add module/i }));
    fireEvent.click(screen.getByRole("button", { name: /add module/i }));

    expect(onAddModule).toHaveBeenCalledTimes(1);
    await act(async () => resolveAdd({ ok: true }));
  });
});

describe("ModuleComposer — failed rename stays in edit mode with text intact", () => {
  function enterRenameMode() {
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    return screen.getByLabelText(/rename module a/i) as HTMLInputElement;
  }

  it("keeps the row in edit mode with the typed name and a row-local error when the rename callback rejects, then succeeds on retry", async () => {
    const onRenameModule = vi
      .fn<(id: string, title: string) => Promise<ComposerResult>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true });

    render(
      <ModuleComposer
        modules={[{ id: "m1", title: "Module A" }]}
        onAddModule={vi.fn()}
        onRenameModule={onRenameModule}
      />,
    );

    const field = enterRenameMode();
    fireEvent.change(field, { target: { value: "Module A renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /save name/i }));
    await flush();

    // Still editing, text intact, error next to this row (not the add input).
    expect((screen.getByLabelText(/rename module a/i) as HTMLInputElement).value).toBe(
      "Module A renamed",
    );
    const renameRow = screen.getByLabelText(/rename module a/i).closest("li") as HTMLElement;
    expect(within(renameRow).getByRole("alert").textContent).toMatch(/still here/i);
    const addForm = addInput().closest("form") as HTMLFormElement;
    expect(within(addForm).queryByRole("alert")).toBeNull();

    // User retries; success exits edit mode.
    fireEvent.click(screen.getByRole("button", { name: /save name/i }));
    await flush();

    expect(onRenameModule).toHaveBeenCalledTimes(2);
    expect(screen.queryByLabelText(/rename module a/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Rename" })).toBeTruthy();
  });

  it("keeps the row in edit mode when the rename callback resolves to { ok: false }", async () => {
    const onRenameModule = vi
      .fn<(id: string, title: string) => Promise<ComposerResult>>()
      .mockResolvedValue({ ok: false, message: "That role does not permit editing this course." });

    render(
      <ModuleComposer
        modules={[{ id: "m1", title: "Module A" }]}
        onAddModule={vi.fn()}
        onRenameModule={onRenameModule}
      />,
    );

    const field = enterRenameMode();
    fireEvent.change(field, { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /save name/i }));
    await flush();

    expect((screen.getByLabelText(/rename module a/i) as HTMLInputElement).value).toBe("Renamed");
    const renameRow = screen.getByLabelText(/rename module a/i).closest("li") as HTMLElement;
    expect(within(renameRow).getByRole("alert").textContent).toMatch(
      /That role does not permit editing this course\./,
    );
  });
});
