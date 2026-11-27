-- YTD per rep for the rep app's Admin tab leaderboard.
-- Actual uses the same rule as rep_dashboard_cache.monthly_actual
-- (_refresh_rep_dashboard_impl): invoiced_items by salesperson, credit memos
-- negative, house/route accounts excluded — just over Jan..this month instead
-- of this month only. Target = budget_2026 for the months already closed; the
-- client adds this month's target pro-rated by selling days.
-- Managers/admins only (is_manager()).
create or replace function public.get_rep_ytd_scoreboard()
returns table(salesperson text, ytd_budget_prior numeric, ytd_actual numeric)
language sql stable security definer
set search_path to 'public'
as $$
  with m as (
    select extract(month from (now() at time zone 'America/Jamaica'))::int mn,
           to_char(now() at time zone 'America/Jamaica','YYYY') yr,
           to_char(now() at time zone 'America/Jamaica','YYYYMM') cur
  ), bud as (
    select b.salesperson, sum(b.budget) prior
    from budget_2026 b, m where b.month_number < m.mn
    group by b.salesperson
  ), act as (
    select i.salesperson,
           sum(case when i.doc_type = 'Credit Memo' then -abs(i.ext_amount) else i.ext_amount end) ytd
    from invoiced_items i, m
    where i.financial_period between m.yr||'01' and m.cur
      and i.salesperson is not null
      and i.salesperson not in ('0','House','SHALLET ROUTE SALES')
    group by i.salesperson
  )
  select coalesce(b.salesperson, a.salesperson), coalesce(b.prior,0), coalesce(a.ytd,0)
  from bud b full join act a on a.salesperson = b.salesperson
  where public.is_manager()
$$;

revoke all on function public.get_rep_ytd_scoreboard() from public, anon;
grant execute on function public.get_rep_ytd_scoreboard() to authenticated;
