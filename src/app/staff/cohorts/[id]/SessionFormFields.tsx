"use client";

/**
 * The shared field block for both "Add session" and "Repeat weekly ×N"
 * (COH-03, D-22 / D-23 / D-24). A controlled component — the parent panel
 * (`SessionsTab`) owns the value and submits it to the matching Server
 * Action, so the same fields work for a single create and a repeat-weekly
 * batch without duplicating markup.
 *
 * D-23 — every date/time input is labelled with the cohort's own timezone in
 * mono, so what is entered is unambiguous. `ResourceForm`'s `FormField.label`
 * is a plain string (no JSX), so the zone label is rendered through a small
 * local wrapper rather than the shared primitive's label slot.
 */

import { FormField, TextInput } from "@/components/primitives";

export type SessionFieldsValue = {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  meetingUrl: string;
  linkVisibleFromMinutes: string;
  facilitatorId: string;
  attendanceExpected: boolean;
  courseId: string;
  /** Only read for the "repeat" variant. */
  occurrences: string;
};

export const EMPTY_SESSION_FIELDS: SessionFieldsValue = {
  title: "",
  date: "",
  startTime: "",
  endTime: "",
  location: "",
  meetingUrl: "",
  linkVisibleFromMinutes: "",
  facilitatorId: "",
  attendanceExpected: true,
  courseId: "",
  occurrences: "1",
};

/**
 * Builds the `session-actions.ts` payload from the current field values.
 * Deliberately kept here rather than in `SessionsTab.tsx`: the Sessions LIST
 * component must never spell out the meeting-link field name at all (D-25,
 * T-05-86's grep gate proves the list surface never touches it), while the
 * create/repeat FORM legitimately needs to capture it.
 */
export function toSessionActionFields(cohortId: string, fields: SessionFieldsValue) {
  return {
    cohortId,
    title: fields.title.trim(),
    date: fields.date,
    startTime: fields.startTime,
    endTime: fields.endTime,
    location: fields.location.trim() || undefined,
    meetingUrl: fields.meetingUrl.trim() || undefined,
    linkVisibleFromMinutes:
      fields.linkVisibleFromMinutes.trim() !== "" ? Number(fields.linkVisibleFromMinutes) : undefined,
    facilitatorId: fields.facilitatorId.trim() || undefined,
    attendanceExpected: fields.attendanceExpected,
    courseId: fields.courseId || undefined,
  };
}

/** "2026-10-05" and "09:00" for an instant, as read on a clock in `timeZone`. */
function wallParts(iso: string, timeZone: string): { date: string; time: string } {
  const at = new Date(iso);
  // en-CA formats a date as YYYY-MM-DD, which is what a date input holds.
  const date = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  return { date, time };
}

/**
 * The form's starting values when editing an existing session (audit A-11): its date and times as
 * read in the cohort's timezone, the way they were entered. The meeting link and its visibility
 * window start blank on purpose. The staff list never carries the link (D-25), and a blank field
 * on save means "leave it unchanged".
 */
export function sessionFieldsFromRow(row: {
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  location: string | null;
  facilitatorId: string | null;
  attendanceExpected: boolean;
  courseId: string | null;
}): SessionFieldsValue {
  const zone = row.timezone || "UTC";
  const start = wallParts(row.startsAt, zone);
  const end = wallParts(row.endsAt, zone);
  return {
    ...EMPTY_SESSION_FIELDS,
    title: row.title,
    date: start.date,
    startTime: start.time,
    endTime: end.time,
    location: row.location ?? "",
    facilitatorId: row.facilitatorId ?? "",
    attendanceExpected: row.attendanceExpected,
    courseId: row.courseId ?? "",
  };
}

export type SessionFormFieldsProps = {
  variant: "single" | "repeat";
  /** Editing an existing session: the meeting link field says a blank value keeps the current link. */
  editing?: boolean;
  value: SessionFieldsValue;
  onChange: (next: SessionFieldsValue) => void;
  cohortTimezone: string;
  /** Present only for a Programme cohort (D-24) — omitted/[] for a Course cohort. */
  courseOptions?: { id: string; title: string }[];
  errors?: Record<string, string>;
};

/** A field label with the cohort's IANA zone appended in mono (D-23). */
function ZonedLabel({ label, timezone }: { label: string; timezone: string }) {
  return (
    <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
      <span className="font-mono text-xs font-normal normal-case tracking-normal text-muted-foreground">
        {timezone}
      </span>
    </span>
  );
}

export function SessionFormFields({
  variant,
  editing = false,
  value,
  onChange,
  cohortTimezone,
  courseOptions,
  errors = {},
}: SessionFormFieldsProps) {
  function set<K extends keyof SessionFieldsValue>(key: K, next: SessionFieldsValue[K]) {
    onChange({ ...value, [key]: next });
  }

  const occurrencesNumber = Number.parseInt(value.occurrences, 10);
  const repeatHint =
    variant === "repeat" && value.date && Number.isInteger(occurrencesNumber) && occurrencesNumber > 0
      ? `Creates ${occurrencesNumber} session${occurrencesNumber === 1 ? "" : "s"}, weekly from ${value.date}.`
      : undefined;

  return (
    <div className="flex flex-col gap-4">
      <FormField name="title" label="Title" required error={errors.title}>
        {(field) => (
          <TextInput
            {...field}
            type="text"
            required
            maxLength={200}
            value={value.title}
            onChange={(e) => set("title", e.target.value)}
          />
        )}
      </FormField>

      <div className="flex flex-col gap-1">
        <label htmlFor="session-date">
          <ZonedLabel label="Date" timezone={cohortTimezone} />
        </label>
        <TextInput
          id="session-date"
          name="date"
          type="date"
          required
          mono
          value={value.date}
          onChange={(e) => set("date", e.target.value)}
          aria-invalid={errors.date ? true : undefined}
        />
        {errors.date && (
          <p role="alert" className="text-sm text-danger">
            {errors.date}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="session-start-time">
            <ZonedLabel label="Start" timezone={cohortTimezone} />
          </label>
          <TextInput
            id="session-start-time"
            name="startTime"
            type="time"
            required
            mono
            value={value.startTime}
            onChange={(e) => set("startTime", e.target.value)}
            aria-invalid={errors.startTime ? true : undefined}
          />
          {errors.startTime && (
            <p role="alert" className="text-sm text-danger">
              {errors.startTime}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="session-end-time">
            <ZonedLabel label="End" timezone={cohortTimezone} />
          </label>
          <TextInput
            id="session-end-time"
            name="endTime"
            type="time"
            required
            mono
            value={value.endTime}
            onChange={(e) => set("endTime", e.target.value)}
            aria-invalid={errors.endTime ? true : undefined}
          />
          {errors.endTime && (
            <p role="alert" className="text-sm text-danger">
              {errors.endTime}
            </p>
          )}
        </div>
      </div>

      <FormField name="location" label="Location" error={errors.location}>
        {(field) => (
          <TextInput
            {...field}
            type="text"
            maxLength={200}
            value={value.location}
            onChange={(e) => set("location", e.target.value)}
          />
        )}
      </FormField>

      <FormField
        name="meetingUrl"
        label="Meeting URL"
        error={errors.meetingUrl}
        hint={
          editing
            ? "Leave blank to keep the current meeting link. Enter a new one to replace it."
            : "The meeting link appears {n} minutes before the session starts — never shown in the sessions list."
        }
      >
        {(field) => (
          <TextInput
            {...field}
            type="url"
            maxLength={500}
            value={value.meetingUrl}
            onChange={(e) => set("meetingUrl", e.target.value)}
          />
        )}
      </FormField>

      <FormField
        name="linkVisibleFromMinutes"
        label="Link visible from (minutes before start)"
        error={errors.linkVisibleFromMinutes}
        hint="Default 60."
      >
        {(field) => (
          <TextInput
            {...field}
            type="number"
            min={0}
            step={1}
            mono
            value={value.linkVisibleFromMinutes}
            onChange={(e) => set("linkVisibleFromMinutes", e.target.value)}
          />
        )}
      </FormField>

      <FormField name="facilitatorId" label="Facilitator (user id)" error={errors.facilitatorId}>
        {(field) => (
          <TextInput
            {...field}
            type="text"
            value={value.facilitatorId}
            onChange={(e) => set("facilitatorId", e.target.value)}
          />
        )}
      </FormField>

      {courseOptions && courseOptions.length > 0 && (
        <FormField
          name="courseId"
          label="Member course (optional)"
          error={errors.courseId}
          hint="Tag this session to one of the programme's member courses."
        >
          {(field) => (
            <select
              {...field}
              value={value.courseId}
              onChange={(e) => set("courseId", e.target.value)}
              className="rounded-md border border-input-border bg-surface px-4 py-2 text-sm text-foreground"
            >
              <option value="">No course tag</option>
              {courseOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          )}
        </FormField>
      )}

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={value.attendanceExpected}
          onChange={(e) => set("attendanceExpected", e.target.checked)}
          className="size-3.5 accent-accent"
        />
        Attendance expected
      </label>

      {variant === "repeat" && (
        <FormField
          name="occurrences"
          label="Occurrences"
          required
          error={errors.occurrences}
          hint={repeatHint ?? "How many weekly sessions to create (1–52)."}
        >
          {(field) => (
            <TextInput
              {...field}
              type="number"
              min={1}
              max={52}
              step={1}
              required
              mono
              value={value.occurrences}
              onChange={(e) => set("occurrences", e.target.value)}
            />
          )}
        </FormField>
      )}
    </div>
  );
}
