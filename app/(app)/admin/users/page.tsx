import type { Metadata } from "next";

import { CreateUserForm } from "@/components/admin/CreateUserForm";
import { UserRowControls } from "@/components/admin/UserRowControls";
import { Avatar } from "@/components/ui/Avatar";
import { RoleBadge } from "@/components/ui/Badge";
import { Card, CardHeader, PageHeader } from "@/components/ui/Card";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { listDepartments, listProfiles } from "@/services/users";

export const metadata: Metadata = { title: "Users · Admin · IT Helpdesk" };

export default async function AdminUsersPage() {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const [users, departments] = await Promise.all([
    listProfiles(supabase),
    listDepartments(supabase),
  ]);

  return (
    <>
      <PageHeader
        title="Users"
        description="Create accounts, change roles and deactivate access. Accounts are never deleted so tickets keep their references."
        action={<CreateUserForm departments={departments} />}
      />

      <Card className="overflow-hidden">
        <CardHeader
          title={`${users.length} accounts`}
          description="Deactivating a user blocks sign-in and removes them from assignment lists."
        />

        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th className="w-[120px]">Role</th>
                <th className="w-[120px]">Status</th>
                <th className="w-[110px]">Created</th>
                <th className="w-[420px]">Manage</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <span className="flex items-center gap-2">
                      <Avatar name={user.full_name} size="sm" />
                      <span className="font-medium text-ink">{user.full_name}</span>
                      {user.id === profile.id ? (
                        <span className="text-xs text-ink-subtle">(you)</span>
                      ) : null}
                    </span>
                  </td>
                  <td className="text-[13px] text-ink-muted">{user.email}</td>
                  <td>
                    <RoleBadge role={user.role} />
                  </td>
                  <td>
                    {user.is_active ? (
                      <span className="inline-flex items-center gap-1.5 text-[13px] text-success-ink">
                        <span data-tone="resolved" className="tone-dot h-1.5 w-1.5 rounded-full" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted">
                        <span data-tone="closed" className="tone-dot h-1.5 w-1.5 rounded-full" />
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="text-[13px] text-ink-muted">{formatDate(user.created_at)}</td>
                  <td>
                    <UserRowControls
                      userId={user.id}
                      role={user.role}
                      departmentId={user.department_id}
                      isActive={user.is_active}
                      departments={departments}
                      isSelf={user.id === profile.id}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
