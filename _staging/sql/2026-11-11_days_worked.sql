-- Days worked + TL payroll submissions → Relief Coverage log.
--
-- A "day worked" = the person logged at least one merch_visit_log row that day
-- (merch_visit_log.user_id = reps.id). Pay fortnights run Mon–Sun x2, anchored on
-- Mon 2 Nov 2026 (dw_fortnight_start). 10 paid weekdays per fortnight; extra days
-- are worked out client-side in shared/days-worked.js.
--
-- A TL's Wednesday submission (submit_tl_payroll) writes one relief_coverage row
-- per claimed date — payable, unpaid — so it shows in Relief Coverage's log and is
-- picked up by the next pay run (relief_create_pay_run / _selected), exactly like a
-- hand-logged coverage day:
--   relief BA  → coverage_type 'Relief Assigned', reason picked by the TL
--   regular BA → coverage_type 'Extra Day',       reason 'Extra day worked'
-- Each row carries the TL's rate per day (relief_coverage.daily_rate); pay runs now
-- pay that rate, falling back to relief_roster.daily_rate, then 4000.
--
-- Who sees whom (dw_scope_ids):
--   admin / manager          → every active merchandiser, relief_merchandiser, tl_merch
--   team_leader / tl_merch   → their team (reps.team_lead_id) plus any relief
--                              merchandiser who logged a visit at one of their
--                              team's stores in the window (5 relief workers have
--                              no team_lead_id; merchandiser_map is name-keyed,
--                              same as get_relief_visits_for_merchandisers).

-- ── submissions (audit of what the TL sent; the log rows are the payable record) ──
create table if not exists public.tl_payroll_submissions (
  id                uuid primary key default gen_random_uuid(),
  tl_rep_id         uuid not null references public.reps(id),
  week_start        date not null,          -- Monday of the week submitted
  fortnight_start   date not null,
  submitted_at      timestamptz not null default now(),
  submitted_by      uuid not null,
  submitted_by_name text,
  lines             jsonb not null default '[]'::jsonb,
  note              text,
  unique (tl_rep_id, week_start)
);
alter table public.tl_payroll_submissions enable row level security;
revoke all on public.tl_payroll_submissions from anon, authenticated;

-- ── relief_coverage: rate per day + link back to the submission / roster row ──
alter table public.relief_coverage
  add column if not exists daily_rate    numeric,
  add column if not exists submission_id uuid references public.tl_payroll_submissions(id) on delete set null,
  add column if not exists rep_id        uuid references public.reps(id) on delete set null;
create index if not exists relief_coverage_submission_idx on public.relief_coverage(submission_id);
create index if not exists relief_coverage_rep_date_idx on public.relief_coverage(rep_id, date);

create or replace function public.dw_fortnight_start(d date)
returns date language sql immutable as $$
  select date '2026-11-02' + (floor((d - date '2026-11-02') / 14.0)::int * 14);
$$;

-- reps.area → Relief Coverage's five regions (Kingston & Portmore fold into SE,
-- same as jm_region_keys).
create or replace function public.dw_region(p_area text)
returns text language sql immutable as $$
  select case
    when p_area ilike 'north east%' or p_area ilike '%north coast%' then 'North East'
    when p_area ilike 'north west%' then 'North West'
    when p_area ilike 'south central%' then 'South Central'
    when p_area ilike 'south east%' or p_area ilike '%kingston%' or p_area ilike '%portmore%' then 'South East'
    when p_area ilike 'south west%' then 'South West'
    else '' end;
$$;

create or replace function public.dw_scope_ids(p_me uuid, p_all boolean, p_from date, p_to date)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select r.id x from reps r
     where p_all and r.active and r.role in ('merchandiser','relief_merchandiser','tl_merch')
    union
    select r.id from reps r
     where not p_all and r.active and r.team_lead_id = p_me
       and r.role in ('merchandiser','relief_merchandiser')
    union
    select v.user_id from merch_visit_log v
      join reps rr on rr.id = v.user_id and rr.role = 'relief_merchandiser'
      join merchandiser_map mm on mm.customer_id = v.customer_id
      join reps t on t.name = mm.merchandiser_name and t.team_lead_id = p_me
     where not p_all and v.visit_date between p_from and p_to
  ) s;
$$;
revoke all on function public.dw_scope_ids(uuid, boolean, date, date) from public, anon, authenticated;

create or replace function public.get_days_worked(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid; v_role text; v_all boolean; v_ids uuid[];
  v_today date := (now() at time zone 'America/Jamaica')::date;
  v_from date; v_to date;
begin
  select p.rep_id, p.role into v_me, v_role from profiles p where p.id = auth.uid() and p.active;
  v_all := v_role in ('admin','manager');
  if v_role is null or (not v_all and (v_role not in ('team_leader','tl_merch') or v_me is null)) then
    raise exception 'Days worked is for team leaders and managers' using errcode = '42501';
  end if;
  v_to   := least(coalesce(p_to, v_today), v_today + 14);
  v_from := greatest(coalesce(p_from, v_to - 42), v_to - 70);
  v_ids  := dw_scope_ids(v_me, v_all, v_from, v_to);

  return jsonb_build_object(
    'scope', case when v_all then 'all' else 'team' end,
    'me', v_me, 'from', v_from, 'to', v_to, 'today', v_today,
    'anchor', date '2026-11-02',
    'staff', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', r.id, 'name', r.name, 'area', r.area, 'role', r.role,
                'team_lead_id', r.team_lead_id, 'team_lead', t.name,
                'on_team', (r.team_lead_id = v_me),
                -- default rate per day: last rate claimed for them, else relief roster, else 4000
                'rate', coalesce(
                   (select c.daily_rate from relief_coverage c
                     where c.daily_rate is not null
                       and (c.rep_id = r.id or lower(trim(c.relief_name)) = lower(r.name))
                     order by c.date desc limit 1),
                   (select ro.daily_rate from relief_roster ro where lower(ro.name) = lower(r.name) limit 1),
                   4000)) order by r.name), '[]')
              from reps r left join reps t on t.id = r.team_lead_id where r.id = any(v_ids)),
    'days', (select coalesce(jsonb_agg(jsonb_build_object('rep_id', user_id, 'd', visit_date,
                'visits', n, 'relief', nr)), '[]')
             from (select user_id, visit_date, count(*) n,
                          count(*) filter (where visit_type = 'relief') nr
                     from merch_visit_log
                    where user_id = any(v_ids) and visit_date between v_from and v_to
                    group by 1, 2) s),
    'leave', (select coalesce(jsonb_agg(jsonb_build_object('rep_id', requester_id,
                'from', from_date, 'to', coalesce(to_date, from_date),
                'type', leave_type, 'status', status)), '[]')
              from leave_requests
             where requester_id = any(v_ids) and status in ('approved','pending')
               and coalesce(to_date, from_date) >= v_from and from_date <= v_to),
    'holidays', (select coalesce(jsonb_agg(jsonb_build_object('d', holiday_date, 'name', holiday_name)), '[]')
                 from public_holidays where holiday_date between v_from and v_to),
    -- days already in the Relief Coverage log as payable (from a submission or logged
    -- by hand), so the form doesn't claim them twice
    'claimed', (select coalesce(jsonb_agg(jsonb_build_object('rep_id', r.id, 'd', c.date,
                'type', c.coverage_type, 'paid', c.payment_id is not null,
                'submission_id', c.submission_id)), '[]')
              from relief_coverage c
              join reps r on r.id = any(v_ids)
                         and (c.rep_id = r.id or (c.rep_id is null and lower(trim(c.relief_name)) = lower(r.name)))
             where c.payable and c.date between v_from - 14 and v_to + 14),
    'submissions', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', s.id, 'tl_rep_id', s.tl_rep_id, 'tl_name', t.name, 'week_start', s.week_start,
                'fortnight_start', s.fortnight_start, 'submitted_at', s.submitted_at,
                'submitted_by_name', s.submitted_by_name, 'lines', s.lines, 'note', s.note)
                order by s.week_start desc, t.name), '[]')
              from tl_payroll_submissions s join reps t on t.id = s.tl_rep_id
             where (v_all or s.tl_rep_id = v_me) and s.week_start between v_from - 7 and v_to)
  );
end $$;
revoke all on function public.get_days_worked(date, date) from public, anon;
grant execute on function public.get_days_worked(date, date) to authenticated;

-- p_lines: [{rep_id, kind:'relief'|'extra', dates:['YYYY-MM-DD',...], reason, absent, rate, note}]
-- Relief dates must fall in the submitted week; extra-day dates anywhere in that
-- week's fortnight. Resubmitting the same week replaces the earlier submission's
-- still-unpaid log rows; a date already payable in the log (paid, or logged by
-- hand) is skipped and reported back, never doubled.
drop function if exists public.submit_tl_payroll(date, jsonb, text);
create or replace function public.submit_tl_payroll(p_week_start date, p_lines jsonb, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid; v_role text; v_tl text; v_tl_area text; v_ids uuid[]; v_id uuid; v_bad int;
  v_today date := (now() at time zone 'America/Jamaica')::date;
  v_fs date := dw_fortnight_start(p_week_start);
  v_we date := p_week_start + 6;
  l jsonb; v_r reps; d date; v_period uuid; v_rate numeric; v_kind text;
  v_lines jsonb := '[]'; v_skipped jsonb := '[]'; v_inserted int := 0; v_kept text[];
begin
  select p.rep_id, p.role, r.name, r.area into v_me, v_role, v_tl, v_tl_area
    from profiles p left join reps r on r.id = p.rep_id
   where p.id = auth.uid() and p.active;
  if v_role not in ('team_leader','tl_merch') or v_me is null then
    raise exception 'Only team leaders submit payroll' using errcode = '42501';
  end if;
  if extract(isodow from p_week_start) <> 1 then raise exception 'Week must start on a Monday'; end if;
  if p_week_start < v_today - 21 or p_week_start > v_today + 7 then
    raise exception 'That week is outside the submission window';
  end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'Lines must be a list'; end if;

  v_ids := dw_scope_ids(v_me, false, v_fs, v_we);

  select count(*) into v_bad from jsonb_array_elements(p_lines) x
   where (x->>'rep_id') is null or not ((x->>'rep_id')::uuid = any(v_ids))
      or coalesce(x->>'kind','') not in ('relief','extra')
      or jsonb_typeof(x->'dates') <> 'array'
      or coalesce((x->>'rate')::numeric, -1) < 0 or (x->>'rate')::numeric > 100000
      or exists (select 1 from jsonb_array_elements_text(x->'dates') dd
                  where (x->>'kind' = 'relief' and dd::date not between p_week_start and v_we)
                     or (x->>'kind' = 'extra'  and dd::date not between v_fs and v_fs + 13));
  if v_bad > 0 then
    raise exception 'Some lines are not on your team, have a missing rate, or dates outside this week/fortnight';
  end if;

  insert into tl_payroll_submissions (tl_rep_id, week_start, fortnight_start, submitted_by, submitted_by_name, note)
  values (v_me, p_week_start, v_fs, auth.uid(), v_tl, nullif(trim(p_note), ''))
  on conflict (tl_rep_id, week_start) do update
     set note = excluded.note, submitted_at = now(),
         submitted_by = excluded.submitted_by, submitted_by_name = excluded.submitted_by_name
  returning id into v_id;

  -- replace this submission's earlier log rows that haven't been paid yet
  delete from relief_coverage where submission_id = v_id and payment_id is null and not imported;

  for l in select * from jsonb_array_elements(p_lines) loop
    select * into v_r from reps where id = (l->>'rep_id')::uuid;
    v_kind := l->>'kind';
    v_rate := (l->>'rate')::numeric;
    v_period := gen_random_uuid();
    v_kept := '{}';
    for d in select distinct dd::date from jsonb_array_elements_text(l->'dates') dd order by 1 loop
      if exists (select 1 from relief_coverage c
                  where c.payable and c.date = d
                    and (c.rep_id = v_r.id or (c.rep_id is null and lower(trim(c.relief_name)) = lower(v_r.name)))) then
        v_skipped := v_skipped || jsonb_build_object('name', v_r.name, 'date', d);
        continue;
      end if;
      insert into relief_coverage (date, region, stores, absent, reason, coverage_type, relief_name,
                                   supervisor, status, days, payable, notes, period_id,
                                   daily_rate, submission_id, rep_id)
      values (d, coalesce(nullif(dw_region(v_r.area), ''), dw_region(v_tl_area)), '',
              case when v_kind = 'relief' then coalesce(trim(l->>'absent'), '') else '' end,
              case when v_kind = 'extra' then 'Extra day worked' else coalesce(nullif(trim(l->>'reason'), ''), 'Other') end,
              case when v_kind = 'extra' then 'Extra Day' else 'Relief Assigned' end,
              v_r.name, coalesce(v_tl, ''), 'Covered', 1, true,
              trim(both ' ·' from coalesce(trim(l->>'note'), '') || ' · Submitted by TL ' || coalesce(v_tl, '')),
              v_period, v_rate, v_id, v_r.id);
      v_inserted := v_inserted + 1;
      v_kept := v_kept || d::text;
    end loop;
    if array_length(v_kept, 1) > 0 then
      v_lines := v_lines || jsonb_build_object(
        'rep_id', v_r.id, 'name', v_r.name, 'role', v_r.role, 'kind', v_kind,
        'days', array_length(v_kept, 1), 'dates', to_jsonb(v_kept), 'rate', v_rate,
        'total', v_rate * array_length(v_kept, 1),
        'reason', case when v_kind = 'extra' then 'Extra day worked' else nullif(trim(l->>'reason'), '') end,
        'absent', nullif(trim(l->>'absent'), ''), 'note', nullif(trim(l->>'note'), ''));
    end if;
  end loop;

  update tl_payroll_submissions set lines = v_lines where id = v_id;
  return jsonb_build_object('id', v_id, 'inserted', v_inserted, 'skipped', v_skipped, 'lines', v_lines);
end $$;
revoke all on function public.submit_tl_payroll(date, jsonb, text) from public, anon;
grant execute on function public.submit_tl_payroll(date, jsonb, text) to authenticated;

-- ── pay runs: pay each log row's own rate (TL-entered), else roster, else 4000 ──
-- One payment per person as before; if their rows carry different rates the
-- payment rate is the day-weighted average, so rate × days still equals the total.
create or replace function public.relief_create_pay_run(p_from date, p_to date, p_pay_date date)
returns setof relief_payments language plpgsql security definer set search_path to 'public' as $function$
declare g record; pid uuid;
begin
  if not public.is_dfl_admin() then raise exception 'Only admins can create pay runs' using errcode = '42501'; end if;
  for g in
    select lower(trim(c.relief_name)) k,
           coalesce(max(r.name), max(trim(c.relief_name))) nm, max(r.id) rid,
           round(sum(c.days * coalesce(c.daily_rate, r.daily_rate, 4000)) / nullif(sum(c.days), 0), 2) rate,
           sum(c.days) days,
           array_agg(c.id) ids,
           string_agg(distinct nullif(c.absent,''), ', ') covering,
           string_agg(distinct nullif(c.reason,''), ', ') reason,
           string_agg(distinct nullif(c.stores,''), '; ') stores,
           array_agg(distinct c.date order by c.date) ds
    from relief_coverage c
    left join relief_roster r on lower(r.name) = lower(trim(c.relief_name))
    where c.payable and c.payment_id is null and not c.imported
      and coalesce(trim(c.relief_name),'') <> '' and c.date between p_from and p_to
    group by lower(trim(c.relief_name))
  loop
    insert into relief_payments (pay_date, relief_name, roster_id, days, rate, dates_covered, covering, reason, stores, status, source, period_from, period_to)
    values (p_pay_date, g.nm, g.rid, g.days, coalesce(g.rate, 4000),
            (select string_agg(to_char(d,'Mon FMDD'), ', ' order by d) from unnest(g.ds) d),
            coalesce(g.covering,''), coalesce(g.reason,''), coalesce(g.stores,''), 'Pending', 'log', p_from, p_to)
    returning id into pid;
    update relief_coverage set payment_id = pid where id = any(g.ids);
    return query select * from relief_payments where id = pid;
  end loop;
end $function$;

create or replace function public.relief_create_pay_run_selected(p_ids uuid[], p_pay_date date)
returns setof relief_payments language plpgsql security definer set search_path to 'public' as $function$
declare g record; pid uuid;
begin
  if not public.is_dfl_admin() then raise exception 'Only admins can create pay runs' using errcode = '42501'; end if;
  for g in
    select lower(trim(c.relief_name)) k,
           coalesce(max(r.name), max(trim(c.relief_name))) nm, max(r.id) rid,
           round(sum(c.days * coalesce(c.daily_rate, r.daily_rate, 4000)) / nullif(sum(c.days), 0), 2) rate,
           sum(c.days) days,
           array_agg(c.id) ids,
           string_agg(distinct nullif(c.absent,''), ', ') covering,
           string_agg(distinct nullif(c.reason,''), ', ') reason,
           string_agg(distinct nullif(c.stores,''), '; ') stores,
           array_agg(distinct c.date order by c.date) ds, min(c.date) dfrom, max(c.date) dto
    from relief_coverage c
    left join relief_roster r on lower(r.name) = lower(trim(c.relief_name))
    where c.id = any(p_ids) and c.payable and c.payment_id is null and not c.imported
      and coalesce(trim(c.relief_name),'') <> ''
    group by lower(trim(c.relief_name))
  loop
    insert into relief_payments (pay_date, relief_name, roster_id, days, rate, dates_covered, covering, reason, stores, status, source, period_from, period_to)
    values (p_pay_date, g.nm, g.rid, g.days, coalesce(g.rate, 4000),
            (select string_agg(to_char(d,'Mon FMDD'), ', ' order by d) from unnest(g.ds) d),
            coalesce(g.covering,''), coalesce(g.reason,''), coalesce(g.stores,''), 'Pending', 'log', g.dfrom, g.dto)
    returning id into pid;
    update relief_coverage set payment_id = pid where id = any(g.ids);
    return query select * from relief_payments where id = pid;
  end loop;
end $function$;

-- ── Full-time Brand Ambassadors on the relief roster ──────────────────────────
-- Their extra days are paid through Relief Coverage pay runs, which look people up
-- in relief_roster (rate, banking details for the HR sheet). So every active
-- full-time BA (reps.role = 'merchandiser') gets a roster row, marked
-- staff_type 'full_time' and linked by rep_id; relief workers stay 'relief'.
-- 44 BAs were added on 2026-11-11 (4 were already on it). Team leaders
-- (tl_merch / team_leader) are not added.
alter table public.relief_roster
  add column if not exists staff_type text not null default 'relief',
  add column if not exists rep_id uuid references public.reps(id) on delete set null;
do $$ begin
  alter table public.relief_roster add constraint relief_roster_staff_type_check check (staff_type in ('relief','full_time'));
exception when duplicate_object then null; end $$;
create unique index if not exists relief_roster_rep_id_key on public.relief_roster(rep_id) where rep_id is not null;

-- link existing roster rows to their (active) staff row by name
update public.relief_roster ro set rep_id = r.id
  from public.reps r
 where ro.rep_id is null and r.active and lower(r.name) = lower(ro.name)
   and r.role in ('merchandiser','relief_merchandiser');
update public.relief_roster ro set staff_type = 'full_time'
  from public.reps r where r.id = ro.rep_id and r.role = 'merchandiser';

-- Add (or re-activate) roster rows for active full-time BAs; deactivate the
-- full-time row of anyone no longer an active BA. p_rep limits it to one person.
create or replace function public.sync_relief_roster_full_time(p_rep uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into relief_roster (id, name, region, daily_rate, active, staff_type, rep_id)
  select s.slug || case when exists (select 1 from relief_roster x where x.id = s.slug)
                        then '-' || substr(md5(s.rid::text), 1, 4) else '' end,
         s.name, s.region, 4000, true, 'full_time', s.rid
    from (select r.id rid, r.name, dw_region(r.area) region,
                 coalesce(nullif(trim(both '-' from lower(regexp_replace(trim(r.name), '[^A-Za-z0-9]+', '-', 'g'))), ''), 'ba') slug
            from reps r
           where r.active and r.role = 'merchandiser' and (p_rep is null or r.id = p_rep)
             and not exists (select 1 from relief_roster ro
                              where ro.rep_id = r.id or lower(ro.name) = lower(r.name))) s;
  get diagnostics n = row_count;

  update relief_roster ro set active = (r.active and r.role = 'merchandiser'), updated_at = now()
    from reps r
   where ro.rep_id = r.id and ro.staff_type = 'full_time' and (p_rep is null or r.id = p_rep)
     and ro.active is distinct from (r.active and r.role = 'merchandiser');
  -- a BA who moves to relief becomes a relief roster entry
  update relief_roster ro set staff_type = 'relief', active = r.active, updated_at = now()
    from reps r
   where ro.rep_id = r.id and ro.staff_type = 'full_time' and r.role = 'relief_merchandiser'
     and (p_rep is null or r.id = p_rep);
  return n;
end $$;
revoke all on function public.sync_relief_roster_full_time(uuid) from public, anon, authenticated;

create or replace function public.trg_reps_sync_relief_roster()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform sync_relief_roster_full_time(new.id);
  return new;
end $$;
revoke all on function public.trg_reps_sync_relief_roster() from public, anon, authenticated;
drop trigger if exists reps_sync_relief_roster on public.reps;
create trigger reps_sync_relief_roster
  after insert or update of role, active on public.reps
  for each row execute function public.trg_reps_sync_relief_roster();

-- register everyone now
select public.sync_relief_roster_full_time();
