-- Relief lines may claim last week too (2026-11-26) — follows 2026-11-25_payroll_submit_scope.sql.
-- Angela Whitter could only tick this week's days for Qewon Campbell (relief, no
-- visits logged), so a missed week couldn't be caught up without switching the
-- form to "Last week" and losing this week's lines. The form now offers the week
-- before plus the selected week on every relief line (lineDays() in
-- shared/days-worked.js); this widens the matching server check. Dates already
-- payable in Relief Coverage are still skipped, so nothing can be claimed twice.
-- Only change from 2026-11-25: relief dates between p_week_start - 7 and v_we.
-- Re-runnable. CREATE OR REPLACE keeps the existing grants.

create or replace function public.submit_tl_payroll(p_week_start date, p_lines jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_me uuid; v_role text; v_tl text; v_tl_area text; v_ids uuid[]; v_id uuid; v_bad text;
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

  -- Same look-back as get_days_worked (v_to - 42), so the screen and the check agree.
  v_ids := _dw_scope(v_me, false, least(v_fs, v_today) - 42, greatest(v_we, v_today), tl_write_ids(v_me));

  select string_agg(coalesce(r.name, 'Unknown person') || ' (' || b.why || ')', ', ' order by b.n) into v_bad
    from (
      select n, x->>'rep_id' rid,
             case
               when (x->>'rep_id') is null then 'no person'
               when not ((x->>'rep_id')::uuid = any(v_ids)) then 'not on your team'
               when coalesce(x->>'kind','') not in ('relief','extra') then 'unknown line type'
               when jsonb_typeof(x->'dates') <> 'array' then 'no dates'
               when coalesce((x->>'rate')::numeric, -1) < 0 or (x->>'rate')::numeric > 100000 then 'missing or invalid rate'
               when exists (select 1 from jsonb_array_elements_text(x->'dates') dd
                             where (x->>'kind' = 'relief' and dd::date not between p_week_start - 7 and v_we))
                 then 'dates outside this week and last week'
               when exists (select 1 from jsonb_array_elements_text(x->'dates') dd
                             where (x->>'kind' = 'extra' and dd::date not between v_fs and v_fs + 13))
                 then 'dates outside this fortnight'
             end why
        from jsonb_array_elements(p_lines) with ordinality t(x, n)
    ) b
    left join reps r on r.id::text = b.rid
   where b.why is not null;
  if v_bad is not null then
    raise exception 'Check these lines — %', v_bad;
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
