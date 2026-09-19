/**
 * Plan 11-12: TemplateCanvas (Task 1), ElementInspector (Task 2), and the
 * image-element upload flow (Task 3).
 *
 * Lives under tests/components/ — vitest.config.mts's "components" jsdom
 * project only picks up tests/components/**\/*.test.tsx.
 *
 * Covers:
 *
 *   1. `TemplateCanvas` in isolation, via a small controlled `Harness` that
 *      owns `elements`/`selectedIndex` state (the same shape
 *      `TemplateEditorShell` owns) — keyboard-only nudge/Shift-nudge/delete,
 *      dynamic-field sample values, accessible names, `readOnly`'s
 *      no-handles/no-delete guarantee, pointer-drag clamping, and the
 *      scale-independence of keyboard nudge (page units, never scaled
 *      screen pixels).
 *   2. `ElementInspector` through the real `TemplateEditorShell` — the SAME
 *      integration style `certificate-templates.test.tsx` already
 *      establishes for this editor (a real click-to-add plus real state,
 *      not a mocked shell) — two-way binding, the field-type-switch
 *      `literal`-clearing invariant (proven against the real
 *      `parseCertificateTemplateLayout`), accessible labels, exact UI-SPEC
 *      copy, and the negative-Width input-boundary clamp.
 *   3. The image-upload flow's UI reaction to `template-asset-actions.ts`
 *      (mocked here — its own server-side behaviour is covered by grep
 *      gates and code review, not a jsdom test) — the Save-blocking guard
 *      for an unattached image element, and the upload control's `danger`
 *      state with a retry affordance on a failed upload.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TemplateCanvas, PENDING_UPLOAD_ASSET_KEY } from "@/app/staff/certificates/templates/TemplateCanvas";
import { TemplateEditorShell } from "@/app/staff/certificates/templates/TemplateEditorShell";
import {
  parseCertificateTemplateLayout,
  EMPTY_LAYOUT_V1,
  type CertificateElementV1,
} from "@/server/services/certificate-template-layout";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/app/staff/certificates/templates/template-asset-actions", () => ({
  presignTemplateAssetUploadAction: vi.fn(),
  confirmTemplateAssetUploadAction: vi.fn(),
}));

import {
  presignTemplateAssetUploadAction,
  confirmTemplateAssetUploadAction,
} from "@/app/staff/certificates/templates/template-asset-actions";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function customTextElement(overrides: Partial<Extract<CertificateElementV1, { kind: "text" }>> = {}) {
  return {
    kind: "text" as const,
    field: "literal" as const,
    literal: "New text",
    x: 10,
    y: 10,
    width: 200,
    height: 40,
    fontSize: 18,
    color: "#111827",
    align: "left" as const,
    ...overrides,
  };
}

function learnerNameElement(overrides: Partial<Extract<CertificateElementV1, { kind: "text" }>> = {}) {
  return {
    kind: "text" as const,
    field: "learnerName" as const,
    x: 10,
    y: 10,
    width: 200,
    height: 40,
    fontSize: 18,
    color: "#111827",
    align: "left" as const,
    ...overrides,
  };
}

function imageElement(overrides: Partial<Extract<CertificateElementV1, { kind: "image" }>> = {}) {
  return {
    kind: "image" as const,
    assetKey: PENDING_UPLOAD_ASSET_KEY,
    x: 10,
    y: 10,
    width: 150,
    height: 100,
    ...overrides,
  };
}

function borderElement(overrides: Partial<Extract<CertificateElementV1, { kind: "border" }>> = {}) {
  return {
    kind: "border" as const,
    style: "solid" as const,
    color: "#111827",
    widthPt: 2,
    ...overrides,
  };
}

/** A controlled wrapper mirroring the exact shape `TemplateEditorShell`
 * itself owns (`elements`/`selectedIndex` state, one `onChange` write path) —
 * so `TemplateCanvas` is exercised as the real controlled component it is,
 * not as if it owned its own state. */
function Harness({
  initialElements,
  readOnly = false,
  onChangeSpy,
  initialSelectedIndex = null,
}: {
  initialElements: CertificateElementV1[];
  readOnly?: boolean;
  onChangeSpy?: (elements: CertificateElementV1[]) => void;
  initialSelectedIndex?: number | null;
}) {
  const [elements, setElements] = useState(initialElements);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(initialSelectedIndex);
  return (
    <TemplateCanvas
      elements={elements}
      selectedIndex={selectedIndex}
      pageSize="A4"
      orientation="landscape"
      readOnly={readOnly}
      onChange={(next) => {
        onChangeSpy?.(next);
        setElements(next);
      }}
      onSelect={setSelectedIndex}
    />
  );
}

// ---------------------------------------------------------------------------
// Task 1 — TemplateCanvas
// ---------------------------------------------------------------------------

describe("TemplateCanvas", () => {
  it("moves the focused element by 1 page unit on ArrowRight, 10 on Shift+ArrowRight, and deletes it on Delete with no modal", () => {
    render(<Harness initialElements={[customTextElement({ x: 10, y: 10 })]} />);

    const box = screen.getByRole("group", { name: "Text element: custom text" });
    box.focus();

    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.keyDown(box, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(box, { key: "Delete" });

    expect(screen.queryByRole("group", { name: "Text element: custom text" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Add an element to begin designing this certificate.")).toBeTruthy();
  });

  it("moves by exactly 1 page unit on ArrowRight and exactly 10 on Shift+ArrowRight (measured via onChange)", () => {
    const onChangeSpy = vi.fn();
    render(<Harness initialElements={[customTextElement({ x: 10, y: 10 })]} onChangeSpy={onChangeSpy} />);
    const box = screen.getByRole("group", { name: "Text element: custom text" });

    fireEvent.keyDown(box, { key: "ArrowRight" });
    expect(onChangeSpy.mock.calls.at(-1)![0][0].x).toBe(11);

    fireEvent.keyDown(box, { key: "ArrowRight", shiftKey: true });
    expect(onChangeSpy.mock.calls.at(-1)![0][0].x).toBe(21);

    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(onChangeSpy.mock.calls.at(-1)![0][0].y).toBe(11);
  });

  it("renders a learnerName element's sample value and never the raw field token", () => {
    const { container } = render(<Harness initialElements={[learnerNameElement()]} />);

    expect(screen.getByText("Jordan Example")).toBeTruthy();
    expect(screen.queryByText(/learnerName/)).toBeNull();
    expect(container.innerHTML).not.toContain("learnerName");
  });

  it("gives every element kind a queryable accessible name", () => {
    render(
      <Harness
        initialElements={[customTextElement(), imageElement(), borderElement()]}
      />,
    );

    expect(screen.getByRole("group", { name: "Text element: custom text" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Image element" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Border" })).toBeTruthy();
  });

  it("renders no delete control and no resize handles in readOnly mode, even for a nominally-selected element", () => {
    render(
      <Harness initialElements={[customTextElement()]} readOnly initialSelectedIndex={0} />,
    );

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("clamps a drag that would move an element fully off the page", () => {
    const onChangeSpy = vi.fn();
    render(
      <Harness
        initialElements={[customTextElement({ x: 10, y: 10, width: 200, height: 40 })]}
        onChangeSpy={onChangeSpy}
      />,
    );
    const box = screen.getByRole("group", { name: "Text element: custom text" });

    fireEvent.pointerDown(box, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(box, { pointerId: 1, clientX: 1_000_000, clientY: 1_000_000 });
    fireEvent.pointerUp(box, { pointerId: 1 });

    const last = onChangeSpy.mock.calls.at(-1)![0][0];
    // A4 landscape page is 841.89 x 595.28pt — the element (200x40) must stay
    // fully inside, never dragged fully off no matter how large the pointer
    // delta was.
    expect(last.x).toBeCloseTo(841.89 - 200, 5);
    expect(last.y).toBeCloseTo(595.28 - 40, 5);
  });

  it("emits the identical page-unit delta for the same keyboard nudge regardless of the container's rendered width", () => {
    function nudgeDelta(containerWidthPx: number): number {
      const original = HTMLElement.prototype.getBoundingClientRect;
      HTMLElement.prototype.getBoundingClientRect = function stub(this: HTMLElement) {
        const real = original.call(this);
        return { ...real, width: containerWidthPx } as DOMRect;
      };
      const onChangeSpy = vi.fn();
      render(<Harness initialElements={[customTextElement({ x: 10 })]} onChangeSpy={onChangeSpy} />);
      const box = screen.getByRole("group", { name: "Text element: custom text" });
      fireEvent.keyDown(box, { key: "ArrowRight" });
      HTMLElement.prototype.getBoundingClientRect = original;
      const delta = onChangeSpy.mock.calls.at(-1)![0][0].x - 10;
      cleanup();
      return delta;
    }

    expect(nudgeDelta(300)).toBe(1);
    expect(nudgeDelta(1200)).toBe(1);
  });

  // UAT test 4 (plan 11-21): the uploaded logo is a plain <img> that the
  // browser natively drags, cancelling the editor's pointer drag. jsdom has no
  // native image drag, so these DOM-contract assertions (not a simulated
  // drag) are what reproduce the gap.
  describe("drag safety (UAT test 4)", () => {
    const ASSET_KEY = "template-assets/logo.png";
    function renderWithImage(onChangeSpy?: (els: CertificateElementV1[]) => void) {
      const elements: CertificateElementV1[] = [imageElement({ assetKey: ASSET_KEY, x: 20, y: 20 })];
      function ImageHarness() {
        const [els, setEls] = useState(elements);
        const [selected, setSelected] = useState<number | null>(null);
        return (
          <TemplateCanvas
            elements={els}
            selectedIndex={selected}
            pageSize="A4"
            orientation="landscape"
            readOnly={false}
            assetPreviewUrls={{ [ASSET_KEY]: "blob:test-preview" }}
            onChange={(next) => {
              onChangeSpy?.(next);
              setEls(next);
            }}
            onSelect={setSelected}
          />
        );
      }
      return render(<ImageHarness />);
    }

    it("renders the preview image non-draggable and pointer-transparent", () => {
      const { container } = renderWithImage();
      const img = container.querySelector("img")!;
      expect(img.getAttribute("draggable")).toBe("false");
      expect(img.className).toContain("pointer-events-none");
      expect(img.className).toContain("select-none");
    });

    it("cancels native dragstart on both the image and its element box", () => {
      const { container } = renderWithImage();
      const img = container.querySelector("img")!;
      const box = screen.getByRole("group", { name: "Image element" });
      // fireEvent returns false when the event was default-prevented.
      expect(fireEvent.dragStart(img)).toBe(false);
      expect(fireEvent.dragStart(box)).toBe(false);
    });

    it("gives every interactive element box select-none and touch-none", () => {
      render(<Harness initialElements={[customTextElement(), imageElement(), borderElement()]} />);
      for (const name of ["Text element: custom text", "Image element", "Border"]) {
        const box = screen.getByRole("group", { name });
        expect(box.className).toContain("select-none");
        expect(box.className).toContain("touch-none");
      }
    });

    it("adds no drag-safety handlers or classes to a readOnly canvas", () => {
      const { container } = render(
        <Harness initialElements={[customTextElement(), borderElement()]} readOnly />,
      );
      expect(container.innerHTML).not.toContain("touch-none");
      expect(container.innerHTML).not.toContain("select-none");
    });

    // Regression GUARD only: passes both before and after the fix in jsdom
    // (no native image drag exists there). The DOM-contract tests above are
    // the ones that fail against the old markup.
    it("moves an image element by the pointer distance (guard, not a browser repro)", () => {
      const onChangeSpy = vi.fn();
      renderWithImage(onChangeSpy);
      const box = screen.getByRole("group", { name: "Image element" });
      fireEvent.pointerDown(box, { pointerId: 1, clientX: 0, clientY: 0 });
      fireEvent.pointerMove(box, { pointerId: 1, clientX: 100, clientY: 0 });
      fireEvent.pointerUp(box, { pointerId: 1 });
      expect(onChangeSpy.mock.calls.at(-1)![0][0].x).toBe(120);
    });
  });

  it("imports no drag/canvas library", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(process.cwd(), "src/app/staff/certificates/templates/TemplateCanvas.tsx"),
      "utf8",
    );
    expect(/hello-pangea|react-dnd|dnd-kit|fabric|konva/.test(source)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task 2 — ElementInspector, exercised through the real TemplateEditorShell
// ---------------------------------------------------------------------------

// The Properties panel (like the Elements palette) renders TWICE —
// TemplateEditorShell's own responsive `<details>` (mobile) plus `<aside>`
// (lg+) duplicate — jsdom computes no media queries, so both are in the DOM
// at once (the same reasoning `certificate-templates.test.tsx` documents).
// Every inspector query below takes the FIRST match; firing a change event
// on it updates the one shared `elements` state both copies render from.
describe("ElementInspector (via TemplateEditorShell)", () => {
  it("binds X two-way: typing in the inspector moves the canvas element, and nudging on the canvas updates the inspector", () => {
    render(<TemplateEditorShell initial={{ name: "Draft", layout: EMPTY_LAYOUT_V1, readOnly: false }} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Text" })[0]);
    const xInput = screen.getAllByLabelText("X")[0] as HTMLInputElement;
    const box = screen.getByRole("group", { name: "Text element: custom text" });

    // Inspector -> canvas: typing a new X, then nudging on the canvas, must
    // move from the TYPED value (proving the write landed in shared state).
    fireEvent.change(xInput, { target: { value: "50" } });
    fireEvent.keyDown(box, { key: "ArrowRight" });
    expect(xInput.value).toBe("51");

    // Canvas -> inspector: nudging again updates the SAME input.
    fireEvent.keyDown(box, { key: "ArrowRight", shiftKey: true });
    expect(xInput.value).toBe("61");
  });

  it("clears `literal` when switching a text element's field type off Custom text, and the emitted element passes the real parser", async () => {
    const onCreate = vi.fn().mockResolvedValue({ ok: true, id: "tpl-new" });
    render(
      <TemplateEditorShell
        initial={{ name: "Draft template", layout: EMPTY_LAYOUT_V1, readOnly: false }}
        onCreate={onCreate}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Text" })[0]);
    fireEvent.change(screen.getAllByLabelText("Field type")[0], { target: { value: "learnerName" } });

    const save = screen.getByRole("button", { name: "Save template" });
    fireEvent.click(save);

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const layout = onCreate.mock.calls[0][0].layout;
    const parsed = parseCertificateTemplateLayout(layout);
    expect(parsed.elements).toHaveLength(1);
    expect(parsed.elements[0]).toMatchObject({ kind: "text", field: "learnerName" });
    expect("literal" in parsed.elements[0]).toBe(false);
  });

  it("renders the exact dynamic-field caption copy from UI-SPEC §7.3.5", () => {
    render(<TemplateEditorShell initial={{ name: "Draft", layout: EMPTY_LAYOUT_V1, readOnly: false }} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Text" })[0]);
    fireEvent.change(screen.getAllByLabelText("Field type")[0], { target: { value: "awardTitle" } });

    expect(
      screen.getAllByText("This will be replaced with the learner's actual award title when issued.").length,
    ).toBeGreaterThan(0);
  });

  it("gives every inspector input an accessible label", () => {
    render(<TemplateEditorShell initial={{ name: "Draft", layout: EMPTY_LAYOUT_V1, readOnly: false }} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Text" })[0]);
    expect(screen.getAllByLabelText("X").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Y").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Width").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Height").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Field type").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Font size").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Color").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("group", { name: "Alignment" }).length).toBeGreaterThan(0);
  });

  it("does not let a negative Width typed into the inspector reach the underlying element", () => {
    render(<TemplateEditorShell initial={{ name: "Draft", layout: EMPTY_LAYOUT_V1, readOnly: false }} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Text" })[0]);
    const widthInput = screen.getAllByLabelText("Width")[0] as HTMLInputElement;
    expect(widthInput.value).toBe("200");

    fireEvent.change(widthInput, { target: { value: "-5" } });

    expect(widthInput.value).toBe("200");
  });

  it("shows only the empty-inspector placeholder when nothing is selected, and the border-only fields when a border is selected", () => {
    render(<TemplateEditorShell initial={{ name: "Draft", layout: EMPTY_LAYOUT_V1, readOnly: false }} />);
    expect(screen.getAllByText("Select an element to edit its properties.").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: "Border" })[0]);
    expect(screen.getAllByLabelText("Style").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Width (pt)").length).toBeGreaterThan(0);
    // A border has no x/y/width/height in the schema — no X/Y/Height fields render for it.
    expect(screen.queryAllByLabelText("X")).toHaveLength(0);
    expect(screen.queryAllByLabelText("Height")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Task 3 — image-element asset upload
// ---------------------------------------------------------------------------

describe("Image-element asset upload", () => {
  it("blocks Save with an inline message when an image element has no real asset attached, and never calls onCreate", async () => {
    const onCreate = vi.fn();
    render(
      <TemplateEditorShell
        initial={{ name: "Draft", layout: EMPTY_LAYOUT_V1, readOnly: false }}
        onCreate={onCreate}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Image" })[0]);
    const save = screen.getByRole("button", { name: "Save template" });
    expect((save as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(save);

    expect(await screen.findByText("Attach an image to every image element before saving.")).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("offers only PNG and JPEG in the image file picker (the renderer embeds nothing else)", () => {
    render(<TemplateEditorShell initial={{ name: "Draft", layout: EMPTY_LAYOUT_V1, readOnly: false }} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Image" })[0]);

    const fileInput = screen.getAllByLabelText("Image")[0] as HTMLInputElement;
    expect(fileInput.getAttribute("accept")).toBe("image/png,image/jpeg");
  });

  it("surfaces the danger state with a Retry affordance when the upload fails", async () => {
    vi.mocked(presignTemplateAssetUploadAction).mockResolvedValue({
      ok: false,
      message: "This upload could not be started. Reload the page and try again.",
    });

    render(<TemplateEditorShell initial={{ name: "Draft", layout: EMPTY_LAYOUT_V1, readOnly: false }} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Image" })[0]);

    // Two `ElementInspector` instances mount (the responsive details/aside
    // duplicate) but each owns its OWN local upload state — only the
    // instance whose file input actually fired shows the failure, so every
    // assertion below stays scoped to `[0]`, the instance under test.
    const fileInput = screen.getAllByLabelText("Image")[0] as HTMLInputElement;
    const file = new File(["fake-bytes"], "logo.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(screen.getAllByText("Upload failed").length).toBeGreaterThan(0));
    const retry = screen.getAllByRole("button", { name: "Retry" })[0];
    expect(retry).toBeTruthy();
    expect(
      screen.getAllByText("This upload could not be started. Reload the page and try again.").length,
    ).toBeGreaterThan(0);

    expect(confirmTemplateAssetUploadAction).not.toHaveBeenCalled();

    // Retry re-attempts the same file through the same flow.
    vi.mocked(presignTemplateAssetUploadAction).mockResolvedValue({
      ok: true,
      stagedKey: "certificate-template-asset-uploads/draft/staged-1",
      uploadUrl: "https://storage.example/staged-1",
      expiresIn: 900,
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(confirmTemplateAssetUploadAction).mockResolvedValue({
      ok: true,
      assetKey: "certificate-template-assets/draft/final-1",
    });

    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText("Uploaded")).toBeTruthy());
  });
});
