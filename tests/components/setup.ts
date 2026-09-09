import { configure } from "@testing-library/react";

// A Tiptap/ProseMirror mount is heavy, and the first editor test in a file also
// pays that module's import cost. Under a full-suite run — a dozen worker
// processes competing for the CPU — the default 1000ms async-query timeout is
// occasionally too tight for the toolbar to appear, so `findBy*` flakes. This
// only raises the ceiling; a query still resolves the moment its node exists.
configure({ asyncUtilTimeout: 5000 });

// jsdom implements no layout, so `Range.prototype.getClientRects` /
// `getBoundingClientRect` are absent. ProseMirror's `scrollToSelection` runs on
// every editor state change and, via a deferred `focus()` chain command, can
// fire after a test has torn its editor down — surfacing as an unhandled
// `TypeError: target.getClientRects is not a function`. Real browsers always
// have these, so inert stubs restore the environment rather than mask a defect.
if (typeof Range !== "undefined") {
  const emptyRectList = {
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  } as unknown as DOMRectList;

  if (typeof Range.prototype.getClientRects !== "function") {
    Range.prototype.getClientRects = () => emptyRectList;
  }
  if (typeof Range.prototype.getBoundingClientRect !== "function") {
    Range.prototype.getBoundingClientRect = () => new DOMRect();
  }
}
