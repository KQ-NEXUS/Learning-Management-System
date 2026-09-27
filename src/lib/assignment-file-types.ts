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

/**
 * F-08 — the content types a browser may legitimately report for each
 * permitted extension (keys without the leading dot). The declared type must
 * be one of these, so a learner can never store `report.pdf` as `text/html`
 * and have it served back to a grader with that type. Aliases cover what real
 * platforms send (Windows reports `.csv` as `application/vnd.ms-excel` and
 * `.zip` as `application/x-zip-compressed`).
 */
export const ASSIGNMENT_MIME_TYPES_BY_EXTENSION: Readonly<Record<string, readonly string[]>> = Object.freeze({
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ppt: ["application/vnd.ms-powerpoint"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  txt: ["text/plain"],
  csv: ["text/csv", "application/vnd.ms-excel", "text/plain"],
  zip: ["application/zip", "application/x-zip-compressed"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
});

/** F-08 — the size cap applied when an assignment does not set its own. */
export const DEFAULT_SUBMISSION_MAX_BYTES = 50 * 1024 * 1024;
