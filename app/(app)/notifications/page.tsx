import type { Metadata } from "next";

import { NotificationList } from "@/components/notifications/NotificationList";
import { Card, PageHeader } from "@/components/ui/Card";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listNotifications } from "@/services/notifications";

export const metadata: Metadata = { title: "Notifications · IT Helpdesk" };

export default async function NotificationsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const notifications = await listNotifications(supabase, profile.id);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        description="Ticket updates that involve you."
      />
      <Card className="overflow-hidden">
        <NotificationList notifications={notifications} />
      </Card>
    </div>
  );
}
