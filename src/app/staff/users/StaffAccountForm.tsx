"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { ResourceForm, FormField, TextInput } from "@/components/primitives";
import type { ScopeType } from "@/server/permissions";
import type { ScopeTarget } from "@/server/services/scope-lookup-service";
import { createStaffAccountAction, searchScopeTargetsAction, type CreateStaffAccountState } from "./actions";

const INITIAL: CreateStaffAccountState = { errors: [], created: null };

const SCOPE_TYPES: { value: ScopeType; label: string }[] = [
  { value: "GLOBAL", label: "Global" },
  { value: "PROGRAMME", label: "Programme" },
  { value: "COURSE", label: "Course" },
  { value: "COHORT", label: "Cohort" },
];

const EMPTY_STATE_COPY: Partial<Record<ScopeType, string>> = {
  PROGRAMME: "No Programmes exist yet — check back once catalogue authoring (Phase 4) lands.",
  COHORT: "No Cohorts exist yet — check back once scheduling (Phase 5) lands.",
};

export type RoleOption = { id: string; name: string };

function generateClientPassword(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function StaffAccountForm({ roles }: { roles: RoleOption[] }) {
  const [state, action, pending] = useActionState(createStaffAccountAction, INITIAL);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [roleId, setRoleId] = useState("");
  const [scopeType, setScopeType] = useState<ScopeType>("GLOBAL");
  const [scopeId, setScopeId] = useState("");
  const [scopeQuery, setScopeQuery] = useState("");
  const [scopeTargets, setScopeTargets] = useState<ScopeTarget[]>([]);
  const [copied, setCopied] = useState(false);

  // Resetting scopeTargets/scopeId when scopeType flips back to GLOBAL
  // happens in the select's own onChange handler below (a user action), not
  // here — this effect only performs the one thing an effect should: talking
  // to an external system (the lookup action) when scopeType/scopeQuery
  // change, and only when there's actually something to look up.
  useEffect(() => {
    if (scopeType === "GLOBAL") return;

    let cancelled = false;
    searchScopeTargetsAction(scopeType, scopeQuery).then((targets) => {
      if (!cancelled) setScopeTargets(targets);
    });
    return () => {
      cancelled = true;
    };
  }, [scopeType, scopeQuery]);

  if (state.created) {
    return (
      <div className="flex flex-col gap-4 border border-zinc-200 bg-white px-4 py-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold tracking-tight">Staff account created</h2>
          <p className="text-sm text-zinc-600">
            {state.created.name} ({state.created.email})
          </p>
        </div>

        <div className="flex flex-col gap-1.5 border border-zinc-200 bg-zinc-50/60 px-3 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
            Temporary password
          </span>
          <div className="flex items-center gap-2">
            <code className="font-mono text-sm text-zinc-900">{state.created.temporaryPassword}</code>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(state.created!.temporaryPassword);
                setCopied(true);
              }}
              className="border border-zinc-300 bg-white px-2 py-1 text-xs font-medium hover:bg-zinc-50"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            Shown only once — relay this to the new staff member out of band.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-zinc-200 pt-4">
          <Link
            href={`/staff/users/${state.created.userId}`}
            className="bg-accent px-3 py-1.5 text-xs font-medium text-accent-contrast hover:opacity-90"
          >
            View account
          </Link>
          <Link
            href="/staff/users"
            className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
          >
            Back to list
          </Link>
        </div>
      </div>
    );
  }

  const formErrors = state.errors.filter((e) => e.name !== "form");

  return (
    <ResourceForm
      title="New staff account"
      errors={formErrors}
      pending={pending}
      submitLabel="Create account & assign role"
      onSubmit={action}
    >
      <FormField name="name" label="Name" required>
        {(props) => <TextInput {...props} required />}
      </FormField>

      <FormField name="email" label="Email" required>
        {(props) => <TextInput {...props} type="email" required />}
      </FormField>

      <FormField
        name="temporaryPassword"
        label="Temporary password"
        hint="Leave blank to generate one automatically."
      >
        {(props) => (
          <div className="flex gap-2">
            <TextInput
              {...props}
              value={temporaryPassword}
              onChange={(e) => setTemporaryPassword(e.target.value)}
              mono
            />
            <button
              type="button"
              onClick={() => setTemporaryPassword(generateClientPassword())}
              className="border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-50"
            >
              Generate
            </button>
          </div>
        )}
      </FormField>

      <FormField name="roleId" label="Role" required>
        {(props) => (
          <select
            {...props}
            required
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            className="border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
          >
            <option value="">Choose a role</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        )}
      </FormField>

      <FormField name="scopeType" label="Scope">
        {(props) => (
          <select
            {...props}
            value={scopeType}
            onChange={(e) => {
              setScopeType(e.target.value as ScopeType);
              setScopeId("");
              setScopeQuery("");
              setScopeTargets([]);
            }}
            className="border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
          >
            {SCOPE_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}
      </FormField>

      {scopeType !== "GLOBAL" && (
        <FormField name="scopeId" label={`${SCOPE_TYPES.find((s) => s.value === scopeType)?.label} target`} required>
          {(props) =>
            scopeTargets.length === 0 && !scopeQuery ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-sm text-zinc-500">{EMPTY_STATE_COPY[scopeType]}</p>
                {/* Kept visible (not hidden) so a `required` field stays a
                    focusable, submittable control — a hidden required field
                    blocks native form submission entirely in most browsers. */}
                <select {...props} required value="" onChange={() => {}} disabled>
                  <option value="">No targets available</option>
                </select>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <TextInput
                  placeholder="Search…"
                  value={scopeQuery}
                  onChange={(e) => setScopeQuery(e.target.value)}
                />
                <select
                  {...props}
                  required
                  value={scopeId}
                  onChange={(e) => setScopeId(e.target.value)}
                  className="border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
                >
                  <option value="">Choose a target</option>
                  {scopeTargets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.label}
                    </option>
                  ))}
                </select>
              </div>
            )
          }
        </FormField>
      )}

      <FormField name="endsAt" label="End date" hint="Optional.">
        {(props) => <TextInput {...props} type="date" />}
      </FormField>
    </ResourceForm>
  );
}
