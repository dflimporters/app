-- Permanent vs temporary relief (2026-11-11).
--
-- relief_roster.staff_type:
--   'relief'           = TEMPORARY relief — no fixed days, every day worked is payable
--   'permanent_relief' = PERMANENT relief — staff with 10 paid days a fortnight like a
--                        full-time BA; only extra days are claimed. Dwayne Granston only.
--                        (His J$500/relief-visit incentive is separate — calc_relief_incentive.)
--   'full_time'        = full-time Brand Ambassador
-- get_days_worked() now returns staff_type per person so shared/days-worked.js can
-- tell them apart (role alone can't: Dwayne is still role relief_merchandiser).

alter table public.relief_roster drop constraint if exists relief_roster_staff_type_check;
alter table public.relief_roster add constraint relief_roster_staff_type_check
  check (staff_type in ('relief','permanent_relief','full_time'));
comment on column public.relief_roster.staff_type is
  'relief = temporary relief (every day payable); permanent_relief = permanent relief staff, 10 paid days/fortnight, extra days only (Dwayne Granston); full_time = full-time Brand Ambassador';

insert into public.relief_roster (id, name, phone, region, daily_rate, active, staff_type, rep_id)
select 'dwayne-granston', r.name, coalesce(r.phone, ''), dw_region(r.area), 4000, true, 'permanent_relief', r.id
  from public.reps r where r.id = '33850590-52c9-4e1e-8053-084aeaf62c22'
on conflict (id) do update set staff_type = 'permanent_relief', rep_id = excluded.rep_id;

-- Keep permanent relief active in step with their staff row (the full-time rules don't touch them).
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
  update relief_roster ro set staff_type = 'relief', active = r.active, updated_at = now()
    from reps r
   where ro.rep_id = r.id and ro.staff_type = 'full_time' and r.role = 'relief_merchandiser'
     and (p_rep is null or r.id = p_rep);
  update relief_roster ro set active = r.active, updated_at = now()
    from reps r
   where ro.rep_id = r.id and ro.staff_type = 'permanent_relief' and (p_rep is null or r.id = p_rep)
     and ro.active is distinct from r.active;
  return n;
end $$;
revoke all on function public.sync_relief_roster_full_time(uuid) from public, anon, authenticated;

-- get_days_worked: + staff_type per person (roster value, else from role)
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
                'staff_type', coalesce(
                   (select ro.staff_type from relief_roster ro where ro.rep_id = r.id limit 1),
                   case when r.role = 'relief_merchandiser' then 'relief' else 'full_time' end),
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
