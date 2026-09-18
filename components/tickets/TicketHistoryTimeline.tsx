import { ArrowRight } from "lucide-react";

import { EmptyState } from "@/components/ui/Field";
import { HISTORY_ACTION_LABEL } from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import type { HistoryWithActor } from "@/types";

const VALUE_LABEL: Record<string, string> = {
  OPEN: "Open",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  WAITING_USER: "Waiting User",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

function label(value: string | null) {
  if (!value) return "—";
  return VALUE_LABEL[value] ?? value;
}

export function TicketHistoryTimeline({ history }: { history: HistoryWithActor[] }) {
  if (!history.length) {
    return (
      <EmptyState
        title="No activity yet"
        description="Changes to this ticket will show up here."
        className="py-8"
      />
    );
  }

  return (
    <ol className="space-y-3">
      {history.map((entry) => {
        const actor = entry.actor?.full_name ?? "System";
        const verb = HISTORY_ACTION_LABEL[entry.action] ?? entry.action.toLowerCase();

        return (
          <li key={entry.id} className="flex gap-3">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-surface-border ring-2 ring-surface" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-ink">
                <span className="font-medium">{actor}</span> {verb}
              </p>

              {entry.action === "COMMENT_ADDED" || entry.action === "ATTACHMENT_ADDED" ? (
                <p className="mt-0.5 truncate text-xs text-ink-muted">{entry.new_value}</p>
              ) : null}

              {entry.action !== "COMMENT_ADDED" &&
              entry.action !== "ATTACHMENT_ADDED" &&
              entry.action !== "CREATED" ? (
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                  <span className="rounded bg-surface-muted px-1.5 py-0.5">
                    {label(entry.old_value)}
                  </span>
                  <ArrowRight className="h-3 w-3 text-ink-subtle" />
                  <span className="rounded bg-surface-muted px-1.5 py-0.5 font-medium text-ink">
                    {label(entry.new_value)}
                  </span>
                </p>
              ) : null}

              <p className="mt-0.5 text-[11px] text-ink-subtle">
                {formatDateTime(entry.created_at)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
