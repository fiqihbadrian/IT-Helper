"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserCheck } from "lucide-react";

import { assignToMe, updateTicket } from "@/app/actions/tickets";
import { Alert } from "@/components/ui/Field";
import { PRIORITY_META, STATUS_META, TICKET_PRIORITIES, TICKET_STATUSES } from "@/lib/constants";
import type { Category, Profile, TicketPriority, TicketStatus, TicketWithRelations } from "@/types";

interface TicketControlsProps {
  ticket: TicketWithRelations;
  categories: Category[];
  technicians: Profile[];
  currentUserId: string;
}

export function TicketControls({
  ticket,
  categories,
  technicians,
  currentUserId,
}: TicketControlsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "Update failed");
      else router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {error ? <Alert>{error}</Alert> : null}

      <ControlRow label="Status" busy={pending}>
        <select
          className="input"
          value={ticket.status}
          disabled={pending}
          onChange={(event) =>
            run(() =>
              updateTicket({ ticketId: ticket.id, status: event.target.value as TicketStatus }),
            )
          }
        >
          {TICKET_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_META[status].label}
            </option>
          ))}
        </select>
      </ControlRow>

      <ControlRow label="Priority" busy={pending}>
        <select
          className="input"
          value={ticket.priority}
          disabled={pending}
          onChange={(event) =>
            run(() =>
              updateTicket({
                ticketId: ticket.id,
                priority: event.target.value as TicketPriority,
              }),
            )
          }
        >
          {TICKET_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_META[priority].label}
            </option>
          ))}
        </select>
      </ControlRow>

      <ControlRow label="Category" busy={pending}>
        <select
          className="input"
          value={ticket.category_id ?? ""}
          disabled={pending}
          onChange={(event) =>
            run(() =>
              updateTicket({
                ticketId: ticket.id,
                categoryId: event.target.value || null,
              }),
            )
          }
        >
          <option value="">Uncategorised</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </ControlRow>

      <ControlRow label="Assignee" busy={pending}>
        <select
          className="input"
          value={ticket.assigned_to ?? ""}
          disabled={pending}
          onChange={(event) =>
            run(() =>
              updateTicket({
                ticketId: ticket.id,
                assignedTo: event.target.value || null,
              }),
            )
          }
        >
          <option value="">Unassigned</option>
          {technicians.map((technician) => (
            <option key={technician.id} value={technician.id}>
              {technician.full_name}
            </option>
          ))}
        </select>
      </ControlRow>

      {ticket.assigned_to !== currentUserId ? (
        <button
          type="button"
          className="btn-secondary w-full"
          disabled={pending}
          onClick={() => run(() => assignToMe(ticket.id))}
        >
          <UserCheck className="h-4 w-4" />
          Assign to me
        </button>
      ) : null}
    </div>
  );
}

function ControlRow({
  label,
  busy,
  children,
}: {
  label: string;
  busy: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[13px] font-medium text-ink">{label}</span>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-subtle" /> : null}
      </div>
      {children}
    </div>
  );
}
