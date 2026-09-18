-- =============================================================================
-- IT Helpdesk — Profile visibility for ticket participants
-- Migration 0008
--
-- `profiles_select_self` lets you read your own row, and staff read everything.
-- That left a hole in the ticket conversation: when a support agent replies to
-- an employee's ticket, the employee could not read the agent's profile, so the
-- reply rendered with no name at all — "Unknown" in the UI and `null` in the API.
--
-- A helpdesk conversation is not anonymous, and the participant is not a secret:
-- you already see their words. What must stay hidden is the rest of the
-- directory. So this policy grants exactly one extra thing — the profile of
-- somebody you are already in a ticket with.
-- =============================================================================

create or replace function public.shares_ticket_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tickets t
    where public.can_access_ticket(t.id)
      and (
        t.created_by = p_user_id
        or t.assigned_to = p_user_id
        or exists (
          select 1
          from public.ticket_comments c
          where c.ticket_id = t.id
            and c.user_id = p_user_id
        )
      )
  );
$$;

grant execute on function public.shares_ticket_with(uuid) to authenticated;

drop policy if exists profiles_select_participants on public.profiles;
create policy profiles_select_participants on public.profiles
  for select to authenticated
  using (public.shares_ticket_with(id));
