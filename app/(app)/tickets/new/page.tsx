import type { Metadata } from "next";

import { CreateTicketForm } from "@/components/tickets/CreateTicketForm";
import { PageHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/Field";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getActiveCategories } from "@/services/tickets";

export const metadata: Metadata = { title: "Create Ticket · IT Helpdesk" };

export default async function NewTicketPage() {
  await requireProfile();
  const supabase = await createClient();
  const categories = await getActiveCategories(supabase);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Create Ticket"
        description="Describe the problem and the IT team will take it from there."
      />
      {categories.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No categories available"
            description="An administrator has to create at least one active category before tickets can be submitted."
          />
        </div>
      ) : (
        <CreateTicketForm categories={categories} />
      )}
    </div>
  );
}
