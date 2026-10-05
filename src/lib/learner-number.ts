/**
 * Learner numbers: the format (owner decisions, 2026-10-04).
 *
 * Learners were the one record in the app without a readable reference: an
 * order has ORD-…, a ticket KQT-…, a cohort its code, but a learner only a
 * name (not unique), an email (often unknown to staff) and an internal id
 * nobody can read out. A learner number fixes that.
 *
 * The school has not settled its format, so the format is a PATTERN an
 * administrator sets, and numbers are issued IN ORDER from one continuous
 * counter:
 *
 *   KQL-######        ->  KQL-000001, KQL-000002, …
 *   KQ/{YY}/#####     ->  KQ/26/00001, …
 *   {YYYY}-STU-####   ->  2026-STU-0001, …
 *
 * A pattern is fixed text plus:
 *   - one run of `#`: the counter, zero-padded to the run's width;
 *   - optionally `{YYYY}` or `{YY}`: the year the learner registered.
 *
 * The counter never restarts (not per year, not when the pattern changes), so
 * the same counter value is never issued twice. A number that outgrows its
 * width simply gets longer (KQL-999999 is followed by KQL-1000000) rather than
 * failing a registration.
 *
 * This module is pure: no database, no clock of its own.
 */

export const LEARNER_NUMBER_MAX_PATTERN_LENGTH = 40;
/** The narrowest counter allowed: `###` gives 999 numbers before it has to widen. */
export const LEARNER_NUMBER_MIN_COUNTER_WIDTH = 3;

const YEAR_TOKENS = ["{YYYY}", "{YY}"] as const;
/** Characters allowed as fixed text. Spaces are refused: a number must survive being typed or read aloud. */
const LITERAL = /^[A-Za-z0-9\-/_.]$/;

export type LearnerNumberPart =
  | { kind: "text"; value: string }
  | { kind: "year"; digits: 2 | 4 }
  | { kind: "counter"; width: number };

export type ParsedLearnerNumberPattern =
  | { ok: true; parts: LearnerNumberPart[]; counterWidth: number }
  | { ok: false; message: string };

/** Splits a pattern into its parts, or says in plain words why it cannot be used. */
export function parseLearnerNumberPattern(input: string): ParsedLearnerNumberPattern {
  const pattern = input.trim();
  if (!pattern) return { ok: false, message: "Enter a pattern, for example KQL-######." };
  if (pattern.length > LEARNER_NUMBER_MAX_PATTERN_LENGTH) {
    return { ok: false, message: `Keep the pattern to ${LEARNER_NUMBER_MAX_PATTERN_LENGTH} characters or fewer.` };
  }

  const parts: LearnerNumberPart[] = [];
  let counterWidth = 0;
  let text = "";
  const flushText = () => {
    if (text) parts.push({ kind: "text", value: text });
    text = "";
  };

  for (let index = 0; index < pattern.length; ) {
    const token = YEAR_TOKENS.find((candidate) => pattern.startsWith(candidate, index));
    if (token) {
      if (parts.some((part) => part.kind === "year")) return { ok: false, message: "Use the year only once in the pattern." };
      flushText();
      parts.push({ kind: "year", digits: token === "{YYYY}" ? 4 : 2 });
      index += token.length;
      continue;
    }

    const char = pattern[index];
    if (char === "#") {
      if (counterWidth > 0) {
        return { ok: false, message: "Put all the # signs together: the pattern can have only one counter." };
      }
      let width = 0;
      while (pattern[index + width] === "#") width++;
      flushText();
      parts.push({ kind: "counter", width });
      counterWidth = width;
      index += width;
      continue;
    }

    if (char === "{" || char === "}") {
      return { ok: false, message: "The only codes in braces are {YYYY} and {YY}, for the registration year." };
    }
    if (!LITERAL.test(char)) {
      return {
        ok: false,
        message:
          char === " "
            ? "A learner number cannot contain spaces. Use a dash or a slash instead."
            : `"${char}" cannot be used. Use letters, digits, and - / _ . only.`,
      };
    }
    text += char;
    index++;
  }
  flushText();

  if (counterWidth === 0) {
    return { ok: false, message: "Add a counter: a run of # signs, for example ###### for six digits." };
  }
  if (counterWidth < LEARNER_NUMBER_MIN_COUNTER_WIDTH) {
    return {
      ok: false,
      message: `Use at least ${LEARNER_NUMBER_MIN_COUNTER_WIDTH} # signs, so the number has room for more than a handful of learners.`,
    };
  }
  return { ok: true, parts, counterWidth };
}

/**
 * The learner number for counter value `sequence`, for a learner registering
 * at `at`. Throws for a pattern that does not parse: callers validate first.
 */
export function formatLearnerNumber(pattern: string, sequence: number, at: Date): string {
  const parsed = parseLearnerNumberPattern(pattern);
  if (!parsed.ok) throw new Error(`Invalid learner number pattern: ${parsed.message}`);
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error("A learner number counter starts at 1.");

  const year = String(at.getUTCFullYear());
  return parsed.parts
    .map((part) => {
      if (part.kind === "text") return part.value;
      if (part.kind === "year") return part.digits === 4 ? year : year.slice(-2);
      return String(sequence).padStart(part.width, "0");
    })
    .join("");
}

/** The next few numbers a pattern would issue, for the settings screen's preview. */
export function previewLearnerNumbers(pattern: string, nextSequence: number, at: Date, count = 3): string[] {
  if (!parseLearnerNumberPattern(pattern).ok) return [];
  return Array.from({ length: count }, (_, offset) => formatLearnerNumber(pattern, nextSequence + offset, at));
}

/** How many learners a pattern covers before its numbers have to grow longer. */
export function learnerNumberCapacity(pattern: string): number | null {
  const parsed = parseLearnerNumberPattern(pattern);
  return parsed.ok ? 10 ** parsed.counterWidth - 1 : null;
}
