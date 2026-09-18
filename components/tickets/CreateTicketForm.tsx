"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Paperclip, X } from "lucide-react";

import { createTicket, registerAttachment } from "@/app/actions/tickets";
import { Alert, Field } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { PRIORITY_META, TICKET_PRIORITIES } from "@/lib/constants";
import { uploadTicketFile, validateFile } from "@/lib/upload";
import { cn, formatFileSize } from "@/lib/utils";
import type { Category } from "@/types";

export function CreateTicketForm({ categories }: { categories: Category[] }) {
  const [state, formAction] = useActionState(createTicket, null);
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; ticketNumber: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!state?.ok || !state.data) return;

    const { id, ticketNumber } = state.data;
    let cancelled = false;

    async function finish() {
      if (files.length === 0) {
        setCreated({ id, ticketNumber });
        return;
      }
      setUploading(true);
      try {
        for (const file of files) {
          const uploaded = await uploadTicketFile(id, file);
          await registerAttachment({ ticketId: id, ...uploaded });
        }
        if (!cancelled) setCreated({ id, ticketNumber });
      } catch (error) {
        if (!cancelled) {
          setUploadError(
            error instanceof Error
              ? `${error.message} — the ticket was created, you can attach the file from the ticket page.`
              : "Upload failed.",
          );
          setCreated({ id, ticketNumber });
        }
      } finally {
        if (!cancelled) setUploading(false);
      }
    }

    void finish();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next: File[] = [];
    for (const file of Array.from(list)) {
      const invalid = validateFile(file);
      if (invalid) {
        setFileError(invalid);
        return;
      }
      next.push(file);
    }
    setFileError(null);
    setFiles((prev) => [...prev, ...next].slice(0, 5));
  }

  if (created) {
    return (
      <div className="card px-5 py-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 text-success-ink" />
          <div>
            <p className="text-sm font-semibold text-ink">Ticket berhasil dibuat.</p>
            <p className="mt-1 font-mono text-sm text-ink-muted">#{created.ticketNumber}</p>
            {uploading ? (
              <p className="mt-2 flex items-center gap-2 text-[13px] text-ink-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Uploading attachments…
              </p>
            ) : null}
            {uploadError ? <Alert className="mt-3">{uploadError}</Alert> : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={`/tickets/${created.id}`} className="btn-primary">
                Open ticket
              </Link>
              <Link href="/tickets?scope=created" className="btn-secondary">
                My tickets
              </Link>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => router.push("/tickets/new")}
              >
                Create another
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="card space-y-5 px-5 py-6">
      {state && !state.ok && state.error ? <Alert>{state.error}</Alert> : null}

      <Field label="Title" htmlFor="title" required hint="Short summary of the problem.">
        <input
          id="title"
          name="title"
          required
          maxLength={160}
          className="input"
          placeholder="Laptop tidak bisa connect WiFi"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" htmlFor="categoryId" required>
          <select id="categoryId" name="categoryId" required className="input" defaultValue="">
            <option value="" disabled>
              Select a category
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Priority" htmlFor="priority" required>
          <select id="priority" name="priority" required className="input" defaultValue="MEDIUM">
            {TICKET_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_META[priority].label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field
        label="Description"
        htmlFor="description"
        required
        hint="Include what you were doing, when it started and any error message."
      >
        <textarea
          id="description"
          name="description"
          required
          rows={7}
          maxLength={5000}
          className="input resize-y"
          placeholder="Laptop saya tidak bisa menemukan WiFi kantor sejak pagi."
        />
      </Field>

      <div>
        <span className="label">Attachments</span>
        <div className="rounded-md border border-dashed border-surface-border bg-surface-muted/50 px-4 py-4">
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => addFiles(event.target.files)}
            accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.zip"
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={() => inputRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
            Attach file
          </button>
          <p className="mt-2 text-xs text-ink-subtle">
            Max 5 files, 10 MB each. Images, PDF, Office documents or ZIP.
          </p>

          {files.length ? (
            <ul className="mt-3 space-y-1.5">
              {files.map((file) => (
                <li
                  key={`${file.name}-${file.size}`}
                  className="flex items-center gap-2 rounded border border-surface-border bg-surface px-2.5 py-1.5 text-[13px]"
                >
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="text-xs text-ink-subtle">{formatFileSize(file.size)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    className={cn("text-ink-subtle hover:text-danger-ink")}
                    onClick={() =>
                      setFiles((prev) => prev.filter((item) => item !== file))
                    }
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {fileError ? <p className="mt-2 text-xs text-danger-ink">{fileError}</p> : null}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-surface-border pt-4">
        <Link href="/tickets?scope=created" className="btn-secondary">
          Cancel
        </Link>
        <SubmitButton pendingLabel="Submitting…">Submit ticket</SubmitButton>
      </div>
    </form>
  );
}
