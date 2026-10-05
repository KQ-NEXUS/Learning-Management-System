"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { Check } from "lucide-react";
import { useLicenceRestriction } from "@/components/licence/LicenceRestrictionProvider";
import { LicenceRefusalNote, RestrictedControlReason } from "@/components/licence/LicenceRefusalNote";
import { isLicenceRefusalMessage } from "@/server/licence/policy";

// The link/plain-text decision reads child DOM that only exists after commit,
// so it must run synchronously before paint to avoid a flash of the wrong
// element. `useLayoutEffect` warns during SSR, where there is nothing to
// measure, so fall back to `useEffect` on the server.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * ResourceForm — the create/edit primitive.
 *
 * Behaviours carried over from the design spec:
 *   - An error summary at the top links to each offending field, and receives
 *     focus after a failed submit (WCAG 2.2 AA, PRD NFR-09).
 *   - Fields validate on blur, not on every keystroke.
 *   - Cross-field errors (for example "exactly one of course or programme")
 *     appear in the summary, since they belong to no single input. These have
 *     no `field-<name>` control to focus, so they render as plain alert text
 *     rather than as a link that would go nowhere (WR-02).
 *   - Field errors only become links once a matching `field-<name>` control is
 *     actually present in this form; an error for an absent field stays as
 *     plain text so the summary never contains a dead link.
 *   - A failed save never shows success and never clears the entered values.
 */

export type FieldError = {
  /**
   * Matches a FormField `name`. If a control with id `field-<name>` exists in
   * this form the summary links to it; otherwise the message is shown as plain
   * text (cross-field / form-level failures, or fields not rendered yet).
   */
  name: string;
  message: string;
};

export type ResourceFormState =
  | { status: "ready" }
  | { status: "loading" }
  | { status: "denied"; permission?: string }
  | { status: "error"; message?: string };

export type ResourceFormProps = {
  title: string;
  subtitle?: ReactNode;
  /** e.g. "Draft saved 14:02 WAT". Absent when there is no draft. */
  draftStatus?: string;
  errors?: FieldError[];
  state?: ResourceFormState;
  submitLabel?: string;
  pending?: boolean;
  /**
   * Required whenever the form itself renders. A Server Component showing only the
   * denied/loading/error state must omit it: a function cannot cross into a Client Component.
   */
  onSubmit?: (formData: FormData) => void | Promise<void>;
  onCancel?: () => void;
  onRetry?: () => void;
  /**
   * A wide, sectioned form: the band already carries the page title, so the form draws no heading of
   * its own, and its children are `FormSection`s (a 280px title column beside the fields).
   */
  sectioned?: boolean;
  /** Gives the <form> an id so a submit button elsewhere on the page (e.g. in the header band) can target it. */
  formId?: string;
  /** Omit the built-in Cancel/Save footer when the page provides its own submit control. */
  hideFooter?: boolean;
  /**
   * Licence UI mirror (14-19, D-09, courtesy only; the server is the gate). In restricted
   * continuity mode a "write" form's built-in submit is disabled with a visible reason.
   * Default "write"; no staff or catalogue form is a continuity action.
   */
  licenceEffect?: "write" | "continuity";
  /**
   * Show the form one `FormStep` at a time, with a progress bar on top and Back / Next between
   * steps, so a long form is filled in as a few short ones. Every step stays in the page (only
   * hidden), so nothing typed is lost moving between them and the whole form is submitted at once.
   *
   *   - "linear" (creating something): steps are taken in order. Next checks the current step's
   *     required fields first, and the submit button appears only on the last step.
   *   - "free" (editing something): every step can be opened directly and the submit button is
   *     always there, so changing one field does not mean paging through the rest.
   */
  stepped?: "linear" | "free";
  children: ReactNode;
};

export type FormStepProps = {
  /** Short name shown in the progress bar and as the step's heading. */
  title: string;
  description?: string;
  children: ReactNode;
};

/**
 * One step of a `stepped` ResourceForm. It must be a direct child of the form. Outside a stepped
 * form it renders as a plain titled group.
 */
export function FormStep({ title, description, children }: FormStepProps) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-[20px] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground">{title}</h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function isFormStep(node: ReactNode): node is ReactElement<FormStepProps> {
  return isValidElement(node) && node.type === FormStep;
}

const BTN =
  "inline-flex min-h-[46px] items-center rounded-md border border-input-border bg-surface px-5 text-sm font-semibold text-foreground hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY =
  "inline-flex min-h-[46px] items-center rounded-md bg-accent px-6 text-sm font-semibold text-accent-contrast hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-50";

export function ResourceForm({
  title,
  subtitle,
  draftStatus,
  errors = [],
  state = { status: "ready" },
  submitLabel = "Save",
  pending = false,
  onSubmit,
  onCancel,
  onRetry,
  sectioned = false,
  formId,
  hideFooter = false,
  licenceEffect = "write",
  stepped,
  children,
}: ResourceFormProps) {
  const summaryId = useId();
  const restrictedReasonId = useId();
  const { restricted, canViewLicence } = useLicenceRestriction();
  const blockedByLicence = restricted && licenceEffect !== "continuity";
  // A server licence refusal is a calm warning, never an entry in the danger summary (T-14-19-05).
  const refusalErrors = errors.filter((error) => isLicenceRefusalMessage(error.message));
  const summaryErrors = errors.filter((error) => !isLicenceRefusalMessage(error.message));
  const summaryRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [, startSubmit] = useTransition();

  // ---- stepped mode ----
  const allChildren = Children.toArray(children);
  const steps = stepped ? allChildren.filter(isFormStep) : [];
  const outsideSteps = stepped ? allChildren.filter((child) => !isFormStep(child)) : null;
  const lastStep = steps.length - 1;
  const [currentStep, setCurrentStep] = useState(0);
  // The furthest step reached: a linear form lets you go back to any of these, never past them.
  const [reachedStep, setReachedStep] = useState(0);
  const [stepMessage, setStepMessage] = useState<string | null>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);

  function stepPanel(index: number): HTMLElement | null {
    return formRef.current?.querySelector<HTMLElement>(`[data-form-step="${index}"]`) ?? null;
  }

  /** The step's first field the browser considers invalid (a required field left empty, a bad number...). */
  function firstInvalidIn(index: number): HTMLInputElement | null {
    const fields = stepPanel(index)?.querySelectorAll<HTMLInputElement>("input, select, textarea") ?? [];
    for (const field of fields) {
      if (!field.disabled && !field.checkValidity()) return field;
    }
    return null;
  }

  function showStep(index: number) {
    setCurrentStep(index);
    setReachedStep((reached) => Math.max(reached, index));
    setStepMessage(null);
    // After the step is shown: move focus to its heading so keyboard and screen-reader users land on it.
    requestAnimationFrame(() => stepHeadingRef.current?.focus());
  }

  /** Stops at the first step from `from` up to (not including) `to` that still has an invalid field. */
  function advanceTo(to: number, from = currentStep) {
    for (let index = from; index < to; index++) {
      const invalid = firstInvalidIn(index);
      if (invalid) {
        if (index !== currentStep) setCurrentStep(index);
        setStepMessage("Fill in the highlighted field before you continue.");
        requestAnimationFrame(() => {
          invalid.focus();
          invalid.reportValidity();
        });
        return false;
      }
    }
    showStep(to);
    return true;
  }

  function goToStep(index: number) {
    if (index === currentStep) return;
    if (index < currentStep || stepped === "free") showStep(index);
    else advanceTo(index);
  }

  // The save runs from a submit handler, NOT from the form's `action` prop.
  // React resets every uncontrolled field of a <form action={fn}> once the
  // action settles, success or failure, so a save refused by validation wiped
  // whatever had been typed and a second click then saved the old values
  // (audit R3-05). Dispatching inside a transition keeps `useActionState`'s
  // pending flag working for the callers that pass its dispatcher here.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onSubmit) return;
    if (stepped) {
      // Enter in a text field submits a form. In a linear form that is "Next" until the last step.
      if (stepped === "linear" && currentStep < lastStep) {
        advanceTo(currentStep + 1);
        return;
      }
      // Before sending: no step may still have an invalid field, including ones not on screen.
      for (let index = 0; index <= lastStep; index++) {
        const invalid = firstInvalidIn(index);
        if (invalid) {
          setCurrentStep(index);
          setStepMessage("Fill in the highlighted field before you save.");
          requestAnimationFrame(() => {
            invalid.focus();
            invalid.reportValidity();
          });
          return;
        }
      }
    }
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    startSubmit(async () => {
      await onSubmit(formData);
    });
  }

  // Which error names resolve to a real `field-<name>` control *inside this
  // form*. Recomputed after every render because the offending fields are
  // rendered as children and only exist in the DOM after mount/update. An
  // error whose target is missing (cross-field failures, form-level failures,
  // or a field not currently rendered) stays as plain text — never a link
  // that leads nowhere (WR-02).
  const [linkableNames, setLinkableNames] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  useIsomorphicLayoutEffect(() => {
    const form = formRef.current;
    if (!form) {
      if (linkableNames.size > 0) setLinkableNames(new Set());
      return;
    }
    const presentIds = new Set(
      Array.from(form.querySelectorAll<HTMLElement>("[id]")).map((el) => el.id),
    );
    const next = new Set(
      errors
        .filter((error) => presentIds.has(`field-${error.name}`))
        .map((error) => error.name),
    );
    const unchanged =
      next.size === linkableNames.size &&
      [...next].every((name) => linkableNames.has(name));
    if (!unchanged) setLinkableNames(next);
  }, [errors, linkableNames]);

  // A save the server refused: open the step that holds the first field it complained about, so
  // the message and the field are on screen together. Compared by content, not identity: callers
  // pass a fresh empty array on every render when there are no errors.
  const errorsKey = errors.map((error) => `${error.name} ${error.message}`).join("");
  const [errorsShownKey, setErrorsShownKey] = useState("");
  useIsomorphicLayoutEffect(() => {
    if (!stepped || errorsKey === errorsShownKey) return;
    setErrorsShownKey(errorsKey);
    for (const error of errors) {
      // Looked up by id rather than a selector: a field name is not always a valid selector.
      const field = document.getElementById(`field-${error.name}`);
      const index = field && formRef.current?.contains(field)
        ? field.closest<HTMLElement>("[data-form-step]")?.dataset.formStep
        : undefined;
      if (index !== undefined) {
        setCurrentStep(Number(index));
        return;
      }
    }
  }, [errors, errorsKey, errorsShownKey, stepped]);

  // Move focus to the error summary whenever it appears — the summary is
  // the first thing a screen reader user needs after a failed submit
  // (WCAG 2.2 AA, NFR-09). tabIndex={-1} on the summary makes it a valid
  // focus target without adding it to the normal tab order.
  useEffect(() => {
    if (errors.length > 0) {
      summaryRef.current?.focus();
    }
  }, [errors]);

  if (state.status === "denied") {
    return (
      <div className="mx-auto flex w-full max-w-[700px] flex-col items-start gap-2 border-t border-foreground py-12">
        <span className="font-mono text-xs tracking-wide text-muted-foreground">403</span>
        <p className="text-sm font-semibold text-foreground">Editing needs additional permission</p>
        <p className="max-w-prose text-sm text-muted-foreground">
          Your role does not include{" "}
          {state.permission ? (
            <code className="rounded-sm bg-surface-2 px-1 font-mono text-xs">
              {state.permission}
            </code>
          ) : (
            "the required permission"
          )}{" "}
          at this scope. Ask a workspace administrator to grant it.
        </p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="mx-auto flex w-full max-w-[700px] flex-col items-start gap-2 border-t border-foreground py-12">
        <p className="text-sm font-semibold text-foreground">Could not load this record</p>
        {state.message && isLicenceRefusalMessage(state.message) ? (
          <LicenceRefusalNote message={state.message} />
        ) : (
          <p className="max-w-prose text-sm text-muted-foreground">
            {state.message ?? "The request failed. Nothing has been changed."}
          </p>
        )}
        {onRetry && (
          <button type="button" onClick={onRetry} className={BTN}>
            Retry
          </button>
        )}
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div
        aria-busy
        className="mx-auto flex w-full max-w-[700px] flex-col gap-4 border-t border-foreground pt-5"
      >
        <span className="h-4 w-48 animate-pulse rounded-sm bg-surface-2" />
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1">
            <span className="h-2.5 w-24 animate-pulse rounded-sm bg-surface-2" />
            <span className="h-8 w-full animate-pulse rounded-sm bg-surface-2" />
          </div>
        ))}
        <p aria-live="polite" className="sr-only">
          Loading form
        </p>
      </div>
    );
  }

  return (
    <form
      id={formId}
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      className={`flex w-full flex-col ${sectioned ? "max-w-[1100px]" : "max-w-[720px]"}`}
    >
      <div className="flex flex-col gap-6">
        {sectioned ? (
          <h2 className="sr-only">{title}</h2>
        ) : (
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex flex-col gap-1">
              <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-foreground">{title}</h2>
              {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
            </div>
          </div>
        )}

        {refusalErrors.length > 0 && <LicenceRefusalNote message={refusalErrors[0].message} />}

        {summaryErrors.length > 0 && (
          <div
            ref={summaryRef}
            role="alert"
            aria-labelledby={summaryId}
            tabIndex={-1}
            className="rounded-md border border-danger/30 bg-danger-surface px-4 py-2"
          >
            <p id={summaryId} className="text-sm font-semibold text-danger">
              {summaryErrors.length} {summaryErrors.length === 1 ? "issue needs" : "issues need"}{" "}
              attention before this can be saved
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {summaryErrors.map((error) => (
                <li key={error.name}>
                  {linkableNames.has(error.name) ? (
                    <a
                      href={`#field-${error.name}`}
                      className="text-sm text-danger underline underline-offset-2"
                    >
                      {error.message}
                    </a>
                  ) : (
                    <span className="text-sm text-danger">{error.message}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {stepped && steps.length > 0 ? (
          <>
            {outsideSteps}

            <nav aria-label="Progress" className="flex flex-col gap-2">
              <ol className="flex flex-wrap items-center gap-y-3">
                {steps.map((step, index) => {
                  const isCurrent = index === currentStep;
                  const isDone = index < currentStep || (index <= reachedStep && !isCurrent);
                  const reachable = stepped === "free" || index <= reachedStep + 1;
                  return (
                    <li key={step.props.title} className="flex items-center">
                      <button
                        type="button"
                        onClick={() => goToStep(index)}
                        disabled={!reachable}
                        aria-current={isCurrent ? "step" : undefined}
                        className="group flex items-center gap-2 rounded-md py-1 pr-1 text-sm disabled:cursor-not-allowed"
                      >
                        <span
                          aria-hidden
                          className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                            isCurrent
                              ? "border-accent bg-accent text-accent-contrast"
                              : isDone
                                ? "border-accent bg-accent-wash text-accent"
                                : "border-input-border bg-surface text-muted-foreground"
                          }`}
                        >
                          {isDone ? <Check className="size-4" /> : index + 1}
                        </span>
                        <span
                          className={`${isCurrent ? "font-semibold text-foreground" : isDone ? "text-foreground group-hover:underline" : "text-muted-foreground"}`}
                        >
                          {step.props.title}
                        </span>
                        <span className="sr-only">{isCurrent ? " (current step)" : isDone ? " (done)" : ""}</span>
                      </button>
                      {index < lastStep && (
                        <span
                          aria-hidden
                          className={`mx-3 h-px w-6 sm:w-12 ${index < currentStep ? "bg-accent" : "bg-border"}`}
                        />
                      )}
                    </li>
                  );
                })}
              </ol>
              <div
                role="progressbar"
                aria-label="Form progress"
                aria-valuemin={0}
                aria-valuemax={steps.length}
                aria-valuenow={currentStep + 1}
                className="h-1 w-full overflow-hidden rounded-full bg-accent-wash"
              >
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Step {currentStep + 1} of {steps.length}
              </p>
            </nav>

            {stepMessage && (
              <p role="alert" className="rounded-md border border-danger/30 bg-danger-surface px-4 py-2 text-sm text-danger">
                {stepMessage}
              </p>
            )}

            {steps.map((step, index) => (
              // Hidden, never unmounted: an uncontrolled field keeps its value only while it is in the page.
              <section key={step.props.title} data-form-step={index} hidden={index !== currentStep} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <h3
                    ref={index === currentStep ? stepHeadingRef : undefined}
                    tabIndex={-1}
                    className="text-[20px] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground outline-none"
                  >
                    {step.props.title}
                  </h3>
                  {step.props.description && <p className="text-sm text-muted-foreground">{step.props.description}</p>}
                </div>
                {step.props.children}
              </section>
            ))}
          </>
        ) : (
          <div className={sectioned ? "flex flex-col" : "flex flex-col gap-4"}>{children}</div>
        )}
      </div>

      <div
        className={`mt-8 flex flex-wrap items-center gap-4 border-t border-foreground pt-6 ${hideFooter ? "hidden" : ""}`}
      >
        {draftStatus && (
          <p className="font-mono text-xs text-muted-foreground">{draftStatus}</p>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {onCancel && (
            <button type="button" onClick={onCancel} className={BTN}>
              Cancel
            </button>
          )}
          {stepped && currentStep > 0 && (
            <button type="button" onClick={() => showStep(currentStep - 1)} disabled={pending} className={BTN}>
              Back
            </button>
          )}
          {/* A linear form offers the submit button only once every step has been taken. */}
          {(!stepped || stepped === "free" || currentStep === lastStep) && (
            <button
              type="submit"
              disabled={pending || blockedByLicence}
              aria-describedby={blockedByLicence && !hideFooter ? restrictedReasonId : undefined}
              className={stepped === "free" && currentStep < lastStep ? BTN : BTN_PRIMARY}
            >
              {pending ? "Saving…" : submitLabel}
            </button>
          )}
          {stepped && currentStep < lastStep && (
            <button type="button" onClick={() => advanceTo(currentStep + 1)} disabled={pending} className={BTN_PRIMARY}>
              Next
            </button>
          )}
        </div>
      </div>
      {blockedByLicence && !hideFooter && (
        <div className="mt-3 flex justify-end">
          <RestrictedControlReason id={restrictedReasonId} canViewLicence={canViewLicence} />
        </div>
      )}
    </form>
  );
}

/** One row of a sectioned form: title and description on the left, the fields on the right. */
export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-6 border-t border-border py-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-14">
      <div className="flex flex-col gap-2">
        <h3 className="text-[20px] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground">{title}</h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

/** Two equal columns for related fields inside a `FormSection`. */
export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-5 sm:grid-cols-2">{children}</div>;
}

export type FormFieldProps = {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (props: {
    id: string;
    name: string;
    "aria-invalid": boolean | undefined;
    "aria-describedby": string | undefined;
  }) => ReactNode;
};

/**
 * Wires a control to its label, hint, and error.
 *
 * The render-prop shape exists so the aria wiring cannot be forgotten: there
 * is no way to render a control here without receiving the ids it needs.
 */
export function FormField({
  name,
  label,
  hint,
  error,
  required,
  children,
}: FormFieldProps) {
  const id = `field-${name}`;
  const errorId = `${id}-err`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-foreground">
        {label}
        {required && (
          <span className="ml-1 text-xs font-normal text-muted-foreground" aria-hidden>
            required
          </span>
        )}
      </label>

      {children({
        id,
        name,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}

      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** The default text control, styled to match the spec sheet. */
export function TextInput(
  props: React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean },
) {
  const { mono, className, ...rest } = props;
  return (
    <input
      {...rest}
      className={`h-12 rounded-md border border-input-border bg-surface px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground aria-[invalid=true]:border-danger ${
        mono ? "font-mono tabular-nums" : ""
      } ${className ?? ""}`}
    />
  );
}
