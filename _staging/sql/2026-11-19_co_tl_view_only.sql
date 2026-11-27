-- Co-TL access levels (2026-11-19) — follows 2026-11-19_co_team_leaders.sql.
-- tl_co_leads.access = 'view' | 'full'.
--   view: sees everything the TL sees for that team, acts on none of it.
--   full: acts as a second TL.
-- Reads use tl_led_ids(me) (view + full); writes use tl_write_ids(me) (full only).
-- Jomo Thompson is 'view' on Coliesha Smith's team until the Dec 1 handover.
-- NOTE: leave approvals write leave_requests directly (UPDATE policy is any active
-- staff), so for leave the view-only block is client-side only — pre-existing.
-- Re-runnable.

alter table public.tl_co_leads add column if not exists access text not null default 'full';
do $$ begin
  alter table public.tl_co_leads add constraint tl_co_leads_access_chk check (access in ('view','full'));
exception when duplicate_object then null; end $$;

update public.tl_co_leads set access = 'view'
 where co_tl_rep_id = '13746d22-890d-4ba7-8174-b53e11701152'   -- Jomo Thompson
   and tl_rep_id    = 'a0583273-5273-4073-9c29-9c137dc295b0';  -- Coliesha Smith

create or replace function public.tl_write_ids(p_rep uuid)
returns uuid[] language sql stable security definer set search_path to 'public' as $$
  select array[p_rep] || coalesce((select array_agg(c.tl_rep_id) from tl_co_leads c
                                     join reps t on t.id = c.tl_rep_id and t.active
                                    where c.co_tl_rep_id = p_rep and c.access = 'full'), '{}');
$$;
revoke execute on function public.tl_write_ids(uuid) from public, anon, authenticated;

-- Client: {led, write} for the caller (or, for admin/manager, p_rep).
create or replace function public.get_tl_scope(p_rep uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_me uuid; v_rep uuid;
begin
  select p.rep_id into v_me from profiles p where p.id = auth.uid() and p.active;
  v_rep := coalesce(p_rep, v_me);
  if v_rep is null then return jsonb_build_object('led', '[]'::jsonb, 'write', '[]'::jsonb); end if;
  if v_rep is distinct from v_me and not public.is_manager() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  return jsonb_build_object('led', to_jsonb(tl_led_ids(v_rep)), 'write', to_jsonb(tl_write_ids(v_rep)));
end $$;
revoke execute on function public.get_tl_scope(uuid) from public, anon;
grant execute on function public.get_tl_scope(uuid) to authenticated;

-- Visit-store corrections: see with view access, decide with full access.
create or replace function public._visit_correction_is_approver(p_requester uuid)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.active and p.role in ('admin','manager'))
      or exists (select 1 from profiles p join reps tl on tl.id = p.rep_id and tl.active
                 join reps rq on rq.id = p_requester and rq.id <> tl.id
                             and rq.team_lead_id = any(public.tl_write_ids(tl.id))
                 where p.id = auth.uid() and p.active);
$function$;

create or replace function public._visit_correction_can_see(p_requester uuid)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select public._visit_correction_is_approver(p_requester)
      or exists (select 1 from profiles p where p.id = auth.uid() and p.active and p.rep_id = p_requester)
      or exists (select 1 from profiles p join reps tl on tl.id = p.rep_id and tl.active
                 join reps rq on rq.id = p_requester and rq.id <> tl.id
                             and rq.team_lead_id = any(public.tl_led_ids(tl.id))
                 where p.id = auth.uid() and p.active);
$function$;

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
       OR NOT (v_target.team_lead_id = any(public.tl_write_ids(v_rep.id))) THEN
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
        AND v_req.team_lead_rep_id = any(public.tl_write_ids(v_rep.id))
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

-- Signing: only teams with full access show up as "to sign" and can be signed.
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
             and emp.team_lead_id = any(public.tl_write_ids(v_me))
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
        and e.emp_tl = any(public.tl_write_ids(v_me)) and e.employee_rep_id is distinct from v_me then
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

-- Days worked scope with an explicit lead list; dw_scope_ids (reads) = all led teams.
create or replace function public._dw_scope(p_me uuid, p_all boolean, p_from date, p_to date, p_lead uuid[])
returns uuid[] language sql stable security definer set search_path to 'public' as $function$
  select coalesce(array_agg(distinct x), '{}') from (
    select r.id x from reps r
     where p_all and r.active and r.role in ('merchandiser','relief_merchandiser','tl_merch')
    union
    select r.id from reps r
     where not p_all and r.active and r.team_lead_id = any(p_lead) and r.id <> p_me
       and (r.role in ('merchandiser','relief_merchandiser') or (r.role = 'tl_merch' and public.is_co_tl(r.id)))
    union
    select v.user_id from merch_visit_log v
      join reps rr on rr.id = v.user_id and rr.role = 'relief_merchandiser'
      join merchandiser_map mm on mm.customer_id = v.customer_id
      join reps t on t.name = mm.merchandiser_name and t.team_lead_id = any(p_lead)
     where not p_all and v.visit_date between p_from and p_to
  ) s;
$function$;
revoke execute on function public._dw_scope(uuid, boolean, date, date, uuid[]) from public, anon, authenticated;

create or replace function public.dw_scope_ids(p_me uuid, p_all boolean, p_from date, p_to date)
returns uuid[] language sql stable security definer set search_path to 'public' as $function$
  select public._dw_scope(p_me, p_all, p_from, p_to, public.tl_led_ids(p_me));
$function$;

-- Payroll submission: only people on teams the TL has full access to.
create or replace function public.submit_tl_payroll(p_week_start date, p_lines jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
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

  v_ids := _dw_scope(v_me, false, v_fs, v_we, tl_write_ids(v_me));

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
end $function$;
