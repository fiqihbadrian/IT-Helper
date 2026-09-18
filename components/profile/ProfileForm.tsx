"use client";

import { useActionState } from "react";

import { updateOwnProfile } from "@/app/actions/auth";
import { Alert, Field } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";

export function ProfileForm({ fullName }: { fullName: string }) {
  const [state, formAction] = useActionState(updateOwnProfile, null);

  return (
    <form action={formAction} className="space-y-4">
      {state?.ok ? <Alert tone="success">Profile updated.</Alert> : null}
      {state && !state.ok && state.error ? <Alert>{state.error}</Alert> : null}

      <Field label="Full name" htmlFor="fullName" required>
        <input
          id="fullName"
          name="fullName"
          defaultValue={fullName}
          required
          maxLength={120}
          className="input"
        />
      </Field>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
      </div>
    </form>
  );
}
