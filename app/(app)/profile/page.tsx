import type { Metadata } from "next";

import { ApiKeyPanel } from "@/components/profile/ApiKeyPanel";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { TelegramPanel } from "@/components/profile/TelegramPanel";
import { RoleBadge } from "@/components/ui/Badge";
import { Card, CardHeader, PageHeader } from "@/components/ui/Card";
import { requireProfile } from "@/lib/auth";
import { telegramConfigured, telegramEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";
import { listApiKeys } from "@/services/telegram";

export const metadata: Metadata = { title: "Profil · IT Helpdesk" };

export default async function ProfilePage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ data: department }, apiKeys] = await Promise.all([
    profile.department_id
      ? supabase
          .from("departments")
          .select("name")
          .eq("id", profile.department_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    listApiKeys(supabase, profile.id),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Profil" description="Informasi akun dan integrasi." />

      <Card>
        <CardHeader title="Account" description="Role and department are managed by an administrator." />
        <dl className="divide-y divide-surface-border text-[13px]">
          <Row label="Email">{profile.email}</Row>
          <Row label="Role">
            <RoleBadge role={profile.role} />
          </Row>
          <Row label="Department">{department?.name ?? "—"}</Row>
          <Row label="Status">
            {profile.is_active ? (
              <span className="text-success-ink">Active</span>
            ) : (
              <span className="text-danger-ink">Inactive</span>
            )}
          </Row>
          <Row label="Member since">{formatDateTime(profile.created_at)}</Row>
        </dl>
      </Card>

      <Card className="mt-5">
        <CardHeader title="Display name" />
        <div className="px-5 py-4">
          <ProfileForm fullName={profile.full_name} />
        </div>
      </Card>

      <div className="mt-5">
        <TelegramPanel
          botUsername={telegramEnv.botUsername()}
          linked={profile.telegram_user_id !== null}
          linkedChatId={profile.telegram_user_id}
          configured={telegramConfigured()}
        />
      </div>

      <div className="mt-5">
        <ApiKeyPanel keys={apiKeys} />
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-medium text-ink">{children}</dd>
    </div>
  );
}
