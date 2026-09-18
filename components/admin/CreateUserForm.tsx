"use client";

import { useActionState, useState } from "react";
import { Plus, X } from "lucide-react";

import { createUser } from "@/app/actions/admin";
import { Alert, Field } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { ROLE_META, USER_ROLES } from "@/lib/constants";
import type { Department } from "@/types";

export function CreateUserForm({ departments }: { departments: Department[] }) {
  const [state, formAction] = useActionState(createUser, null);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Create user
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-card border border-surface-border bg-surface shadow-lg">
        <div className="flex items-center justify-between border-b border-surface-border px-5 py-4">
          <h2 className="text-sm font-semibold">Create user</h2>
          <button
            type="button"
            className="btn-ghost p-1.5"
            aria-label="Close"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form action={formAction} className="space-y-4 px-5 py-5">
          {state?.ok ? <Alert tone="success">User created successfully.</Alert> : null}
          {state && !state.ok && state.error ? <Alert>{state.error}</Alert> : null}

          <Field label="Full name" htmlFor="fullName" required>
            <input id="fullName" name="fullName" required className="input" />
          </Field>

          <Field label="Email" htmlFor="email" required>
            <input id="email" name="email" type="email" required className="input" />
          </Field>

          <Field
            label="Temporary password"
            htmlFor="password"
            required
            hint="Minimum 8 characters. Share it with the user securely."
          >
            <input
              id="password"
              name="password"
              type="text"
              required
              minLength={8}
              className="input font-mono"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Role" htmlFor="role" required>
              <select id="role" name="role" className="input" defaultValue="employee">
                {USER_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_META[role].label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Department" htmlFor="departmentId">
              <select id="departmentId" name="departmentId" className="input" defaultValue="">
                <option value="">None</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="flex justify-end gap-2 border-t border-surface-border pt-4">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Close
            </button>
            <SubmitButton pendingLabel="Creating…">Create user</SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
