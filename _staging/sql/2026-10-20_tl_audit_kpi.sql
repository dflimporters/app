-- Team Leader KPIs: Win the Week (10 store audits Mon–Sun) and Win the Quarter
-- (10 × weeks in the quarter + every Brand Ambassador on the team evaluated).
-- Applied via apply_migration 'tl_audit_kpi' on 2026-10-20.

-- ── 1. ID-stamp audits and evaluations (name-keyed joins break silently) ──
alter table public.merch_store_audits
  add column if not exists tl_rep_id uuid references public.reps(id),
  add column if not exists merchandiser_rep_id uuid references public.reps(id);

alter table public.merchandiser_evaluations
  add column if not exists employee_rep_id uuid references public.reps(id),
  add column if not exists reviewer_rep_id uuid references public.reps(id);

create index if not exists merch_store_audits_tl_date_idx on public.merch_store_audits (tl_rep_id, audit_date);
create index if not exists merchandiser_evaluations_emp_idx on public.merchandiser_evaluations (employee_rep_id, created_at);

-- The auditor/reviewer is always the signed-in user — never trusted from the client.
create or replace function public.stamp_store_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select p.rep_id into new.tl_rep_id from profiles p where p.id = auth.uid();
  if new.merchandiser_rep_id is null and coalesce(new.merchandiser_name,'') <> '' then
    select r.id into new.merchandiser_rep_id from reps r
     where lower(trim(r.name)) = lower(trim(new.merchandiser_name)) and r.active
     order by r.id limit 1;
  end if;
  return new;
end $$;

drop trigger if exists stamp_store_audit on public.merch_store_audits;
create trigger stamp_store_audit before insert on public.merch_store_audits
  for each row execute function public.stamp_store_audit();

create or replace function public.stamp_evaluation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select p.rep_id into new.reviewer_rep_id from profiles p where p.id = auth.uid();
  if new.employee_rep_id is null and coalesce(new.employee_name,'') <> '' then
    select r.id into new.employee_rep_id from reps r
     where lower(trim(r.name)) = lower(trim(new.employee_name)) and r.active
     order by r.id limit 1;
  end if;
  return new;
end $$;

drop trigger if exists stamp_evaluation on public.merchandiser_evaluations;
create trigger stamp_evaluation before insert on public.merchandiser_evaluations
  for each row execute function public.stamp_evaluation();

revoke execute on function public.stamp_store_audit() from public, anon, authenticated;
revoke execute on function public.stamp_evaluation()  from public, anon, authenticated;

-- Backfill by name (best effort; unmatched rows simply stay null).
update public.merch_store_audits a set tl_rep_id = r.id
  from public.reps r where a.tl_rep_id is null and lower(trim(r.name)) = lower(trim(a.tl_name));
update public.merch_store_audits a set merchandiser_rep_id = r.id
  from public.reps r where a.merchandiser_rep_id is null and lower(trim(r.name)) = lower(trim(a.merchandiser_name));
update public.merchandiser_evaluations e set employee_rep_id = r.id
  from public.reps r where e.employee_rep_id is null and lower(trim(r.name)) = lower(trim(e.employee_name));

-- ── 2. KPI calculator ──
-- Week = Monday–Sunday in Jamaica time; a quarter is the weeks whose Monday falls in it.
-- A store counts once per week (re-auditing the same store that week doesn't add).
-- Quarter target = 10 × weeks in the quarter (13 for Q4 2026); "equivalent"
-- means the quarter total is what counts, not 10 in every single week.
-- Evaluations: a supervisor/manager evaluation of each active BA on the TL's
-- team, created this quarter, by anyone in a supervisor role.
create or replace function public.get_tl_kpi(p_tl_rep_id uuid default null, p_date date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_all   boolean := public.is_manager() or coalesce(auth.role(),'') = 'service_role';
  v_me    uuid;
  v_today date := coalesce(p_date, (now() at time zone 'America/Jamaica')::date);
  v_wk    date := date_trunc('week', v_today)::date;
  -- A week belongs to the quarter its Monday falls in, so every week is a
  -- full Mon–Sun and Q4 2026 runs Mon 5 Oct → Sun 3 Jan (13 weeks).
  v_qs    date := date_trunc('quarter', v_wk)::date;
  v_q0    date := v_qs + ((8 - extract(isodow from v_qs)::int) % 7);
  v_q1    date := date_trunc('week', (v_qs + interval '3 months - 1 day'))::date + 6;
  v_weeks int;
  v_out   jsonb := '[]'::jsonb;
  t record;
begin
  if not v_all then
    select p.rep_id into v_me from profiles p where p.id = auth.uid() and p.active;
    if v_me is null then return '[]'::jsonb; end if;
    if p_tl_rep_id is not null and p_tl_rep_id <> v_me then
      raise exception 'not authorised' using errcode = '42501';
    end if;
    p_tl_rep_id := v_me;
  end if;

  v_weeks := ((v_q1 - 6 - v_q0) / 7) + 1;

  for t in
    select r.id, r.name, r.area from reps r
     where r.active and r.role in ('team_leader','tl_merch')
       and (p_tl_rep_id is null or r.id = p_tl_rep_id)
     order by r.name
  loop
    v_out := v_out || jsonb_build_object(
      'tl_rep_id', t.id, 'tl_name', t.name, 'area', t.area,
      'today', v_today, 'week_start', v_wk, 'week_end', v_wk + 6,
      'quarter_start', v_q0, 'quarter_end', v_q1,
      'quarter_label', 'Q' || extract(quarter from v_qs) || ' ' || extract(year from v_qs),
      'week_target', 10,
      'weeks_in_quarter', v_weeks,
      'weeks_elapsed', ((v_wk - v_q0) / 7) + 1,
      'quarter_target', 10 * v_weeks,
      'week_done', (select count(distinct a.customer_id) from merch_store_audits a
                     where a.tl_rep_id = t.id and a.audit_date between v_wk and v_wk + 6),
      'quarter_done', (select coalesce(sum(n),0) from (
                        select count(distinct a.customer_id) n from merch_store_audits a
                         where a.tl_rep_id = t.id and a.audit_date between v_q0 and v_q1
                         group by date_trunc('week', a.audit_date)) w),
      'weeks', (select coalesce(jsonb_agg(jsonb_build_object('week_start', ws, 'done', n) order by ws), '[]'::jsonb)
                  from (select gs::date ws,
                               (select count(distinct a.customer_id) from merch_store_audits a
                                 where a.tl_rep_id = t.id and a.audit_date between gs::date and gs::date + 6) n
                          from generate_series(v_q0, v_wk, interval '7 days') gs) x),
      'team', (select coalesce(jsonb_agg(jsonb_build_object(
                  'rep_id', b.id, 'name', b.name,
                  'evaluated_at', (select max(e.created_at) from merchandiser_evaluations e
                                    where e.employee_rep_id = b.id and e.filled_by_role = 'supervisor_manager'
                                      and (e.created_at at time zone 'America/Jamaica')::date between v_qs and v_q1)
                ) order by b.name), '[]'::jsonb)
                from reps b
               where b.active and b.team_lead_id = t.id
                 and b.role in ('merchandiser','tl_merch','relief_merchandiser'))
    );
  end loop;
  return v_out;
end $$;

revoke execute on function public.get_tl_kpi(uuid, date) from public, anon;
grant execute on function public.get_tl_kpi(uuid, date) to authenticated;
