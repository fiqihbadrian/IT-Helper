"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CheckCheck, Loader2 } from "lucide-react";

import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/app/actions/notifications";
import { EmptyState } from "@/components/ui/Field";
import { cn, formatRelative } from "@/lib/utils";
import type { Notification } from "@/types";

export function NotificationList({
  notifications,
}: {
  notifications: Notification[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean }>) {
    startTransition(async () => {
      await action();
      router.refresh();
    });
  }

  if (!notifications.length) {
    return (
      <EmptyState
        title="No notifications"
        description="You will be notified when a ticket is created, assigned or replied to."
      />
    );
  }

  const unread = notifications.filter((item) => !item.is_read).length;

  return (
    <>
      <div className="flex items-center justify-between border-b border-surface-border px-4 py-2.5">
        <span className="text-[13px] text-ink-muted">
          {unread > 0 ? `${unread} unread` : "All caught up"}
        </span>
        {unread > 0 ? (
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-[13px]"
            disabled={pending}
            onClick={() => run(markAllNotificationsRead)}
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCheck className="h-3.5 w-3.5" />
            )}
            Mark all as read
          </button>
        ) : null}
      </div>

      <ul className="divide-y divide-surface-border">
        {notifications.map((item) => (
          <li
            key={item.id}
            className={cn("flex items-start gap-3 px-4 py-3.5", !item.is_read && "bg-accent/10")}
          >
            <span
              className={cn(
                "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                item.is_read ? "bg-surface-border" : "bg-accent",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                {item.ticket_id ? (
                  <Link
                    href={`/tickets/${item.ticket_id}`}
                    className="text-[13px] font-medium text-ink hover:text-accent"
                  >
                    {item.title}
                  </Link>
                ) : (
                  <span className="text-[13px] font-medium text-ink">{item.title}</span>
                )}
                <span className="text-[11px] text-ink-subtle">
                  {formatRelative(item.created_at)}
                </span>
              </div>
              <p className="mt-0.5 text-[13px] text-ink-muted">{item.message}</p>
            </div>

            {!item.is_read ? (
              <button
                type="button"
                className="btn-ghost p-1.5"
                aria-label="Mark as read"
                disabled={pending}
                onClick={() => run(() => markNotificationRead(item.id))}
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
