-- Sales Support Hub: Friday meeting (18 Nov 2026). Approved by Scott in chat ("go ahead with both steps"); APPLIED as migration ss_hub_friday once the dry run passed.
-- Adds, and changes nothing that exists except adding one branch to ss_hub_data:
--   1. ss_hub_data part 'ar'  (read only): each of the support person's customers' open AR lines from the latest complete AR snapshot
--      (ar_aging_rows, taken daily at 6am), and each customer's last payment. Same source as key_hub_data; head-office accounts are not pulled in.
--   2. ss_hub_plans            one row per rep and week: the plan made in the Friday meeting (jsonb), whether the meeting was held, who saved it.
--   3. ss_hub_rep_access(rep)  Scott / admins, or the support person who covers that rep. The plan table's rules use it.
--   4. ss_hub_plan_report(week) every support person's reps with their plan for a week (Scott / admins only): the report back to Scott.
do $$
declare d text;
        arpart text := $q$  elsif p_part = 'ar' then
    -- open AR lines for the support person's customers (latest complete snapshot) and each customer's last payment
    select json_build_object(
      'asof', (select snapshot_date from ar_aging_snapshots where id = (select max(id) from ar_aging_snapshots where status = 'complete')),
      'ar', (select json_agg(json_build_array(customer_id, doc_type, ref_nbr, to_char(doc_date,'YYYY-MM-DD'), to_char(due_date,'YYYY-MM-DD'), round(balance_jmd), days_aged, is_credit, terms)) from ar_aging_rows where snapshot_id = (select max(id) from ar_aging_snapshots where status = 'complete') and customer_id in (select customer_id from ss_s) and balance_jmd <> 0),
      'lastpay', (select json_agg(json_build_array(customer_id, to_char(payment_date,'YYYY-MM-DD'), rcpt)) from (select distinct on (customer_id) customer_id, payment_date, rcpt from (select customer_id, payment_date, payment_ref, max(payment_receipt_total) rcpt from ar_payments where customer_id in (select customer_id from ss_s) and payment_type = 'Payment' and payment_date >= current_date - 200 and not coalesce(is_missing,false) group by 1,2,3) q order by customer_id, payment_date desc) lp)
    ) into v_out;

$q$;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.proname = 'ss_hub_data' and p.pronamespace = 'public'::regnamespace;
  if (length(d) - length(replace(d, '  elsif p_part = ''inv'' then', ''))) / length('  elsif p_part = ''inv'' then') <> 1
     or position('''ar''' in d) > 0 then
    raise exception 'ss_hub_data is not in the expected shape';
  end if;
  d := replace(d, '  elsif p_part = ''inv'' then', arpart || '  elsif p_part = ''inv'' then');
  execute d;
end $$;

-- 3. who may read / write a rep's plan
create or replace function public.ss_hub_rep_access(p_rep text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.is_price_approver()
      or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
      or exists (select 1 from ss_hub_support s join profiles p on p.full_name = s.full_name
                 where p.id = auth.uid() and p_rep = any (s.reps));
$$;
revoke all on function public.ss_hub_rep_access(text) from public, anon;
grant execute on function public.ss_hub_rep_access(text) to authenticated;

-- 2. the plans
create table if not exists public.ss_hub_plans (
  rep text not null,                        -- salesperson name exactly as in ss_hub_support.reps
  week_start date not null,                 -- the Monday of the week the plan is for
  support text not null,                    -- first name of the support person who held the meeting
  data jsonb not null default '{}'::jsonb,  -- goal, visits, collect, push, help, blockers
  met boolean not null default false,       -- ticked once the support person and rep have been through it together
  met_on date,
  by uuid default auth.uid(), by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (rep, week_start)
);
alter table public.ss_hub_plans enable row level security;
drop policy if exists ss_hub_plans_read on public.ss_hub_plans;
create policy ss_hub_plans_read on public.ss_hub_plans for select to authenticated using (public.ss_hub_rep_access(rep));
drop policy if exists ss_hub_plans_add on public.ss_hub_plans;
create policy ss_hub_plans_add on public.ss_hub_plans for insert to authenticated with check (public.ss_hub_rep_access(rep) and by = auth.uid());
drop policy if exists ss_hub_plans_change on public.ss_hub_plans;
create policy ss_hub_plans_change on public.ss_hub_plans for update to authenticated using (public.ss_hub_rep_access(rep)) with check (public.ss_hub_rep_access(rep) and by = auth.uid());
grant select, insert, update on public.ss_hub_plans to authenticated;

-- 4. the report back to Scott: every support person's reps, with the plan (or null) for the week
create or replace function public.ss_hub_plan_report(p_week date)
returns json language sql stable security definer set search_path to 'public' as $$
  select json_agg(json_build_object('support', s.support, 'rep', r.rep,
           'plan', (select to_json(p) from (select data, met, met_on, by_name, updated_at from ss_hub_plans where rep = r.rep and week_start = p_week) p))
         order by array_position(array['Alecia','Jenelle','Althia'], s.support), r.rep)
  from ss_hub_support s, unnest(s.reps) r(rep)
  where public.is_price_approver() or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin');
$$;
revoke all on function public.ss_hub_plan_report(date) from public, anon;
grant execute on function public.ss_hub_plan_report(date) to authenticated;
