import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType } from "react";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type RichTextEditorProps = {
  value: string;
  onChange: (html: string) => void;
};

async function loadRichTextEditor(): Promise<
  ComponentType<RichTextEditorProps>
> {
  const catalogue = await import("@/components/catalogue");
  const component = (catalogue as Record<string, unknown>).RichTextEditor;

  expect(
    component,
    "the catalogue module must export the planned RichTextEditor",
  ).toBeTypeOf("function");

  return component as ComponentType<RichTextEditorProps>;
}

describe("RichTextEditor", () => {
  it("renders exactly the seven D-29 authoring controls", async () => {
    const RichTextEditor = await loadRichTextEditor();
    render(<RichTextEditor value="<p>Lesson body</p>" onChange={() => {}} />);

    const buttons = await screen.findAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Bold",
      "Italic",
      "Heading 2",
      "Heading 3",
      "Bulleted list",
      "Numbered list",
      "Link",
    ]);
  });

  it("makes every toolbar control a non-submit toggle with pressed state", async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const RichTextEditor = await loadRichTextEditor();

    render(
      <form onSubmit={onSubmit}>
        <RichTextEditor value="<p>Lesson body</p>" onChange={() => {}} />
      </form>,
    );

    const buttons = await screen.findAllByRole("button");
    for (const button of buttons) {
      expect(button.getAttribute("type")).toBe("button");
      expect(["true", "false"]).toContain(
        button.getAttribute("aria-pressed"),
      );
    }

    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("cannot represent excluded headings, marks, or block nodes", async () => {
    const RichTextEditor = await loadRichTextEditor();
    const { container } = render(
      <RichTextEditor
        value={
          '<h1>Page title</h1><h2>Allowed</h2><blockquote>Quote</blockquote>' +
          '<pre><code>block</code></pre><p><s>strike</s><code>inline</code></p>' +
          '<hr><p style="color:red;font-size:40px;font-family:serif">Body</p>'
        }
        onChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector("[contenteditable='true']")).toBeTruthy();
    });

    expect(container.querySelector("h2")?.textContent).toBe("Allowed");
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("blockquote")).toBeNull();
    expect(container.querySelector("pre")).toBeNull();
    expect(container.querySelector("code")).toBeNull();
    expect(container.querySelector("s")).toBeNull();
    expect(container.querySelector("hr")).toBeNull();
    expect(container.querySelector("[style]")).toBeNull();
  });

  it("opens an accessible inline link editor without using a browser prompt", async () => {
    const prompt = vi.spyOn(window, "prompt");
    const RichTextEditor = await loadRichTextEditor();
    render(<RichTextEditor value="<p>Lesson body</p>" onChange={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Link" }));

    expect(prompt).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Link URL" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply link" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel link" })).toBeTruthy();
  });

  it("emits only the shared lesson-body allow-list after an edit", async () => {
    const onChange = vi.fn();
    const RichTextEditor = await loadRichTextEditor();
    render(
      <RichTextEditor
        value={
          '<p style="color:red">Body<script>alert(1)</script></p>' +
          '<iframe src="https://evil.example"></iframe>'
        }
        onChange={onChange}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Heading 2" }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const html = onChange.mock.calls.at(-1)?.[0] as string;
    expect(html).toContain("<h2>Body</h2>");
    expect(html).not.toMatch(/script|iframe|style=/i);
  });
});
