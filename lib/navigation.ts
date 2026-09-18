import {
  Activity,
  AlertTriangle,
  Bell,
  Building2,
  ClipboardList,
  Inbox,
  LayoutDashboard,
  PlusCircle,
  Settings,
  Tags,
  Ticket as TicketIcon,
  UserCircle,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { UserRole } from "@/types";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Extra query parameters appended to the href. */
  query?: Record<string, string>;
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

export const NAV_BY_ROLE: Record<UserRole, NavSection[]> = {
  employee: [
    {
      items: [
        { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
        { label: "My Tickets", href: "/tickets", icon: ClipboardList, query: { scope: "created" } },
        { label: "Create Ticket", href: "/tickets/new", icon: PlusCircle },
      ],
    },
    {
      items: [
        { label: "Notifications", href: "/notifications", icon: Bell },
        { label: "Profile", href: "/profile", icon: UserCircle },
      ],
    },
  ],
  it_support: [
    {
      items: [
        { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
        { label: "All Tickets", href: "/tickets", icon: TicketIcon, query: { scope: "all" } },
        { label: "My Tickets", href: "/tickets", icon: ClipboardList, query: { scope: "mine" } },
        { label: "Unassigned", href: "/tickets", icon: Inbox, query: { scope: "unassigned" } },
        { label: "High Priority", href: "/tickets", icon: AlertTriangle, query: { scope: "high_priority" } },
      ],
    },
    {
      items: [
        { label: "Notifications", href: "/notifications", icon: Bell },
        { label: "Profile", href: "/profile", icon: UserCircle },
      ],
    },
  ],
  admin: [
    {
      items: [
        { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
        { label: "Tickets", href: "/tickets", icon: TicketIcon, query: { scope: "all" } },
      ],
    },
    {
      title: "Administration",
      items: [
        { label: "Users", href: "/admin/users", icon: Users },
        { label: "Departments", href: "/admin/departments", icon: Building2 },
        { label: "Categories", href: "/admin/categories", icon: Tags },
        { label: "Activity Logs", href: "/admin/activity", icon: Activity },
      ],
    },
    {
      items: [
        { label: "Notifications", href: "/notifications", icon: Bell },
        { label: "Profile", href: "/profile", icon: UserCircle },
        { label: "Settings", href: "/admin/settings", icon: Settings },
      ],
    },
  ],
};

export const DEFAULT_TICKET_SCOPE: Record<UserRole, string> = {
  employee: "created",
  it_support: "all",
  admin: "all",
};

export function buildHref(item: NavItem) {
  if (!item.query) return item.href;
  const search = new URLSearchParams(item.query);
  return `${item.href}?${search.toString()}`;
}
