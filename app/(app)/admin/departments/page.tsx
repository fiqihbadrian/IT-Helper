import type { Metadata } from "next";

import { DepartmentManager } from "@/components/admin/DepartmentManager";
import { PageHeader } from "@/components/ui/Card";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listDepartments } from "@/services/users";

export const metadata: Metadata = { title: "Departments · Admin · IT Helpdesk" };

export default async function AdminDepartmentsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const departments = await listDepartments(supabase);

  return (
    <>
      <PageHeader
        title="Departments"
        description="Organisational units used to group users and filter tickets."
      />
      <DepartmentManager departments={departments} />
    </>
  );
}
