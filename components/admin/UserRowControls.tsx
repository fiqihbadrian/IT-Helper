"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { updateUser } from "@/app/actions/admin";
import { ROLE_META, USER_ROLES } from "@/lib/constants";
import type { Department, UserRole } from "@/types";

export function UserRowControls({
  userId,
  role,
  departmentId,
  isActive,
  departments,
  isSelf,
}: {
  userId: string;
  role: UserRole;
  departmentId: string | null;
  isActive: boolean;
  departments: Department[];
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(patch: Parameters<typeof updateUser>[0]) {
    setError(null);
    startTransition(async () => {
      const result = await updateUser(patch);
      if (!result.ok) setError(result.error ?? "Update failed");
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-subtle" /> : null}

      <select
        aria-label="Role"
        className="input w-auto py-1.5 text-[13px]"
        value={role}
        disabled={pending || isSelf}
        title={isSelf ? "You cannot change your own role" : undefined}
        onChange={(event) => run({ userId, role: event.target.value as UserRole })}
      >
        {USER_ROLES.map((value) => (
          <option key={value} value={value}>
            {ROLE_META[value].label}
          </option>
        ))}
      </select>

      <select
        aria-label="Department"
        className="input w-auto py-1.5 text-[13px]"
        value={departmentId ?? ""}
        disabled={pending}
        onChange={(event) =>
          run({ userId, departmentId: event.target.value || null })
        }
      >
        <option value="">No department</option>
        {departments.map((department) => (
          <option key={department.id} value={department.id}>
            {department.name}
          </option>
        ))}
      </select>

      <button
        type="button"
        className={isActive ? "btn-danger px-2.5 py-1.5 text-[13px]" : "btn-secondary px-2.5 py-1.5 text-[13px]"}
        disabled={pending || isSelf}
        title={isSelf ? "You cannot deactivate your own account" : undefined}
        onClick={() => run({ userId, isActive: !isActive })}
      >
        {isActive ? "Deactivate" : "Activate"}
      </button>

      {error ? <span className="text-xs text-danger-ink">{error}</span> : null}
    </div>
  );
}
