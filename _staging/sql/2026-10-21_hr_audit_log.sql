-- HR access to the full evaluation + store audit log.
-- Applied via apply_migration 'hr_audit_log' on 2026-10-21.

-- 1. HR sees every TL's Win the Week / Win the Quarter (was managers only).
create or replace function public.get_tl_kpi(p_tl_rep_id uuid default null, p_date date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_all   boolean := public.is_manager() or public.is_hr() or coalesce(auth.role(),'') = 'service_role';
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

-- 2. HR evaluation pages match people by staff ID first, name only as fallback.
create or replace function public.get_hr_evaluations()
returns table(id uuid, created_at timestamptz, source text, filled_by_role text, employee_name text,
  job_position text, review_period text, reviewed_by text, scores jsonb, comments jsonb, total_score integer,
  rating text, employee_feedback text, employee_signed boolean, supervisor_signed boolean, manager_signed boolean,
  scan_file_url text, notes text, rep_id uuid, roster_role text, area text, team_leader text,
  hr_processed_at timestamptz, hr_processed_by text, hr_note text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_hr() then raise exception 'Not authorised'; end if;
  return query
  select e.id, e.created_at, e.source, e.filled_by_role,
         e.employee_name, e.position, e.review_period, e.reviewed_by,
         jsonb_build_object(
           'stock_monitoring', e.score_stock_monitoring, 'attendance', e.score_attendance,
           'collaboration', e.score_collaboration, 'rotation_of_goods', e.score_rotation_of_goods,
           'creative_thinking', e.score_creative_thinking, 'data_analysis', e.score_data_analysis,
           'time_management', e.score_time_management, 'industry_knowledge', e.score_industry_knowledge,
           'shelf_display', e.score_shelf_display, 'proactive_communication', e.score_proactive_communication,
           'shelf_maintenance', e.score_shelf_maintenance, 'customer_attentiveness', e.score_customer_attentiveness),
         jsonb_strip_nulls(jsonb_build_object(
           'stock_monitoring', e.comments_stock_monitoring, 'attendance', e.comments_attendance,
           'collaboration', e.comments_collaboration, 'rotation_of_goods', e.comments_rotation_of_goods,
           'creative_thinking', e.comments_creative_thinking, 'data_analysis', e.comments_data_analysis,
           'time_management', e.comments_time_management, 'industry_knowledge', e.comments_industry_knowledge,
           'shelf_display', e.comments_shelf_display, 'proactive_communication', e.comments_proactive_communication,
           'shelf_maintenance', e.comments_shelf_maintenance, 'customer_attentiveness', e.comments_customer_attentiveness)),
         e.total_score, e.rating,
         e.employee_feedback, coalesce(e.employee_signed,false), coalesce(e.supervisor_signed,false), coalesce(e.manager_signed,false),
         e.scan_file_url, e.notes,
         r.id, r.role, r.area, tl.name,
         e.hr_processed_at, e.hr_processed_by, e.hr_note
  from merchandiser_evaluations e
  left join lateral (
    select x.id, x.role, x.area, x.team_lead_id from reps x
    where x.id = e.employee_rep_id
       or (e.employee_rep_id is null and public.hr_norm_name(x.name) = public.hr_norm_name(e.employee_name))
    order by (x.id = e.employee_rep_id) desc nulls last, x.active desc limit 1
  ) r on true
  left join reps tl on tl.id = r.team_lead_id
  order by e.created_at desc, e.id desc;
end $$;

create or replace function public.get_hr_eval_roster()
returns table(rep_id uuid, name text, role text, area text, team_leader text, eval_count integer,
  last_eval_at timestamptz, last_rating text, last_total integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_hr() then raise exception 'Not authorised'; end if;
  return query
  with ev as (
    select e.created_at, e.rating, e.total_score, coalesce(e.employee_rep_id,
             (select x.id from reps x where public.hr_norm_name(x.name) = public.hr_norm_name(e.employee_name)
               order by x.active desc limit 1)) as who
      from merchandiser_evaluations e
  )
  select r.id, r.name, r.role, r.area, tl.name,
         (select count(*)::int from ev where ev.who = r.id),
         le.created_at, le.rating, le.total_score
  from reps r
  left join reps tl on tl.id = r.team_lead_id
  left join lateral (
    select ev.created_at, ev.rating, ev.total_score from ev where ev.who = r.id
    order by ev.created_at desc limit 1
  ) le on true
  where r.active = true and r.role in ('merchandiser','tl_merch')
  order by r.name;
end $$;

-- 3. Every store audit, for HR, with roster details resolved by ID.
create or replace function public.get_hr_store_audits()
returns table(id uuid, created_at timestamptz, audit_date date, customer_id text, store_name text,
  auditor_name text, auditor_rep_id uuid, auditor_role text,
  merchandiser_name text, merchandiser_rep_id uuid, area text, ba_team_leader text,
  scores jsonb, notes jsonb, overall_notes text, score_pct integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_hr() then raise exception 'Not authorised'; end if;
  return query
  select a.id, a.created_at, a.audit_date, a.customer_id, a.store_name,
         coalesce(au.name, a.tl_name), a.tl_rep_id, au.role,
         coalesce(ba.name, a.merchandiser_name), a.merchandiser_rep_id, ba.area, btl.name,
         jsonb_build_object('shelves_clean', a.shelves_clean, 'shelf_presence', a.shelf_presence,
           'facing_correct', a.facing_correct, 'rotation_correct', a.rotation_correct,
           'pricing_correct', a.pricing_correct, 'pos_materials', a.pos_materials),
         jsonb_strip_nulls(jsonb_build_object('shelves_clean', a.shelves_clean_notes, 'shelf_presence', a.shelf_presence_notes,
           'facing_correct', a.facing_notes, 'rotation_correct', a.rotation_notes,
           'pricing_correct', a.pricing_notes, 'pos_materials', a.pos_notes)),
         a.overall_notes,
         (select round(avg(v)/5*100)::int from unnest(array[a.shelves_clean, a.shelf_presence, a.facing_correct,
            a.rotation_correct, a.pricing_correct, a.pos_materials]) v where v > 0)
  from merch_store_audits a
  left join reps au  on au.id = a.tl_rep_id
  left join reps ba  on ba.id = a.merchandiser_rep_id
  left join reps btl on btl.id = ba.team_lead_id
  order by a.created_at desc, a.id desc;
end $$;

revoke execute on function public.get_hr_store_audits() from public, anon;
grant execute on function public.get_hr_store_audits() to authenticated;
