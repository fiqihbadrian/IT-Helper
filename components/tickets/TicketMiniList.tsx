import Link from "next/link";

import { PriorityBadge, StatusBadge, TicketNumber } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/Field";
import { formatRelative } from "@/lib/utils";
import type { TicketWithRelations } from "@/types";

export function TicketMiniList({
  tickets,
  showRequester = true,
  emptyTitle = "Nothing here",
  emptyDescription,
}: {
  tickets: TicketWithRelations[];
  showRequester?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (!tickets.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} className="py-10" />;
  }

  return (
    <ul className="divide-y divide-surface-border">
      {tickets.map((ticket) => (
        <li key={ticket.id}>
          <Link
            href={`/tickets/${ticket.id}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3 transition-colors hover:bg-surface-muted/60"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <TicketNumber number={ticket.ticket_number} />
                {showRequester && ticket.requester ? (
                  <span className="truncate text-xs text-ink-subtle">
                    · {ticket.requester.full_name}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 truncate text-[13px] font-medium text-ink">{ticket.title}</p>
            </div>
            <div className="flex items-center gap-2">
              <PriorityBadge priority={ticket.priority} />
              <StatusBadge status={ticket.status} />
              <span className="hidden w-24 text-right text-xs text-ink-subtle sm:block">
                {formatRelative(ticket.updated_at)}
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
