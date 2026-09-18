import { requireProfile } from "@/lib/auth";
import { countUnread } from "@/services/notifications";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/AppShell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();

  const supabase = await createClient();
  const unread = await countUnread(supabase, profile.id);

  return (
    <AppShell
      user={{
        id: profile.id,
        fullName: profile.full_name,
        email: profile.email,
        role: profile.role,
      }}
      unreadCount={unread}
    >
      {children}
    </AppShell>
  );
}
