-- Co-team-leaders (2026-11-19)
-- A co-TL gets full TL access over another TL's team without taking it over:
-- the BAs keep their team_lead_id, the original TL keeps everything.
-- First row: Jomo Thompson co-leads Coliesha Smith's team (South West, Westmoreland).
--
-- ACCESS ONLY — pay is deliberately unchanged:
--   * calc_tl_incentive: a co-TL gets no TL incentive row and stays a member of
--     their own TL's pool (their stores still count for that TL).
--   * sync_relief_roster_full_time: a tl_merch co-TL keeps their full-time BA
--     relief_roster row; Days Worked still tracks them as a BA on their TL's team.
-- Scope = tl_led_ids(me) = me + every TL I co-lead; a BA is on my team when
-- team_lead_id = any(tl_led_ids(me)) (and is not me).
-- Re-runnable.

create table if not exists public.tl_co_leads (
  co_tl_rep_id uuid not null references public.reps(id) on delete cascade,
  tl_rep_id    uuid not null references public.reps(id) on delete cascade,
  note         text,
  created_at   timestamptz not null default now(),
  primary key (co_tl_rep_id, tl_rep_id),
  check (co_tl_rep_id <> tl_rep_id)
);
alter table public.tl_co_leads enable row level security;
revoke all on public.tl_co_leads from anon, authenticated;

create or replace function public.tl_led_ids(p_rep uuid)
returns uuid[] language sql stable security definer set search_path to 'public' as $$
  select array[p_rep] || coalesce((select array_agg(c.tl_rep_id) from tl_co_leads c
                                     join reps t on t.id = c.tl_rep_id and t.active
                                    where c.co_tl_rep_id = p_rep), '{}');
$$;

create or replace function public.is_co_tl(p_rep uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from tl_co_leads c where c.co_tl_rep_id = p_rep);
$$;
revoke execute on function public.tl_led_ids(uuid), public.is_co_tl(uuid) from public, anon, authenticated;

-- Client read: the TL ids whose team the caller (or, for admin/manager, p_rep) leads.
create or replace function public.get_tl_led_ids(p_rep uuid default null)
returns uuid[] language plpgsql stable security definer set search_path to 'public' as $$
declare v_me uuid;
begin
  select p.rep_id into v_me from profiles p where p.id = auth.uid() and p.active;
  if p_rep is null or p_rep = v_me then
    if v_me is null then return '{}'; end if;
    return tl_led_ids(v_me);
  end if;
  if not public.is_manager() then raise exception 'not authorised' using errcode = '42501'; end if;
  return tl_led_ids(p_rep);
end $$;
revoke execute on function public.get_tl_led_ids(uuid) from public, anon;
grant execute on function public.get_tl_led_ids(uuid) to authenticated;

-- ── scope functions ─────────────────────────────────────────────────────────

create or replace function public._visit_correction_is_approver(p_requester uuid)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.active and p.role in ('admin','manager'))
      or exists (select 1 from profiles p join reps tl on tl.id = p.rep_id and tl.active
                 join reps rq on rq.id = p_requester and rq.id <> tl.id
                             and rq.team_lead_id = any(public.tl_led_ids(tl.id))
                 where p.id = auth.uid() and p.active);
$function$;

create or replace function public.dw_scope_ids(p_me uuid, p_all boolean, p_from date, p_to date)
returns uuid[] language sql stable security definer set search_path to 'public' as $function$
  select coalesce(array_agg(distinct x), '{}') from (
    select r.id x from reps r
     where p_all and r.active and r.role in ('merchandiser','relief_merchandiser','tl_merch')
    union
    select r.id from reps r
     where not p_all and r.active and r.team_lead_id = any(public.tl_led_ids(p_me)) and r.id <> p_me
       and (r.role in ('merchandiser','relief_merchandiser') or (r.role = 'tl_merch' and public.is_co_tl(r.id)))
    union
    select v.user_id from merch_visit_log v
      join reps rr on rr.id = v.user_id and rr.role = 'relief_merchandiser'
      join merchandiser_map mm on mm.customer_id = v.customer_id
      join reps t on t.name = mm.merchandiser_name and t.team_lead_id = any(public.tl_led_ids(p_me))
     where not p_all and v.visit_date between p_from and p_to
  ) s;
$function$;

create or replace function public.get_days_worked(p_from date default null, p_to date default null, p_as_rep uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_me uuid; v_role text; v_all boolean; v_ids uuid[]; v_led uuid[];
  v_today date := (now() at time zone 'America/Jamaica')::date;
  v_from date; v_to date;
begin
  select p.rep_id, p.role into v_me, v_role from profiles p where p.id = auth.uid() and p.active;
  v_all := v_role in ('admin','manager');
  if p_as_rep is not null then
    if not v_all then
      raise exception 'Only admins and managers can view as a team leader' using errcode = '42501';
    end if;
    if not exists (select 1 from reps where id = p_as_rep and active and role in ('team_leader','tl_merch')) then
      raise exception 'That person is not an active team leader';
    end if;
    v_me := p_as_rep; v_all := false; v_role := 'team_leader';
  end if;
  if v_role is null or (not v_all and (v_role not in ('team_leader','tl_merch') or v_me is null)) then
    raise exception 'Days worked is for team leaders and managers' using errcode = '42501';
  end if;
  v_to   := least(coalesce(p_to, v_today), v_today + 14);
  v_from := greatest(coalesce(p_from, v_to - 42), v_to - 70);
  v_ids  := dw_scope_ids(v_me, v_all, v_from, v_to);
  v_led  := tl_led_ids(v_me);

  return jsonb_build_object(
    'scope', case when v_all then 'all' else 'team' end,
    'me', v_me, 'from', v_from, 'to', v_to, 'today', v_today,
    'anchor', date '2026-11-02',
    'staff', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', r.id, 'name', r.name, 'area', r.area, 'role', r.role,
                'team_lead_id', r.team_lead_id, 'team_lead', t.name,
                'on_team', coalesce(r.team_lead_id = any(v_led), false),
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
end $function$;

create or replace function public.get_tl_kpi(p_tl_rep_id uuid default null, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_all   boolean := public.is_manager() or public.is_hr() or coalesce(auth.role(),'') = 'service_role';
  v_me    uuid;
  v_today date := coalesce(p_date, (now() at time zone 'America/Jamaica')::date);
  v_wk    date := date_trunc('week', v_today)::date;
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
               where b.active and b.team_lead_id = any(public.tl_led_ids(t.id)) and b.id <> t.id
                 and b.role in ('merchandiser','tl_merch'))
    );
  end loop;
  return v_out;
end $function$;

create or replace function public.merch_reassign_store(p_customer_id text, p_target_rep_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
DECLARE
  v_rep reps;
  v_role text;
  v_target reps;
BEGIN
  SELECT * INTO v_rep FROM _merch_caller_rep();
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('team_leader','tl_merch','admin','manager') THEN
    RAISE EXCEPTION 'Not authorized.';
  END IF;

  SELECT * INTO v_target FROM reps WHERE id = p_target_rep_id AND active;
  IF v_target.id IS NULL THEN
    RAISE EXCEPTION 'Target merchandiser not found.';
  END IF;

  IF v_role IN ('team_leader','tl_merch') THEN
    IF v_rep.id IS NULL OR v_target.team_lead_id IS NULL
       OR NOT (v_target.team_lead_id = any(public.tl_led_ids(v_rep.id))) THEN
      RAISE EXCEPTION 'You can only assign stores to your own team.';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM customers WHERE customer_id = p_customer_id) THEN
    RAISE EXCEPTION 'Store not found.';
  END IF;

  PERFORM _merch_reassign_internal(p_customer_id, v_target.name);
  RETURN jsonb_build_object('status','reassigned','new_holder',v_target.name);
END;
$function$;

create or replace function public.merch_team_route_requests()
returns setof merch_route_requests language plpgsql stable security definer set search_path to 'public' as $function$
DECLARE
  v_rep reps;
  v_role text;
BEGIN
  SELECT * INTO v_rep FROM _merch_caller_rep();
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();

  IF v_role IN ('admin','manager') THEN
    RETURN QUERY SELECT * FROM merch_route_requests WHERE status='pending' ORDER BY requested_at ASC;
  ELSIF v_rep.id IS NOT NULL AND v_rep.role IN ('team_leader','tl_merch') THEN
    RETURN QUERY SELECT * FROM merch_route_requests
      WHERE team_lead_rep_id = any(public.tl_led_ids(v_rep.id))
        AND requester_rep_id IS DISTINCT FROM v_rep.id
        AND status='pending' ORDER BY requested_at ASC;
  ELSE
    RAISE EXCEPTION 'Not authorized.';
  END IF;
END;
$function$;

create or replace function public.merch_decide_route_request(p_request_id bigint, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
DECLARE
  v_rep reps;
  v_role text;
  v_req merch_route_requests;
  v_decider_rep_id uuid;
BEGIN
  SELECT * INTO v_rep FROM _merch_caller_rep();
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();

  SELECT * INTO v_req FROM merch_route_requests WHERE id = p_request_id;
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Request not found.';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been decided.';
  END IF;

  IF v_role IN ('admin','manager') THEN
    v_decider_rep_id := v_rep.id;
  ELSIF v_rep.id IS NOT NULL AND v_rep.role IN ('team_leader','tl_merch')
        AND v_req.team_lead_rep_id = any(public.tl_led_ids(v_rep.id))
        AND v_req.requester_rep_id IS DISTINCT FROM v_rep.id THEN
    v_decider_rep_id := v_rep.id;
  ELSE
    RAISE EXCEPTION 'Not authorized to decide this request.';
  END IF;

  IF p_approve THEN
    PERFORM _merch_reassign_internal(v_req.customer_id, v_req.requester_name);
    UPDATE merch_route_requests
    SET status='approved', decided_at=now(), decided_by_rep_id=v_decider_rep_id, decision_note=p_note
    WHERE id = p_request_id;
  ELSE
    UPDATE merch_route_requests
    SET status='denied', decided_at=now(), decided_by_rep_id=v_decider_rep_id, decision_note=p_note
    WHERE id = p_request_id;
  END IF;

  RETURN jsonb_build_object('status', CASE WHEN p_approve THEN 'approved' ELSE 'denied' END);
END;
$function$;

create or replace function public.training_log()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_me uuid; v_role text; v_all boolean; v_ids uuid[];
begin
  select p.rep_id, p.role into v_me, v_role from profiles p where p.id = auth.uid() and p.active;
  v_all := v_role in ('admin','manager');
  if not v_all and (v_role not in ('team_leader','tl_merch') or v_me is null) then
    raise exception 'The training log is for team leaders and managers' using errcode = '42501';
  end if;
  select coalesce(array_agg(r.id), '{}') into v_ids from reps r
   where r.active and r.role in ('merchandiser','relief_merchandiser','tl_merch','team_leader')
     and (v_all or r.team_lead_id = any(public.tl_led_ids(v_me)) or r.id = v_me);
  return jsonb_build_object(
    'scope', case when v_all then 'all' else 'team' end,
    'me', v_me,
    'staff', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', r.id, 'name', r.name, 'role', r.role, 'area', r.area,
                'team_lead', t.name,
                'track', case when r.role in ('team_leader','tl_merch') then 'tl' else 'ba' end,
                'signed_in', exists (select 1 from profiles p where p.rep_id = r.id and p.active))
                order by t.name nulls last, r.name), '[]')
              from reps r left join reps t on t.id = r.team_lead_id where r.id = any(v_ids)),
    'completions', (select coalesce(jsonb_agg(jsonb_build_object(
                'rep_id', c.rep_id, 'module', c.module_key, 'course', c.course,
                'score', c.score, 'total', c.total, 'completed_at', c.completed_at)
                order by c.completed_at), '[]')
              from training_completions c where c.rep_id = any(v_ids))
  );
end $function$;

create or replace function public.my_evaluations_to_sign()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_me uuid; v_role text;
begin
  select p.rep_id, p.role into v_me, v_role from profiles p where p.id = auth.uid() and p.active;
  if v_me is null then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(x order by x->>'created_at')
    from (
      select jsonb_build_object(
               'id', e.id, 'created_at', e.created_at,
               'sign_as', case when e.filled_by_role = 'supervisor_manager' then 'employee' else 'supervisor' end,
               'employee_name', coalesce(emp.name, e.employee_name),
               'position', e.position, 'review_period', e.review_period, 'reviewed_by', e.reviewed_by,
               'total_score', e.total_score, 'rating', e.rating, 'employee_feedback', e.employee_feedback,
               'scores', jsonb_build_object(
                 'stock_monitoring', e.score_stock_monitoring, 'attendance', e.score_attendance,
                 'collaboration', e.score_collaboration, 'rotation_of_goods', e.score_rotation_of_goods,
                 'creative_thinking', e.score_creative_thinking, 'data_analysis', e.score_data_analysis,
                 'time_management', e.score_time_management, 'industry_knowledge', e.score_industry_knowledge,
                 'shelf_display', e.score_shelf_display, 'proactive_communication', e.score_proactive_communication,
                 'shelf_maintenance', e.score_shelf_maintenance, 'customer_attentiveness', e.score_customer_attentiveness),
               'comments', jsonb_strip_nulls(jsonb_build_object(
                 'stock_monitoring', e.comments_stock_monitoring, 'attendance', e.comments_attendance,
                 'collaboration', e.comments_collaboration, 'rotation_of_goods', e.comments_rotation_of_goods,
                 'creative_thinking', e.comments_creative_thinking, 'data_analysis', e.comments_data_analysis,
                 'time_management', e.comments_time_management, 'industry_knowledge', e.comments_industry_knowledge,
                 'shelf_display', e.comments_shelf_display, 'proactive_communication', e.comments_proactive_communication,
                 'shelf_maintenance', e.comments_shelf_maintenance, 'customer_attentiveness', e.comments_customer_attentiveness))
             ) x
      from merchandiser_evaluations e
      left join reps emp on emp.id = e.employee_rep_id
      where (e.filled_by_role = 'supervisor_manager'
             and e.employee_rep_id = v_me
             and not coalesce(e.employee_signed, false))
         or (e.filled_by_role = 'employee'
             and v_role in ('team_leader','tl_merch')
             and emp.team_lead_id = any(public.tl_led_ids(v_me))
             and emp.id <> v_me
             and not coalesce(e.supervisor_signed, false)
             and not coalesce(e.manager_signed, false))
    ) s
  ), '[]'::jsonb);
end $function$;

create or replace function public.sign_evaluation(p_id uuid, p_feedback text default null)
returns boolean language plpgsql security definer set search_path to 'public' as $function$
declare v_me uuid; v_role text; v_name text; e record;
begin
  select p.rep_id, p.role, p.full_name into v_me, v_role, v_name
    from profiles p where p.id = auth.uid() and p.active;
  if v_me is null then raise exception 'not authorised' using errcode = '42501'; end if;

  select ev.*, emp.team_lead_id as emp_tl into e
    from merchandiser_evaluations ev left join reps emp on emp.id = ev.employee_rep_id
   where ev.id = p_id for update of ev;
  if not found then raise exception 'Evaluation not found'; end if;

  if e.filled_by_role = 'supervisor_manager' and e.employee_rep_id = v_me then
    update merchandiser_evaluations set
      employee_signed = true,
      employee_signed_at = coalesce(employee_signed_at, now()),
      employee_feedback = coalesce(nullif(trim(p_feedback), ''), employee_feedback)
    where id = p_id;
  elsif e.filled_by_role = 'employee' and v_role in ('team_leader','tl_merch')
        and e.emp_tl = any(public.tl_led_ids(v_me)) and e.employee_rep_id is distinct from v_me then
    update merchandiser_evaluations set
      supervisor_signed = true,
      supervisor_signed_at = coalesce(supervisor_signed_at, now()),
      reviewed_by = coalesce(nullif(trim(reviewed_by), ''), v_name)
    where id = p_id;
  else
    raise exception 'not authorised' using errcode = '42501';
  end if;
  return true;
end $function$;

-- ── pay stays as it was ─────────────────────────────────────────────────────

create or replace function public.sync_relief_roster_full_time(p_rep uuid default null)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  -- A tl_merch who is only a co-TL is still paid as a full-time BA.
  insert into relief_roster (id, name, region, daily_rate, active, staff_type, rep_id)
  select s.slug || case when exists (select 1 from relief_roster x where x.id = s.slug)
                        then '-' || substr(md5(s.rid::text), 1, 4) else '' end,
         s.name, s.region, 4000, true, 'full_time', s.rid
    from (select r.id rid, r.name, dw_region(r.area) region,
                 coalesce(nullif(trim(both '-' from lower(regexp_replace(trim(r.name), '[^A-Za-z0-9]+', '-', 'g'))), ''), 'ba') slug
            from reps r
           where r.active and (r.role = 'merchandiser' or (r.role = 'tl_merch' and public.is_co_tl(r.id)))
             and (p_rep is null or r.id = p_rep)
             and not exists (select 1 from relief_roster ro
                              where ro.rep_id = r.id or lower(ro.name) = lower(r.name))) s;
  get diagnostics n = row_count;

  update relief_roster ro
     set active = (r.active and (r.role = 'merchandiser' or (r.role = 'tl_merch' and public.is_co_tl(r.id)))),
         updated_at = now()
    from reps r
   where ro.rep_id = r.id and ro.staff_type = 'full_time' and (p_rep is null or r.id = p_rep)
     and ro.active is distinct from (r.active and (r.role = 'merchandiser' or (r.role = 'tl_merch' and public.is_co_tl(r.id))));
  update relief_roster ro set staff_type = 'relief', active = r.active, updated_at = now()
    from reps r
   where ro.rep_id = r.id and ro.staff_type = 'full_time' and r.role = 'relief_merchandiser'
     and (p_rep is null or r.id = p_rep);
  update relief_roster ro set active = r.active, updated_at = now()
    from reps r
   where ro.rep_id = r.id and ro.staff_type = 'permanent_relief' and (p_rep is null or r.id = p_rep)
     and ro.active is distinct from r.active;
  return n;
end $function$;

create or replace function public.calc_tl_incentive(p_period text)
returns table(tl_rep_id uuid, tl_name text, tl_role text, region text, acting_for text, total_stores integer, stores_80 integer, stores_100 integer, incentive numeric, members jsonb, stores jsonb)
language sql stable security definer set search_path to 'public' as $function$
-- THE Team Leader incentive calculator. Every screen and the payroll read
-- this; nothing else computes it. Rules:
--   J$250/store at 80-99% of target, J$1,000/store at 100%+.
--   Team = TL + merchandisers/relief with team_lead_id = TL. A formal TL's
--   team also absorbs each tl_merch reporting to them (and that person's
--   team) unless reps.acting_tl_shares_credit = false. A sharing tl_merch is
--   credited over their formal TL's full team; a non-sharing one (or one
--   with no active formal TL) over their own team only.
--   Anyone who is themselves team_leader/tl_merch is excluded from every
--   incentive pool: their own stores pay via their BA commission.
--   CO-TLs (tl_co_leads, 2026-11-19) are access-only: no TL row of their own,
--   and they stay an ordinary member of their own TL's pool.
--   Route-only stores (merchandiser_map.commission_share = 0) are excluded,
--   except in a month the store sells merch_route_only_threshold() (J$250k)+.
--   A store held by two team members counts ONCE for the TL.
--   No target (or target <= 0) for the period: listed, never pays.
with r as (select * from reps where active),
co as (select distinct c.co_tl_rep_id as id from tl_co_leads c),
tl_names as (select x.name from r x where x.role in ('team_leader','tl_merch') and x.id not in (select id from co)),
own_team as (
  select l.id as leader_id, l.name as member from r l
  union
  select m.team_lead_id, m.name from r m
  where m.team_lead_id is not null
    and (m.role in ('merchandiser','relief_merchandiser') or m.id in (select id from co))
),
full_team as (
  select l.id as leader_id, o.member from r l join own_team o on o.leader_id = l.id
  union
  select d.team_lead_id, o.member from r d join own_team o on o.leader_id = d.id
  where d.role = 'tl_merch' and d.team_lead_id is not null and d.acting_tl_shares_credit is distinct from false
    and d.id not in (select id from co)
),
tls as (
  select t.id, t.name, t.role, t.area,
    (t.role = 'tl_merch' and t.acting_tl_shares_credit is distinct from false
      and exists (select 1 from r f where f.id = t.team_lead_id)) as shares
  from r t where t.role in ('team_leader','tl_merch') and t.id not in (select id from co)
),
roster as (
  select t.id as tl_id, ft.member from tls t join full_team ft on ft.leader_id = t.id
  where t.role = 'team_leader'
  union
  select t.id, ft.member from tls t join r me on me.id = t.id
  join full_team ft on ft.leader_id = me.team_lead_id
  where t.shares
  union
  select t.id, o.member from tls t join own_team o on o.leader_id = t.id
  where t.role = 'tl_merch' and not t.shares
),
members as (
  select ro.tl_id, ro.member from roster ro
  where ro.member not in (select n.name from tl_names n)
),
member_stores as (
  select distinct m.tl_id, m.member, mm.customer_id
  from members m
  join merchandiser_map mm on mm.merchandiser_name = m.member
  where mm.commission_share > 0
     or (coalesce((select sum(x.commission_share) from merchandiser_map x where x.customer_id = mm.customer_id), 0) = 0
         and coalesce((select max(f.actual_amount) from full_year_dashboard f
                       where f.customer_id = mm.customer_id and f.period = p_period), 0) >= merch_route_only_threshold())
),
perf as (
  select s.customer_id,
    coalesce(f.customer_name, s.customer_id) as customer_name,
    f.target_amount, coalesce(f.actual_amount, 0) as actual_amount,
    case
      when not (f.target_amount > 0) or f.target_amount is null then 'no_target'
      when coalesce(f.actual_amount,0) >= f.target_amount then '100'
      when coalesce(f.actual_amount,0) >= f.target_amount * 0.8 then '80'
      else 'below'
    end as tier
  from (select distinct customer_id from member_stores) s
  left join full_year_dashboard f on f.customer_id = s.customer_id and f.period = p_period
),
priced as (
  select p.*, case p.tier when '100' then 1000::numeric when '80' then 250::numeric else 0::numeric end as payout
  from perf p
),
tl_store as (
  select ms.tl_id, ms.customer_id, array_agg(ms.member order by ms.member) as held_by
  from member_stores ms group by ms.tl_id, ms.customer_id
),
tl_tot as (
  select ts.tl_id,
    count(*)::int as total_stores,
    count(*) filter (where p.tier = '80')::int as s80,
    count(*) filter (where p.tier = '100')::int as s100,
    sum(p.payout) as incentive,
    jsonb_agg(jsonb_build_object(
      'customer_id', p.customer_id, 'customer_name', p.customer_name,
      'target', p.target_amount, 'actual', p.actual_amount, 'tier', p.tier,
      'payout', p.payout, 'held_by', to_jsonb(ts.held_by))
      order by p.customer_name) as stores
  from tl_store ts join priced p on p.customer_id = ts.customer_id
  group by ts.tl_id
),
mem_tot as (
  select m.tl_id,
    jsonb_agg(jsonb_build_object(
      'name', m.member,
      'stores', coalesce(x.n, 0), 'stores_80', coalesce(x.s80, 0),
      'stores_100', coalesce(x.s100, 0), 'incentive', coalesce(x.earn, 0))
      order by m.member) as members
  from members m
  left join lateral (
    select count(*)::int n,
      count(*) filter (where p.tier = '80')::int s80,
      count(*) filter (where p.tier = '100')::int s100,
      sum(p.payout) earn
    from member_stores ms join priced p on p.customer_id = ms.customer_id
    where ms.tl_id = m.tl_id and ms.member = m.member
  ) x on true
  group by m.tl_id
)
select t.id, t.name::text, t.role::text, t.area::text,
  case when t.shares then (select f.name from r me join r f on f.id = me.team_lead_id where me.id = t.id) end::text,
  coalesce(tt.total_stores, 0), coalesce(tt.s80, 0), coalesce(tt.s100, 0),
  coalesce(tt.incentive, 0),
  coalesce(mt.members, '[]'::jsonb), coalesce(tt.stores, '[]'::jsonb)
from tls t
left join tl_tot tt on tt.tl_id = t.id
left join mem_tot mt on mt.tl_id = t.id
order by t.name;
$function$;
