/**
 * A web address made from a title: lowercase letters, numbers and single hyphens,
 * at most 120 characters (the slug field's own limit). "Workplace Safety: Level 1!"
 * becomes "workplace-safety-level-1".
 */
export function slugFromTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
}
