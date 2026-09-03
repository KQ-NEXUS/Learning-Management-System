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
