/**
 * Derives an avatar's initials + accessible label from a name/email pair.
 *
 * PURE MODULE. Extracted from `src/app/account/layout.tsx` (09-08 Task 1) so
 * the initials rule cannot drift between the two learner-facing shells that
 * now both need it: the account layout and the `(learner)` route-group
 * layout (`/dashboard`, `/learn/*`). Behaviour is unchanged from the
 * original inline helper.
 *
 * When a display name exists it wins outright. When it does not, initials
 * come from the email local-part (first char, uppercased, plus the first
 * char of a second `.`/`_`/`-`-delimited segment if one exists) and the
 * email itself fills the label slot.
 */
export function deriveAvatarDisplay(
  identity: { name: string; email: string } | null,
): { initials: string; label: string } | null {
  if (!identity) return null;
  const trimmedName = identity.name.trim();
  if (trimmedName) {
    const words = trimmedName.split(/\s+/).filter(Boolean);
    const initials =
      words.length > 1
        ? `${words[0][0]}${words[1][0]}`.toUpperCase()
        : words[0].slice(0, 2).toUpperCase();
    return { initials, label: trimmedName };
  }
  const local = identity.email.split("@")[0] ?? "";
  const segments = local.split(/[._-]/).filter(Boolean);
  const initials = `${segments[0]?.[0] ?? ""}${segments[1]?.[0] ?? ""}`.toUpperCase();
  return { initials, label: identity.email };
}
