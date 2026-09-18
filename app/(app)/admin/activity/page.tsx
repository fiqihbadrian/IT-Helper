import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Card, CardHeader, PageHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/Field";
import { requireAdmin } from "@/lib/auth";
import { HISTORY_ACTION_LABEL } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";
import { listActivity } from "@/services/admin";

export const metadata: Metadata = { title: "Activity · Admin · IT Helpdesk" };

export default async function AdminActivityPage() {
  await requireAdmin();
  const supabase = await createClient();
  const activity = await listActivity(supabase, 200);

  return (
    <>
      <PageHeader
        title="Activity Logs"
        description="Every ticket change is recorded automatically in the database."
      />

      <Card className="overflow-hidden">
        <CardHeader title={`Last ${activity.length} events`} />

        {activity.length === 0 ? (
          <EmptyState title="No activity recorded yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-[170px]">When</th>
                  <th className="w-[160px]">Actor</th>
                  <th className="w-[170px]">Action</th>
                  <th className="w-[130px]">Ticket</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((entry) => (
                  <tr key={entry.id}>
                    <td className="whitespace-nowrap text-[13px] text-ink-muted">
                      {formatDateTime(entry.created_at)}
                    </td>
                    <td className="text-[13px] text-ink">{entry.actor_name ?? "System"}</td>
                    <td className="text-[13px] text-ink-muted">
                      {HISTORY_ACTION_LABEL[entry.action] ?? entry.action}
                    </td>
                    <td>
                      {entry.ticket_number ? (
                        <Link
                          href={`/tickets?q=${entry.ticket_number}`}
                          className="font-mono text-[13px] text-ink hover:text-accent"
                        >
                          {entry.ticket_number}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="text-[13px] text-ink-muted">
                      {entry.action === "COMMENT_ADDED" || entry.action === "ATTACHMENT_ADDED" ? (
                        <span className="line-clamp-2">{entry.new_value}</span>
                      ) : entry.action === "CREATED" ? (
                        entry.new_value
                      ) : (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded bg-surface-muted px-1.5 py-0.5">
                            {entry.old_value ?? "—"}
                          </span>
                          <ArrowRight className="h-3 w-3 text-ink-subtle" />
                          <span className="rounded bg-surface-muted px-1.5 py-0.5 font-medium text-ink">
                            {entry.new_value ?? "—"}
                          </span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
