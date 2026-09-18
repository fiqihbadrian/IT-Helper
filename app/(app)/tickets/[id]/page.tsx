import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ReplyForm } from "@/components/tickets/ReplyForm";
import { TicketControls } from "@/components/tickets/TicketControls";
import { TicketConversation } from "@/components/tickets/TicketConversation";
import { TicketHistoryTimeline } from "@/components/tickets/TicketHistoryTimeline";
import { Avatar } from "@/components/ui/Avatar";
import { PriorityBadge, StatusBadge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";
import {
  getActiveCategories,
  getActiveTechnicians,
  getTicketDetail,
} from "@/services/tickets";

export const metadata: Metadata = { title: "Ticket · IT Helpdesk" };

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();

  const detail = await getTicketDetail(supabase, id);
  // RLS already hides other people's tickets, so this is also the 403 path
  if (!detail) notFound();

  const { ticket, comments, history, attachments } = detail;
  const isStaff = profile.role !== "employee";

  const [categories, technicians] = await Promise.all([
    isStaff ? getActiveCategories(supabase) : Promise.resolve([]),
    isStaff ? getActiveTechnicians(supabase) : Promise.resolve([]),
  ]);

  const backHref = isStaff ? "/tickets?scope=all" : "/tickets?scope=created";

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href={backHref}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to tickets
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-ink">
              #{ticket.ticket_number}
            </span>
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
          </div>
          <h1 className="mt-2 text-lg font-semibold tracking-tight text-ink lg:text-xl">
            {ticket.title}
          </h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            {ticket.category?.name ?? "Uncategorised"} · opened{" "}
            {formatDateTime(ticket.created_at)}
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <Card className="overflow-hidden">
            <CardHeader
              title="Conversation"
              description={`${comments.length + 1} message${comments.length ? "s" : ""}`}
            />
            <TicketConversation
              ticket={ticket}
              comments={comments}
              attachments={attachments}
            />
            <ReplyForm ticketId={ticket.id} />
          </Card>

          <Card className="lg:hidden">
            <CardHeader title="Activity history" />
            <div className="px-5 py-4">
              <TicketHistoryTimeline history={history} />
            </div>
          </Card>
        </div>

        <aside className="space-y-5">
          {isStaff ? (
            <Card>
              <CardHeader title="Ticket management" />
              <div className="px-5 py-4">
                <TicketControls
                  ticket={ticket}
                  categories={categories}
                  technicians={technicians}
                  currentUserId={profile.id}
                />
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Details" />
            <dl className="divide-y divide-surface-border text-[13px]">
              <DetailRow label="Requester">
                <span className="flex items-center gap-2">
                  <Avatar name={ticket.requester?.full_name} size="sm" />
                  <span className="truncate">{ticket.requester?.full_name ?? "—"}</span>
                </span>
              </DetailRow>
              <DetailRow label="Email">
                <span className="truncate">{ticket.requester?.email ?? "—"}</span>
              </DetailRow>
              <DetailRow label="Assignee">
                {ticket.assignee ? (
                  <span className="flex items-center gap-2">
                    <Avatar name={ticket.assignee.full_name} size="sm" />
                    <span className="truncate">{ticket.assignee.full_name}</span>
                  </span>
                ) : (
                  <span className="text-ink-subtle">Unassigned</span>
                )}
              </DetailRow>
              <DetailRow label="Category">
                {ticket.category?.name ?? "Uncategorised"}
              </DetailRow>
              <DetailRow label="Created">{formatDateTime(ticket.created_at)}</DetailRow>
              <DetailRow label="Updated">{formatDateTime(ticket.updated_at)}</DetailRow>
              {ticket.resolved_at ? (
                <DetailRow label="Resolved">{formatDateTime(ticket.resolved_at)}</DetailRow>
              ) : null}
              {ticket.closed_at ? (
                <DetailRow label="Closed">{formatDateTime(ticket.closed_at)}</DetailRow>
              ) : null}
            </dl>
          </Card>

          <Card className="hidden lg:block">
            <CardHeader title="Activity history" />
            <div className="max-h-[520px] overflow-y-auto px-5 py-4">
              <TicketHistoryTimeline history={history} />
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 py-2.5">
      <dt className="shrink-0 text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-ink">{children}</dd>
    </div>
  );
}
