-- =============================================================================
-- IT Helpdesk — Aggregates
-- Migration 0005
--
-- SECURITY INVOKER: Row Level Security still applies, so an employee only
-- counts their own tickets while staff count everything.
-- =============================================================================

create or replace function public.ticket_stats()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'total',           count(*),
    'open',            count(*) filter (where status = 'OPEN'),
    'assigned',        count(*) filter (where status = 'ASSIGNED'),
    'in_progress',     count(*) filter (where status = 'IN_PROGRESS'),
    'waiting_user',    count(*) filter (where status = 'WAITING_USER'),
    'resolved',        count(*) filter (where status = 'RESOLVED'),
    'closed',          count(*) filter (where status = 'CLOSED'),
    'active',          count(*) filter (where status not in ('RESOLVED', 'CLOSED')),
    'unassigned',      count(*) filter (where assigned_to is null and status not in ('RESOLVED', 'CLOSED')),
    'assigned_to_me',  count(*) filter (where assigned_to = auth.uid() and status not in ('RESOLVED', 'CLOSED')),
    'high_priority',   count(*) filter (where priority in ('HIGH', 'CRITICAL') and status not in ('RESOLVED', 'CLOSED')),
    'critical',        count(*) filter (where priority = 'CRITICAL' and status not in ('RESOLVED', 'CLOSED'))
  )
  from public.tickets;
$$;

grant execute on function public.ticket_stats() to authenticated;
