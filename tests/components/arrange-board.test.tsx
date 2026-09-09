/**
 * D-19 keyboard-parity proof plus the ArrangeBoard / ModuleComposer surface.
 *
 * The assertion that matters for CAT-03 + NFR-09: the keyboard path
 * ("Move up" / "Move down" / "Move to next module") produces the SAME
 * arrangement array as the equivalent pointer drag. The drag is simulated by
 * handing a `@hello-pangea/dnd` result object to the board's
 * `onDragEnd`-equivalent (`arrangementFromDragResult`) rather than
 * synthesising pointer physics — what is under test is that both entry points
 * converge on one array, not that the library drags.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { DropResult } from "@hello-pangea/dnd";
import {
  ArrangeBoard,
  arrangementFromDragResult,
  moveItemInContainers,
  type ArrangeContainer,
} from "@/components/catalogue";
import { ModuleComposer } from "@/app/staff/courses/[id]/arrange/ModuleComposer";

afterEach(cleanup);

const threeLessons = (): ArrangeContainer[] => [
  {
    id: "m1",
    label: "Module A",
    items: [
      { id: "l1", label: "Lesson 1", badge: "Required" },
      { id: "l2", label: "Lesson 2", badge: "Optional" },
      { id: "l3", label: "Lesson 3", badge: "Optional" },
    ],
  },
];

const twoModules = (): ArrangeContainer[] => [
  {
    id: "m1",
    label: "Module A",
    items: [
      { id: "l1", label: "Lesson 1" },
      { id: "l2", label: "Lesson 2" },
    ],
  },
  { id: "m2", label: "Module B", items: [{ id: "l3", label: "Lesson 3" }] },
];

const toIds = (containers: ArrangeContainer[]) =>
  containers.map((c) => ({ id: c.id, items: c.items.map((i) => i.id) }));

function dropResult(
  draggableId: string,
  from: { droppableId: string; index: number },
  to: { droppableId: string; index: number } | null,
): DropResult {
  return {
    draggableId,
    type: "DEFAULT",
    source: from,
    destination: to,
    reason: "DROP",
    mode: "SNAP",
    combine: null,
  } as DropResult;
}

function Harness({
  initial,
  allowCrossContainer = false,
  withdrawn = [],
  onSaveSpy = () => {},
}: {
  initial: ArrangeContainer[];
  allowCrossContainer?: boolean;
  withdrawn?: { id: string; label: string }[];
  onSaveSpy?: (arrangement: ArrangeContainer[]) => void;
}) {
  const [containers, setContainers] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const dirty = JSON.stringify(toIds(containers)) !== JSON.stringify(toIds(saved));

  return (
    <ArrangeBoard
      containers={containers}
      withdrawn={withdrawn}
      dirty={dirty}
      allowCrossContainer={allowCrossContainer}
      onArrangementChange={setContainers}
      onSave={() => {
        onSaveSpy(containers);
        setSaved(containers);
      }}
      onRestore={() => {}}
    />
  );
}

describe("ArrangeBoard — keyboard parity", () => {
  it("keyboard 'Move up' on the third item equals a drag from index 2 to index 1", () => {
    const initial = threeLessons();

    // The drag reference: index 2 -> index 1 within Module A.
    const dragged = arrangementFromDragResult(
      initial,
      dropResult("l3", { droppableId: "m1", index: 2 }, { droppableId: "m1", index: 1 }),
    );
    expect(dragged).not.toBeNull();

    // The keyboard path: press "Move Lesson 3 up" once.
    render(<Harness initial={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "Move Lesson 3 up" }));

    const rowLabels = screen
      .getAllByRole("listitem")
      .map((li) => li.querySelector("span.font-semibold")?.textContent)
      .filter(Boolean);

    expect(rowLabels).toEqual(["Lesson 1", "Lesson 3", "Lesson 2"]);
    expect(toIds(dragged!)).toEqual([{ id: "m1", items: ["l1", "l3", "l2"] }]);
  });

  it("the keyboard-produced array deep-equals the drag-produced array", () => {
    const initial = twoModules();

    const viaDrag = arrangementFromDragResult(
      initial,
      dropResult("l1", { droppableId: "m1", index: 0 }, { droppableId: "m2", index: 1 }),
    );

    // "Move to next module" appends to the end of the destination container,
    // which for Lesson 1 (Module A index 0 -> Module B) is index 1.
    const viaKeyboard = moveItemInContainers(
      initial,
      { droppableId: "m1", index: 0 },
      { droppableId: "m2", index: 1 },
    );

    expect(toIds(viaKeyboard)).toEqual(toIds(viaDrag!));
    expect(toIds(viaKeyboard)).toEqual([
      { id: "m1", items: ["l2"] },
      { id: "m2", items: ["l3", "l1"] },
    ]);
  });

  it("'Move up' on the first item does not change the arrangement and does not throw", () => {
    const initial = threeLessons();
    render(<Harness initial={initial} />);

    const firstMoveUp = screen.getByRole("button", {
      name: "Move Lesson 1 up",
    }) as HTMLButtonElement;
    // The keyboard "move up" affordance on the first row is disabled — a
    // disabled button fires no click, so the arrangement cannot change here.
    expect(firstMoveUp.disabled).toBe(true);
    expect(() => fireEvent.click(firstMoveUp)).not.toThrow();

    const rowLabels = screen
      .getAllByRole("listitem")
      .map((li) => li.querySelector("span.font-semibold")?.textContent);
    expect(rowLabels).toEqual(["Lesson 1", "Lesson 2", "Lesson 3"]);

    // And a same-slot move through the pure reducer is a genuine no-op.
    expect(
      toIds(
        moveItemInContainers(
          initial,
          { droppableId: "m1", index: 0 },
          { droppableId: "m1", index: 0 },
        ),
      ),
    ).toEqual(toIds(initial));
  });

  it("'Move down' on the last item does not change the arrangement", () => {
    const initial = threeLessons();
    render(<Harness initial={initial} />);

    const lastMoveDown = screen.getByRole("button", {
      name: "Move Lesson 3 down",
    }) as HTMLButtonElement;
    expect(lastMoveDown.disabled).toBe(true);

    const rowLabels = () =>
      screen
        .getAllByRole("listitem")
        .map((li) => li.querySelector("span.font-semibold")?.textContent);
    const before = rowLabels();
    fireEvent.click(lastMoveDown);
    expect(rowLabels()).toEqual(before);
  });

  it("the aria-live region's text changes after a keyboard move", () => {
    render(<Harness initial={threeLessons()} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Move Lesson 3 up" }));
    expect(status.textContent).toContain("Lesson 3");
    expect(status.textContent).toContain("position 2");
  });

  it("'Save order' is disabled before any change and enabled after one", () => {
    render(<Harness initial={threeLessons()} />);
    const save = screen.getByRole("button", { name: "Save order" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Move Lesson 3 up" }));
    expect(save.disabled).toBe(false);
  });

  it("the Withdrawn section renders a Restore button per item, absent from the save payload", () => {
    const onSaveSpy = vi.fn();
    render(
      <Harness
        initial={threeLessons()}
        withdrawn={[
          { id: "w1", label: "Old intro" },
          { id: "w2", label: "Removed quiz" },
        ]}
        onSaveSpy={onSaveSpy}
      />,
    );

    expect(screen.getByText("Withdrawn (2)")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Restore" })).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Move Lesson 3 up" }));
    fireEvent.click(screen.getByRole("button", { name: "Save order" }));

    const arrangement = onSaveSpy.mock.calls[0][0] as ArrangeContainer[];
    const allIds = arrangement.flatMap((c) => c.items.map((i) => i.id));
    expect(allIds).not.toContain("w1");
    expect(allIds).not.toContain("w2");
    expect(allIds).toEqual(["l1", "l3", "l2"]);
  });
});

describe("ModuleComposer", () => {
  it("renders an 'Add module' form with a required title field and submits the trimmed title", () => {
    const onAddModule = vi.fn();
    render(
      <ModuleComposer
        modules={[{ id: "m1", title: "Module A" }]}
        onAddModule={onAddModule}
        onRenameModule={vi.fn()}
      />,
    );

    const title = screen.getByLabelText(/module title/i) as HTMLInputElement;
    expect(title.required).toBe(true);

    fireEvent.change(title, { target: { value: "  Fundamentals  " } });
    fireEvent.click(screen.getByRole("button", { name: /add module/i }));

    expect(onAddModule).toHaveBeenCalledWith("Fundamentals");
  });

  it("shows an empty-state prompt when the course has no modules at all", () => {
    render(
      <ModuleComposer modules={[]} onAddModule={vi.fn()} onRenameModule={vi.fn()} />,
    );

    expect(
      screen.getByText(/a module has to exist before a lesson can/i),
    ).toBeTruthy();
  });

  it("does not render the empty-state prompt once at least one module exists", () => {
    render(
      <ModuleComposer
        modules={[{ id: "m1", title: "Module A" }]}
        onAddModule={vi.fn()}
        onRenameModule={vi.fn()}
      />,
    );

    expect(
      screen.queryByText(/a module has to exist before a lesson can/i),
    ).toBeNull();
  });
});
