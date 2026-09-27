import axe from "axe-core";

/**
 * Runs axe-core against a rendered container in jsdom and returns readable violations.
 * jsdom has no layout, so `color-contrast` is disabled; that check needs a real browser.
 */
export async function axeViolations(container: Element): Promise<string[]> {
  const results = await axe.run(container, {
    rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
  });
  return results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help} -> ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
}
