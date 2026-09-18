"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, X } from "lucide-react";

import { saveCategory } from "@/app/actions/admin";
import { Alert, Field } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { Card, CardHeader } from "@/components/ui/Card";
import type { Category } from "@/types";

export function CategoryManager({ categories }: { categories: Category[] }) {
  const [editing, setEditing] = useState<Category | null>(null);
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
          New category
        </button>
      </div>

      {open ? (
        <Card className="mb-4">
          <CardHeader
            title={editing ? `Edit ${editing.name}` : "New category"}
            action={
              <button type="button" className="btn-ghost p-1.5" onClick={close} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            }
          />
          <div className="px-5 py-4">
            <CategoryForm
              category={editing}
              onDone={() => {
                close();
                router.refresh();
              }}
            />
          </div>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader title={`${categories.length} categories`} />
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th className="w-[110px]">Status</th>
                <th className="w-[90px]"></th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id}>
                  <td className="font-medium text-ink">{category.name}</td>
                  <td className="text-[13px] text-ink-muted">
                    {category.description ?? "—"}
                  </td>
                  <td>
                    {category.is_active ? (
                      <span className="text-[13px] text-success-ink">Active</span>
                    ) : (
                      <span className="text-[13px] text-ink-muted">Inactive</span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-ghost px-2 py-1 text-[13px]"
                      onClick={() => {
                        setEditing(category);
                        setOpen(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
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

function CategoryForm({
  category,
  onDone,
}: {
  category: Category | null;
  onDone: () => void;
}) {
  const [state, formAction] = useActionState(saveCategory, null);

  useEffect(() => {
    if (state?.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="space-y-4">
      {state && !state.ok && state.error ? <Alert>{state.error}</Alert> : null}
      {category ? <input type="hidden" name="id" value={category.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="category-name" required>
          <input
            id="category-name"
            name="name"
            required
            defaultValue={category?.name ?? ""}
            className="input"
          />
        </Field>
        <Field label="Description" htmlFor="category-description">
          <input
            id="category-description"
            name="description"
            defaultValue={category?.description ?? ""}
            className="input"
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-[13px] text-ink">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={category?.is_active ?? true}
          className="h-4 w-4 rounded border-surface-border"
        />
        Active (available when creating tickets)
      </label>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Saving…">
          {category ? "Save category" : "Create category"}
        </SubmitButton>
      </div>
    </form>
  );
}
