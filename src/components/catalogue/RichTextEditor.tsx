"use client";

import { useMemo, useState } from "react";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { sanitizeLessonBody } from "@/lib/sanitize";

export type RichTextEditorProps = {
  value: string;
  onChange: (html: string) => void;
  /**
   * Applied to the actual ProseMirror editable textbox (not a wrapper), so a
   * form error summary can link straight to the focusable control and a screen
   * reader announces the error when the editor takes focus (WR-03, NFR-09).
   */
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

const EMPTY_ACTIVE_STATE = {
  bold: false,
  italic: false,
  heading2: false,
  heading3: false,
  bulletList: false,
  orderedList: false,
  link: false,
};

function isAllowedLink(value: string): boolean {
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function RichTextEditor({
  value,
  onChange,
  id,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedby,
}: RichTextEditorProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  // Attributes land on the ProseMirror editable node itself. A stable
  // reference means Tiptap re-applies them only when the wiring actually
  // changes, but a change *does* propagate because the object identity flips.
  const editorProps = useMemo(() => {
    const attributes: Record<string, string> = { "aria-label": "Lesson body" };
    if (id) attributes.id = id;
    if (ariaInvalid) attributes["aria-invalid"] = "true";
    if (ariaDescribedby) attributes["aria-describedby"] = ariaDescribedby;
    return { attributes };
  }, [id, ariaInvalid, ariaDescribedby]);

  const editor = useEditor({
    immediatelyRender: false,
    editorProps,
    // This array IS the D-29 allow-list. Adding an extension widens what
    // staff can produce and must be reconciled with src/lib/sanitize.ts.
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        code: false,
        strike: false,
        underline: false,
        hardBreak: false,
        link: {
          openOnClick: false,
          protocols: ["http", "https", "mailto"],
        },
      }),
      Placeholder.configure({
        placeholder: "Start writing the lesson content…",
      }),
    ],
    content: sanitizeLessonBody(value),
    onUpdate: ({ editor: currentEditor }) => {
      onChange(sanitizeLessonBody(currentEditor.getHTML()));
    },
  });

  const selectedState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      bold: currentEditor?.isActive("bold") ?? false,
      italic: currentEditor?.isActive("italic") ?? false,
      heading2: currentEditor?.isActive("heading", { level: 2 }) ?? false,
      heading3: currentEditor?.isActive("heading", { level: 3 }) ?? false,
      bulletList: currentEditor?.isActive("bulletList") ?? false,
      orderedList: currentEditor?.isActive("orderedList") ?? false,
      link: currentEditor?.isActive("link") ?? false,
    }),
  });
  const active = selectedState ?? EMPTY_ACTIVE_STATE;

  const controls = [
    {
      label: "Bold",
      pressed: active.bold,
      run: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      label: "Italic",
      pressed: active.italic,
      run: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      label: "Heading 2",
      pressed: active.heading2,
      run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "Heading 3",
      pressed: active.heading3,
      run: () => editor?.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      label: "Bulleted list",
      pressed: active.bulletList,
      run: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      pressed: active.orderedList,
      run: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Link",
      pressed: active.link,
      run: () => {
        setLinkUrl(editor?.getAttributes("link").href ?? "");
        setLinkError(null);
        setLinkOpen(true);
      },
    },
  ];

  function applyLink() {
    if (!editor) return;
    const href = linkUrl.trim();

    if (!href) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setLinkOpen(false);
      return;
    }

    if (!isAllowedLink(href)) {
      setLinkError("Use an http, https, or mailto address.");
      return;
    }

    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkOpen(false);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <div
        role="toolbar"
        aria-label="Lesson formatting"
        className="flex flex-wrap gap-1 border-b border-border bg-surface-2 p-2"
      >
        {controls.map((control) => (
          <button
            key={control.label}
            type="button"
            aria-label={control.label}
            aria-pressed={control.pressed}
            disabled={!editor}
            onClick={control.run}
            className="rounded-md border border-input-border bg-surface px-2 py-1 text-xs font-semibold text-foreground hover:bg-surface-2 aria-pressed:border-accent aria-pressed:bg-surface aria-pressed:text-accent aria-pressed:shadow-xs disabled:opacity-50"
          >
            {control.label}
          </button>
        ))}
      </div>

      {linkOpen && (
        <div
          role="group"
          aria-label="Edit link"
          className="flex flex-col gap-2 border-b border-border bg-surface-2 p-2"
        >
          <label htmlFor="lesson-link-url" className="text-xs font-semibold text-foreground">
            Link URL
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="lesson-link-url"
              type="url"
              value={linkUrl}
              aria-invalid={linkError ? true : undefined}
              aria-describedby={linkError ? "lesson-link-error" : undefined}
              onChange={(event) => setLinkUrl(event.target.value)}
              className="min-w-64 flex-1 rounded-md border border-input-border bg-surface px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground aria-[invalid=true]:border-danger"
              placeholder="https://example.com"
            />
            <button
              type="button"
              onClick={applyLink}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-contrast shadow-[0_6px_18px_var(--accent-glow)] hover:opacity-90"
            >
              Apply link
            </button>
            <button
              type="button"
              onClick={() => setLinkOpen(false)}
              className="rounded-md border border-input-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-surface-2"
            >
              Cancel link
            </button>
          </div>
          {linkError && (
            <p id="lesson-link-error" role="alert" className="text-xs text-danger">
              {linkError}
            </p>
          )}
        </div>
      )}

      <EditorContent
        editor={editor}
        aria-label="Lesson body"
        className="min-h-48 px-3 py-2 text-sm text-foreground [&_.ProseMirror.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror.is-editor-empty:first-child::before]:float-left [&_.ProseMirror.is-editor-empty:first-child::before]:h-0 [&_.ProseMirror.is-editor-empty:first-child::before]:text-muted-foreground [&_.ProseMirror.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror]:min-h-40 [&_.ProseMirror]:outline-none"
      />
    </div>
  );
}
