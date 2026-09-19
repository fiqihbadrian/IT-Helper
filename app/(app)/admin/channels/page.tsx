import type { Metadata } from "next";
import { headers } from "next/headers";

import { ChannelManager } from "@/components/admin/ChannelManager";
import { PageHeader } from "@/components/ui/Card";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listAllCategories } from "@/services/admin";
import { listChannels } from "@/services/channels";
import { listDepartments } from "@/services/users";

export const metadata: Metadata = { title: "Channels · Admin · IT Helpdesk" };

/**
 * The origin the embed snippet should point at is the origin the admin is
 * *looking at*, not whatever `NEXT_PUBLIC_APP_URL` happens to say. Reading it
 * off the request means the snippet is correct in production and in local
 * development without anybody remembering to change a variable.
 */
async function currentOrigin(): Promise<string> {
  const store = await headers();
  const host = store.get("x-forwarded-host") ?? store.get("host") ?? "localhost:3000";
  const proto = store.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function AdminChannelsPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [channels, categories, departments, appUrl] = await Promise.all([
    listChannels(supabase),
    listAllCategories(supabase),
    listDepartments(supabase),
    currentOrigin(),
  ]);

  return (
    <>
      <PageHeader
        title="Channels"
        description="Embeddable chat widgets. Each channel is one website; conversations started there become normal tickets."
      />
      <ChannelManager
        channels={channels}
        appUrl={appUrl}
        categories={categories.filter((category) => category.is_active)}
        departments={departments}
      />
    </>
  );
}
