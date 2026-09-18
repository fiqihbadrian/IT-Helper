import type { Metadata } from "next";

import { CategoryManager } from "@/components/admin/CategoryManager";
import { PageHeader } from "@/components/ui/Card";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listAllCategories } from "@/services/admin";

export const metadata: Metadata = { title: "Categories · Admin · IT Helpdesk" };

export default async function AdminCategoriesPage() {
  await requireAdmin();
  const supabase = await createClient();
  const categories = await listAllCategories(supabase);

  return (
    <>
      <PageHeader
        title="Categories"
        description="Ticket categories shown on the create ticket form."
      />
      <CategoryManager categories={categories} />
    </>
  );
}
