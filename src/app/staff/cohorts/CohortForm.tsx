"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ResourceForm, FormField, TextInput } from "@/components/primitives";
import {
  createCohortAction,
  updateCohortAction,
  type CohortActionResult,
} from "./actions";

const INITIAL: CohortActionResult = { ok: false, errors: [], message: null };

const DELIVERY_OPTIONS = [
  { value: "SELF_PACED", label: "Self-paced" },
  { value: "INSTRUCTOR_LED", label: "Instructor-led" },
  { value: "BLENDED", label: "Blended" },
];

/**
 * `Intl.supportedValuesOf("timeZone")` returns a different list under Node than
 * under the browser (the IANA db moves between engine versions), so building the
 * `<option>`s from it at module load produced a hydration mismatch. The server
 * and the hydrating client both render this small fixed set; the full list is
 * swapped in on the client via `useSyncExternalStore` (below), which never
 * touches the server render.
 */
const FALLBACK_TIMEZONES = ["Africa/Lagos", "Africa/Accra", "Africa/Nairobi", "Europe/London", "UTC"];

let fullTimezonesCache: string[] | null = null;
function fullTimezones(): string[] {
  fullTimezonesCache ??=
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : FALLBACK_TIMEZONES;
  return fullTimezonesCache;
}

const NO_SUBSCRIBE = () => () => {};

/** Keep the current value selectable even if it is not in the list yet. */
function withValue(zones: string[], current: string): string[] {
  return zones.includes(current) ? zones : [current, ...zones];
}

export type OfferOption = { id: string; title: string };

export type Values = {
  code?: string;
  title?: string;
  offerKind?: "COURSE" | "PROGRAMME";
  courseId?: string;
  programmeId?: string;
  deliveryMode?: string;
  timezone?: string;
  startsAt?: string;
  endsAt?: string;
  enrolmentOpensAt?: string;
  enrolmentClosesAt?: string;
  capacity?: number;
  priceMinor?: number;
  currency?: string;
  attendanceThresholdPct?: number | null;
  holdMinutes?: number | null;
};

export function CohortForm(
  props:
    | { mode: "create"; courses: OfferOption[]; programmes: OfferOption[] }
    | {
        mode: "edit";
        cohortId: string;
        expectedUpdatedAt: string;
        courses: OfferOption[];
        programmes: OfferOption[];
        values: Values;
      },
) {
  const router = useRouter();
  const action = props.mode === "create" ? createCohortAction : updateCohortAction;
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const values = props.mode === "edit" ? props.values : {};

  // A single control picks the offer's KIND, then a second dependent select
  // picks the record — the "both" state is not reachable in the happy path,
  // even though the XOR is still validated server-side (T-05-78).
  const [offerKind, setOfferKind] = useState<"" | "COURSE" | "PROGRAMME">(
    values.offerKind ?? (values.courseId ? "COURSE" : values.programmeId ? "PROGRAMME" : ""),
  );

  // Deterministic on the server and the first client render; the full IANA list
  // is swapped in on the client so the `<option>`s hydrate without a mismatch.
  const selectedTimezone = values.timezone ?? "Africa/Lagos";
  const timezoneList = useSyncExternalStore(NO_SUBSCRIBE, fullTimezones, () => FALLBACK_TIMEZONES);
  const timezones = withValue(timezoneList, selectedTimezone);

  const errorFor = (name: string) => (!state.ok ? state.errors : []).find((e) => e.name === name)?.message;

  return (
    <>
      {state.ok === false && state.message && (
        <p role="alert" className="mb-4 rounded-md border border-danger/30 bg-danger-surface px-4 py-2 text-sm text-danger">
          {state.message}
        </p>
      )}
      {props.mode === "edit" && state.ok && (
        <p role="status" className="mb-4 rounded-md border border-success/30 bg-success/10 px-4 py-2 text-sm text-success">
          Saved.
        </p>
      )}

      <ResourceForm
        title={props.mode === "create" ? "New cohort" : "Cohort details"}
        submitLabel={props.mode === "create" ? "Create cohort" : "Save changes"}
        errors={!state.ok ? state.errors : []}
        pending={pending}
        onSubmit={formAction}
        onCancel={() => router.push("/staff/cohorts")}
      >
        {props.mode === "edit" && (
          <>
            <input type="hidden" name="cohortId" value={props.cohortId} />
            <input type="hidden" name="expectedUpdatedAt" value={props.expectedUpdatedAt} />
          </>
        )}

        <FormField name="code" label="Code" required error={errorFor("code")}>
          {(field) => (
            <TextInput {...field} type="text" required maxLength={40} mono defaultValue={values.code ?? ""} />
          )}
        </FormField>

        <FormField name="title" label="Title" required error={errorFor("title")}>
          {(field) => <TextInput {...field} type="text" required maxLength={200} defaultValue={values.title ?? ""} />}
        </FormField>

        <FormField
          name="offerKind"
          label="Offer"
          required
          error={errorFor("offerKind")}
          hint="Exactly one of Course or Programme — choose the kind, then the record."
        >
          {(field) => (
            <select
              {...field}
              required
              value={offerKind}
              onChange={(e) => setOfferKind(e.target.value as "" | "COURSE" | "PROGRAMME")}
              className="rounded-md border border-input-border bg-surface px-4 py-2 text-sm text-foreground aria-[invalid=true]:border-danger"
            >
              <option value="">Choose a kind…</option>
              <option value="COURSE">Course</option>
              <option value="PROGRAMME">Programme</option>
            </select>
          )}
        </FormField>

        {offerKind === "COURSE" && (
          <FormField name="courseId" label="Course" required error={errorFor("courseId")}>
            {(field) => (
              <select
                {...field}
                required
                defaultValue={values.courseId ?? ""}
                className="rounded-md border border-input-border bg-surface px-4 py-2 text-sm text-foreground"
              >
                <option value="">Choose a course…</option>
                {props.courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        )}

        {offerKind === "PROGRAMME" && (
          <FormField name="programmeId" label="Programme" required error={errorFor("programmeId")}>
            {(field) => (
              <select
                {...field}
                required
                defaultValue={values.programmeId ?? ""}
                className="rounded-md border border-input-border bg-surface px-4 py-2 text-sm text-foreground"
              >
                <option value="">Choose a programme…</option>
                {props.programmes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        )}

        <FormField name="deliveryMode" label="Delivery mode" required error={errorFor("deliveryMode")}>
          {(field) => (
            <select
              {...field}
              required
              defaultValue={values.deliveryMode ?? ""}
              className="rounded-md border border-input-border bg-surface px-4 py-2 text-sm text-foreground"
            >
              <option value="" disabled>
                Choose a delivery mode…
              </option>
              {DELIVERY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField
          name="timezone"
          label="Timezone"
          required
          error={errorFor("timezone")}
          hint="Sessions are entered and shown in this timezone; stored as UTC."
        >
          {(field) => (
            <select
              {...field}
              required
              defaultValue={selectedTimezone}
              className="rounded-md border border-input-border bg-surface px-4 py-2 text-sm text-foreground"
            >
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField name="startsAt" label="Starts" required error={errorFor("startsAt")}>
          {(field) => (
            <TextInput {...field} type="datetime-local" required mono defaultValue={values.startsAt ?? ""} />
          )}
        </FormField>

        <FormField name="endsAt" label="Ends" required error={errorFor("endsAt")}>
          {(field) => <TextInput {...field} type="datetime-local" required mono defaultValue={values.endsAt ?? ""} />}
        </FormField>

        <FormField
          name="enrolmentOpensAt"
          label="Enrolment opens"
          required
          error={errorFor("enrolmentOpensAt")}
        >
          {(field) => (
            <TextInput
              {...field}
              type="datetime-local"
              required
              mono
              defaultValue={values.enrolmentOpensAt ?? ""}
            />
          )}
        </FormField>

        <FormField
          name="enrolmentClosesAt"
          label="Enrolment closes"
          required
          error={errorFor("enrolmentClosesAt")}
        >
          {(field) => (
            <TextInput
              {...field}
              type="datetime-local"
              required
              mono
              defaultValue={values.enrolmentClosesAt ?? ""}
            />
          )}
        </FormField>

        <FormField name="capacity" label="Capacity" required error={errorFor("capacity")}>
          {(field) => (
            <TextInput
              {...field}
              type="number"
              min={1}
              step={1}
              required
              mono
              defaultValue={values.capacity ?? ""}
            />
          )}
        </FormField>

        <FormField
          name="priceMinor"
          label="Price (minor units)"
          required
          error={errorFor("priceMinor")}
          hint="Whole integer minor units — e.g. 500000 for ₦5,000.00, never a decimal amount."
        >
          {(field) => (
            <TextInput
              {...field}
              type="number"
              min={0}
              step={1}
              required
              mono
              defaultValue={values.priceMinor ?? ""}
            />
          )}
        </FormField>

        <FormField name="currency" label="Currency" required error={errorFor("currency")}>
          {(field) => (
            <TextInput
              {...field}
              type="text"
              required
              maxLength={3}
              mono
              defaultValue={values.currency ?? "NGN"}
              placeholder="NGN"
            />
          )}
        </FormField>

        <FormField
          name="attendanceThresholdPct"
          label="Attendance threshold %"
          error={errorFor("attendanceThresholdPct")}
        >
          {(field) => (
            <TextInput
              {...field}
              type="number"
              min={0}
              max={100}
              step={1}
              mono
              defaultValue={values.attendanceThresholdPct ?? ""}
            />
          )}
        </FormField>

        <FormField
          name="holdMinutes"
          label="Seat-hold minutes"
          error={errorFor("holdMinutes")}
          hint="default 30 · 0 or blank = seat taken only on activation"
        >
          {(field) => (
            <TextInput {...field} type="number" min={0} step={1} mono defaultValue={values.holdMinutes ?? ""} />
          )}
        </FormField>
      </ResourceForm>
    </>
  );
}
