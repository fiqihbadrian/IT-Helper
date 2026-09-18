"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Bell, LogOut, Menu, X } from "lucide-react";

import { signOut } from "@/app/actions/auth";
import { Avatar } from "@/components/ui/Avatar";
import { RoleBadge } from "@/components/ui/Badge";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { ROLE_META } from "@/lib/constants";
import { buildHref, DEFAULT_TICKET_SCOPE, NAV_BY_ROLE, type NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/types";

interface AppShellProps {
  user: { id: string; fullName: string; email: string; role: UserRole };
  unreadCount: number;
  children: React.ReactNode;
}

export function AppShell({ user, unreadCount, children }: AppShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname, searchParams]);

  const sections = NAV_BY_ROLE[user.role];
  const defaultScope = DEFAULT_TICKET_SCOPE[user.role];

  const isActive = (item: NavItem) => {
    const base = item.href.split("?")[0];
    const itemScope = item.query?.scope;
    if (itemScope) {
      return pathname === base && (searchParams.get("scope") ?? defaultScope) === itemScope;
    }
    return pathname === base || pathname.startsWith(`${base}/`);
  };

  const primaryItems = sections[0]?.items ?? [];
  const bottomItems = primaryItems.slice(0, 4);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 border-b border-surface-border px-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-ink text-[11px] font-bold text-surface">
          IT
        </span>
        <span className="text-sm font-semibold tracking-tight">Helpdesk</span>
        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          className="btn-ghost ml-auto p-1.5 lg:hidden"
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
        {sections.map((section, index) => (
          <div key={section.title ?? index} className={index > 0 ? "mt-6" : undefined}>
            {section.title ? (
              <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                {section.title}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item);
                const Icon = item.icon;
                return (
                  <li key={`${item.href}-${item.label}`}>
                    <Link
                      href={buildHref(item)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
                        active
                          ? "bg-accent-soft text-accent"
                          : "text-ink-muted hover:bg-surface-muted hover:text-ink",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                      {item.href === "/notifications" && unreadCount > 0 ? (
                        <span className="ml-auto rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-surface-border p-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={user.fullName} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink">{user.fullName}</p>
            <p className="truncate text-[11px] text-ink-muted">{ROLE_META[user.role].label}</p>
          </div>
          <form action={signOut}>
            <button type="submit" className="btn-ghost p-2" aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-surface-border bg-surface lg:block">
        {sidebar}
      </aside>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-64 border-r border-surface-border bg-surface shadow-lg">
            {sidebar}
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-surface-border bg-surface/95 px-4 backdrop-blur lg:px-6">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="btn-ghost p-2 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-4 w-4" />
          </button>

          <Link href="/dashboard" className="text-sm font-semibold tracking-tight lg:hidden">
            IT Helpdesk
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link
              href="/notifications"
              className="btn-ghost relative p-2"
              aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 ? (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-danger" />
              ) : null}
            </Link>
            <div className="hidden items-center gap-2 sm:flex">
              <Avatar name={user.fullName} size="sm" />
              <span className="text-[13px] font-medium">{user.fullName}</span>
              <RoleBadge role={user.role} />
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-5 pb-24 lg:px-6 lg:py-6 lg:pb-6">{children}</main>

        <nav
          className="fixed inset-x-0 bottom-0 z-30 grid border-t border-surface-border bg-surface lg:hidden"
          style={{ gridTemplateColumns: `repeat(${bottomItems.length + 1}, minmax(0, 1fr))` }}
          aria-label="Primary"
        >
          {bottomItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            return (
              <Link
                key={`bottom-${item.href}-${item.label}`}
                href={buildHref(item)}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium",
                  active ? "text-accent" : "text-ink-muted",
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="truncate px-1">{item.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium text-ink-muted"
          >
            <Menu className="h-4 w-4" />
            <span>More</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
