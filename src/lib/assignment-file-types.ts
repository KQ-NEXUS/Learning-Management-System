/**
 * The closed list of file extensions staff may permit for an Assignment
 * submission (ASM-03).
 *
 * A multi-select surface over a free-text field per `10-UI-SPEC.md` §7.1 —
 * the same closed-set discipline `src/lib/upload-limits.ts` already applies
 * to LessonResource uploads, kept in its own module because that table is
 * deliberately scoped to LessonType `FILE`/`IMAGE`/`VIDEO` and excludes
 * `QUIZ`/`ASSIGNMENT` (`10-RESEARCH.md`'s ASM-03 row: "These are
 * per-Assessment authored values, NOT looked up from the static
 * `UPLOAD_LIMITS` table"). Shared by `AssessmentFormFields.tsx`'s chip
 * picker and `actions.ts`'s zod validation so the authored UI and the
 * server-side check can never drift apart (T-10-13).
 */
export const ALLOWED_ASSIGNMENT_FILE_TYPES = Object.freeze([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  ".csv",
  ".zip",
  ".png",
  ".jpg",
  ".jpeg",
] as const);

export type AllowedAssignmentFileType = (typeof ALLOWED_ASSIGNMENT_FILE_TYPES)[number];
