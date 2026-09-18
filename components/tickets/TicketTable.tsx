import Link from "next/link";

import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/Field";
import { PriorityBadge, StatusBadge, TicketNumber } from "@/components/ui/Badge";
import { formatRelative, truncate } from "@/lib/utils";
import type { TicketWithRelations } from "@/types";

interface TicketTableProps {
  tickets: TicketWithRelations[];
  showRequester?: boolean;
  showAssignee?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
}

export function TicketTable({
  tickets,
  showRequester = true,
  showAssignee = true,
  emptyTitle = "No tickets found",
  emptyDescription = "Nothing matches the current filters.",
  emptyAction,
}: TicketTableProps) {
  if (!tickets.length) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  return (
    <>
      {/* Desktop */}
      <div className="hidden overflow-x-auto md:block">
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-[104px]">Ticket</th>
              <th>Subject</th>
              {showRequester ? <th className="w-[180px]">Requester</th> : null}
              {showAssignee ? <th className="w-[170px]">Assignee</th> : null}
              <th className="w-[120px]">Priority</th>
              <th className="w-[140px]">Status</th>
              <th className="w-[110px]">Updated</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              <tr key={ticket.id}>
                <td>
                  <TicketNumber number={ticket.ticket_number} href={`/tickets/${ticket.id}`} />
                </td>
                <td className="max-w-md">
                  <Link
                    href={`/tickets/${ticket.id}`}
                    className="font-medium text-ink hover:text-accent"
                  >
                    {ticket.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-ink-subtle">
                    {ticket.category?.name ?? "Uncategorised"}
                  </p>
                </td>
                {showRequester ? (
                  <td>
                    <span className="text-[13px] text-ink-muted">
                      {ticket.requester?.full_name ?? "—"}
                    </span>
                  </td>
                ) : null}
                {showAssignee ? (
                  <td>
                    {ticket.assignee ? (
                      <span className="flex items-center gap-2">
                        <Avatar name={ticket.assignee.full_name} size="sm" />
                        <span className="text-[13px] text-ink-muted">
                          {ticket.assignee.full_name}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[13px] text-ink-subtle">Unassigned</span>
                    )}
                  </td>
                ) : null}
                <td>
                  <PriorityBadge priority={ticket.priority} />
                </td>
                <td>
                  <StatusBadge status={ticket.status} />
                </td>
                <td className="text-[13px] text-ink-muted">
                  {formatRelative(ticket.updated_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <ul className="divide-y divide-surface-border md:hidden">
        {tickets.map((ticket) => (
          <li key={ticket.id}>
            <Link href={`/tickets/${ticket.id}`} className="block px-4 py-3.5">
              <div className="flex items-center justify-between gap-2">
                <TicketNumber number={ticket.ticket_number} />
                <StatusBadge status={ticket.status} />
              </div>
              <p className="mt-1.5 text-sm font-medium text-ink">{ticket.title}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {truncate(ticket.description, 90)}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <PriorityBadge priority={ticket.priority} />
                <span className="text-xs text-ink-subtle">
                  {ticket.category?.name ?? "Uncategorised"}
                </span>
                <span className="ml-auto text-xs text-ink-subtle">
                  {formatRelative(ticket.updated_at)}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
