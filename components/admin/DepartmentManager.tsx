"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, X } from "lucide-react";

import { saveDepartment } from "@/app/actions/admin";
import { Alert, Field } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { Card, CardHeader } from "@/components/ui/Card";
import type { Department } from "@/types";

export function DepartmentManager({ departments }: { departments: Department[] }) {
  const [editing, setEditing] = useState<Department | null>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();

  function close() {
    setOpen(false);
    setEditing(null);
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          New department
        </button>
      </div>

      {open ? (
        <Card className="mb-4">
          <CardHeader
            title={editing ? `Rename ${editing.name}` : "New department"}
            action={
              <button type="button" className="btn-ghost p-1.5" onClick={close} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            }
          />
          <div className="px-5 py-4">
            <DepartmentForm
              department={editing}
              onDone={() => {
                close();
                router.refresh();
              }}
            />
          </div>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader
          title={`${departments.length} departments`}
          description="Departments are used for grouping users and filtering tickets."
        />
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Name</th>
                <th className="w-[90px]"></th>
              </tr>
            </thead>
            <tbody>
              {departments.map((department) => (
                <tr key={department.id}>
                  <td className="font-medium text-ink">{department.name}</td>
                  <td>
                    <button
                      type="button"
                      className="btn-ghost px-2 py-1 text-[13px]"
                      onClick={() => {
                        setEditing(department);
                        setOpen(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Rename
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function DepartmentForm({
  department,
  onDone,
}: {
  department: Department | null;
  onDone: () => void;
}) {
  const [state, formAction] = useActionState(saveDepartment, null);

  useEffect(() => {
    if (state?.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="space-y-4">
      {state && !state.ok && state.error ? <Alert>{state.error}</Alert> : null}
      {department ? <input type="hidden" name="id" value={department.id} /> : null}

      <Field label="Name" htmlFor="department-name" required>
        <input
          id="department-name"
          name="name"
          required
          defaultValue={department?.name ?? ""}
          className="input"
        />
      </Field>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Saving…">
          {department ? "Save department" : "Create department"}
        </SubmitButton>
      </div>
    </form>
  );
}
