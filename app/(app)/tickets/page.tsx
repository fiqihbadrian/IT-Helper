import type { Metadata } from "next";
import Link from "next/link";
import { PlusCircle } from "lucide-react";

import { TicketFilterBar } from "@/components/tickets/TicketFilterBar";
import { TicketTable } from "@/components/tickets/TicketTable";
import { Card, PageHeader } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/StatCard";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getActiveCategories,
  getActiveTechnicians,
  listTickets,
} from "@/services/tickets";
import { listDepartments } from "@/services/users";
import type {
  TicketFilters,
  TicketPriority,
  TicketScope,
  TicketSort,
  TicketStatus,
} from "@/types";

export const metadata: Metadata = { title: "Tickets · IT Helpdesk" };

const SCOPE_TITLE: Record<TicketScope, { title: string; description: string }> = {
  all: { title: "All Tickets", description: "Every ticket in the system." },
  created: { title: "My Tickets", description: "Tickets you have reported." },
  mine: { title: "Assigned to Me", description: "Tickets currently on your plate." },
  unassigned: { title: "Unassigned", description: "Waiting for a technician." },
  high_priority: { title: "High Priority", description: "HIGH and CRITICAL tickets." },
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function TicketsPage({ searchParams }: PageProps) {
  const profile = await requireProfile();
  const params = await searchParams;
  const isStaff = profile.role !== "employee";

  const requestedScope = (single(params.scope) ?? (isStaff ? "all" : "created")) as TicketScope;
  // employees only ever see their own tickets, whatever the URL says
  const scope: TicketScope = isStaff ? requestedScope : "created";

  const filters: TicketFilters = {
    scope,
    search: single(params.q),
    status: (single(params.status) as TicketStatus | undefined) ?? "ALL",
    priority: (single(params.priority) as TicketPriority | undefined) ?? "ALL",
    categoryId: single(params.category),
    technicianId: single(params.technician),
    departmentId: single(params.department),
    dateFrom: single(params.from),
    dateTo: single(params.to),
    sort: (single(params.sort) as TicketSort | undefined) ?? "newest",
  };

  const page = Number(single(params.page) ?? "1") || 1;

  const supabase = await createClient();
  const [result, categories, technicians, departments] = await Promise.all([
    listTickets(supabase, filters, profile.id, { page }),
    getActiveCategories(supabase),
    isStaff ? getActiveTechnicians(supabase) : Promise.resolve([]),
    isStaff ? listDepartments(supabase) : Promise.resolve([]),
  ]);

  const heading = SCOPE_TITLE[scope] ?? SCOPE_TITLE.all;

  const queryForPagination: Record<string, string | undefined> = {
    scope: single(params.scope),
    status: single(params.status),
    priority: single(params.priority),
    category: single(params.category),
    technician: single(params.technician),
    department: single(params.department),
    from: single(params.from),
    to: single(params.to),
    q: single(params.q),
    sort: single(params.sort),
  };

  return (
    <>
      <PageHeader
        title={heading.title}
        description={heading.description}
        action={
          <Link href="/tickets/new" className="btn-primary">
            <PlusCircle className="h-4 w-4" />
            Create Ticket
          </Link>
        }
      />

      <Card className="overflow-hidden">
        <TicketFilterBar
          categories={categories}
          technicians={technicians}
          departments={departments}
          compact={!isStaff}
        />

        <div className="flex items-center justify-between px-4 py-2.5 text-[13px] text-ink-muted">
          <span>
            {result.total} {result.total === 1 ? "ticket" : "tickets"}
          </span>
        </div>

        <TicketTable
          tickets={result.tickets}
          showAssignee={scope !== "mine"}
          emptyTitle="No tickets found"
          emptyDescription={
            isStaff
              ? "Try clearing the filters or searching for a different term."
              : "You have not created any ticket yet."
          }
          emptyAction={
            !isStaff ? (
              <Link href="/tickets/new" className="btn-primary">
                <PlusCircle className="h-4 w-4" />
                Create Ticket
              </Link>
            ) : undefined
          }
        />

        <Pagination
          page={result.page}
          pageCount={result.pageCount}
          basePath="/tickets"
          params={queryForPagination}
        />
      </Card>
    </>
  );
}
