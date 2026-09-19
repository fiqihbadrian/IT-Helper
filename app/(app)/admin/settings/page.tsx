import type { Metadata } from "next";

import { Card, CardHeader, PageHeader } from "@/components/ui/Card";
import { requireAdmin } from "@/lib/auth";
import { describeDatabaseRoute, isCloudflareRuntime } from "@/lib/db/pool";
import { telegramConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getDashboardStats } from "@/services/tickets";
import { listAllCategories } from "@/services/admin";
import { listDepartments, listProfiles } from "@/services/users";

export const metadata: Metadata = { title: "Settings · Admin · IT Helpdesk" };

export default async function AdminSettingsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [users, departments, categories, stats] = await Promise.all([
    listProfiles(supabase),
    listDepartments(supabase),
    listAllCategories(supabase),
    getDashboardStats(supabase),
  ]);
  const database = describeDatabaseRoute();
  const onWorkers = isCloudflareRuntime();

  return (
    <>
      <PageHeader
        title="Settings"
        description="Read-only overview of the running system."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Workspace" />
          <dl className="divide-y divide-surface-border text-[13px]">
            <Row label="Users">{users.length}</Row>
            <Row label="Active users">{users.filter((user) => user.is_active).length}</Row>
            <Row label="Departments">{departments.length}</Row>
            <Row label="Categories">
              {categories.length} ({categories.filter((category) => category.is_active).length} active)
            </Row>
            <Row label="Total tickets">{stats.total}</Row>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Storage & attachments" />
          <dl className="divide-y divide-surface-border text-[13px]">
            <Row label="Bucket">
              <span className="font-mono">
                {process.env.NEXT_PUBLIC_TICKET_BUCKET ?? "ticket-attachments"}
              </span>
            </Row>
            <Row label="Visibility">Private (signed URLs)</Row>
            <Row label="Max file size">10 MB</Row>
            <Row label="Signed URL lifetime">60 minutes</Row>
          </dl>
        </Card>

        <Card>
          <CardHeader
            title="Runtime"
            description="Where the app runs and how it reaches Postgres."
          />
          <dl className="divide-y divide-surface-border text-[13px]">
            <Row label="Platform">
              {onWorkers ? "Cloudflare Workers" : "Node.js"}
            </Row>
            <Row label="Database route">
              {database.kind === "hyperdrive" ? "Hyperdrive" : "Direct pool"}
            </Row>
            <Row label="Database host">
              <span className="font-mono">{database.host}</span>
            </Row>
            <Row label="Query cache">
              {database.kind === "hyperdrive" ? (
                <span className="text-ink-muted">
                  Disabled — required, the cache key ignores row-level security
                </span>
              ) : (
                <span className="text-ink-muted">Not applicable</span>
              )}
            </Row>
          </dl>
        </Card>

        <Card>
          <CardHeader
            title="Notification channels"
            description="Notifications are stored once and dispatched per channel."
          />
          <dl className="divide-y divide-surface-border text-[13px]">
            <Row label="Web (in-app)">
              <span className="text-success-ink">Enabled</span>
            </Row>
            <Row label="Telegram — bot karyawan">
              {telegramConfigured("employee") ? (
                <span className="text-success-ink">Enabled</span>
              ) : (
                <span className="text-ink-muted">Set BOT_TELE_KARYAWAN to enable</span>
              )}
            </Row>
            <Row label="Telegram — bot tim IT">
              {telegramConfigured("staff") ? (
                <span className="text-success-ink">Enabled</span>
              ) : (
                <span className="text-ink-muted">Set BOT_TELE_ADMIN to enable</span>
              )}
            </Row>
            <Row label="Email">
              <span className="text-ink-muted">Planned</span>
            </Row>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Roadmap" description="Where the platform is headed." />
          <ol className="divide-y divide-surface-border text-[13px]">
            <Row label="Phase 1">Ticketing, RLS, dashboards — done</Row>
            <Row label="Phase 2">Telegram bot on the same ticket data — done</Row>
            <Row label="Phase 3">Asset management (devices table ready)</Row>
            <Row label="Phase 4">Remote support agent (remote_sessions table ready)</Row>
          </ol>
        </Card>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{children}</dd>
    </div>
  );
}
