"use client";

import { useEffect, useState } from "react";
import { FileText, Image as ImageIcon, Loader2 } from "lucide-react";

import { getAttachmentUrls } from "@/lib/upload";
import { cn, formatFileSize, isImageMime } from "@/lib/utils";
import type { TicketAttachment } from "@/types";

export function AttachmentList({
  attachments,
  className,
  compact = false,
}: {
  attachments: TicketAttachment[];
  className?: string;
  compact?: boolean;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(attachments.length > 0);

  useEffect(() => {
    let cancelled = false;
    if (!attachments.length) {
      setLoading(false);
      return;
    }

    getAttachmentUrls(attachments.map((file) => file.file_path))
      .then((result) => {
        if (!cancelled) setUrls(result);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [attachments]);

  if (!attachments.length) return null;

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-ink-subtle">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading attachments…
      </p>
    );
  }

  return (
    <ul className={cn("space-y-2", className)}>
      {attachments.map((file) => {
        const url = urls[file.file_path];
        const image = isImageMime(file.mime_type);

        return (
          <li key={file.id}>
            {image && url && !compact ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="block w-fit overflow-hidden rounded-md border border-surface-border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={file.file_name}
                  className="max-h-64 w-auto max-w-full object-contain"
                />
              </a>
            ) : (
              <a
                href={url ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-2 rounded-md border border-surface-border bg-surface px-2.5 py-1.5 text-[13px] hover:border-ink-subtle"
              >
                {image ? (
                  <ImageIcon className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                ) : (
                  <FileText className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                )}
                <span className="truncate">{file.file_name}</span>
                <span className="shrink-0 text-xs text-ink-subtle">
                  {formatFileSize(file.file_size)}
                </span>
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
