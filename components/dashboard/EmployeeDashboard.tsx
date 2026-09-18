import Link from "next/link";
import { PlusCircle } from "lucide-react";

import { TicketTable } from "@/components/tickets/TicketTable";
import { Card, CardHeader, PageHeader } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { getDashboardStats, getRecentTickets } from "@/services/tickets";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types";

export async function EmployeeDashboard({ profile }: { profile: Profile }) {
  const supabase = await createClient();
  const [stats, recent] = await Promise.all([
    getDashboardStats(supabase),
    getRecentTickets(supabase, 5, "created", profile.id),
  ]);

  return (
    <>
      <PageHeader
        title={`Hello, ${profile.full_name.split(" ")[0]}`}
        description="Track the issues you have reported to IT Support."
        action={
          <Link href="/tickets/new" className="btn-primary">
            <PlusCircle className="h-4 w-4" />
            Create Ticket
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Open"
          value={stats.open}
          tone="open"
          href="/tickets?scope=created&status=OPEN"
        />
        <StatCard
          label="In Progress"
          value={stats.assigned + stats.inProgress}
          tone="progress"
          href="/tickets?scope=created&status=IN_PROGRESS"
        />
        <StatCard
          label="Waiting User"
          value={stats.waitingUser}
          tone="waiting"
          href="/tickets?scope=created&status=WAITING_USER"
        />
        <StatCard
          label="Resolved"
          value={stats.resolved + stats.closed}
          tone="resolved"
          href="/tickets?scope=created&status=RESOLVED"
        />
      </div>

      <Card className="mt-5">
        <CardHeader
          title="Recent Tickets"
          description="Your five most recent reports."
          action={
            <Link href="/tickets?scope=created" className="btn-secondary px-3 py-1.5">
              View all
            </Link>
          }
        />
        <TicketTable
          tickets={recent}
          showRequester={false}
          showAssignee
          emptyTitle="You have not created any ticket yet"
          emptyDescription="Report a problem and the IT team will pick it up."
          emptyAction={
            <Link href="/tickets/new" className="btn-primary">
              <PlusCircle className="h-4 w-4" />
              Create Ticket
            </Link>
          }
        />
      </Card>
    </>
  );
}
