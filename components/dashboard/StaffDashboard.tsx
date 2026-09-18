import Link from "next/link";

import { TicketMiniList } from "@/components/tickets/TicketMiniList";
import { TicketTable } from "@/components/tickets/TicketTable";
import { Card, CardHeader, PageHeader } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { createClient } from "@/lib/supabase/server";
import {
  getDashboardStats,
  getRecentTickets,
  listTickets,
} from "@/services/tickets";
import type { Profile } from "@/types";

export async function StaffDashboard({ profile }: { profile: Profile }) {
  const supabase = await createClient();

  const [stats, urgent, unassigned, mine, recent] = await Promise.all([
    getDashboardStats(supabase),
    listTickets(
      supabase,
      { scope: "high_priority", status: "OPEN", sort: "priority" },
      profile.id,
      { pageSize: 5 },
    ),
    listTickets(supabase, { scope: "unassigned", sort: "newest" }, profile.id, { pageSize: 5 }),
    listTickets(supabase, { scope: "mine", sort: "updated" }, profile.id, { pageSize: 5 }),
    getRecentTickets(supabase, 6, "all", profile.id),
  ]);

  return (
    <>
      <PageHeader
        title="IT Support Dashboard"
        description="Everything that needs attention across the queue."
        action={
          <Link href="/tickets?scope=unassigned" className="btn-secondary">
            Unassigned queue
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Open"
          value={stats.open}
          tone="open"
          href="/tickets?scope=all&status=OPEN"
        />
        <StatCard
          label="In Progress"
          value={stats.assigned + stats.inProgress}
          tone="progress"
          href="/tickets?scope=all&status=IN_PROGRESS"
        />
        <StatCard
          label="Waiting User"
          value={stats.waitingUser}
          tone="waiting"
          href="/tickets?scope=all&status=WAITING_USER"
        />
        <StatCard
          label="Resolved"
          value={stats.resolved + stats.closed}
          tone="resolved"
          href="/tickets?scope=all&status=RESOLVED"
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Unassigned"
          value={stats.unassigned}
          tone="critical"
          href="/tickets?scope=unassigned"
        />
        <StatCard
          label="Assigned to me"
          value={stats.assignedToMe}
          tone="assigned"
          href="/tickets?scope=mine"
        />
        <StatCard
          label="High priority"
          value={stats.highPriority}
          tone="high"
          href="/tickets?scope=high_priority"
        />
        <StatCard
          label="Total tickets"
          value={stats.total}
          tone="closed"
          href="/tickets?scope=all"
        />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Urgent tickets"
            description="Open tickets with HIGH or CRITICAL priority."
            action={
              <Link href="/tickets?scope=high_priority" className="btn-ghost px-2 py-1 text-xs">
                View all
              </Link>
            }
          />
          <TicketMiniList
            tickets={urgent.tickets}
            emptyTitle="No urgent tickets"
            emptyDescription="Nothing high or critical is currently open."
          />
        </Card>

        <Card>
          <CardHeader
            title="Unassigned"
            description="Waiting for a technician to pick them up."
            action={
              <Link href="/tickets?scope=unassigned" className="btn-ghost px-2 py-1 text-xs">
                View all
              </Link>
            }
          />
          <TicketMiniList
            tickets={unassigned.tickets}
            emptyTitle="Queue is clear"
            emptyDescription="Every open ticket already has an owner."
          />
        </Card>

        <Card>
          <CardHeader
            title="Assigned to me"
            description="Your own workload, most recently updated first."
            action={
              <Link href="/tickets?scope=mine" className="btn-ghost px-2 py-1 text-xs">
                View all
              </Link>
            }
          />
          <TicketMiniList
            tickets={mine.tickets}
            showRequester
            emptyTitle="Nothing assigned to you"
            emptyDescription="Pick a ticket from the unassigned queue."
          />
        </Card>

        <Card>
          <CardHeader
            title="Latest activity"
            description="Newest tickets across all departments."
            action={
              <Link href="/tickets?scope=all" className="btn-ghost px-2 py-1 text-xs">
                View all
              </Link>
            }
          />
          <TicketMiniList tickets={recent} emptyTitle="No tickets yet" />
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Recently updated" description="Full list view of the latest changes." />
        <TicketTable tickets={recent} />
      </Card>
    </>
  );
}
