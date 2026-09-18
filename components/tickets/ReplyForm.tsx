"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Paperclip, Send, X } from "lucide-react";

import { addComment, registerAttachment } from "@/app/actions/tickets";
import { Alert } from "@/components/ui/Field";
import { uploadTicketFile, validateFile } from "@/lib/upload";
import { formatFileSize } from "@/lib/utils";

export function ReplyForm({ ticketId }: { ticketId: string }) {
  const [state, formAction] = useActionState(addComment, null);
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!state?.ok || !state.data) return;
    if (handled.current === state.data.id) return;
    handled.current = state.data.id;

    const commentId = state.data.id;
    setMessage("");
    setFiles([]);

    if (files.length === 0) return;

    async function upload() {
      setBusy(true);
      try {
        for (const file of files) {
          const uploaded = await uploadTicketFile(ticketId, file);
          await registerAttachment({ ticketId, commentId, ...uploaded });
        }
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
      } finally {
        setBusy(false);
      }
    }

    void upload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next: File[] = [];
    for (const file of Array.from(list)) {
      const invalid = validateFile(file);
      if (invalid) {
        setError(invalid);
        return;
      }
      next.push(file);
    }
    setError(null);
    setFiles((prev) => [...prev, ...next].slice(0, 5));
  }

  return (
    <form
      action={formAction}
      className="border-t border-surface-border bg-surface px-4 py-4 lg:px-5"
    >
      <input type="hidden" name="ticketId" value={ticketId} />

      {state && !state.ok && state.error ? (
        <Alert className="mb-3">{state.error}</Alert>
      ) : null}
      {error ? <Alert className="mb-3">{error}</Alert> : null}

      <label htmlFor="message" className="sr-only">
        Write a reply
      </label>
      <textarea
        id="message"
        name="message"
        rows={3}
        required
        maxLength={5000}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Write a reply…"
        className="input resize-y"
      />

      {files.length ? (
        <ul className="mt-2 space-y-1.5">
          {files.map((file) => (
            <li
              key={`${file.name}-${file.size}`}
              className="flex items-center gap-2 rounded border border-surface-border bg-surface-muted/60 px-2.5 py-1.5 text-[13px]"
            >
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="text-xs text-ink-subtle">{formatFileSize(file.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                className="text-ink-subtle hover:text-danger-ink"
                onClick={() => setFiles((prev) => prev.filter((item) => item !== file))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.zip"
          onChange={(event) => addFiles(event.target.files)}
        />
        <button
          type="button"
          className="btn-secondary"
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip className="h-4 w-4" />
          <span className="hidden sm:inline">Attach File</span>
        </button>

        <button
          type="submit"
          className="btn-primary ml-auto"
          disabled={busy || !message.trim()}
        >
          <Send className="h-4 w-4" />
          {busy ? "Uploading…" : "Send"}
        </button>
      </div>
    </form>
  );
}
