import Link from "next/link";

import { PRIORITY_META, ROLE_META, STATUS_META } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { TicketPriority, TicketStatus, UserRole } from "@/types";

const base =
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap";

export function StatusBadge({
  status,
  className,
}: {
  status: TicketStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span className={cn(base, "tone", className)} data-tone={meta.tone}>
      <span className="tone-dot h-1.5 w-1.5 rounded-full" />
      {meta.label}
    </span>
  );
}

export function PriorityBadge({
  priority,
  className,
}: {
  priority: TicketPriority;
  className?: string;
}) {
  const meta = PRIORITY_META[priority];
  return (
    <span className={cn(base, "tone", className)} data-tone={meta.tone}>
      <span className="tone-dot h-1.5 w-1.5 rounded-full" />
      {meta.label}
    </span>
  );
}

export function RoleBadge({ role }: { role: UserRole }) {
  const meta = ROLE_META[role];
  return (
    <span className={cn(base, "tone")} data-tone={meta.tone}>
      {meta.label}
    </span>
  );
}

export function Badge({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(base, "bg-surface-muted text-ink-muted ring-surface-border", className)}>
      {children}
    </span>
  );
}

export function TicketNumber({
  number,
  href,
  className,
}: {
  number: string;
  href?: string;
  className?: string;
}) {
  const content = (
    <span className={cn("font-mono text-[13px] font-medium text-ink", className)}>{number}</span>
  );
  if (!href) return content;
  return (
    <Link href={href} className="hover:text-accent hover:underline">
      {content}
    </Link>
  );
}
