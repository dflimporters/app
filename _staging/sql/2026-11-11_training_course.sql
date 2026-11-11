-- Training course completions (2026-11-11).
--
-- The course itself (tracks, modules, lessons, knowledge checks) lives in
-- /training/course-data.js. The database only records who completed which module:
--   training_completions — one row per person per module (first completion kept;
--   a retake updates last_reviewed_at and keeps the best score).
-- Tracks: 'ba' (merchandiser, relief_merchandiser) and 'tl' (team_leader, tl_merch).
-- The TL track includes the BA modules, so a module counts once whichever track
-- it was done in.
--
-- RPCs (SECURITY DEFINER, authenticated only):
--   training_mark_complete(module, course, score, total) — caller's own row
--   training_my_progress()                              — caller's own rows
--   training_log()  — admin/manager: every active field staff member;
--                     team_leader/tl_merch: their own team (reps.team_lead_id) + themselves

create table if not exists public.training_completions (
  id               uuid primary key default gen_random_uuid(),
  rep_id           uuid not null references public.reps(id) on delete cascade,
  module_key       text not null,
  course           text not null check (course in ('ba','tl')),
  score            int,
  total            int,
  completed_at     timestamptz not null default now(),
  last_reviewed_at timestamptz not null default now(),
  user_id          uuid default auth.uid(),
  unique (rep_id, module_key)
);
alter table public.training_completions enable row level security;
revoke all on public.training_completions from anon, authenticated;

create or replace function public.training_mark_complete(p_module text, p_course text, p_score int, p_total int)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_rep uuid; r training_completions;
begin
  select p.rep_id into v_rep from profiles p where p.id = auth.uid() and p.active;
  if v_rep is null then raise exception 'Your account is not linked to a staff record' using errcode = '42501'; end if;
  if p_module !~ '^[a-z0-9-]{2,40}$' then raise exception 'Unknown module'; end if;
  if p_course not in ('ba','tl') then raise exception 'Unknown course'; end if;
  if p_total is null or p_total < 1 or p_score is null or p_score < p_total then
    raise exception 'Answer every question correctly before marking the module complete';
  end if;
  insert into training_completions (rep_id, module_key, course, score, total)
  values (v_rep, p_module, p_course, p_score, p_total)
  on conflict (rep_id, module_key) do update
     set last_reviewed_at = now(), score = greatest(training_completions.score, excluded.score),
         total = excluded.total
  returning * into r;
  return to_jsonb(r);
end $$;
revoke all on function public.training_mark_complete(text, text, int, int) from public, anon;
grant execute on function public.training_mark_complete(text, text, int, int) to authenticated;

create or replace function public.training_my_progress()
returns setof public.training_completions language sql stable security definer set search_path = public as $$
  select c.* from training_completions c
    join profiles p on p.rep_id = c.rep_id
   where p.id = auth.uid() and p.active
   order by c.completed_at;
$$;
revoke all on function public.training_my_progress() from public, anon;
grant execute on function public.training_my_progress() to authenticated;

create or replace function public.training_log()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid; v_role text; v_all boolean; v_ids uuid[];
begin
  select p.rep_id, p.role into v_me, v_role from profiles p where p.id = auth.uid() and p.active;
  v_all := v_role in ('admin','manager');
  if not v_all and (v_role not in ('team_leader','tl_merch') or v_me is null) then
    raise exception 'The training log is for team leaders and managers' using errcode = '42501';
  end if;
  select coalesce(array_agg(r.id), '{}') into v_ids from reps r
   where r.active and r.role in ('merchandiser','relief_merchandiser','tl_merch','team_leader')
     and (v_all or r.team_lead_id = v_me or r.id = v_me);
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
end $$;
revoke all on function public.training_log() from public, anon;
grant execute on function public.training_log() to authenticated;
